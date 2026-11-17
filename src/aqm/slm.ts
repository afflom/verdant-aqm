/**
 * Stratum 6–7 — Invariant-Guarded 4-Bit `CodedSlmDirector` & `CyberneticObserverLoop` (`slm.ts`)
 * Translates natural-language operator intents locally via 4-bit nibble `Packed<Grid<16>, 2>`
 * zero-decode contractions (`k11`), admitting proposals ONLY when Prism QAM invariants pass (`DenialWins`).
 */

import { runWasmPacked4Gemv } from './holoGuest';
import { verifyAndCompileCircuitPrism } from './prismKernel';
import {
  EIGHT,
  FOUR,
  ONE,
  SEVEN,
  SIXTEEN,
  THIRTY_TWO,
  THREE,
  TWO,
  ZERO,
} from './stratum0';
import {
  AqmBackendMode,
  AqmCircuitSpec,
  AqmGateStep,
  GateKind,
  ModeledAqmError,
} from './types';

export interface AqmSlmProposalResult {
  readonly prompt: string;
  readonly matchedIntentId: string;
  readonly matchedTitle: string;
  readonly codedGemmScore: number;
  readonly admitted: boolean;
  readonly proposedSpec: AqmCircuitSpec;
  readonly refusalError?: ModeledAqmError;
}

interface SlmIntentTemplate {
  readonly id: string;
  readonly title: string;
  readonly keywords: readonly string[];
  /** 16-dimensional 4-bit quantized weight vector (nibbles 0..15 packed 2 per byte -> 8 bytes) */
  readonly packedWeights: Uint8Array;
  readonly buildSpec: (requestedQubits: number | null, wireTargets: readonly number[]) => AqmCircuitSpec;
}

/** 16-entry signed Q15-like lookup codebook `Grid<16>` */
const GRID_16_CODEBOOK = new Int32Array([
  -8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8, 12,
]);

function packNibbles16(nibbles: readonly number[]): Uint8Array {
  const packed = new Uint8Array(EIGHT);
  for (let i = ZERO; i < EIGHT; i += ONE) {
    const lo = nibbles[i * TWO] & (SIXTEEN - ONE);
    const hi = nibbles[i * TWO + ONE] & (SIXTEEN - ONE);
    packed[i] = lo | (hi << FOUR);
  }
  return packed;
}

/**
 * Zero-decode `coded_gemm` dot product over `Packed<Grid<16>, 2>` executed directly inside the compiled `wasm32` guest (`wasm_coded_packed4_gemv`).
 */
export function codedGemmPacked4BitDot(packedRow: Uint8Array, activations: Int32Array): number {
  const { out } = runWasmPacked4Gemv(activations, packedRow, GRID_16_CODEBOOK, ONE, EIGHT);
  return Number(out[ZERO]);
}

export function buildParametricSparseGhzSpec(qubitCount: number): AqmCircuitSpec {
  const n = Math.max(ONE, Math.floor(qubitCount));
  const steps: AqmGateStep[] = [{ id: `ghz${n}-h0`, kind: GateKind.H, targets: [ZERO] }];
  for (let i = ZERO; i < n - ONE; i += ONE) {
    steps.push({ id: `ghz${n}-cx${i}`, kind: GateKind.CNOT, targets: [i, i + ONE] });
  }
  steps.push({ id: `ghz${n}-t-end`, kind: GateKind.T, targets: [n - ONE] });
  return {
    name:
      n === THREE
        ? '3-Qubit GHZ + T Phase Manifold'
        : `${n}-Qubit Sparse GHZ + T Cat State (Sparse Z[ζ₈])`,
    description:
      n === THREE
        ? 'Maximally entangled 3-qubit Greenberger-Horne-Zeilinger state with an exact pi/4 cyclotomic T-phase twist.'
        : `Unbounded sparse Runs<Grid<16>,16> ket engine over ${n} qubits (2^${n} Hilbert space, 2 active cyclotomic kets, zero float drift).`,
    qubitCount: n,
    seed: n === THREE ? 1042 : 6400 + (n % 997),
    backend: AqmBackendMode.CyclotomicExact,
    steps,
  };
}

export function buildParametricExactMpsSpec(qubitCount: number): AqmCircuitSpec {
  const n = Math.max(TWO, Math.floor(qubitCount));
  const steps: AqmGateStep[] = [];
  for (let i = ZERO; i < n; i += FOUR) {
    steps.push({ id: `mps-h-${i}`, kind: GateKind.H, targets: [i] });
    steps.push({ id: `mps-t-${i}`, kind: GateKind.T, targets: [i] });
    if (i + ONE < n) {
      steps.push({ id: `mps-cx-${i}`, kind: GateKind.CNOT, targets: [i, i + ONE] });
    }
    if (i + TWO < n) {
      steps.push({ id: `mps-cx2-${i}`, kind: GateKind.CNOT, targets: [i + ONE, i + TWO] });
      steps.push({ id: `mps-s-${i}`, kind: GateKind.S, targets: [i + TWO] });
    }
    if (i + THREE < n) {
      steps.push({ id: `mps-cz-${i}`, kind: GateKind.CZ, targets: [i + TWO, i + THREE] });
    }
  }
  return {
    name: `${n}-Qubit Non-Clifford Cascade (Exact Z[ζ₈] MPS)`,
    description: `Exact Q(ζ₈) Galois-norm RREF tensor-train simulation of ${n} non-Clifford qubits with bounded Schmidt rank χ ≤ 2.`,
    qubitCount: n,
    seed: n === THIRTY_TWO ? 3208 : 3200 + (n % 997),
    backend: AqmBackendMode.ExactMps,
    steps,
  };
}

export function buildParametricTableauRingSpec(qubitCount: number): AqmCircuitSpec {
  const n = Math.max(TWO, Math.floor(qubitCount));
  const steps: AqmGateStep[] = [];
  for (let i = ZERO; i < n; i += ONE) {
    steps.push({ id: `tab${n}-h-${i}`, kind: GateKind.H, targets: [i] });
  }
  for (let i = ZERO; i < n; i += ONE) {
    steps.push({ id: `tab${n}-cz-${i}`, kind: GateKind.CZ, targets: [i, (i + ONE) % n] });
  }
  return {
    name: `${n}-Qubit Clifford Cluster Ring (64-Bit F₂ Tableau)`,
    description: `${n}-qubit ring graph state executed via 64-bit word-packed Gottesman-Knill F₂ symplectic tableau (O(n²/64)).`,
    qubitCount: n,
    seed: n === TWO * THIRTY_TWO ? 6464 : 6400 + (n % 997),
    backend: AqmBackendMode.StabilizerTableau,
    steps,
  };
}

export function buildParametricAtlasBraidSpec(qubitCount: number): AqmCircuitSpec {
  const n = Math.max(TWO, Math.floor(qubitCount));
  const steps: AqmGateStep[] = [];
  for (let i = ZERO; i < n; i += TWO) {
    steps.push({ id: `atl-h-${i}`, kind: GateKind.H, targets: [i] });
    steps.push({ id: `atl-t-${i}`, kind: GateKind.T, targets: [i] });
    steps.push({ id: `atl-cx-${i}`, kind: GateKind.CNOT, targets: [i, (i + ONE) % n] });
  }
  return {
    name: `${n}-Qubit Topological Atlas Braid Schedule`,
    description: `${n}-qubit topological schedule on the constant 768-byte UOR Atlas (4, 3, 8) carrier with BLAKE3 κ prefix-state elision.`,
    qubitCount: n,
    seed: n === THREE * THIRTY_TWO ? 9624 : 9600 + (n % 997),
    backend: AqmBackendMode.AtlasHolospace,
    steps,
  };
}

function build64QubitSparseGhzPreset(): AqmCircuitSpec {
  return buildParametricSparseGhzSpec(TWO * THIRTY_TWO);
}

function build32QubitExactMpsPreset(): AqmCircuitSpec {
  return buildParametricExactMpsSpec(THIRTY_TWO);
}

function build64QubitTableauRingPreset(): AqmCircuitSpec {
  return buildParametricTableauRingSpec(TWO * THIRTY_TWO);
}

function build96QubitAtlasBraidPreset(): AqmCircuitSpec {
  return buildParametricAtlasBraidSpec(THREE * THIRTY_TWO);
}

export const CANONICAL_CIRCUIT_PRESETS: readonly AqmCircuitSpec[] = [
  buildParametricSparseGhzSpec(THREE),
  {
    name: 'Bell Pair + Seeded Born Collapse',
    description:
      'Two-qubit EPR singlet/triplet bell pair followed by journaled projective Z-measurement on q0.',
    qubitCount: TWO,
    seed: 2026,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [
      { id: 'b0', kind: GateKind.H, targets: [ZERO] },
      { id: 'b1', kind: GateKind.CNOT, targets: [ZERO, ONE] },
      { id: 'b2', kind: GateKind.MEASURE, targets: [ZERO], branchMode: 'seeded' },
    ],
  },
  {
    name: '4-Qubit Quantum Teleportation + Interference',
    description:
      'Prepares non-Clifford payload on q0, distributes Bell resource across q1-q2, entangles ancilla q3, and interferes.',
    qubitCount: FOUR,
    seed: 4096,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [
      { id: 'tp0', kind: GateKind.H, targets: [ZERO] },
      { id: 'tp1', kind: GateKind.T, targets: [ZERO] },
      { id: 'tp2', kind: GateKind.H, targets: [ONE] },
      { id: 'tp3', kind: GateKind.CNOT, targets: [ONE, TWO] },
      { id: 'tp4', kind: GateKind.CNOT, targets: [ZERO, ONE] },
      { id: 'tp5', kind: GateKind.H, targets: [ZERO] },
      { id: 'tp6', kind: GateKind.CZ, targets: [TWO, THREE] },
      { id: 'tp7', kind: GateKind.H, targets: [THREE] },
    ],
  },
  build32QubitExactMpsPreset(),
  build64QubitSparseGhzPreset(),
  build64QubitTableauRingPreset(),
  build96QubitAtlasBraidPreset(),
];

const SLM_INTENTS: readonly SlmIntentTemplate[] = [
  {
    id: 'intent-ghz',
    title: 'Prepare GHZ + T Manifold',
    keywords: ['ghz', '3-qubit', 'three', 'greenberger', 'entangle'],
    packedWeights: packNibbles16([15, 13, 7, 7, 10, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8]),
    buildSpec: (n) =>
      n !== null && n !== THREE ? buildParametricSparseGhzSpec(n) : CANONICAL_CIRCUIT_PRESETS[ZERO],
  },
  {
    id: 'intent-bell-measure',
    title: 'Prepare Bell Pair & Measure',
    keywords: ['bell', 'epr', 'pair', 'measure', 'collapse'],
    packedWeights: packNibbles16([7, 7, 15, 13, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8]),
    buildSpec: (n, wires) => {
      const qCount = n !== null ? Math.max(TWO, n) : TWO;
      const w0 = wires.length >= ONE ? wires[ZERO] : ZERO;
      const w1 = wires.length >= TWO ? wires[ONE] : ONE;
      if (qCount === TWO && w0 === ZERO && w1 === ONE) {
        return CANONICAL_CIRCUIT_PRESETS[ONE];
      }
      return {
        name: `${qCount}-Qubit Bell Pair + Seeded Born Collapse (q${w0}, q${w1})`,
        description: `EPR Bell pair across wires q${w0} and q${w1} on ${qCount} qubits followed by projective Z-measurement.`,
        qubitCount: qCount,
        seed: 2026,
        backend: AqmBackendMode.CyclotomicExact,
        steps: [
          { id: 'b0', kind: GateKind.H, targets: [w0] },
          { id: 'b1', kind: GateKind.CNOT, targets: [w0, w1] },
          { id: 'b2', kind: GateKind.MEASURE, targets: [w0], branchMode: 'seeded' },
        ],
      };
    },
  },
  {
    id: 'intent-teleport',
    title: '4-Qubit Teleportation & Cyclotomic Interference',
    keywords: ['teleport', 'teleportation', '4-qubit', 'interference', 'four'],
    packedWeights: packNibbles16([7, 7, 7, 7, 15, 14, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8]),
    buildSpec: (n) => {
      if (n === null || n === FOUR) return CANONICAL_CIRCUIT_PRESETS[TWO];
      const qCount = Math.max(FOUR, n);
      return {
        ...CANONICAL_CIRCUIT_PRESETS[TWO],
        name: `${qCount}-Qubit Teleportation & Cyclotomic Interference`,
        qubitCount: qCount,
      };
    },
  },
  {
    id: 'intent-mps-32',
    title: 'Exact Z[ζ₈] MPS Non-Clifford Cascade',
    keywords: ['mps', 'tensor', '32-qubit', 'cascade', 'schmidt'],
    packedWeights: packNibbles16([7, 7, 7, 7, 7, 7, 15, 14, 7, 7, 7, 7, 7, 7, 7, 8]),
    buildSpec: (n) =>
      n !== null && n !== THIRTY_TWO
        ? buildParametricExactMpsSpec(n)
        : CANONICAL_CIRCUIT_PRESETS[THREE],
  },
  {
    id: 'intent-ghz-64',
    title: 'Sparse Z[ζ₈] GHZ + T Cat State',
    keywords: ['64-qubit', 'sparse', 'cat', 'megascale', 'large'],
    packedWeights: packNibbles16([7, 7, 7, 7, 7, 7, 7, 7, 15, 14, 7, 7, 7, 7, 7, 8]),
    buildSpec: (n) =>
      n !== null && n !== TWO * THIRTY_TWO
        ? buildParametricSparseGhzSpec(n)
        : CANONICAL_CIRCUIT_PRESETS[FOUR],
  },
  {
    id: 'intent-graph-tableau',
    title: 'Clifford Cluster Ring (64-Bit Tableau)',
    keywords: ['graph', 'cluster', 'stabilizer', 'tableau', 'clifford', 'ring'],
    packedWeights: packNibbles16([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 15, 14, 7, 7, 7, 8]),
    buildSpec: (n) =>
      n !== null && n !== TWO * THIRTY_TWO
        ? buildParametricTableauRingSpec(n)
        : CANONICAL_CIRCUIT_PRESETS[FOUR + ONE],
  },
  {
    id: 'intent-atlas-96',
    title: 'Atlas Topological Braid Schedule',
    keywords: ['atlas', 'braid', 'topological', '96-qubit', 'holospace'],
    packedWeights: packNibbles16([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 15, 14, 7, 8]),
    buildSpec: (n) =>
      n !== null && n !== THREE * THIRTY_TWO
        ? buildParametricAtlasBraidSpec(n)
        : CANONICAL_CIRCUIT_PRESETS[FOUR + TWO],
  },
  {
    id: 'intent-adversarial-clone',
    title: 'Adversarial Proposal: Duplicate-Wire Cloning via CNOT',
    keywords: ['clone', 'cloning', 'duplicate', 'copy', 'onto q', 'same wire'],
    packedWeights: packNibbles16([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 15, 8]),
    buildSpec: (n, wires) => {
      const targetWire = wires.length >= ONE ? wires[ZERO] : ZERO;
      const secondWire = wires.length >= TWO ? wires[ONE] : targetWire;
      const qCount = n !== null ? Math.max(ONE, n) : Math.max(TWO, targetWire + TWO);
      return {
        name: `Adversarial Cloning Proposal (q${targetWire}, q${secondWire})`,
        description: `Proposed duplicate-wire CNOT(q${targetWire}, q${secondWire}) attempting to clone superposition on ${qCount} qubits.`,
        qubitCount: qCount,
        seed: ONE,
        backend: AqmBackendMode.CyclotomicExact,
        steps: [
          { id: 'adv0', kind: GateKind.H, targets: [targetWire] },
          { id: 'adv1', kind: GateKind.CNOT, targets: [targetWire, secondWire] },
        ],
      };
    },
  },
];

/** Pre-packed 8×8 (64-byte) `Packed<Grid<16>, 2>` weight matrix for single-shot Wasm GEMV routing */
const SLM_PACKED_WEIGHT_MATRIX = (() => {
  const mat = new Uint8Array(SLM_INTENTS.length * EIGHT);
  SLM_INTENTS.forEach((intent, row) => {
    mat.set(intent.packedWeights, row * EIGHT);
  });
  return mat;
})();

function extractRequestedQubitCount(norm: string): number | null {
  const match = norm.match(/\b(\d+)\s*(?:-\s*)?(?:qubits?|q\b)(?!\d)/);
  if (!match) return null;
  // Avoid matching wire references like "q0" or "q7" where 'q' precedes digits; regex requires digits BEFORE 'qubit'/'q'
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed < ONE) return null;
  return Math.min(parsed, 1_000_000);
}

function extractWireTargets(norm: string): number[] {
  const out: number[] = [];
  const re = /\bq(?:ubit)?\s*(\d+)\b/g;
  let m: RegExpExecArray | null = re.exec(norm);
  while (m !== null) {
    const w = Number.parseInt(m[1], 10);
    if (Number.isFinite(w) && w >= ZERO) {
      out.push(w);
    }
    m = re.exec(norm);
  }
  return out;
}

const SIX_ACT = TWO * THREE;
const TEN_ACT = TWO * (FOUR + ONE);

export function routePromptWithCodedSlm(rawPrompt: string): AqmSlmProposalResult {
  const norm = rawPrompt.trim().toLowerCase();
  const requestedQubits = extractRequestedQubitCount(norm);
  const wireTargets = extractWireTargets(norm);

  // Direct adversarial guard check for non-Clifford in Tableau
  if (norm.includes('inject t in tableau') || norm.includes('magic state tableau')) {
    const qCount = requestedQubits ?? THREE;
    const w0 = wireTargets.length >= ONE ? wireTargets[ZERO] : ZERO;
    const proposedSpec: AqmCircuitSpec = {
      name: 'Adversarial Non-Clifford Tableau Proposal',
      description: 'Dispatches pi/4 T-gate into F_2 stabilizer mode.',
      qubitCount: qCount,
      seed: ONE,
      backend: AqmBackendMode.StabilizerTableau,
      steps: [
        { id: 't0', kind: GateKind.H, targets: [w0] },
        { id: 't1', kind: GateKind.T, targets: [w0] },
      ],
    };
    const check = verifyAndCompileCircuitPrism(proposedSpec);
    if (!check.ok) {
      return {
        prompt: rawPrompt,
        matchedIntentId: 'intent-adversarial-tableau-t',
        matchedTitle: 'Adversarial Proposal: Inject T Gate into F_2 Tableau',
        codedGemmScore: 64,
        admitted: false,
        proposedSpec,
        refusalError: check.error,
      };
    }
  }

  // Explicit single/two-wire gate synthesis when user names wire indices exceeding or targeting specific wires (e.g. "h on q16 with 8 qubits")
  if (
    requestedQubits !== null &&
    wireTargets.length >= ONE &&
    wireTargets.some((w) => w >= requestedQubits)
  ) {
    const badWire = wireTargets.find((w) => w >= requestedQubits) ?? wireTargets[ZERO];
    const proposedSpec: AqmCircuitSpec = {
      name: `Wire-Targeted Proposal on ${requestedQubits} Qubits (q${badWire})`,
      description: `Operator requested wire q${badWire} on a ${requestedQubits}-qubit register.`,
      qubitCount: requestedQubits,
      seed: ONE,
      backend: AqmBackendMode.CyclotomicExact,
      steps: [{ id: 'oob0', kind: GateKind.H, targets: [badWire] }],
    };
    const check = verifyAndCompileCircuitPrism(proposedSpec);
    if (!check.ok) {
      return {
        prompt: rawPrompt,
        matchedIntentId: 'intent-adversarial-oob-wire',
        matchedTitle: `Adversarial Proposal: Out-of-Bounds Wire q${badWire} on ${requestedQubits} Qubits`,
        codedGemmScore: 64,
        admitted: false,
        proposedSpec,
        refusalError: check.error,
      };
    }
  }

  const activations = new Int32Array(SIXTEEN);
  activations[SIXTEEN - ONE] = ONE; // Bias slot

  SLM_INTENTS.forEach((intent, idx) => {
    for (const kw of intent.keywords) {
      if (norm.includes(kw)) {
        const slotA = Math.min(SIXTEEN - TWO, idx * TWO);
        const slotB = Math.min(SIXTEEN - TWO, idx * TWO + ONE);
        activations[slotA] += TEN_ACT;
        if (slotB !== slotA) activations[slotB] += SIX_ACT;
      }
    }
  });

  // If user requested a large N-qubit circuit (>= 16) without hitting a narrow small-N keyword, boost sparse megascale slot unless another megascale substrate was named
  if (
    requestedQubits !== null &&
    requestedQubits >= SIXTEEN &&
    !norm.includes('mps') &&
    !norm.includes('tensor') &&
    !norm.includes('cascade') &&
    !norm.includes('tableau') &&
    !norm.includes('clifford') &&
    !norm.includes('stabilizer') &&
    !norm.includes('ring') &&
    !norm.includes('atlas') &&
    !norm.includes('braid') &&
    !norm.includes('topological') &&
    !norm.includes('clone') &&
    !norm.includes('duplicate')
  ) {
    activations[EIGHT] += TEN_ACT;
    activations[EIGHT + ONE] += SIX_ACT;
  }

  // Score all 8 intents in a single batched zero-decode Wasm `wasm_coded_packed4_gemv` call
  const { out: wasmScores } = runWasmPacked4Gemv(
    activations,
    SLM_PACKED_WEIGHT_MATRIX,
    GRID_16_CODEBOOK,
    SLM_INTENTS.length,
    EIGHT,
  );

  let bestIntent = SLM_INTENTS[ZERO];
  let bestScore = -1_000_000;

  for (let idx = ZERO; idx < SLM_INTENTS.length; idx += ONE) {
    const score = Number(wasmScores[idx]);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = SLM_INTENTS[idx];
    }
  }

  const proposedSpec = bestIntent.buildSpec(requestedQubits, wireTargets);
  const check = verifyAndCompileCircuitPrism(proposedSpec);

  if (!check.ok) {
    return {
      prompt: rawPrompt,
      matchedIntentId: bestIntent.id,
      matchedTitle: bestIntent.title,
      codedGemmScore: bestScore,
      admitted: false,
      proposedSpec,
      refusalError: check.error,
    };
  }

  return {
    prompt: rawPrompt,
    matchedIntentId: bestIntent.id,
    matchedTitle: proposedSpec.name,
    codedGemmScore: bestScore,
    admitted: true,
    proposedSpec,
  };
}

/**
 * Q15 Integer Leaky Integrate-and-Fire Salience Observer (`CyberneticObserverLoop`, `lif_decay = 7/8`, `dim = 8`)
 */
export class CyberneticObserverLoop {
  private readonly potentialsQ15 = new Int32Array(EIGHT);

  public stepFocus(channelIndex: number, impulseQ15 = 4096): ReadonlyArray<number> {
    for (let i = ZERO; i < EIGHT; i += ONE) {
      this.potentialsQ15[i] = Math.floor((this.potentialsQ15[i] * SEVEN) / EIGHT);
    }
    if (channelIndex >= ZERO && channelIndex < EIGHT) {
      this.potentialsQ15[channelIndex] = Math.min(32767, this.potentialsQ15[channelIndex] + impulseQ15);
    }
    return Array.from(this.potentialsQ15);
  }

  public snapshot(): ReadonlyArray<number> {
    return Array.from(this.potentialsQ15);
  }
}
