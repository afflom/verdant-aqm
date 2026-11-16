/**
 * Stratum 1B — Gottesman-Knill Binary Symplectic Pauli-Tableau Backend (`stabilizer.ts`)
 * Simulates Clifford circuits in O(n^2) over F_2^{2n x (2n+1)} and models the rotated d=3
 * [[9, 1, 3]] topological surface-code lattice with symplectic commutativity verification.
 */

import { FOUR, NINE, ONE, THREE, TWO, ZERO } from './stratum0';
import { AqmGateStep, BlochVector, ForcedCollapseBranch, GateKind } from './types';

export interface SymplecticTableau {
  readonly n: number;
  /** Flattened 2n x n X-bit matrix (row-major, values 0 or 1) */
  readonly x: Uint8Array;
  /** Flattened 2n x n Z-bit matrix (row-major, values 0 or 1) */
  readonly z: Uint8Array;
  /** 2n phase bits (0 => +1, 1 => -1) */
  readonly r: Uint8Array;
  readonly collapsedWires: ReadonlyMap<number, 0 | 1>;
}

export function createInitialTableau(n: number): SymplecticTableau {
  const rows = TWO * n;
  const x = new Uint8Array(rows * n);
  const z = new Uint8Array(rows * n);
  const r = new Uint8Array(rows);
  for (let i = ZERO; i < n; i += ONE) {
    // Destabilizer i = X_i
    x[i * n + i] = ONE;
    // Stabilizer n + i = Z_i
    z[(n + i) * n + i] = ONE;
  }
  return { n, x, z, r, collapsedWires: new Map() };
}

export function cloneTableau(tab: SymplecticTableau): {
  n: number;
  x: Uint8Array;
  z: Uint8Array;
  r: Uint8Array;
  collapsedWires: Map<number, 0 | 1>;
} {
  return {
    n: tab.n,
    x: new Uint8Array(tab.x),
    z: new Uint8Array(tab.z),
    r: new Uint8Array(tab.r),
    collapsedWires: new Map(tab.collapsedWires),
  };
}

/** Aaronson-Gottesman phase exponent g(x1, z1, x2, z2) in {-1, 0, +1} */
function phaseG(x1: number, z1: number, x2: number, z2: number): number {
  if (x1 === ZERO && z1 === ZERO) return ZERO;
  if (x1 === ONE && z1 === ONE) return z2 - x2;
  if (x1 === ONE && z1 === ZERO) return z2 * (TWO * x2 - ONE);
  return x2 * (ONE - TWO * z2);
}

/** Multiplies row `h` by row `i` in place (`row[h] <- row[i] * row[h]`) */
function rowsum(
  n: number,
  x: Uint8Array,
  z: Uint8Array,
  r: Uint8Array,
  h: number,
  i: number,
): void {
  let acc = TWO * r[h] + TWO * r[i];
  for (let j = ZERO; j < n; j += ONE) {
    const idxI = i * n + j;
    const idxH = h * n + j;
    acc += phaseG(x[idxI], z[idxI], x[idxH], z[idxH]);
    x[idxH] ^= x[idxI];
    z[idxH] ^= z[idxI];
  }
  const mod4 = ((acc % FOUR) + FOUR) % FOUR;
  r[h] = mod4 === TWO ? ONE : ZERO;
}

export function stepStabilizerTableau(
  tab: SymplecticTableau,
  step: AqmGateStep,
  deterministicDraw01: number,
): {
  nextTableau: SymplecticTableau;
  measurementOutcome?: {
    wire: number;
    outcome: 0 | 1;
    probZero: number;
    probOne: number;
    drawValue: number;
    branchMode: ForcedCollapseBranch;
  };
} {
  const mut = cloneTableau(tab);
  const { n, x, z, r } = mut;
  const rows = TWO * n;

  if (step.kind === GateKind.MEASURE) {
    const a = step.targets[ZERO];
    let pRow = -ONE;
    for (let p = n; p < rows; p += ONE) {
      if (x[p * n + a] === ONE) {
        pRow = p;
        break;
      }
    }
    const branchMode: ForcedCollapseBranch = step.branchMode ?? 'seeded';

    if (pRow >= n) {
      // Random 50/50 outcome in Clifford state
      for (let i = ZERO; i < rows; i += ONE) {
        if (i !== pRow && i !== pRow - n && x[i * n + a] === ONE) {
          rowsum(n, x, z, r, i, pRow);
        }
      }
      // Copy row pRow into destabilizer pRow - n
      for (let j = ZERO; j < n; j += ONE) {
        x[(pRow - n) * n + j] = x[pRow * n + j];
        z[(pRow - n) * n + j] = z[pRow * n + j];
      }
      r[pRow - n] = r[pRow];
      // Set stabilizer pRow to +/- Z_a
      for (let j = ZERO; j < n; j += ONE) {
        x[pRow * n + j] = ZERO;
        z[pRow * n + j] = j === a ? ONE : ZERO;
      }
      const outcome: 0 | 1 =
        branchMode === 'force0'
          ? ZERO
          : branchMode === 'force1'
            ? ONE
            : deterministicDraw01 < 0.5
              ? ZERO
              : ONE;
      r[pRow] = outcome;
      mut.collapsedWires.set(a, outcome);
      return {
        nextTableau: mut,
        measurementOutcome: {
          wire: a,
          outcome,
          probZero: 0.5,
          probOne: 0.5,
          drawValue: deterministicDraw01,
          branchMode,
        },
      };
    } else {
      // Deterministic outcome: sum destabilizer+stabilizer scratch row using destabilizer clues
      const scratchX = new Uint8Array(n);
      const scratchZ = new Uint8Array(n);
      let scratchR = ZERO;

      const addRowToScratch = (srcRow: number) => {
        let acc = TWO * scratchR + TWO * r[srcRow];
        for (let j = ZERO; j < n; j += ONE) {
          acc += phaseG(x[srcRow * n + j], z[srcRow * n + j], scratchX[j], scratchZ[j]);
          scratchX[j] ^= x[srcRow * n + j];
          scratchZ[j] ^= z[srcRow * n + j];
        }
        const mod4 = ((acc % FOUR) + FOUR) % FOUR;
        scratchR = mod4 === TWO ? ONE : ZERO;
      };

      for (let i = ZERO; i < n; i += ONE) {
        if (x[i * n + a] === ONE) {
          addRowToScratch(i + n);
        }
      }
      const outcome: 0 | 1 = scratchR === ONE ? ONE : ZERO;
      mut.collapsedWires.set(a, outcome);
      return {
        nextTableau: mut,
        measurementOutcome: {
          wire: a,
          outcome,
          probZero: outcome === ZERO ? ONE : ZERO,
          probOne: outcome === ONE ? ONE : ZERO,
          drawValue: deterministicDraw01,
          branchMode,
        },
      };
    }
  }

  for (const w of step.targets) {
    mut.collapsedWires.delete(w);
  }

  if (step.kind === GateKind.H) {
    const a = step.targets[ZERO];
    for (let i = ZERO; i < rows; i += ONE) {
      const idx = i * n + a;
      r[i] ^= x[idx] & z[idx];
      const tmp = x[idx];
      x[idx] = z[idx];
      z[idx] = tmp;
    }
  } else if (step.kind === GateKind.S) {
    const a = step.targets[ZERO];
    for (let i = ZERO; i < rows; i += ONE) {
      const idx = i * n + a;
      r[i] ^= x[idx] & z[idx];
      z[idx] ^= x[idx];
    }
  } else if (step.kind === GateKind.X) {
    const a = step.targets[ZERO];
    for (let i = ZERO; i < rows; i += ONE) {
      r[i] ^= z[i * n + a];
    }
  } else if (step.kind === GateKind.Z) {
    const a = step.targets[ZERO];
    for (let i = ZERO; i < rows; i += ONE) {
      r[i] ^= x[i * n + a];
    }
  } else if (step.kind === GateKind.Y) {
    const a = step.targets[ZERO];
    for (let i = ZERO; i < rows; i += ONE) {
      const idx = i * n + a;
      r[i] ^= x[idx] ^ z[idx];
    }
  } else if (step.kind === GateKind.CNOT) {
    const a = step.targets[ZERO];
    const b = step.targets[ONE];
    for (let i = ZERO; i < rows; i += ONE) {
      const ia = i * n + a;
      const ib = i * n + b;
      r[i] ^= x[ia] & z[ib] & (x[ib] ^ z[ia] ^ ONE);
      x[ib] ^= x[ia];
      z[ia] ^= z[ib];
    }
  } else if (step.kind === GateKind.CZ) {
    // CZ = (I x H) CNOT (I x H)
    const a = step.targets[ZERO];
    const b = step.targets[ONE];
    for (let i = ZERO; i < rows; i += ONE) {
      const ia = i * n + a;
      const ib = i * n + b;
      r[i] ^= x[ia] & x[ib] & (z[ia] ^ z[ib]);
      z[ia] ^= x[ib];
      z[ib] ^= x[ia];
    }
  } else if (step.kind === GateKind.SWAP) {
    const a = step.targets[ZERO];
    const b = step.targets[ONE];
    for (let i = ZERO; i < rows; i += ONE) {
      const ia = i * n + a;
      const ib = i * n + b;
      const tx = x[ia];
      x[ia] = x[ib];
      x[ib] = tx;
      const tz = z[ia];
      z[ia] = z[ib];
      z[ib] = tz;
    }
  }

  return { nextTableau: mut };
}

/**
 * Verifies pairwise symplectic commutativity of all n active stabilizer rows [n..2n-1].
 */
export function verifyStabilizersCommute(tab: SymplecticTableau): {
  commutes: boolean;
  checkedPairs: number;
} {
  const { n, x, z } = tab;
  let checkedPairs = ZERO;
  for (let i = n; i < TWO * n; i += ONE) {
    for (let j = i + ONE; j < TWO * n; j += ONE) {
      checkedPairs += ONE;
      let symp = ZERO;
      for (let q = ZERO; q < n; q += ONE) {
        symp ^= (x[i * n + q] & z[j * n + q]) ^ (z[i * n + q] & x[j * n + q]);
      }
      if (symp !== ZERO) {
        return { commutes: false, checkedPairs };
      }
    }
  }
  return { commutes: true, checkedPairs };
}

export function formatStabilizerGenerators(tab: SymplecticTableau): string[] {
  const { n, x, z, r } = tab;
  const out: string[] = [];
  for (let row = n; row < TWO * n; row += ONE) {
    let str = r[row] === ONE ? '-' : '+';
    for (let q = ZERO; q < n; q += ONE) {
      const xb = x[row * n + q];
      const zb = z[row * n + q];
      if (xb === ZERO && zb === ZERO) str += 'I';
      else if (xb === ONE && zb === ZERO) str += 'X';
      else if (xb === ZERO && zb === ONE) str += 'Z';
      else str += 'Y';
    }
    out.push(str);
  }
  return out;
}

/**
 * Computes single-qubit Pauli expectations (<X_q>, <Y_q>, <Z_q>) directly from the F_2 tableau.
 * For any Clifford stabilizer state, <P_q> is in {-1, 0, +1}!
 */
export function inspectStabilizerBlochVectors(tab: SymplecticTableau): BlochVector[] {
  const { n, x, z, r } = tab;
  const rows = TWO * n;
  const vectors: BlochVector[] = new Array(n);

  const expectationSinglePauli = (q: number, px: number, pz: number): number => {
    // Check if P_q anticommutes with any stabilizer row [n..2n-1]: if so, expectation is 0!
    for (let row = n; row < rows; row += ONE) {
      const anti = (px & z[row * n + q]) ^ (pz & x[row * n + q]);
      if (anti === ONE) return ZERO;
    }
    // Otherwise P_q is in the stabilizer group up to +/- sign; multiply stabilizer rows where destabilizer anticommutes with P_q
    const scratchX = new Uint8Array(n);
    const scratchZ = new Uint8Array(n);
    let scratchR = ZERO;
    for (let i = ZERO; i < n; i += ONE) {
      const antiDestab = (px & z[i * n + q]) ^ (pz & x[i * n + q]);
      if (antiDestab === ONE) {
        const srcRow = i + n;
        let acc = TWO * scratchR + TWO * r[srcRow];
        for (let j = ZERO; j < n; j += ONE) {
          acc += phaseG(x[srcRow * n + j], z[srcRow * n + j], scratchX[j], scratchZ[j]);
          scratchX[j] ^= x[srcRow * n + j];
          scratchZ[j] ^= z[srcRow * n + j];
        }
        const mod4 = ((acc % FOUR) + FOUR) % FOUR;
        scratchR = mod4 === TWO ? ONE : ZERO;
      }
    }
    // Now scratch row equals +/- P_q. Notice if px=1,pz=1, tableau row represents i*X*Z = Y? Wait:
    // In Aaronson-Gottesman convention, x=1,z=1 means Y directly (since X*Z = -iY). Let's confirm:
    return scratchR === ONE ? -ONE : ONE;
  };

  for (let q = ZERO; q < n; q += ONE) {
    const rx = expectationSinglePauli(q, ONE, ZERO);
    const ry = expectationSinglePauli(q, ONE, ONE);
    const rz = expectationSinglePauli(q, ZERO, ONE);
    const rLen = Math.min(ONE, Math.hypot(rx, ry, rz));
    const purity = 0.5 * (ONE + rLen * rLen);
    const entropyBits = rLen > 0.99 ? ZERO : ONE;
    vectors[q] = {
      qubit: q,
      rx,
      ry,
      rz,
      purity,
      entropyBits,
      p1: 0.5 * (ONE - rz),
      collapsedTo: tab.collapsedWires.get(q) ?? null,
    };
  }
  return vectors;
}

/**
 * Rotated d=3 [[9, 1, 3]] Topological Surface-Code Lattice Specification
 */
export type PauliFault = 'I' | 'X' | 'Y' | 'Z';

export interface StabilizerPlaquetteSpec {
  readonly id: string;
  readonly kind: 'X' | 'Z';
  readonly index: number;
  readonly dataQubits: readonly number[];
  /** 3D lattice coordinates (x, z) in patch units */
  readonly centerX: number;
  readonly centerZ: number;
}

export const SURFACE_CODE_DATA_COORDS: readonly { id: number; label: string; x: number; z: number }[] = [
  { id: 0, label: 'd0', x: -ONE, z: -ONE },
  { id: 1, label: 'd1', x: ZERO, z: -ONE },
  { id: 2, label: 'd2', x: ONE, z: -ONE },
  { id: 3, label: 'd3', x: -ONE, z: ZERO },
  { id: 4, label: 'd4', x: ZERO, z: ZERO },
  { id: 5, label: 'd5', x: ONE, z: ZERO },
  { id: 6, label: 'd6', x: -ONE, z: ONE },
  { id: 7, label: 'd7', x: ZERO, z: ONE },
  { id: 8, label: 'd8', x: ONE, z: ONE },
];

export const SURFACE_CODE_PLAQUETTES: readonly StabilizerPlaquetteSpec[] = [
  // X-type stabilizers (detect Z & Y phase flips)
  { id: 'X0', kind: 'X', index: 0, dataQubits: [0, 1, 3, 4], centerX: -0.5, centerZ: -0.5 },
  { id: 'X1', kind: 'X', index: 1, dataQubits: [1, 2], centerX: 0.5, centerZ: -1.5 },
  { id: 'X2', kind: 'X', index: 2, dataQubits: [6, 7], centerX: -0.5, centerZ: 1.5 },
  { id: 'X3', kind: 'X', index: 3, dataQubits: [4, 5, 7, 8], centerX: 0.5, centerZ: 0.5 },
  // Z-type stabilizers (detect X & Y bit flips)
  { id: 'Z0', kind: 'Z', index: 0, dataQubits: [0, 3], centerX: -1.5, centerZ: -0.5 },
  { id: 'Z1', kind: 'Z', index: 1, dataQubits: [1, 2, 4, 5], centerX: 0.5, centerZ: -0.5 },
  { id: 'Z2', kind: 'Z', index: 2, dataQubits: [3, 4, 6, 7], centerX: -0.5, centerZ: 0.5 },
  { id: 'Z3', kind: 'Z', index: 3, dataQubits: [5, 8], centerX: 1.5, centerZ: 0.5 },
];

/** Logical X = X_0 X_3 X_6 (left column), Logical Z = Z_0 Z_1 Z_2 (top row) */
export const LOGICAL_X_SUPPORT = [0, 3, 6] as const;
export const LOGICAL_Z_SUPPORT = [0, 1, 2] as const;

export function verifySurfaceCodeCommutativity(): boolean {
  const xPlaqs = SURFACE_CODE_PLAQUETTES.filter((p) => p.kind === 'X');
  const zPlaqs = SURFACE_CODE_PLAQUETTES.filter((p) => p.kind === 'Z');
  for (const xp of xPlaqs) {
    for (const zp of zPlaqs) {
      let overlap = ZERO;
      for (const q of xp.dataQubits) {
        if (zp.dataQubits.includes(q)) overlap += ONE;
      }
      if (overlap % TWO !== ZERO) return false;
    }
  }
  return SURFACE_CODE_DATA_COORDS.length === NINE && SURFACE_CODE_PLAQUETTES.length === TWO * FOUR;
}

export function extractSurfaceCodeSyndromes(faults: readonly PauliFault[]): {
  excitedIds: string[];
  xSyndromes: boolean[];
  zSyndromes: boolean[];
  logicalXFlipped: boolean;
  logicalZFlipped: boolean;
} {
  // Fault F = (fx, fz): I=(0,0), X=(1,0), Z=(0,1), Y=(1,1)
  const fx = faults.map((f) => (f === 'X' || f === 'Y' ? ONE : ZERO));
  const fz = faults.map((f) => (f === 'Z' || f === 'Y' ? ONE : ZERO));

  const excitedIds: string[] = [];
  const xSyndromes: boolean[] = [];
  const zSyndromes: boolean[] = [];

  for (const plaq of SURFACE_CODE_PLAQUETTES) {
    let parity = ZERO;
    for (const q of plaq.dataQubits) {
      if (plaq.kind === 'X') {
        // X-stabilizer anticommutes with Z-component of error
        parity ^= fz[q];
      } else {
        // Z-stabilizer anticommutes with X-component of error
        parity ^= fx[q];
      }
    }
    const isExcited = parity === ONE;
    if (isExcited) excitedIds.push(plaq.id);
    if (plaq.kind === 'X') xSyndromes.push(isExcited);
    else zSyndromes.push(isExcited);
  }

  // Logical X operator X_0 X_3 X_6 anticommutes with Z-faults on {0,3,6}
  let logXParity = ZERO;
  for (const q of LOGICAL_X_SUPPORT) logXParity ^= fz[q];

  // Logical Z operator Z_0 Z_1 Z_2 anticommutes with X-faults on {0,1,2}
  let logZParity = ZERO;
  for (const q of LOGICAL_Z_SUPPORT) logZParity ^= fx[q];

  return {
    excitedIds,
    xSyndromes,
    zSyndromes,
    logicalXFlipped: logXParity === ONE,
    logicalZFlipped: logZParity === ONE,
  };
}
