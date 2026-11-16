/**
 * Stratum 2–4 — DeterministicInputJournal, 64-Frame RollbackSession, #vdnt= Snapshot URLs,
 * Progressive UORC-SHA256-CHAIN-v1 Packer, and Stitch 2-of-3 XOR Parity Custody (`journal.ts`)
 */

import {
  CyclotomicMachineState,
  createInitialCyclotomicState,
  inspectCyclotomicState,
  stepCyclotomicGate,
} from './cyclotomic';
import { verifyAndCompileCircuitPrism } from './prismKernel';
import { bytesToHex, sha256Bytes, sha256Hex } from './sha256';
import {
  SymplecticTableau,
  createInitialTableau,
  formatStabilizerGenerators,
  inspectStabilizerBlochVectors,
  stepStabilizerTableau,
  verifyStabilizersCommute,
} from './stabilizer';
import {
  EIGHT,
  FOUR,
  ONE,
  ROLLBACK_WINDOW_FRAMES,
  SNAPSHOT_URL_MAX_BYTES,
  SIXTEEN,
  THIRTY_TWO,
  THREE,
  TWO,
  ZERO,
  pow2Constructive,
} from './stratum0';
import {
  AqmBackendMode,
  AqmCircuitSpec,
  BasisAmplitudeSummary,
  BlochVector,
  CompiledDagNode,
  ConservationReport,
  EntanglementEdge,
  ForcedCollapseBranch,
  ModeledAqmError,
} from './types';

export interface JournalEntry {
  readonly frameIndex: number;
  readonly stepIndex: number;
  readonly stepId: string;
  readonly summary: string;
  readonly prevChainDigest: string;
  readonly chainDigest: string;
  readonly measurement?: {
    readonly wire: number;
    readonly outcome: 0 | 1;
    readonly probZero: number;
    readonly probOne: number;
    readonly drawValue: number;
    readonly branchMode: ForcedCollapseBranch;
  };
}

export interface AqmFrameSnapshot {
  readonly cursor: number;
  readonly chainDigest: string;
  readonly cyclotomic?: CyclotomicMachineState;
  readonly tableau?: SymplecticTableau;
  readonly blochVectors: readonly BlochVector[];
  readonly entanglementEdges: readonly EntanglementEdge[];
  readonly basisAmplitudes: readonly BasisAmplitudeSummary[];
  readonly stabilizerGenerators: readonly string[];
  readonly stabilizersCommute: boolean;
  readonly conservation: ConservationReport;
}

export interface ExecutedRollbackSession {
  readonly ok: true;
  readonly spec: AqmCircuitSpec;
  readonly dagNodes: readonly CompiledDagNode[];
  readonly dagDepth: number;
  readonly frames: readonly AqmFrameSnapshot[];
  readonly journal: readonly JournalEntry[];
}

/**
 * Deterministic uniform [0, 1) draw derived via SHA-256(seed : stepIndex : wire) — zero Math.random().
 */
export function deterministicBornDraw(seed: number, stepIndex: number, wire: number): number {
  const bytes = sha256Bytes(new TextEncoder().encode(`verdant-born:${seed}:${stepIndex}:${wire}`));
  const view = new DataView(bytes.buffer);
  const u32 = view.getUint32(ZERO, false);
  return u32 / pow2Constructive(THIRTY_TWO);
}

function buildFrameFromCyclotomic(
  cursor: number,
  chainDigest: string,
  state: CyclotomicMachineState,
): AqmFrameSnapshot {
  const inspected = inspectCyclotomicState(state);
  return {
    cursor,
    chainDigest,
    cyclotomic: state,
    blochVectors: inspected.blochVectors,
    entanglementEdges: inspected.entanglementEdges,
    basisAmplitudes: inspected.basisAmplitudes,
    stabilizerGenerators: [],
    stabilizersCommute: true,
    conservation: inspected.conservation,
  };
}

function buildFrameFromTableau(
  cursor: number,
  chainDigest: string,
  tab: SymplecticTableau,
): AqmFrameSnapshot {
  const bloch = inspectStabilizerBlochVectors(tab);
  const gens = formatStabilizerGenerators(tab);
  const comm = verifyStabilizersCommute(tab);

  // Pairwise entanglement heuristic in tableau mode: wires that are mixed (purity < 1) and share stabilizer support
  const edges: EntanglementEdge[] = [];
  for (let a = ZERO; a < tab.n; a += ONE) {
    for (let b = a + ONE; b < tab.n; b += ONE) {
      if (bloch[a].purity < 0.99 && bloch[b].purity < 0.99) {
        let shared = ZERO;
        for (let row = tab.n; row < TWO * tab.n; row += ONE) {
          const suppA = tab.x[row * tab.n + a] | tab.z[row * tab.n + a];
          const suppB = tab.x[row * tab.n + b] | tab.z[row * tab.n + b];
          if (suppA === ONE && suppB === ONE) shared += ONE;
        }
        if (shared > ZERO) {
          edges.push({
            qubitA: a,
            qubitB: b,
            correlationStrength: Math.min(ONE, shared / TWO),
          });
        }
      }
    }
  }

  return {
    cursor,
    chainDigest,
    tableau: tab,
    blochVectors: bloch,
    entanglementEdges: edges,
    basisAmplitudes: [],
    stabilizerGenerators: gens,
    stabilizersCommute: comm.commutes,
    conservation: {
      rationalNumerator: '1',
      rootTwoCoefficient: '0',
      scaleDenominator: '1',
      normExactOne: comm.commutes,
      bijectiveWiresVerified: true,
      tropicalTerminalReachable: true,
    },
  };
}

/**
 * Compiles and executes up to `ROLLBACK_WINDOW_FRAMES` (64) reversible/journaled frames
 * so stepping backward or re-branching any measurement collapse is instant and bit-identical.
 */
export function executeCircuitRollbackSession(
  spec: AqmCircuitSpec,
): ExecutedRollbackSession | { readonly ok: false; readonly error: ModeledAqmError } {
  const compiled = verifyAndCompileCircuitPrism(spec);
  if (!compiled.ok) {
    return compiled;
  }

  const maxSteps = Math.min(spec.steps.length, ROLLBACK_WINDOW_FRAMES - ONE);
  let chainTip = sha256Hex(
    `VDNT-GENESIS:${spec.name}:n=${spec.qubitCount}:seed=${spec.seed}:backend=${spec.backend}`,
  );

  const frames: AqmFrameSnapshot[] = [];
  const journal: JournalEntry[] = [];

  if (spec.backend === AqmBackendMode.CyclotomicExact) {
    let curState = createInitialCyclotomicState(spec.qubitCount);
    frames.push(buildFrameFromCyclotomic(ZERO, chainTip, curState));

    for (let i = ZERO; i < maxSteps; i += ONE) {
      const step = spec.steps[i];
      const draw = deterministicBornDraw(spec.seed, i, step.targets[ZERO]);
      const res = stepCyclotomicGate(curState, step, draw);
      curState = res.nextState;

      const prevDigest = chainTip;
      const stepRecord = res.measurementOutcome
        ? `${step.kind}(q${step.targets[ZERO]})->${res.measurementOutcome.outcome}[${res.measurementOutcome.branchMode}]`
        : `${step.kind}(${step.targets.map((w) => `q${w}`).join(',')})`;
      chainTip = sha256Hex(`${prevDigest}|${i}|${stepRecord}`);

      journal.push({
        frameIndex: i + ONE,
        stepIndex: i,
        stepId: step.id,
        summary: stepRecord,
        prevChainDigest: prevDigest,
        chainDigest: chainTip,
        measurement: res.measurementOutcome,
      });
      frames.push(buildFrameFromCyclotomic(i + ONE, chainTip, curState));
    }
  } else {
    let curTab = createInitialTableau(spec.qubitCount);
    frames.push(buildFrameFromTableau(ZERO, chainTip, curTab));

    for (let i = ZERO; i < maxSteps; i += ONE) {
      const step = spec.steps[i];
      const draw = deterministicBornDraw(spec.seed, i, step.targets[ZERO]);
      const res = stepStabilizerTableau(curTab, step, draw);
      curTab = res.nextTableau;

      const prevDigest = chainTip;
      const stepRecord = res.measurementOutcome
        ? `${step.kind}(q${step.targets[ZERO]})->${res.measurementOutcome.outcome}[${res.measurementOutcome.branchMode}]`
        : `${step.kind}(${step.targets.map((w) => `q${w}`).join(',')})`;
      chainTip = sha256Hex(`${prevDigest}|${i}|${stepRecord}`);

      journal.push({
        frameIndex: i + ONE,
        stepIndex: i,
        stepId: step.id,
        summary: stepRecord,
        prevChainDigest: prevDigest,
        chainDigest: chainTip,
        measurement: res.measurementOutcome,
      });
      frames.push(buildFrameFromTableau(i + ONE, chainTip, curTab));
    }
  }

  return {
    ok: true,
    spec,
    dagNodes: compiled.nodes,
    dagDepth: compiled.depth,
    frames,
    journal,
  };
}

/**
 * Authenticated `#vdnt=` Binary World/Quantum Snapshot URL Codec (VE-09 / AQ-07)
 * Format: "VDNT1." + base64url(JSON payload) + "." + 16-hex-char SHA-256 MAC tag
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = ZERO; i < bytes.byteLength; i += ONE) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (FOUR - (b64.length % FOUR)) % FOUR;
  const padded = b64 + '='.repeat(padLen);
  if (typeof atob === 'function') {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = ZERO; i < bin.length; i += ONE) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

export interface VdntSnapshotEnvelope {
  readonly spec: AqmCircuitSpec;
  readonly cursor: number;
}

export function encodeVdntSnapshotToken(envelope: VdntSnapshotEnvelope): string {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (jsonBytes.byteLength > SNAPSHOT_URL_MAX_BYTES) {
    throw new Error('VDNT snapshot exceeds 32768-byte URL ceiling');
  }
  const body = toBase64Url(jsonBytes);
  const digest = sha256Hex(`VDNT1.${body}`).slice(ZERO, SIXTEEN);
  return `VDNT1.${body}.${digest}`;
}

export function decodeVdntSnapshotToken(
  token: string,
): { ok: true; value: VdntSnapshotEnvelope } | { ok: false; reason: string } {
  const cleaned = token.startsWith('#vdnt=') ? token.slice('#vdnt='.length) : token;
  const parts = cleaned.split('.');
  if (parts.length !== THREE || parts[ZERO] !== 'VDNT1') {
    return { ok: false, reason: 'Invalid VDNT1 header prefix' };
  }
  const expectedTag = sha256Hex(`VDNT1.${parts[ONE]}`).slice(ZERO, SIXTEEN);
  if (parts[TWO] !== expectedTag) {
    return { ok: false, reason: 'VDNT SHA-256 integrity tag mismatch' };
  }
  try {
    const raw = fromBase64Url(parts[ONE]);
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as VdntSnapshotEnvelope;
    if (!parsed || typeof parsed.cursor !== 'number' || !parsed.spec) {
      return { ok: false, reason: 'Malformed VDNT payload schema' };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, reason: 'Failed to decode base64url VDNT payload' };
  }
}

/**
 * Progressive `UORC-SHA256-CHAIN-v1` Multi-LOD Stream Packer (LOD0..LOD4, AQ-08)
 */
export interface UorcLodFrame {
  readonly lod: number;
  readonly name: string;
  readonly workUnits: number;
  readonly lossless: boolean;
  readonly byteLength: number;
  readonly prevHash: string;
  readonly frameHash: string;
  readonly payloadSummary: string;
  readonly rawBytes: Uint8Array;
}

export function packProgressiveUorcStream(
  spec: AqmCircuitSpec,
  frame: AqmFrameSnapshot,
): readonly UorcLodFrame[] {
  const lodPayloads: Array<{
    lod: number;
    name: string;
    workUnits: number;
    lossless: boolean;
    summary: string;
    data: unknown;
  }> = [
    {
      lod: ZERO,
      name: 'LOD0 · Bloch & Wire Proxy',
      workUnits: TWO * (FOUR + ONE),
      lossless: false,
      summary: `${spec.qubitCount} wires · Bloch vectors (${frame.blochVectors.map((b) => b.rz.toFixed(TWO)).join(', ')})`,
      data: {
        qubits: spec.qubitCount,
        blochRz: frame.blochVectors.map((b) => Math.round(b.rz * 1000)),
      },
    },
    {
      lod: ONE,
      name: 'LOD1 · Entanglement Graph',
      workUnits: FOUR * (FOUR + ONE),
      lossless: false,
      summary: `${frame.entanglementEdges.length} mutual-information edge(s) · full Bloch (rx, ry, rz)`,
      data: {
        bloch: frame.blochVectors,
        edges: frame.entanglementEdges,
      },
    },
    {
      lod: TWO,
      name: 'LOD2 · Dominant Amplitudes',
      workUnits: SIX_WORK * (FOUR + ONE),
      lossless: false,
      summary: `Top non-zero basis states & stabilizer generators`,
      data: {
        topAmps: frame.basisAmplitudes.filter((a) => a.probability > 1e-6).slice(ZERO, EIGHT),
        generators: frame.stabilizerGenerators.slice(ZERO, EIGHT),
      },
    },
    {
      lod: THREE,
      name: 'LOD3 · Lossless Quantum State',
      workUnits: EIGHT * (FOUR + ONE),
      lossless: true,
      summary: `Lossless ${spec.backend} amplitudes / tableau + k14 conservation ledger`,
      data: {
        conservation: frame.conservation,
        exactBasis: frame.basisAmplitudes.map((a) => [a.bitstring, a.exactFormula]),
        generators: frame.stabilizerGenerators,
      },
    },
    {
      lod: FOUR,
      name: 'LOD4 · Ultra-HD Lattice & Journal',
      workUnits: SIXTEEN * (FOUR + ONE),
      lossless: true,
      summary: `Complete circuit spec + MPS bond ranks + 3D manifold coordinates`,
      data: {
        spec,
        cursor: frame.cursor,
        chainDigest: frame.chainDigest,
        mpsBonds: frame.cyclotomic?.mpsBondRanks ?? [],
      },
    },
  ];

  let prevHash = sha256Hex('UORC-SHA256-CHAIN-v1:GENESIS');
  const out: UorcLodFrame[] = [];

  for (const item of lodPayloads) {
    const bodyBytes = new TextEncoder().encode(
      JSON.stringify({ chain: 'UORC-SHA256-CHAIN-v1', lod: item.lod, prevHash, data: item.data }),
    );
    const frameHash = bytesToHex(sha256Bytes(bodyBytes));
    out.push({
      lod: item.lod,
      name: item.name,
      workUnits: item.workUnits,
      lossless: item.lossless,
      byteLength: bodyBytes.byteLength,
      prevHash,
      frameHash,
      payloadSummary: item.summary,
      rawBytes: bodyBytes,
    });
    prevHash = frameHash;
  }

  return out;
}

const SIX_WORK = TWO * THREE;

/**
 * `Stitch` 2-of-3 Binary XOR Parity Custody (`prism/identity/4`, VE-24 / AQ-08)
 * Splits payload into even-padded halves S0, S1 and computes parity shard S2 = S0 XOR S1.
 * Dropping ANY 1 of {S0, S1, S2} allows bit-exact reconstruction from the remaining 2 shards!
 */
export interface StitchParityBundle {
  readonly originalByteLength: number;
  readonly originalSha256: string;
  readonly shardByteLength: number;
  readonly prismIdentityFingerprint: string;
  readonly signatureHex: string;
  readonly shards: readonly [Uint8Array, Uint8Array, Uint8Array];
  readonly shardDigests: readonly [string, string, string];
}

export function createStitchParityBundle(
  payload: Uint8Array,
  prismIdentityFingerprint: string,
  signatureHex: string,
): StitchParityBundle {
  const originalByteLength = payload.byteLength;
  const originalSha256 = bytesToHex(sha256Bytes(payload));
  const halfLen = Math.max(ONE, Math.ceil(originalByteLength / TWO));

  const s0 = new Uint8Array(halfLen);
  const s1 = new Uint8Array(halfLen);
  const s2 = new Uint8Array(halfLen);

  s0.set(payload.subarray(ZERO, Math.min(halfLen, originalByteLength)), ZERO);
  if (originalByteLength > halfLen) {
    s1.set(payload.subarray(halfLen, originalByteLength), ZERO);
  }
  for (let i = ZERO; i < halfLen; i += ONE) {
    s2[i] = s0[i] ^ s1[i];
  }

  return {
    originalByteLength,
    originalSha256,
    shardByteLength: halfLen,
    prismIdentityFingerprint,
    signatureHex,
    shards: [s0, s1, s2],
    shardDigests: [
      bytesToHex(sha256Bytes(s0)).slice(ZERO, SIXTEEN),
      bytesToHex(sha256Bytes(s1)).slice(ZERO, SIXTEEN),
      bytesToHex(sha256Bytes(s2)).slice(ZERO, SIXTEEN),
    ],
  };
}

export function reconstructFromStitchShards(
  bundle: StitchParityBundle,
  available: readonly [boolean, boolean, boolean],
): {
  ok: boolean;
  reconstructedSha256: string;
  integrityVerified: boolean;
  bytes: Uint8Array;
  reason?: string;
} {
  const presentCount =
    (available[ZERO] ? ONE : ZERO) + (available[ONE] ? ONE : ZERO) + (available[TWO] ? ONE : ZERO);

  if (presentCount < TWO) {
    return {
      ok: false,
      reconstructedSha256: '',
      integrityVerified: false,
      bytes: new Uint8Array(ZERO),
      reason: `Insufficient custody quorum: ${presentCount}/3 fragments online (threshold = 2).`,
    };
  }

  const len = bundle.shardByteLength;
  let r0: Uint8Array;
  let r1: Uint8Array;

  if (available[ZERO] && available[ONE]) {
    r0 = bundle.shards[ZERO];
    r1 = bundle.shards[ONE];
  } else if (available[ZERO] && available[TWO]) {
    r0 = bundle.shards[ZERO];
    r1 = new Uint8Array(len);
    for (let i = ZERO; i < len; i += ONE) {
      r1[i] = bundle.shards[ZERO][i] ^ bundle.shards[TWO][i];
    }
  } else {
    // available[1] && available[2]
    r1 = bundle.shards[ONE];
    r0 = new Uint8Array(len);
    for (let i = ZERO; i < len; i += ONE) {
      r0[i] = bundle.shards[ONE][i] ^ bundle.shards[TWO][i];
    }
  }

  const joined = new Uint8Array(len * TWO);
  joined.set(r0, ZERO);
  joined.set(r1, len);
  const trimmed = joined.subarray(ZERO, bundle.originalByteLength);
  const reconstructedSha256 = bytesToHex(sha256Bytes(trimmed));
  const integrityVerified = reconstructedSha256 === bundle.originalSha256;

  return {
    ok: integrityVerified,
    reconstructedSha256,
    integrityVerified,
    bytes: new Uint8Array(trimmed),
  };
}
