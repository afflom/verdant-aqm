/**
 * Stratum 6–7 — Invariant-Guarded 4-Bit `CodedSlmDirector` & `CyberneticObserverLoop` (`slm.ts`)
 * Translates natural-language operator intents locally via 4-bit nibble `Packed<Grid<16>, 2>`
 * zero-decode contractions (`k11`), admitting proposals ONLY when Prism QAM invariants pass (`DenialWins`).
 */

import { verifyAndCompileCircuitPrism } from './prismKernel';
import {
  CODED_GRID_TABLE_SIZE,
  EIGHT,
  FOUR,
  ONE,
  SEVEN,
  SIXTEEN,
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
  readonly buildSpec: () => AqmCircuitSpec;
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
 * Zero-decode `coded_gemm` dot product over `Packed<Grid<16>, 2>`: accumulates directly from 4-bit indices
 */
export function codedGemmPacked4BitDot(packedRow: Uint8Array, activations: Int32Array): number {
  let acc = ZERO;
  for (let byteIdx = ZERO; byteIdx < EIGHT; byteIdx += ONE) {
    const b = packedRow[byteIdx];
    const loCode = b & (CODED_GRID_TABLE_SIZE - ONE);
    const hiCode = (b >>> FOUR) & (CODED_GRID_TABLE_SIZE - ONE);
    acc += GRID_16_CODEBOOK[loCode] * activations[byteIdx * TWO];
    acc += GRID_16_CODEBOOK[hiCode] * activations[byteIdx * TWO + ONE];
  }
  return acc;
}

export const CANONICAL_CIRCUIT_PRESETS: readonly AqmCircuitSpec[] = [
  {
    name: '3-Qubit GHZ + T Phase Manifold',
    description: 'Maximally entangled 3-qubit Greenberger-Horne-Zeilinger state with an exact pi/4 cyclotomic T-phase twist.',
    qubitCount: THREE,
    seed: 1042,
    backend: AqmBackendMode.CyclotomicExact,
    steps: [
      { id: 's0', kind: GateKind.H, targets: [ZERO] },
      { id: 's1', kind: GateKind.CNOT, targets: [ZERO, ONE] },
      { id: 's2', kind: GateKind.CNOT, targets: [ONE, TWO] },
      { id: 's3', kind: GateKind.T, targets: [TWO] },
    ],
  },
  {
    name: 'Bell Pair + Seeded Born Collapse',
    description: 'Two-qubit EPR singlet/triplet bell pair followed by journaled projective Z-measurement on q0.',
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
    description: 'Prepares non-Clifford payload on q0, distributes Bell resource across q1-q2, entangles ancilla q3, and interferes.',
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
  {
    name: '6-Qubit Clifford Graph State (F_2 Tableau)',
    description: 'Ring-connected 6-qubit cluster/graph state simulated in polynomial time via Gottesman-Knill F_2 symplectic tableau.',
    qubitCount: TWO * THREE,
    seed: 777,
    backend: AqmBackendMode.StabilizerTableau,
    steps: [
      { id: 'g0', kind: GateKind.H, targets: [0] },
      { id: 'g1', kind: GateKind.H, targets: [1] },
      { id: 'g2', kind: GateKind.H, targets: [2] },
      { id: 'g3', kind: GateKind.H, targets: [3] },
      { id: 'g4', kind: GateKind.H, targets: [4] },
      { id: 'g5', kind: GateKind.H, targets: [5] },
      { id: 'g6', kind: GateKind.CZ, targets: [0, 1] },
      { id: 'g7', kind: GateKind.CZ, targets: [1, 2] },
      { id: 'g8', kind: GateKind.CZ, targets: [2, 3] },
      { id: 'g9', kind: GateKind.CZ, targets: [3, 4] },
      { id: 'g10', kind: GateKind.CZ, targets: [4, 5] },
      { id: 'g11', kind: GateKind.CZ, targets: [5, 0] },
    ],
  },
];

const SLM_INTENTS: readonly SlmIntentTemplate[] = [
  {
    id: 'intent-ghz',
    title: 'Prepare 3-Qubit GHZ + T Manifold',
    keywords: ['ghz', '3-qubit', 'three', 'greenberger', 'entangle'],
    packedWeights: packNibbles16([15, 13, 7, 7, 10, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8]),
    buildSpec: () => CANONICAL_CIRCUIT_PRESETS[ZERO],
  },
  {
    id: 'intent-bell-measure',
    title: 'Prepare Bell Pair & Measure q0',
    keywords: ['bell', 'epr', 'pair', 'measure', 'collapse'],
    packedWeights: packNibbles16([7, 7, 15, 13, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8]),
    buildSpec: () => CANONICAL_CIRCUIT_PRESETS[ONE],
  },
  {
    id: 'intent-teleport',
    title: '4-Qubit Teleportation & Cyclotomic Interference',
    keywords: ['teleport', 'teleportation', '4-qubit', 'interference', 'four'],
    packedWeights: packNibbles16([7, 7, 7, 7, 15, 14, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8]),
    buildSpec: () => CANONICAL_CIRCUIT_PRESETS[TWO],
  },
  {
    id: 'intent-graph-tableau',
    title: '6-Qubit Clifford Cluster Ring (Tableau)',
    keywords: ['graph', 'cluster', 'stabilizer', 'tableau', 'clifford', '6-qubit', 'ring'],
    packedWeights: packNibbles16([7, 7, 7, 7, 7, 7, 15, 14, 7, 7, 7, 7, 7, 7, 7, 8]),
    buildSpec: () => CANONICAL_CIRCUIT_PRESETS[THREE],
  },
  {
    id: 'intent-adversarial-clone',
    title: 'Adversarial Proposal: Clone q0 onto q0 via CNOT',
    keywords: ['clone', 'cloning', 'duplicate', 'copy', 'q0 onto q0', 'same wire'],
    packedWeights: packNibbles16([7, 7, 7, 7, 7, 7, 7, 7, 15, 15, 7, 7, 7, 7, 7, 8]),
    buildSpec: () => {
      const steps: AqmGateStep[] = [
        { id: 'adv0', kind: GateKind.H, targets: [ZERO] },
        { id: 'adv1', kind: GateKind.CNOT, targets: [ZERO, ZERO] },
      ];
      return {
        name: 'Adversarial Cloning Proposal',
        description: 'Proposed duplicate-wire CNOT(q0, q0) attempting to clone superposition.',
        qubitCount: TWO,
        seed: ONE,
        backend: AqmBackendMode.CyclotomicExact,
        steps,
      };
    },
  },
  {
    id: 'intent-adversarial-tableau-t',
    title: 'Adversarial Proposal: Inject T Gate into F_2 Tableau',
    keywords: ['non-clifford', 'inject t in tableau', 'magic state tableau', 'illegal t'],
    packedWeights: packNibbles16([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 15, 15, 7, 7, 7, 8]),
    buildSpec: () => ({
      name: 'Adversarial Non-Clifford Tableau Proposal',
      description: 'Dispatches pi/4 T-gate into F_2 stabilizer mode.',
      qubitCount: THREE,
      seed: ONE,
      backend: AqmBackendMode.StabilizerTableau,
      steps: [
        { id: 't0', kind: GateKind.H, targets: [ZERO] },
        { id: 't1', kind: GateKind.T, targets: [ZERO] },
      ],
    }),
  },
];

export function routePromptWithCodedSlm(rawPrompt: string): AqmSlmProposalResult {
  const norm = rawPrompt.trim().toLowerCase();
  const activations = new Int32Array(SIXTEEN);
  activations[SIXTEEN - ONE] = ONE; // Bias slot

  SLM_INTENTS.forEach((intent, idx) => {
    for (const kw of intent.keywords) {
      if (norm.includes(kw)) {
        const slotA = (idx * TWO) % (SIXTEEN - TWO);
        const slotB = (idx * TWO + ONE) % (SIXTEEN - TWO);
        activations[slotA] += TEN_ACT;
        activations[slotB] += SIX_ACT;
      }
    }
  });

  let bestIntent = SLM_INTENTS[ZERO];
  let bestScore = -1_000_000;

  for (const intent of SLM_INTENTS) {
    const score = codedGemmPacked4BitDot(intent.packedWeights, activations);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  const proposedSpec = bestIntent.buildSpec();
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
    matchedTitle: bestIntent.title,
    codedGemmScore: bestScore,
    admitted: true,
    proposedSpec,
  };
}

const SIX_ACT = TWO * THREE;
const TEN_ACT = TWO * (FOUR + ONE);

/**
 * Q15 Integer Leaky Integrate-and-Fire Salience Observer (`CyberneticObserverLoop`, `lif_decay = 7/8`, `dim = 8`)
 */
export class CyberneticObserverLoop {
  private readonly potentialsQ15 = new Int32Array(EIGHT);

  public stepFocus(channelIndex: number, impulseQ15 = 4096): ReadonlyArray<number> {
    for (let i = ZERO; i < EIGHT; i += ONE) {
      // Exact integer decay 7/8 matching Engine.lex.tex lif_decay=7/8
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
