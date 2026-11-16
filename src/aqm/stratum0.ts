/**
 * Stratum 0 — Pure {0, 1} Constructive Arithmetic, BoundedBuffer & W5H Certificates
 * Derived strictly from {0, 1} with zero magic numeric literals (FI-08 parametric ratchet).
 */

export const ZERO = 0;
export const ONE = 1;
export const TWO = ONE + ONE;
export const THREE = TWO + ONE;
export const FOUR = TWO * TWO;
export const FIVE = FOUR + ONE;
export const SIX = THREE * TWO;
export const SEVEN = SIX + ONE;
export const EIGHT = TWO * FOUR;
export const NINE = THREE * THREE;
export const TEN = TWO * FIVE;
export const TWELVE = THREE * FOUR;
export const FIFTEEN = THREE * FIVE;
export const SIXTEEN = FOUR * FOUR;

export const ZERO_BIG = BigInt(ZERO);
export const ONE_BIG = BigInt(ONE);
export const TWO_BIG = ONE_BIG + ONE_BIG;

/**
 * Constructive power of two: computes 2^exp purely by repeated shift from ONE.
 */
export function pow2Constructive(exp: number): number {
  if (exp < ZERO || !Number.isInteger(exp)) {
    throw new RangeError('Exponent must be a non-negative integer');
  }
  let acc = ONE;
  for (let i = ZERO; i < exp; i += ONE) {
    acc *= TWO;
  }
  return acc;
}

/**
 * Constructive BigInt power of two: 2n^exp for arbitrary bit-width accumulators (64/96/128-bit+).
 */
export function pow2BigInt(exp: number): bigint {
  let acc = ONE_BIG;
  for (let i = ZERO; i < exp; i += ONE) {
    acc <<= ONE_BIG;
  }
  return acc;
}

export const THIRTY_TWO = pow2Constructive(FIVE);
export const SIXTY_FOUR = pow2Constructive(SIX);
export const NINETY_SIX = THREE * THIRTY_TWO;
export const ONE_TWENTY_EIGHT = pow2Constructive(SEVEN);
export const TWO_FIFTY_SIX = pow2Constructive(EIGHT);
export const FIVE_TWELVE = pow2Constructive(NINE);

/** Canonical Stratum 0 & Engine structural constants derived from {0, 1} */
export const CORE_WASM_REQUEST_MAX_BYTES = SIXTY_FOUR;
export const CORE_WASM_RESPONSE_MAX_BYTES = FIVE_TWELVE;
export const ROLLBACK_WINDOW_FRAMES = SIXTY_FOUR;
export const TILE_EDGE_PX = SIXTEEN;
export const CODED_GRID_TABLE_SIZE = SIXTEEN;
export const PACKED_NIBBLE_BITS = FOUR;
export const PACKED_NIBBLE_PER_BYTE = TWO;
export const AUDIO_WORKLET_QUANTUM_FRAMES = ONE_TWENTY_EIGHT;
export const SNAPSHOT_URL_MAX_BYTES = pow2Constructive(FIFTEEN);
export const MAX_EXACT_STATEVEC_QUBITS = EIGHT; // Up to 2^8 = 256 exact cyclotomic basis states in interactive UI
export const DEFAULT_QUBIT_COUNT = FOUR;

/**
 * Constructive n-th prime generator (0-indexed: nthPrimeConstructive(0) = 2, (1) = 3, (2) = 5...)
 * Matches Foundation.Ontology.V1.Model::nthPrimeConstructive.
 */
export function nthPrimeConstructive(index: number): number {
  if (index < ZERO || !Number.isInteger(index)) {
    throw new RangeError('Prime index must be non-negative');
  }
  let found = ZERO;
  let candidate = TWO;
  while (true) {
    let isPrime = true;
    for (let d = TWO; d * d <= candidate; d += ONE) {
      if (candidate % d === ZERO) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) {
      if (found === index) {
        return candidate;
      }
      found += ONE;
    }
    candidate += ONE;
  }
}

/**
 * Foundation.Bytes::BoundedBuffer — Enforces explicit upper byte capacity before kernel execution.
 */
export class BoundedBuffer {
  public readonly maxBytes: number;
  private readonly data: Uint8Array;

  private constructor(bytes: Uint8Array, maxBytes: number) {
    this.data = bytes;
    this.maxBytes = maxBytes;
  }

  public static fromBytes(
    input: Uint8Array,
    maxBytes: number,
  ): { ok: true; value: BoundedBuffer } | { ok: false; byteLength: number; maxBytes: number } {
    if (input.byteLength > maxBytes) {
      return { ok: false, byteLength: input.byteLength, maxBytes };
    }
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    return { ok: true, value: new BoundedBuffer(copy, maxBytes) };
  }

  public static fromUtf8(
    text: string,
    maxBytes: number,
  ): { ok: true; value: BoundedBuffer } | { ok: false; byteLength: number; maxBytes: number } {
    const encoded = new TextEncoder().encode(text);
    return BoundedBuffer.fromBytes(encoded, maxBytes);
  }

  public get byteLength(): number {
    return this.data.byteLength;
  }

  public toBytes(): Uint8Array {
    const out = new Uint8Array(this.data.byteLength);
    out.set(this.data);
    return out;
  }

  public toUtf8(): string {
    return new TextDecoder().decode(this.data);
  }
}

export interface W5HStratumCertificate {
  readonly stratum: number;
  readonly who: string;
  readonly what: string;
  readonly whereModule: string;
  readonly whenPhase: string;
  readonly whyInvariant: string;
  readonly howConstructed: string;
}

export const AQM_STRATA_CERTIFICATES: readonly W5HStratumCertificate[] = [
  {
    stratum: ZERO,
    who: 'Foundation.Ontology & Bytes',
    what: 'Constructive {0,1} powers, primes, and BoundedBuffer',
    whereModule: 'src/aqm/stratum0.ts',
    whenPhase: 'Compile & ingress guard',
    whyInvariant: 'Zero magic literals (FI-08) and bounded input memory',
    howConstructed: 'pow2Constructive, nthPrimeConstructive, BoundedBuffer(64/512)',
  },
  {
    stratum: ONE,
    who: 'Semiring Tensor Substrate',
    what: 'Exact Z[zeta_8]/2^k state vectors, F_2 tableaus, Tropical lightcones',
    whereModule: 'src/aqm/cyclotomic.ts · stabilizer.ts · tropical.ts',
    whenPhase: 'Gate contraction & syndrome solve',
    whyInvariant: 'Zero floating-point drift, exact l2 norm conservation (k14)',
    howConstructed: '128-bit BigInt cyclotomic ring + F_2 symplectic inner product',
  },
  {
    stratum: TWO,
    who: 'Circuit DAG Compiler',
    what: 'Kahn topological layer scheduler & wire linearity',
    whereModule: 'src/aqm/prismKernel.ts',
    whenPhase: 'Pre-execution validation',
    whyInvariant: 'No-cloning (distinct wires) and acyclic causal ordering',
    howConstructed: 'wiresDistinctAndBounded + Kahn barrier scheduler',
  },
  {
    stratum: THREE,
    who: 'Deterministic Rollback Engine',
    what: 'SHA-256 DeterministicInputJournal & 64-frame RollbackSession',
    whereModule: 'src/aqm/journal.ts',
    whenPhase: 'Born-rule collapse & branch replay',
    whyInvariant: 'Bit-exact cross-architecture replay and measurement re-branching',
    howConstructed: 'Constructive SHA-256 hash chain + #vdnt= snapshot codec',
  },
  {
    stratum: FOUR,
    who: 'Progressive Streaming & Custody',
    what: 'UORC-SHA256-CHAIN-v1 LOD0..LOD4 & Stitch 2-of-3 XOR parity',
    whereModule: 'src/aqm/journal.ts',
    whenPhase: 'Progressive load & peer custody',
    whyInvariant: 'Single-shard fault tolerance and authenticated LOD refinement',
    howConstructed: '5-tier UORC frame chain + GF(2) parity shards + WebCrypto ECDSA',
  },
  {
    stratum: FIVE,
    who: 'Core-Wasm Isolated Verifier',
    what: 'hologram:guest/core-wasm@1 worker acceptance & defect gates',
    whereModule: 'src/aqm/verifierWorker.ts',
    whenPhase: 'Off-thread verification',
    whyInvariant: 'Untrusted UI separation and planted-defect refusal (R5)',
    howConstructed: 'Web Worker message boundary + 16 acceptance vectors',
  },
  {
    stratum: SIX,
    who: 'Spatial 3D Quantum Studio',
    what: 'Bloch manifolds, d=3 rotated surface-code QEC, causal lightcones',
    whereModule: 'src/components/QuantumViewport3D.tsx · tileRasterizer.ts',
    whenPhase: 'On-demand viewport render',
    whyInvariant: 'Identical scene semantics across WebGL2 PBR and 16x16 software tiles',
    howConstructed: 'Three.js RoomEnvironment PBR + CPU 16x16 tile rasterizer',
  },
  {
    stratum: SEVEN,
    who: 'Cybernetics, SLM & Acoustics',
    what: 'Q15 LIF observer, 4-bit CodedSlmDirector, Euler-Bernoulli modal bars',
    whereModule: 'src/aqm/slm.ts · sonification.ts',
    whenPhase: 'Operator guidance & telemetry sonification',
    whyInvariant: 'DenialWins invariant-guarded proposals and 128-frame audio quantum',
    howConstructed: 'Packed 4-bit nibble GEMM + WebAudio modal harmonic bank',
  },
];

/**
 * Verifies that Stratum 0 structural constants satisfy exact constructive identities.
 */
export function verifyConstructiveRatchet(): {
  valid: boolean;
  identitiesChecked: number;
  summary: string;
} {
  const checks = [
    pow2Constructive(ZERO) === ONE,
    pow2Constructive(FOUR) === TILE_EDGE_PX,
    pow2Constructive(SIX) === CORE_WASM_REQUEST_MAX_BYTES,
    pow2Constructive(SIX) === ROLLBACK_WINDOW_FRAMES,
    pow2Constructive(SEVEN) === ONE_TWENTY_EIGHT,
    pow2Constructive(NINE) === CORE_WASM_RESPONSE_MAX_BYTES,
    nthPrimeConstructive(ZERO) === TWO,
    nthPrimeConstructive(ONE) === THREE,
    nthPrimeConstructive(TWO) === FIVE,
    nthPrimeConstructive(THREE) === SEVEN,
    AQM_STRATA_CERTIFICATES.length === EIGHT,
  ];
  const valid = checks.every(Boolean);
  return {
    valid,
    identitiesChecked: checks.length,
    summary: valid
      ? `conformant:strata=${AQM_STRATA_CERTIFICATES.length},identities=${checks.length},zero-constants=true`
      : 'refused:ratchet-identity-failed',
  };
}
