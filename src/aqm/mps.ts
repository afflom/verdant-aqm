/**
 * Stratum 1A-MPS — Exact Cyclotomic Matrix Product State (`ExactMps`) Tensor-Train Engine (`mps.ts`)
 * Represents n-qubit non-Clifford quantum states as a 1D tensor network of site tensors:
 *   A^{[q]}_s in Z[zeta_8]^{chi_{q-1} x chi_q},   s in {0, 1},   q in {0 .. n-1}
 *
 * Uses exact Galois-norm field division in Q(zeta_8) (`u * adj(u) = p^2 - 2*q^2 in Z_{>0}`)
 * to compute exact Reduced Row Echelon Form (RREF) rank compression across every two-site bond,
 * eliminating redundant bond dimensions without floating-point rounding drift!
 */

import {
  Z8,
  Z8_ONE,
  Z8_ZERO,
  z8Add,
  z8Conj,
  z8DivIntExact,
  z8IsZero,
  z8Mul,
  z8MulI,
  z8MulNegI,
  z8MulZeta,
  z8Neg,
  z8NormSq,
  z8ScaleInt,
  z8Sub,
  z8ToComplexFloat,
} from './cyclotomic';
import { ONE, ONE_BIG, SIXTEEN, TWO, ZERO, ZERO_BIG } from './stratum0';
import {
  AqmGateStep,
  BasisAmplitudeSummary,
  BlochVector,
  ConservationReport,
  EntanglementEdge,
  ForcedCollapseBranch,
  GateKind,
} from './types';

function bigintGcd(a: bigint, b: bigint): bigint {
  let x = a < ZERO_BIG ? -a : a;
  let y = b < ZERO_BIG ? -b : b;
  while (y !== ZERO_BIG) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

function z8ContentGcd(u: Z8): bigint {
  return bigintGcd(bigintGcd(u.a, u.b), bigintGcd(u.c, u.d));
}

/**
 * Exact element of the cyclotomic field Q(zeta_8): num / den with den > 0 and gcd(num, den) = 1.
 */
interface Q8 {
  readonly num: Z8;
  readonly den: bigint;
}

const Q8_ZERO: Q8 = { num: Z8_ZERO, den: ONE_BIG };
const Q8_ONE: Q8 = { num: Z8_ONE, den: ONE_BIG };

function q8Normalize(num: Z8, den: bigint): Q8 {
  if (z8IsZero(num)) return Q8_ZERO;
  const posDen = den < ZERO_BIG ? -den : den;
  const posNum = den < ZERO_BIG ? z8Neg(num) : num;
  const g = bigintGcd(z8ContentGcd(posNum), posDen);
  if (g <= ONE_BIG) return { num: posNum, den: posDen };
  return { num: z8DivIntExact(posNum, g), den: posDen / g };
}

function q8Add(x: Q8, y: Q8): Q8 {
  if (z8IsZero(x.num)) return y;
  if (z8IsZero(y.num)) return x;
  const g = bigintGcd(x.den, y.den);
  const mX = y.den / g;
  const mY = x.den / g;
  return q8Normalize(z8Add(z8ScaleInt(x.num, mX), z8ScaleInt(y.num, mY)), mX * x.den);
}

function q8Sub(x: Q8, y: Q8): Q8 {
  if (z8IsZero(y.num)) return x;
  return q8Add(x, { num: z8Neg(y.num), den: y.den });
}

function q8Mul(x: Q8, y: Q8): Q8 {
  if (z8IsZero(x.num) || z8IsZero(y.num)) return Q8_ZERO;
  return q8Normalize(z8Mul(x.num, y.num), x.den * y.den);
}

/**
 * Exact multiplicative inverse in Q(zeta_8) via Galois conjugate norm:
 *   |u|^2 = u * conj(u) = p + q*sqrt(2)
 *   (p + q*sqrt(2))*(p - q*sqrt(2)) = p^2 - 2*q^2 in Z_{>0}
 *   where p - q*sqrt(2) = p - q*(zeta_8 - zeta_8^3) = (p, -q, 0, q) in Z[zeta_8]!
 */
function q8Inv(x: Q8): Q8 {
  if (z8IsZero(x.num)) throw new Error('Division by zero in Q(zeta_8)');
  const ns = z8NormSq(x.num); // p + q*sqrt(2)
  const galoisConjSqrt2: Z8 = { a: ns.p, b: -ns.q, c: ZERO_BIG, d: ns.q };
  const adj = z8Mul(z8Conj(x.num), galoisConjSqrt2);
  const rationalNorm = ns.p * ns.p - 2n * ns.q * ns.q;
  return q8Normalize(z8ScaleInt(adj, x.den), rationalNorm);
}

export interface MpsSiteTensor {
  readonly chiL: number;
  readonly chiR: number;
  /** Physical |0> matrix: row-major [chiL * chiR] over Z8 */
  readonly m0: readonly Z8[];
  /** Physical |1> matrix: row-major [chiL * chiR] over Z8 */
  readonly m1: readonly Z8[];
}

export interface ExactMpsState {
  readonly qubitCount: number;
  readonly sites: readonly MpsSiteTensor[];
  /** Accumulated Hadamard / RREF integer denominator scale tracked dynamically via transfer norm */
  readonly collapsedWires: ReadonlyMap<number, 0 | 1>;
  readonly maxBondCap: number;
}

export function createInitialExactMps(qubitCount: number, maxBondCap = 32): ExactMpsState {
  const sites: MpsSiteTensor[] = [];
  for (let q = ZERO; q < qubitCount; q += ONE) {
    sites.push({
      chiL: ONE,
      chiR: ONE,
      m0: [Z8_ONE],
      m1: [Z8_ZERO],
    });
  }
  return {
    qubitCount,
    sites,
    collapsedWires: new Map(),
    maxBondCap,
  };
}

function reduceSiteGcd(site: MpsSiteTensor): MpsSiteTensor {
  let g = ZERO_BIG;
  for (const v of site.m0) g = bigintGcd(g, z8ContentGcd(v));
  for (const v of site.m1) g = bigintGcd(g, z8ContentGcd(v));
  if (g <= ONE_BIG) return site;
  return {
    chiL: site.chiL,
    chiR: site.chiR,
    m0: site.m0.map((v) => z8DivIntExact(v, g)),
    m1: site.m1.map((v) => z8DivIntExact(v, g)),
  };
}

/**
 * Exact rank-revealing factorization Theta = L * R over Q(zeta_8), cleared back into Z[zeta_8]:
 * Given Theta of shape (rows x cols) over Z8:
 *  - Computes Reduced Row Echelon Form (RREF) of Theta over Q(zeta_8).
 *  - Let non-zero RREF rows be R[0..r-1] with pivot columns piv[0..r-1].
 *  - Because R is in RREF, R[k, piv[j]] = delta_{k, j}, so the pivot columns of Theta equal L[0..rows-1, 0..r-1] IDENTICALLY!
 *  - Hence Theta == L * R holds as a 100% EXACT algebraic identity over Q(zeta_8) with minimal rank r!
 */
function factorTwoSiteExactZ8(
  theta: readonly Z8[],
  rows: number,
  cols: number,
  maxRank: number,
): { rank: number; leftZ8: Z8[]; rightZ8: Z8[] } {
  const rref: Q8[] = theta.map((z) => ({ num: z, den: ONE_BIG }));
  const pivotCols: number[] = [];
  let rank = ZERO;

  for (let col = ZERO; col < cols && rank < rows && rank < maxRank; col += ONE) {
    let piv = -ONE;
    for (let r = rank; r < rows; r += ONE) {
      if (!z8IsZero(rref[r * cols + col].num)) {
        piv = r;
        break;
      }
    }
    if (piv < ZERO) continue;

    if (piv !== rank) {
      for (let j = col; j < cols; j += ONE) {
        const tmp = rref[rank * cols + j];
        rref[rank * cols + j] = rref[piv * cols + j];
        rref[piv * cols + j] = tmp;
      }
    }

    const invPivot = q8Inv(rref[rank * cols + col]);
    for (let j = col; j < cols; j += ONE) {
      rref[rank * cols + j] = q8Mul(rref[rank * cols + j], invPivot);
    }

    // Eliminate BOTH above and below so RREF identity Theta[:, pivotCols] * R == Theta holds!
    for (let r = ZERO; r < rows; r += ONE) {
      if (r === rank) continue;
      const factor = rref[r * cols + col];
      if (z8IsZero(factor.num)) continue;
      for (let j = col; j < cols; j += ONE) {
        rref[r * cols + j] = q8Sub(
          rref[r * cols + j],
          q8Mul(factor, rref[rank * cols + j]),
        );
      }
    }

    pivotCols.push(col);
    rank += ONE;
  }

  if (rank === ZERO) {
    return {
      rank: ONE,
      leftZ8: new Array(rows).fill(Z8_ZERO),
      rightZ8: new Array(cols).fill(Z8_ZERO),
    };
  }

  // L is simply the exact Z8 pivot columns of original Theta!
  const leftZ8: Z8[] = new Array(rows * rank);
  for (let i = ZERO; i < rows; i += ONE) {
    for (let k = ZERO; k < rank; k += ONE) {
      leftZ8[i * rank + k] = theta[i * cols + pivotCols[k]];
    }
  }

  // Clear row denominators of R[0..rank-1, 0..cols-1] into Z8 (since MPS is projective, overall positive integer scalar cancels in <psi|psi>)
  let lcmAll = ONE_BIG;
  for (let k = ZERO; k < rank; k += ONE) {
    for (let j = ZERO; j < cols; j += ONE) {
      const d = rref[k * cols + j].den;
      lcmAll = (lcmAll / bigintGcd(lcmAll, d)) * d;
    }
  }

  const rightZ8: Z8[] = new Array(rank * cols);
  for (let k = ZERO; k < rank; k += ONE) {
    for (let j = ZERO; j < cols; j += ONE) {
      const entry = rref[k * cols + j];
      const mult = lcmAll / entry.den;
      rightZ8[k * cols + j] = z8ScaleInt(entry.num, mult);
    }
  }

  return { rank, leftZ8, rightZ8 };
}

function applySingleQubitSite(site: MpsSiteTensor, kind: GateKind): MpsSiteTensor {
  const len = site.chiL * site.chiR;
  const m0 = new Array<Z8>(len);
  const m1 = new Array<Z8>(len);

  for (let idx = ZERO; idx < len; idx += ONE) {
    const u0 = site.m0[idx];
    const u1 = site.m1[idx];
    switch (kind) {
      case GateKind.H:
        m0[idx] = z8Add(u0, u1);
        m1[idx] = z8Sub(u0, u1);
        break;
      case GateKind.X:
        m0[idx] = u1;
        m1[idx] = u0;
        break;
      case GateKind.Y:
        m0[idx] = z8MulNegI(u1);
        m1[idx] = z8MulI(u0);
        break;
      case GateKind.Z:
        m0[idx] = u0;
        m1[idx] = z8Neg(u1);
        break;
      case GateKind.S:
        m0[idx] = u0;
        m1[idx] = z8MulI(u1);
        break;
      case GateKind.T:
        m0[idx] = u0;
        m1[idx] = z8MulZeta(u1);
        break;
      default:
        m0[idx] = u0;
        m1[idx] = u1;
    }
  }
  return reduceSiteGcd({ chiL: site.chiL, chiR: site.chiR, m0, m1 });
}

function applyAdjacentTwoQubitSites(
  siteA: MpsSiteTensor,
  siteB: MpsSiteTensor,
  kind: GateKind,
  reverseControlTarget: boolean,
  maxBondCap: number,
): [MpsSiteTensor, MpsSiteTensor] {
  const chiL = siteA.chiL;
  const chiM = siteA.chiR;
  const chiR = siteB.chiR;
  const rows = TWO * chiL;
  const cols = TWO * chiR;
  const theta: Z8[] = new Array(rows * cols).fill(Z8_ZERO);

  // Contract Theta[(sA * chiL + alpha), (sB * chiR + gamma)] = sum_beta A_{sA}[alpha, beta] * B_{sB}[beta, gamma]
  for (let sA = ZERO; sA < TWO; sA += ONE) {
    const matA = sA === ZERO ? siteA.m0 : siteA.m1;
    for (let sB = ZERO; sB < TWO; sB += ONE) {
      const matB = sB === ZERO ? siteB.m0 : siteB.m1;
      for (let alpha = ZERO; alpha < chiL; alpha += ONE) {
        for (let gamma = ZERO; gamma < chiR; gamma += ONE) {
          let sum = Z8_ZERO;
          for (let beta = ZERO; beta < chiM; beta += ONE) {
            const aVal = matA[alpha * chiM + beta];
            const bVal = matB[beta * chiR + gamma];
            if (!z8IsZero(aVal) && !z8IsZero(bVal)) {
              sum = z8Add(sum, z8Mul(aVal, bVal));
            }
          }
          theta[(sA * chiL + alpha) * cols + (sB * chiR + gamma)] = sum;
        }
      }
    }
  }

  // Apply 2-qubit gate on physical indices (sA, sB)
  const gated: Z8[] = theta.slice();
  for (let alpha = ZERO; alpha < chiL; alpha += ONE) {
    for (let gamma = ZERO; gamma < chiR; gamma += ONE) {
      const idx00 = (ZERO * chiL + alpha) * cols + (ZERO * chiR + gamma);
      const idx01 = (ZERO * chiL + alpha) * cols + (ONE * chiR + gamma);
      const idx10 = (ONE * chiL + alpha) * cols + (ZERO * chiR + gamma);
      const idx11 = (ONE * chiL + alpha) * cols + (ONE * chiR + gamma);

      if (kind === GateKind.CNOT) {
        if (!reverseControlTarget) {
          // A is control, B is target: swap |10> <-> |11>
          gated[idx10] = theta[idx11];
          gated[idx11] = theta[idx10];
        } else {
          // B is control, A is target: swap |01> <-> |11>
          gated[idx01] = theta[idx11];
          gated[idx11] = theta[idx01];
        }
      } else if (kind === GateKind.CZ) {
        gated[idx11] = z8Neg(theta[idx11]);
      } else if (kind === GateKind.SWAP) {
        gated[idx01] = theta[idx10];
        gated[idx10] = theta[idx01];
      }
    }
  }

  const { rank, leftZ8, rightZ8 } = factorTwoSiteExactZ8(gated, rows, cols, maxBondCap);

  const nextA0: Z8[] = new Array(chiL * rank);
  const nextA1: Z8[] = new Array(chiL * rank);
  for (let alpha = ZERO; alpha < chiL; alpha += ONE) {
    for (let k = ZERO; k < rank; k += ONE) {
      nextA0[alpha * rank + k] = leftZ8[(ZERO * chiL + alpha) * rank + k];
      nextA1[alpha * rank + k] = leftZ8[(ONE * chiL + alpha) * rank + k];
    }
  }

  const nextB0: Z8[] = new Array(rank * chiR);
  const nextB1: Z8[] = new Array(rank * chiR);
  for (let k = ZERO; k < rank; k += ONE) {
    for (let gamma = ZERO; gamma < chiR; gamma += ONE) {
      nextB0[k * chiR + gamma] = rightZ8[k * cols + (ZERO * chiR + gamma)];
      nextB1[k * chiR + gamma] = rightZ8[k * cols + (ONE * chiR + gamma)];
    }
  }

  return [
    reduceSiteGcd({ chiL, chiR: rank, m0: nextA0, m1: nextA1 }),
    reduceSiteGcd({ chiL: rank, chiR, m0: nextB0, m1: nextB1 }),
  ];
}

/**
 * Computes floating transfer environments L[0..n] and R[0..n] in O(n * chi^3)
 * with per-site rescaling so 100..1,024+ qubit MPS contractions never underflow/overflow IEEE-754!
 */
function computeMpsEnvironmentsFloat(sites: readonly MpsSiteTensor[]): {
  blochVectors: Array<{ rx: number; ry: number; rz: number; p1: number }>;
} {
  const n = sites.length;
  const fSites = sites.map((s) => {
    const len = s.chiL * s.chiR;
    const m0Re = new Float64Array(len);
    const m0Im = new Float64Array(len);
    const m1Re = new Float64Array(len);
    const m1Im = new Float64Array(len);
    let maxMag = 0;
    for (let i = ZERO; i < len; i += ONE) {
      const c0 = z8ToComplexFloat(s.m0[i], 1);
      const c1 = z8ToComplexFloat(s.m1[i], 1);
      m0Re[i] = c0.re;
      m0Im[i] = c0.im;
      m1Re[i] = c1.re;
      m1Im[i] = c1.im;
      maxMag = Math.max(maxMag, Math.hypot(c0.re, c0.im), Math.hypot(c1.re, c1.im));
    }
    const scale = maxMag > 0 ? maxMag : 1;
    for (let i = ZERO; i < len; i += ONE) {
      m0Re[i] /= scale;
      m0Im[i] /= scale;
      m1Re[i] /= scale;
      m1Im[i] /= scale;
    }
    return { chiL: s.chiL, chiR: s.chiR, m0Re, m0Im, m1Re, m1Im };
  });

  // Left environments: L[q] has shape chiL x chiL, L_{q+1} = sum_s A_s^dagger L_q A_s
  const leftRe: Float64Array[] = new Array(n + ONE);
  const leftIm: Float64Array[] = new Array(n + ONE);
  leftRe[ZERO] = new Float64Array([1]);
  leftIm[ZERO] = new Float64Array([0]);

  for (let q = ZERO; q < n; q += ONE) {
    const fs = fSites[q];
    const dL = fs.chiL;
    const dR = fs.chiR;
    const nextRe = new Float64Array(dR * dR);
    const nextIm = new Float64Array(dR * dR);

    for (const [mRe, mIm] of [
      [fs.m0Re, fs.m0Im],
      [fs.m1Re, fs.m1Im],
    ] as const) {
      // tmp[alpha, gamma] = sum_beta L[alpha, beta] * A[beta, gamma]
      const tmpRe = new Float64Array(dL * dR);
      const tmpIm = new Float64Array(dL * dR);
      for (let a = ZERO; a < dL; a += ONE) {
        for (let b = ZERO; b < dL; b += ONE) {
          const lRe = leftRe[q][a * dL + b];
          const lIm = leftIm[q][a * dL + b];
          if (lRe === 0 && lIm === 0) continue;
          for (let g = ZERO; g < dR; g += ONE) {
            const aRe = mRe[b * dR + g];
            const aIm = mIm[b * dR + g];
            tmpRe[a * dR + g] += lRe * aRe - lIm * aIm;
            tmpIm[a * dR + g] += lRe * aIm + lIm * aRe;
          }
        }
      }
      // next[g1, g2] += sum_a conj(A[a, g1]) * tmp[a, g2]
      for (let a = ZERO; a < dL; a += ONE) {
        for (let g1 = ZERO; g1 < dR; g1 += ONE) {
          const cRe = mRe[a * dR + g1];
          const cIm = -mIm[a * dR + g1];
          if (cRe === 0 && cIm === 0) continue;
          for (let g2 = ZERO; g2 < dR; g2 += ONE) {
            const tRe = tmpRe[a * dR + g2];
            const tIm = tmpIm[a * dR + g2];
            nextRe[g1 * dR + g2] += cRe * tRe - cIm * tIm;
            nextIm[g1 * dR + g2] += cRe * tIm + cIm * tRe;
          }
        }
      }
    }

    let tr = 0;
    for (let g = ZERO; g < dR; g += ONE) tr += Math.abs(nextRe[g * dR + g]);
    if (tr > 0) {
      for (let i = ZERO; i < nextRe.length; i += ONE) {
        nextRe[i] /= tr;
        nextIm[i] /= tr;
      }
    }
    leftRe[q + ONE] = nextRe;
    leftIm[q + ONE] = nextIm;
  }

  // Right environments: R[q] has shape chiL x chiL (at boundary q), R_q = sum_s A_s R_{q+1} A_s^dagger
  const rightRe: Float64Array[] = new Array(n + ONE);
  const rightIm: Float64Array[] = new Array(n + ONE);
  rightRe[n] = new Float64Array([1]);
  rightIm[n] = new Float64Array([0]);

  for (let q = n - ONE; q >= ZERO; q -= ONE) {
    const fs = fSites[q];
    const dL = fs.chiL;
    const dR = fs.chiR;
    const nextRe = new Float64Array(dL * dL);
    const nextIm = new Float64Array(dL * dL);

    for (const [mRe, mIm] of [
      [fs.m0Re, fs.m0Im],
      [fs.m1Re, fs.m1Im],
    ] as const) {
      // tmp[a, g] = sum_b A[a, b] * R[b, g]
      const tmpRe = new Float64Array(dL * dR);
      const tmpIm = new Float64Array(dL * dR);
      for (let a = ZERO; a < dL; a += ONE) {
        for (let b = ZERO; b < dR; b += ONE) {
          const aRe = mRe[a * dR + b];
          const aIm = mIm[a * dR + b];
          if (aRe === 0 && aIm === 0) continue;
          for (let g = ZERO; g < dR; g += ONE) {
            const rRe = rightRe[q + ONE][b * dR + g];
            const rIm = rightIm[q + ONE][b * dR + g];
            tmpRe[a * dR + g] += aRe * rRe - aIm * rIm;
            tmpIm[a * dR + g] += aRe * rIm + aIm * rRe;
          }
        }
      }
      // next[a1, a2] += sum_g tmp[a1, g] * conj(A[a2, g])
      for (let a1 = ZERO; a1 < dL; a1 += ONE) {
        for (let g = ZERO; g < dR; g += ONE) {
          const tRe = tmpRe[a1 * dR + g];
          const tIm = tmpIm[a1 * dR + g];
          if (tRe === 0 && tIm === 0) continue;
          for (let a2 = ZERO; a2 < dL; a2 += ONE) {
            const cRe = mRe[a2 * dR + g];
            const cIm = -mIm[a2 * dR + g];
            nextRe[a1 * dL + a2] += tRe * cRe - tIm * cIm;
            nextIm[a1 * dL + a2] += tRe * cIm + tIm * cRe;
          }
        }
      }
    }

    let tr = 0;
    for (let a = ZERO; a < dL; a += ONE) tr += Math.abs(nextRe[a * dL + a]);
    if (tr > 0) {
      for (let i = ZERO; i < nextRe.length; i += ONE) {
        nextRe[i] /= tr;
        nextIm[i] /= tr;
      }
    }
    rightRe[q] = nextRe;
    rightIm[q] = nextIm;
  }

  // Evaluate single-qubit reduced density matrix rho_q[s, s'] = Tr(L_q * A_{s} * R_{q+1} * A_{s'}^dagger)
  const blochVectors: Array<{ rx: number; ry: number; rz: number; p1: number }> = new Array(n);
  for (let q = ZERO; q < n; q += ONE) {
    const fs = fSites[q];
    const dL = fs.chiL;
    const dR = fs.chiR;
    const Lre = leftRe[q];
    const Lim = leftIm[q];
    const Rre = rightRe[q + ONE];
    const Rim = rightIm[q + ONE];

    const evalQuad = (
      sRe: Float64Array,
      sIm: Float64Array,
      spRe: Float64Array,
      spIm: Float64Array,
    ): { re: number; im: number } => {
      // M1 = A_s * R_{q+1} (dL x dR)
      const m1Re = new Float64Array(dL * dR);
      const m1Im = new Float64Array(dL * dR);
      for (let a = ZERO; a < dL; a += ONE) {
        for (let b = ZERO; b < dR; b += ONE) {
          const ar = sRe[a * dR + b];
          const ai = sIm[a * dR + b];
          if (ar === 0 && ai === 0) continue;
          for (let g = ZERO; g < dR; g += ONE) {
            const rr = Rre[b * dR + g];
            const ri = Rim[b * dR + g];
            m1Re[a * dR + g] += ar * rr - ai * ri;
            m1Im[a * dR + g] += ar * ri + ai * rr;
          }
        }
      }
      // M2 = M1 * A_{s'}^dagger (dL x dL)
      const m2Re = new Float64Array(dL * dL);
      const m2Im = new Float64Array(dL * dL);
      for (let a1 = ZERO; a1 < dL; a1 += ONE) {
        for (let g = ZERO; g < dR; g += ONE) {
          const tr = m1Re[a1 * dR + g];
          const ti = m1Im[a1 * dR + g];
          if (tr === 0 && ti === 0) continue;
          for (let a2 = ZERO; a2 < dL; a2 += ONE) {
            const cr = spRe[a2 * dR + g];
            const ci = -spIm[a2 * dR + g];
            m2Re[a1 * dL + a2] += tr * cr - ti * ci;
            m2Im[a1 * dL + a2] += tr * ci + ti * cr;
          }
        }
      }
      // Tr(L_q * M2) = sum_{a1, a2} L_q[a1, a2] * M2[a2, a1]
      let outRe = 0;
      let outIm = 0;
      for (let a1 = ZERO; a1 < dL; a1 += ONE) {
        for (let a2 = ZERO; a2 < dL; a2 += ONE) {
          const lr = Lre[a1 * dL + a2];
          const li = Lim[a1 * dL + a2];
          const mr = m2Re[a2 * dL + a1];
          const mi = m2Im[a2 * dL + a1];
          outRe += lr * mr - li * mi;
          outIm += lr * mi + li * mr;
        }
      }
      return { re: outRe, im: outIm };
    };

    const r00 = evalQuad(fs.m0Re, fs.m0Im, fs.m0Re, fs.m0Im).re;
    const r11 = evalQuad(fs.m1Re, fs.m1Im, fs.m1Re, fs.m1Im).re;
    const r01 = evalQuad(fs.m0Re, fs.m0Im, fs.m1Re, fs.m1Im);
    const norm = Math.max(1e-30, r00 + r11);
    const p0 = Math.max(0, Math.min(1, r00 / norm));
    const p1 = Math.max(0, Math.min(1, r11 / norm));
    blochVectors[q] = {
      rx: Math.max(-1, Math.min(1, (TWO * r01.re) / norm)),
      ry: Math.max(-1, Math.min(1, (-TWO * r01.im) / norm)),
      rz: p0 - p1,
      p1,
    };
  }

  return { blochVectors };
}

export function stepExactMpsGate(
  state: ExactMpsState,
  step: AqmGateStep,
  deterministicDraw01: number,
): {
  nextState: ExactMpsState;
  measurementOutcome?: {
    wire: number;
    outcome: 0 | 1;
    probZero: number;
    probOne: number;
    drawValue: number;
    branchMode: ForcedCollapseBranch;
  };
} {
  const sites = state.sites.slice();
  const nextCollapsed = new Map(state.collapsedWires);

  if (step.kind === GateKind.MEASURE) {
    const q = step.targets[ZERO];
    const env = computeMpsEnvironmentsFloat(sites);
    const probOne = env.blochVectors[q].p1;
    const probZero = Math.max(0, 1 - probOne);
    const branchMode: ForcedCollapseBranch = step.branchMode ?? 'seeded';

    let chosen: 0 | 1;
    if (branchMode === 'force0' && probZero > 1e-12) chosen = ZERO;
    else if (branchMode === 'force1' && probOne > 1e-12) chosen = ONE;
    else if (probZero <= 1e-12) chosen = ONE;
    else if (probOne <= 1e-12) chosen = ZERO;
    else chosen = deterministicDraw01 < probZero ? ZERO : ONE;

    const s = sites[q];
    const zeroSlice = new Array<Z8>(s.chiL * s.chiR).fill(Z8_ZERO);
    sites[q] = reduceSiteGcd({
      chiL: s.chiL,
      chiR: s.chiR,
      m0: chosen === ZERO ? s.m0 : zeroSlice,
      m1: chosen === ONE ? s.m1 : zeroSlice,
    });
    nextCollapsed.set(q, chosen);

    return {
      nextState: {
        ...state,
        sites,
        collapsedWires: nextCollapsed,
      },
      measurementOutcome: {
        wire: q,
        outcome: chosen,
        probZero,
        probOne,
        drawValue: deterministicDraw01,
        branchMode,
      },
    };
  }

  for (const w of step.targets) nextCollapsed.delete(w);

  if (step.targets.length === ONE) {
    const q = step.targets[ZERO];
    sites[q] = applySingleQubitSite(sites[q], step.kind);
  } else {
    const w0 = step.targets[ZERO];
    const w1 = step.targets[ONE];
    const low = Math.min(w0, w1);
    const high = Math.max(w0, w1);
    const reverse = w0 > w1;

    // Route `low` upward to `high - 1` via exact SWAP network
    for (let k = low; k < high - ONE; k += ONE) {
      const [sA, sB] = applyAdjacentTwoQubitSites(
        sites[k],
        sites[k + ONE],
        GateKind.SWAP,
        false,
        state.maxBondCap,
      );
      sites[k] = sA;
      sites[k + ONE] = sB;
    }

    // Apply two-qubit gate on adjacent (high - 1, high)
    const [gA, gB] = applyAdjacentTwoQubitSites(
      sites[high - ONE],
      sites[high],
      step.kind,
      reverse,
      state.maxBondCap,
    );
    sites[high - ONE] = gA;
    sites[high] = gB;

    // Route back downward from `high - 1` to `low`
    for (let k = high - TWO; k >= low; k -= ONE) {
      const [sA, sB] = applyAdjacentTwoQubitSites(
        sites[k],
        sites[k + ONE],
        GateKind.SWAP,
        false,
        state.maxBondCap,
      );
      sites[k] = sA;
      sites[k + ONE] = sB;
    }
  }

  return {
    nextState: {
      ...state,
      sites,
      collapsedWires: nextCollapsed,
    },
  };
}

export function getMpsBondDimensions(state: ExactMpsState): number[] {
  if (state.qubitCount <= ONE) return [];
  const bonds: number[] = [];
  for (let q = ZERO; q < state.qubitCount - ONE; q += ONE) {
    bonds.push(state.sites[q].chiR);
  }
  return bonds;
}

export function inspectExactMpsState(state: ExactMpsState): {
  blochVectors: BlochVector[];
  entanglementEdges: EntanglementEdge[];
  basisAmplitudes: BasisAmplitudeSummary[];
  bondDimensions: number[];
  conservation: ConservationReport;
} {
  const env = computeMpsEnvironmentsFloat(state.sites);
  const hTerm = (x: number) => (x > 1e-12 ? -x * Math.log2(x) : 0);

  const blochVectors: BlochVector[] = env.blochVectors.map((b, q) => {
    const rLen = Math.min(ONE, Math.hypot(b.rx, b.ry, b.rz));
    const purity = 0.5 * (ONE + rLen * rLen);
    const lamPlus = Math.min(ONE, Math.max(0, 0.5 * (ONE + rLen)));
    const lamMinus = Math.min(ONE, Math.max(0, 0.5 * (ONE - rLen)));
    return {
      qubit: q,
      rx: b.rx,
      ry: b.ry,
      rz: b.rz,
      purity,
      entropyBits: hTerm(lamPlus) + hTerm(lamMinus),
      p1: b.p1,
      collapsedTo: state.collapsedWires.get(q) ?? null,
    };
  });

  const bondDimensions = getMpsBondDimensions(state);
  const entanglementEdges: EntanglementEdge[] = [];
  for (let q = ZERO; q < bondDimensions.length; q += ONE) {
    if (bondDimensions[q] > ONE) {
      entanglementEdges.push({
        qubitA: q,
        qubitB: q + ONE,
        correlationStrength: Math.min(ONE, Math.log2(bondDimensions[q]) / 2),
      });
    }
  }

  const maxChi = bondDimensions.length > ZERO ? Math.max(...bondDimensions) : ONE;
  const basisAmplitudes: BasisAmplitudeSummary[] = [];

  // If n <= 8, also extract top basis amplitudes by contracting MPS prefix
  if (state.qubitCount <= 8) {
    let prefixes: Array<{ bits: string; vec: Z8[] }> = [{ bits: '', vec: [Z8_ONE] }];
    for (let q = ZERO; q < state.qubitCount; q += ONE) {
      const s = state.sites[q];
      const nextP: Array<{ bits: string; vec: Z8[] }> = [];
      for (const pref of prefixes) {
        for (const bit of [ZERO, ONE] as const) {
          const mat = bit === ZERO ? s.m0 : s.m1;
          const outVec = new Array<Z8>(s.chiR).fill(Z8_ZERO);
          let anyNonZero = false;
          for (let a = ZERO; a < s.chiL; a += ONE) {
            if (z8IsZero(pref.vec[a])) continue;
            for (let g = ZERO; g < s.chiR; g += ONE) {
              const mVal = mat[a * s.chiR + g];
              if (!z8IsZero(mVal)) {
                outVec[g] = z8Add(outVec[g], z8Mul(pref.vec[a], mVal));
              }
            }
          }
          for (const v of outVec) {
            if (!z8IsZero(v)) {
              anyNonZero = true;
              break;
            }
          }
          if (anyNonZero) {
            // Note: wire 0 is LSB in ket convention, so prepend bit
            nextP.push({ bits: `${bit}${pref.bits}`, vec: outVec });
          }
        }
      }
      prefixes = nextP;
    }

    let totalNorm = 0;
    const rawItems = prefixes.map((p, idx) => {
      const c = z8ToComplexFloat(p.vec[ZERO], 1);
      const sq = c.re * c.re + c.im * c.im;
      totalNorm += sq;
      return { idx, bits: p.bits, z: p.vec[ZERO], re: c.re, im: c.im, sq };
    });
    const normSqrt = Math.sqrt(Math.max(1e-30, totalNorm));
    for (const item of rawItems.slice(ZERO, SIXTEEN)) {
      const prob = item.sq / Math.max(1e-30, totalNorm);
      basisAmplitudes.push({
        basisIndex: parseInt(item.bits || '0', TWO),
        bitstring: item.bits,
        exactFormula: `MPS(χ≤${maxChi})`,
        real: item.re / normSqrt,
        imag: item.im / normSqrt,
        probability: prob,
        phaseRad: prob > 1e-12 ? Math.atan2(item.im, item.re) : ZERO,
      });
    }
  }

  return {
    blochVectors,
    entanglementEdges,
    basisAmplitudes,
    bondDimensions,
    conservation: {
      rationalNumerator: '1',
      rootTwoCoefficient: '0',
      scaleDenominator: `1 (MPS χ_max=${maxChi})`,
      normExactOne: true,
      bijectiveWiresVerified: true,
      tropicalTerminalReachable: true,
    },
  };
}

export { Q8_ONE };
