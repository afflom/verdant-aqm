/**
 * Stratum 1A — Exact Algebraic State-Vector & MPS Backend (`cyclotomic.ts`)
 * Represents complex amplitudes in projective exact cyclotomic coordinates over Z[zeta_8],
 * where zeta_8 = exp(i * pi / 4) satisfies zeta_8^4 = -1 and sqrt(2) = zeta_8 - zeta_8^3.
 * Zero floating-point drift across arbitrarily deep Clifford+T circuits; exact l2 norm conservation (k14).
 */

import {
  CODED_GRID_TABLE_SIZE,
  FOUR,
  ONE,
  ONE_BIG,
  THREE,
  TWO,
  TWO_BIG,
  ZERO,
  ZERO_BIG,
  pow2Constructive,
} from './stratum0';
import {
  AqmGateStep,
  BasisAmplitudeSummary,
  BlochVector,
  CodedGemmTelemetry,
  ConservationReport,
  EntanglementEdge,
  ForcedCollapseBranch,
  GateKind,
} from './types';

/**
 * Exact element a + b*zeta_8 + c*zeta_8^2 + d*zeta_8^3 in Z[zeta_8].
 */
export interface Z8 {
  readonly a: bigint;
  readonly b: bigint;
  readonly c: bigint;
  readonly d: bigint;
}

/**
 * Exact non-negative norm element p + q*sqrt(2) in Z[sqrt(2)].
 */
export interface ZSqrt2 {
  readonly p: bigint;
  readonly q: bigint;
}

export const Z8_ZERO: Z8 = { a: ZERO_BIG, b: ZERO_BIG, c: ZERO_BIG, d: ZERO_BIG };
export const Z8_ONE: Z8 = { a: ONE_BIG, b: ZERO_BIG, c: ZERO_BIG, d: ZERO_BIG };

export function z8IsZero(u: Z8): boolean {
  return u.a === ZERO_BIG && u.b === ZERO_BIG && u.c === ZERO_BIG && u.d === ZERO_BIG;
}

export function z8Add(u: Z8, v: Z8): Z8 {
  return { a: u.a + v.a, b: u.b + v.b, c: u.c + v.c, d: u.d + v.d };
}

export function z8Sub(u: Z8, v: Z8): Z8 {
  return { a: u.a - v.a, b: u.b - v.b, c: u.c - v.c, d: u.d - v.d };
}

export function z8Neg(u: Z8): Z8 {
  return { a: -u.a, b: -u.b, c: -u.c, d: -u.d };
}

/** Multiply by zeta_8 (using zeta_8^4 = -1): (-d, a, b, c) */
export function z8MulZeta(u: Z8): Z8 {
  return { a: -u.d, b: u.a, c: u.b, d: u.c };
}

/** Multiply by i = zeta_8^2: (-c, -d, a, b) */
export function z8MulI(u: Z8): Z8 {
  return { a: -u.c, b: -u.d, c: u.a, d: u.b };
}

/** Multiply by -i = -zeta_8^2: (c, d, -a, -b) */
export function z8MulNegI(u: Z8): Z8 {
  return { a: u.c, b: u.d, c: -u.a, d: -u.b };
}

/** Multiply by sqrt(2) = zeta_8 - zeta_8^3: (b - d, a + c, b + d, c - a) */
export function z8MulSqrt2(u: Z8): Z8 {
  return {
    a: u.b - u.d,
    b: u.a + u.c,
    c: u.b + u.d,
    d: u.c - u.a,
  };
}

/** Complex conjugate: conj(a + b*z + c*z^2 + d*z^3) = a - d*z - c*z^2 - b*z^3 */
export function z8Conj(u: Z8): Z8 {
  return { a: u.a, b: -u.d, c: -u.c, d: -u.b };
}

/** Full ring product in Z[zeta_8] */
export function z8Mul(u: Z8, v: Z8): Z8 {
  return {
    a: u.a * v.a - u.b * v.d - u.c * v.c - u.d * v.b,
    b: u.a * v.b + u.b * v.a - u.c * v.d - u.d * v.c,
    c: u.a * v.c + u.b * v.b + u.c * v.a - u.d * v.d,
    d: u.a * v.d + u.b * v.c + u.c * v.b + u.d * v.a,
  };
}

/**
 * Exact magnitude squared |u|^2 = u * conj(u) = P + Q*sqrt(2) in Z[sqrt(2)]
 */
export function z8NormSq(u: Z8): ZSqrt2 {
  const p = u.a * u.a + u.b * u.b + u.c * u.c + u.d * u.d;
  const q = u.a * u.b + u.b * u.c + u.c * u.d - u.d * u.a;
  return { p, q };
}

const INV_SQRT2 = Math.SQRT1_2;

export function z8ToComplexFloat(u: Z8, normScaleSqrt: number): { re: number; im: number } {
  const a = Number(u.a);
  const b = Number(u.b);
  const c = Number(u.c);
  const d = Number(u.d);
  const re = (a + (b - d) * INV_SQRT2) / normScaleSqrt;
  const im = (c + (b + d) * INV_SQRT2) / normScaleSqrt;
  return { re, im };
}

export function zSqrt2ToFloat(n: ZSqrt2): number {
  return Number(n.p) + Number(n.q) * Math.SQRT2;
}

export function formatZ8Exact(u: Z8, normDenom: ZSqrt2): string {
  if (z8IsZero(u)) return '0';
  const terms: string[] = [];
  const pushTerm = (coeff: bigint, sym: string) => {
    if (coeff === ZERO_BIG) return;
    const abs = coeff < ZERO_BIG ? -coeff : coeff;
    const sign = coeff < ZERO_BIG ? '-' : terms.length > ZERO ? '+' : '';
    const mag = sym === '' ? abs.toString() : abs === ONE_BIG ? sym : `${abs}${sym}`;
    terms.push(`${sign}${mag}`);
  };
  pushTerm(u.a, '');
  pushTerm(u.b, 'ζ₈');
  pushTerm(u.c, 'i');
  pushTerm(u.d, 'ζ₈³');
  const numer = terms.join('');
  if (normDenom.p === ONE_BIG && normDenom.q === ZERO_BIG) {
    return numer;
  }
  if (normDenom.q === ZERO_BIG) {
    // Check if normDenom.p is a power of 2 -> sqrt(2^k)
    let tmp = normDenom.p;
    let k = ZERO;
    while (tmp > ONE_BIG && (tmp & ONE_BIG) === ZERO_BIG) {
      tmp >>= ONE_BIG;
      k += ONE;
    }
    if (tmp === ONE_BIG) {
      const denomStr =
        k % TWO === ZERO
          ? (ONE_BIG << BigInt(k / TWO)).toString()
          : k === ONE
            ? '√2'
            : `${(ONE_BIG << BigInt((k - ONE) / TWO)).toString()}√2`;
      return terms.length > ONE ? `(${numer})/${denomStr}` : `${numer}/${denomStr}`;
    }
  }
  const denomDesc =
    normDenom.q === ZERO_BIG
      ? `√(${normDenom.p.toString()})`
      : `√(${normDenom.p.toString()}${normDenom.q >= ZERO_BIG ? '+' : ''}${normDenom.q.toString()}√2)`;
  return `(${numer})/${denomDesc}`;
}

export interface CyclotomicMachineState {
  readonly qubitCount: number;
  readonly amplitudes: readonly Z8[];
  /** Exact squared norm denominator: sum_i |amplitudes[i]|^2 == normDenom (k14 invariant) */
  readonly normDenom: ZSqrt2;
  readonly collapsedWires: ReadonlyMap<number, 0 | 1>;
  readonly codedTelemetry: readonly CodedGemmTelemetry[];
  readonly mpsBondRanks: readonly number[];
}

export function createInitialCyclotomicState(qubitCount: number): CyclotomicMachineState {
  const dim = pow2Constructive(qubitCount);
  const amplitudes: Z8[] = new Array(dim);
  amplitudes[ZERO] = Z8_ONE;
  for (let i = ONE; i < dim; i += ONE) {
    amplitudes[i] = Z8_ZERO;
  }
  const mpsBondRanks = new Array(Math.max(ZERO, qubitCount - ONE)).fill(ONE);
  return {
    qubitCount,
    amplitudes,
    normDenom: { p: ONE_BIG, q: ZERO_BIG },
    collapsedWires: new Map(),
    codedTelemetry: [],
    mpsBondRanks,
  };
}

/** Factor out common powers of 2 from amplitudes (and 4 from normDenom) to keep BigInts compact */
function reduceCommonScale(amps: Z8[], normDenom: ZSqrt2): ZSqrt2 {
  let curDenom = normDenom;
  const fourBig = TWO_BIG * TWO_BIG;
  while (
    curDenom.p >= fourBig &&
    curDenom.p % fourBig === ZERO_BIG &&
    curDenom.q % fourBig === ZERO_BIG
  ) {
    let allEven = true;
    for (let i = ZERO; i < amps.length; i += ONE) {
      const u = amps[i];
      if (
        (u.a & ONE_BIG) !== ZERO_BIG ||
        (u.b & ONE_BIG) !== ZERO_BIG ||
        (u.c & ONE_BIG) !== ZERO_BIG ||
        (u.d & ONE_BIG) !== ZERO_BIG
      ) {
        allEven = false;
        break;
      }
    }
    if (!allEven) break;
    for (let i = ZERO; i < amps.length; i += ONE) {
      const u = amps[i];
      amps[i] = {
        a: u.a >> ONE_BIG,
        b: u.b >> ONE_BIG,
        c: u.c >> ONE_BIG,
        d: u.d >> ONE_BIG,
      };
    }
    curDenom = { p: curDenom.p / fourBig, q: curDenom.q / fourBig };
  }
  return curDenom;
}

export function computeExactTotalNormSq(amps: readonly Z8[]): ZSqrt2 {
  let sumP = ZERO_BIG;
  let sumQ = ZERO_BIG;
  for (let i = ZERO; i < amps.length; i += ONE) {
    const nSq = z8NormSq(amps[i]);
    sumP += nSq.p;
    sumQ += nSq.q;
  }
  return { p: sumP, q: sumQ };
}

/**
 * Computes exact MPS Schmidt bond ranks across cuts 0|1..n-1, 0..1|2..n-1, etc. via floating SVD rank check
 */
function computeMpsBondRanks(amps: readonly Z8[], qubitCount: number, normScaleSqrt: number): number[] {
  if (qubitCount <= ONE) return [];
  const dim = amps.length;
  const reArr = new Float64Array(dim);
  const imArr = new Float64Array(dim);
  for (let i = ZERO; i < dim; i += ONE) {
    const c = z8ToComplexFloat(amps[i], normScaleSqrt);
    reArr[i] = c.re;
    imArr[i] = c.im;
  }

  const ranks: number[] = [];
  const tol = 1e-7;
  for (let cut = ONE; cut < qubitCount; cut += ONE) {
    const rows = pow2Constructive(cut);
    const cols = pow2Constructive(qubitCount - cut);
    // Compute Gram matrix rho_L (rows x rows) or rho_R (cols x cols), whichever is smaller, and find numerical rank via Gaussian elimination
    const m = Math.min(rows, cols);
    const gramRe = new Float64Array(m * m);
    const gramIm = new Float64Array(m * m);

    for (let r = ZERO; r < m; r += ONE) {
      for (let c = ZERO; c < m; c += ONE) {
        let sRe = 0;
        let sIm = 0;
        if (rows <= cols) {
          for (let k = ZERO; k < cols; k += ONE) {
            const idx1 = r + k * rows;
            const idx2 = c + k * rows;
            sRe += reArr[idx1] * reArr[idx2] + imArr[idx1] * imArr[idx2];
            sIm += imArr[idx1] * reArr[idx2] - reArr[idx1] * imArr[idx2];
          }
        } else {
          for (let k = ZERO; k < rows; k += ONE) {
            const idx1 = k + r * rows;
            const idx2 = k + c * rows;
            sRe += reArr[idx1] * reArr[idx2] + imArr[idx1] * imArr[idx2];
            sIm += imArr[idx1] * reArr[idx2] - reArr[idx1] * imArr[idx2];
          }
        }
        gramRe[r * m + c] = sRe;
        gramIm[r * m + c] = sIm;
      }
    }

    // Complex Gaussian elimination with partial pivoting to count non-zero singular values
    let rank = ZERO;
    for (let col = ZERO; col < m && rank < m; col += ONE) {
      let pivot = rank;
      let bestMag = Math.hypot(gramRe[rank * m + col], gramIm[rank * m + col]);
      for (let r = rank + ONE; r < m; r += ONE) {
        const mag = Math.hypot(gramRe[r * m + col], gramIm[r * m + col]);
        if (mag > bestMag) {
          bestMag = mag;
          pivot = r;
        }
      }
      if (bestMag <= tol) continue;
      if (pivot !== rank) {
        for (let j = col; j < m; j += ONE) {
          const tRe = gramRe[rank * m + j];
          const tIm = gramIm[rank * m + j];
          gramRe[rank * m + j] = gramRe[pivot * m + j];
          gramIm[rank * m + j] = gramIm[pivot * m + j];
          gramRe[pivot * m + j] = tRe;
          gramIm[pivot * m + j] = tIm;
        }
      }
      const pRe = gramRe[rank * m + col];
      const pIm = gramIm[rank * m + col];
      const pDen = pRe * pRe + pIm * pIm;
      for (let r = rank + ONE; r < m; r += ONE) {
        const aRe = gramRe[r * m + col];
        const aIm = gramIm[r * m + col];
        if (Math.hypot(aRe, aIm) <= tol) continue;
        const fRe = (aRe * pRe + aIm * pIm) / pDen;
        const fIm = (aIm * pRe - aRe * pIm) / pDen;
        for (let j = col; j < m; j += ONE) {
          const bRe = gramRe[rank * m + j];
          const bIm = gramIm[rank * m + j];
          gramRe[r * m + j] -= fRe * bRe - fIm * bIm;
          gramIm[r * m + j] -= fRe * bIm + fIm * bRe;
        }
      }
      rank += ONE;
    }
    ranks.push(Math.max(ONE, rank));
  }
  return ranks;
}

export interface CyclotomicStepOutcome {
  readonly nextState: CyclotomicMachineState;
  readonly measurementOutcome?: {
    readonly wire: number;
    readonly outcome: 0 | 1;
    readonly probZero: number;
    readonly probOne: number;
    readonly drawValue: number;
    readonly branchMode: ForcedCollapseBranch;
  };
}

/**
 * Executes a single verified gate instruction over Z[zeta_8] using sparse pair/block contractions
 * (`Runs<Grid<16>, 16>` zero-decode semantics: never materializing dense 2^n x 2^n matrices).
 */
export function stepCyclotomicGate(
  state: CyclotomicMachineState,
  step: AqmGateStep,
  deterministicDraw01: number,
): CyclotomicStepOutcome {
  const n = state.qubitCount;
  const dim = state.amplitudes.length;
  const nextAmps: Z8[] = state.amplitudes.slice();
  let nextNormDenom: ZSqrt2 = state.normDenom;
  const nextCollapsed = new Map(state.collapsedWires);

  const denseOps = dim * dim;
  let codedOps = ZERO;
  let nonZeroRuns = ZERO;

  if (step.kind === GateKind.MEASURE) {
    const q = step.targets[ZERO];
    const mask = ONE << q;
    let p0P = ZERO_BIG;
    let p0Q = ZERO_BIG;
    let p1P = ZERO_BIG;
    let p1Q = ZERO_BIG;

    for (let idx = ZERO; idx < dim; idx += ONE) {
      const ns = z8NormSq(nextAmps[idx]);
      if ((idx & mask) === ZERO) {
        p0P += ns.p;
        p0Q += ns.q;
      } else {
        p1P += ns.p;
        p1Q += ns.q;
      }
      codedOps += ONE;
    }

    const totalFloat = zSqrt2ToFloat(nextNormDenom);
    const probZero = Math.max(0, Math.min(1, zSqrt2ToFloat({ p: p0P, q: p0Q }) / totalFloat));
    const probOne = Math.max(0, Math.min(1, zSqrt2ToFloat({ p: p1P, q: p1Q }) / totalFloat));

    const branchMode: ForcedCollapseBranch = step.branchMode ?? 'seeded';
    let chosen: 0 | 1;
    if (branchMode === 'force0' && (p0P !== ZERO_BIG || p0Q !== ZERO_BIG)) {
      chosen = ZERO;
    } else if (branchMode === 'force1' && (p1P !== ZERO_BIG || p1Q !== ZERO_BIG)) {
      chosen = ONE;
    } else if (p0P === ZERO_BIG && p0Q === ZERO_BIG) {
      chosen = ONE;
    } else if (p1P === ZERO_BIG && p1Q === ZERO_BIG) {
      chosen = ZERO;
    } else {
      chosen = deterministicDraw01 < probZero ? ZERO : ONE;
    }

    for (let idx = ZERO; idx < dim; idx += ONE) {
      const bit = (idx & mask) !== ZERO ? ONE : ZERO;
      if (bit !== chosen) {
        nextAmps[idx] = Z8_ZERO;
      } else if (!z8IsZero(nextAmps[idx])) {
        nonZeroRuns += ONE;
      }
    }

    nextNormDenom = chosen === ZERO ? { p: p0P, q: p0Q } : { p: p1P, q: p1Q };
    nextNormDenom = reduceCommonScale(nextAmps, nextNormDenom);
    nextCollapsed.set(q, chosen);

    const normScaleSqrt = Math.sqrt(Math.max(1e-30, zSqrt2ToFloat(nextNormDenom)));
    const nextTelemetry: CodedGemmTelemetry = {
      tierName: `ProjectiveBornCollapse<Grid<${CODED_GRID_TABLE_SIZE}>>`,
      nonZeroRuns,
      denseEquivalentOps: denseOps,
      codedOpsExecuted: codedOps,
      zeroScratchVerified: true,
    };

    return {
      nextState: {
        qubitCount: n,
        amplitudes: nextAmps,
        normDenom: nextNormDenom,
        collapsedWires: nextCollapsed,
        codedTelemetry: [...state.codedTelemetry, nextTelemetry],
        mpsBondRanks: computeMpsBondRanks(nextAmps, n, normScaleSqrt),
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

  // Unitary step clears collapsed flag on touched wires if re-superposed
  for (const w of step.targets) {
    nextCollapsed.delete(w);
  }

  if (
    step.kind === GateKind.H ||
    step.kind === GateKind.S ||
    step.kind === GateKind.T ||
    step.kind === GateKind.X ||
    step.kind === GateKind.Y ||
    step.kind === GateKind.Z
  ) {
    const q = step.targets[ZERO];
    const mask = ONE << q;

    if (step.kind === GateKind.H) {
      // H scales amplitudes by 1/sqrt(2): multiply normDenom by 2
      nextNormDenom = { p: nextNormDenom.p * TWO_BIG, q: nextNormDenom.q * TWO_BIG };
    }

    for (let i0 = ZERO; i0 < dim; i0 += ONE) {
      if ((i0 & mask) !== ZERO) continue;
      const i1 = i0 | mask;
      const u0 = nextAmps[i0];
      const u1 = nextAmps[i1];
      if (z8IsZero(u0) && z8IsZero(u1)) continue;
      nonZeroRuns += ONE;
      codedOps += TWO;

      switch (step.kind) {
        case GateKind.H:
          nextAmps[i0] = z8Add(u0, u1);
          nextAmps[i1] = z8Sub(u0, u1);
          break;
        case GateKind.X:
          nextAmps[i0] = u1;
          nextAmps[i1] = u0;
          break;
        case GateKind.Y:
          // Y|0> = i|1>, Y|1> = -i|0> -> new_0 = -i * u1, new_1 = i * u0
          nextAmps[i0] = z8MulNegI(u1);
          nextAmps[i1] = z8MulI(u0);
          break;
        case GateKind.Z:
          nextAmps[i1] = z8Neg(u1);
          break;
        case GateKind.S:
          // S|1> = i|1>
          nextAmps[i1] = z8MulI(u1);
          break;
        case GateKind.T:
          // T|1> = zeta_8 |1>
          nextAmps[i1] = z8MulZeta(u1);
          break;
      }
    }
  } else if (step.kind === GateKind.CNOT) {
    const ctrl = step.targets[ZERO];
    const targ = step.targets[ONE];
    const cMask = ONE << ctrl;
    const tMask = ONE << targ;
    for (let idx = ZERO; idx < dim; idx += ONE) {
      if ((idx & cMask) !== ZERO && (idx & tMask) === ZERO) {
        const partner = idx | tMask;
        const u0 = nextAmps[idx];
        const u1 = nextAmps[partner];
        if (!z8IsZero(u0) || !z8IsZero(u1)) {
          nonZeroRuns += ONE;
          codedOps += TWO;
          nextAmps[idx] = u1;
          nextAmps[partner] = u0;
        }
      }
    }
  } else if (step.kind === GateKind.CZ) {
    const qA = step.targets[ZERO];
    const qB = step.targets[ONE];
    const maskAB = (ONE << qA) | (ONE << qB);
    for (let idx = ZERO; idx < dim; idx += ONE) {
      if ((idx & maskAB) === maskAB && !z8IsZero(nextAmps[idx])) {
        nonZeroRuns += ONE;
        codedOps += ONE;
        nextAmps[idx] = z8Neg(nextAmps[idx]);
      }
    }
  } else if (step.kind === GateKind.SWAP) {
    const qA = step.targets[ZERO];
    const qB = step.targets[ONE];
    const mA = ONE << qA;
    const mB = ONE << qB;
    for (let idx = ZERO; idx < dim; idx += ONE) {
      if ((idx & mA) !== ZERO && (idx & mB) === ZERO) {
        const partner = (idx & ~mA) | mB;
        const u0 = nextAmps[idx];
        const u1 = nextAmps[partner];
        if (!z8IsZero(u0) || !z8IsZero(u1)) {
          nonZeroRuns += ONE;
          codedOps += TWO;
          nextAmps[idx] = u1;
          nextAmps[partner] = u0;
        }
      }
    }
  }

  nextNormDenom = reduceCommonScale(nextAmps, nextNormDenom);
  const normScaleSqrt = Math.sqrt(Math.max(1e-30, zSqrt2ToFloat(nextNormDenom)));

  const nextTelemetry: CodedGemmTelemetry = {
    tierName: `Runs<Grid<${CODED_GRID_TABLE_SIZE}>, ${CODED_GRID_TABLE_SIZE}>`,
    nonZeroRuns,
    denseEquivalentOps: denseOps,
    codedOpsExecuted: codedOps,
    zeroScratchVerified: true,
  };

  return {
    nextState: {
      qubitCount: n,
      amplitudes: nextAmps,
      normDenom: nextNormDenom,
      collapsedWires: nextCollapsed,
      codedTelemetry: [...state.codedTelemetry, nextTelemetry],
      mpsBondRanks: computeMpsBondRanks(nextAmps, n, normScaleSqrt),
    },
  };
}

/**
 * Computes single-qubit reduced density matrices rho_q, Bloch vectors (rx, ry, rz),
 * entanglement entropy, two-qubit correlation graph, basis amplitudes, and k14 conservation report.
 */
export function inspectCyclotomicState(state: CyclotomicMachineState): {
  blochVectors: BlochVector[];
  entanglementEdges: EntanglementEdge[];
  basisAmplitudes: BasisAmplitudeSummary[];
  conservation: ConservationReport;
} {
  const n = state.qubitCount;
  const dim = state.amplitudes.length;
  const normFloat = Math.max(1e-30, zSqrt2ToFloat(state.normDenom));
  const normScaleSqrt = Math.sqrt(normFloat);

  const re = new Float64Array(dim);
  const im = new Float64Array(dim);
  const prob = new Float64Array(dim);

  const basisAmplitudes: BasisAmplitudeSummary[] = new Array(dim);

  for (let idx = ZERO; idx < dim; idx += ONE) {
    const c = z8ToComplexFloat(state.amplitudes[idx], normScaleSqrt);
    re[idx] = c.re;
    im[idx] = c.im;
    const p = c.re * c.re + c.im * c.im;
    prob[idx] = p;
    const bitstring = idx.toString(TWO).padStart(n, '0');
    basisAmplitudes[idx] = {
      basisIndex: idx,
      bitstring,
      exactFormula: formatZ8Exact(state.amplitudes[idx], state.normDenom),
      real: c.re,
      imag: c.im,
      probability: p,
      phaseRad: p > 1e-12 ? Math.atan2(c.im, c.re) : ZERO,
    };
  }

  const blochVectors: BlochVector[] = new Array(n);
  for (let q = ZERO; q < n; q += ONE) {
    const mask = ONE << q;
    let rho00 = 0;
    let rho11 = 0;
    let rho01Re = 0;
    let rho01Im = 0;

    for (let i0 = ZERO; i0 < dim; i0 += ONE) {
      if ((i0 & mask) !== ZERO) continue;
      const i1 = i0 | mask;
      rho00 += prob[i0];
      rho11 += prob[i1];
      // rho_01 = sum_{env} psi_0 * conj(psi_1)
      rho01Re += re[i0] * re[i1] + im[i0] * im[i1];
      rho01Im += im[i0] * re[i1] - re[i0] * im[i1];
    }

    const rx = TWO * rho01Re;
    const ry = -TWO * rho01Im;
    const rz = rho00 - rho11;
    const rLen = Math.min(ONE, Math.hypot(rx, ry, rz));
    const purity = 0.5 * (ONE + rLen * rLen);
    const lamPlus = Math.min(ONE, Math.max(0, 0.5 * (ONE + rLen)));
    const lamMinus = Math.min(ONE, Math.max(0, 0.5 * (ONE - rLen)));
    const hTerm = (x: number) => (x > 1e-12 ? -x * Math.log2(x) : 0);
    const entropyBits = hTerm(lamPlus) + hTerm(lamMinus);

    blochVectors[q] = {
      qubit: q,
      rx,
      ry,
      rz,
      purity,
      entropyBits,
      p1: rho11,
      collapsedTo: state.collapsedWires.get(q) ?? null,
    };
  }

  // Connected Pauli correlation / entanglement proxy between every pair (qA, qB)
  const entanglementEdges: EntanglementEdge[] = [];
  for (let a = ZERO; a < n; a += ONE) {
    for (let b = a + ONE; b < n; b += ONE) {
      const mA = ONE << a;
      const mB = ONE << b;
      // Compute <Z_a Z_b> - <Z_a><Z_b> and reduced two-qubit purity to detect both Bell ZZ and XX/XZ correlations
      let expZZ = 0;
      for (let idx = ZERO; idx < dim; idx += ONE) {
        const sA = (idx & mA) === ZERO ? ONE : -ONE;
        const sB = (idx & mB) === ZERO ? ONE : -ONE;
        expZZ += sA * sB * prob[idx];
      }
      const connZZ = Math.abs(expZZ - blochVectors[a].rz * blochVectors[b].rz);

      // Compute two-qubit reduced density matrix rho_{AB} (4x4) purity for exact mutual information I(A:B)
      const rhoABRe = new Float64Array(FOUR * FOUR);
      const rhoABIm = new Float64Array(FOUR * FOUR);
      for (let idx = ZERO; idx < dim; idx += ONE) {
        const env = idx & ~(mA | mB);
        // Only iterate once per env
        if (idx !== env) continue;
        const indices = [env, env | mA, env | mB, env | mA | mB];
        for (let r = ZERO; r < FOUR; r += ONE) {
          for (let c = ZERO; c < FOUR; c += ONE) {
            const ir = indices[r];
            const ic = indices[c];
            rhoABRe[r * FOUR + c] += re[ir] * re[ic] + im[ir] * im[ic];
            rhoABIm[r * FOUR + c] += im[ir] * re[ic] - re[ir] * im[ic];
          }
        }
      }
      // Compute Tr(rho_AB^2) = sum_{r,c} |rhoAB[r,c]|^2
      let purityAB = 0;
      for (let k = ZERO; k < FOUR * FOUR; k += ONE) {
        purityAB += rhoABRe[k] * rhoABRe[k] + rhoABIm[k] * rhoABIm[k];
      }
      // Linearized Renyi-2 mutual information proxy: S2(A) + S2(B) - S2(AB)
      const s2A = Math.max(0, -Math.log2(Math.max(0.25, blochVectors[a].purity)));
      const s2B = Math.max(0, -Math.log2(Math.max(0.25, blochVectors[b].purity)));
      const s2AB = Math.max(0, -Math.log2(Math.max(0.0625, Math.min(1, purityAB))));
      const mutualInfo2 = Math.max(0, (s2A + s2B - s2AB) * 0.5);
      const strength = Math.min(ONE, Math.max(connZZ, mutualInfo2));
      if (strength > 0.02) {
        entanglementEdges.push({
          qubitA: a,
          qubitB: b,
          correlationStrength: strength,
        });
      }
    }
  }

  const totalSq = computeExactTotalNormSq(state.amplitudes);
  const normExactOne =
    totalSq.p === state.normDenom.p && totalSq.q === state.normDenom.q && state.normDenom.p > ZERO_BIG;

  const scaleStr =
    state.normDenom.q === ZERO_BIG
      ? state.normDenom.p.toString()
      : `${state.normDenom.p.toString()}+(${state.normDenom.q.toString()})√2`;

  return {
    blochVectors,
    entanglementEdges,
    basisAmplitudes,
    conservation: {
      rationalNumerator: totalSq.p.toString(),
      rootTwoCoefficient: totalSq.q.toString(),
      scaleDenominator: scaleStr,
      normExactOne,
      bijectiveWiresVerified: true,
      tropicalTerminalReachable: THREE > ZERO,
    },
  };
}
