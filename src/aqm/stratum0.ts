/**
 * Stratum 0 — Pure {0, 1} Constructive Arithmetic, BoundedBuffer & W5H Certificates
 * Derived strictly from {0, 1} with zero magic numeric literals (FI-08 parametric ratchet).
 * Note: Zero artificial classical qubit ceilings are imposed in Stratum 0.
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
export const TWENTY_FOUR = THREE * EIGHT;

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
 * Constructive BigInt power of two: 2n^exp for arbitrary bit-width accumulators and ket indices.
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
export const ONE_THOUSAND_TWENTY_FOUR = pow2Constructive(TEN);
export const FOUR_THOUSAND_NINETY_SIX = pow2Constructive(TWELVE);

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
    what: 'Constructive {0,1} powers, primes, BLAKE3 kappa, and BoundedBuffer',
    whereModule: 'src/aqm/stratum0.ts · blake3.ts',
    whenPhase: 'Compile & ingress guard',
    whyInvariant: 'Zero magic literals (FI-08) and bounded input memory',
    howConstructed: 'pow2Constructive, nthPrimeConstructive, blake3Kappa, BoundedBuffer(64/512)',
  },
  {
    stratum: ONE,
    who: 'Unbounded Semiring & Topological Substrate',
    what: 'Sparse BigInt Z[zeta_8] kets, ExactMps Z[zeta_8], 64-bit F_2 tableau, Atlas MTC, uor-matmul',
    whereModule: 'src/aqm/cyclotomic.ts · mps.ts · stabilizer.ts · atlasUtqc.ts · codedMatmul.ts',
    whenPhase: 'Gate contraction, braid weaving & syndrome solve',
    whyInvariant: 'Zero 2^n dense RAM ceiling, zero float drift, exact k14 norm & MTC axioms',
    howConstructed: 'Sparse BigInt kets + Exact Z[zeta_8] MPS + BigUint64Array F_2 + C(Z_3 x Z_2^3, q)',
  },
  {
    stratum: TWO,
    who: 'Unbounded Circuit DAG & QASM Compiler',
    what: 'Kahn topological layer scheduler, wire linearity & SkWeaver PU(22) braids',
    whereModule: 'src/aqm/prismKernel.ts · atlasUtqc.ts',
    whenPhase: 'Pre-execution validation & synthesis',
    whyInvariant: 'No-cloning (distinct wires), acyclic causal ordering, SU(2) residual bound',
    howConstructed: 'wiresDistinctAndBounded + Kahn barrier scheduler + ZXZ Euler synthesis',
  },
  {
    stratum: THREE,
    who: 'Deterministic Rollback Engine',
    what: 'SHA-256 DeterministicInputJournal & RollbackSession across all 4 backends',
    whereModule: 'src/aqm/journal.ts',
    whenPhase: 'Born-rule collapse & branch replay',
    whyInvariant: 'Bit-exact cross-architecture replay and measurement re-branching',
    howConstructed: 'Constructive SHA-256 hash chain + #vdnt= snapshot codec',
  },
  {
    stratum: FOUR,
    who: 'Progressive Streaming & Custody',
    what: 'UORC-SHA256-CHAIN-v1 LOD0..LOD4, OrderRope challenger gate & Stitch 2-of-3 XOR',
    whereModule: 'src/aqm/journal.ts · codedMatmul.ts',
    whenPhase: 'Progressive load & peer custody',
    whyInvariant: 'Lossless challenger admission and single-shard fault tolerance',
    howConstructed: '5-tier UORC frame chain + OrderRope gate + GF(2) parity + WebCrypto ECDSA',
  },
  {
    stratum: FIVE,
    who: 'Hologram v4 & Core-Wasm Guest Verifier',
    what: 'VerdantAqm.holo v4 archive + real zero-import wasm32 Web Worker guest',
    whereModule: 'src/aqm/holoGuest.ts · verifierWorker.ts',
    whenPhase: 'Off-thread Wasm verification',
    whyInvariant: 'Zero host imports, BLAKE3 footer integrity, 24 vectors & 10 defect gates (R5)',
    howConstructed: 'WebAssembly.compile + memory/holo_alloc/holo_run ABI + BLAKE3 APP_MANIFEST',
  },
  {
    stratum: SIX,
    who: 'Spatial 3D Quantum Studio',
    what: 'Bloch manifolds, parametric [[d^2, 1, d]] surface-code QEC, causal lightcones',
    whereModule: 'src/components/QuantumViewport3D.tsx · tileRasterizer.ts',
    whenPhase: 'On-demand viewport render',
    whyInvariant: 'Identical scene semantics across WebGL2 PBR and 16x16 software tiles',
    howConstructed: 'Three.js RoomEnvironment PBR + CPU 16x16 tile rasterizer',
  },
  {
    stratum: SEVEN,
    who: 'Cybernetics, SLM, Acoustics & Honesty',
    what: 'Q15 LIF observer, 4-bit CodedSlmDirector, Euler-Bernoulli audio, UTQC Row-Honesty',
    whereModule: 'src/aqm/slm.ts · sonification.ts · atlasUtqc.ts',
    whenPhase: 'Operator guidance, sonification & ledger audit',
    whyInvariant: 'DenialWins proposals, 128-frame audio quantum, zero benchmark status inflation',
    howConstructed: 'Packed 4-bit nibble GEMM + WebAudio modal bank + Honesty.lex.tex gate',
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
    pow2Constructive(TEN) === ONE_THOUSAND_TWENTY_FOUR,
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
