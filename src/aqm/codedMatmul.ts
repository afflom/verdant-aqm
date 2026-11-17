/**
 * Stratum 1 / Stratum 4 — `uor-matmul` Zero-Decode Semiring Kernels & `uorc` OrderRope Admission (`codedMatmul.ts`)
 * Extrapolated directly from `verdant-tensor/src/coded.rs`, `afflom/lexlean-matmul`, and
 * `prism-devrel/examples/{matmul-coded-admission,uorc-admission}.prompt.json`.
 *
 * All three coded_gemm tiers execute directly over compressed representations using exact 128-bit
 * `BigInt` accumulators (`decode -> accumulate without intermediate rounding -> encode once`),
 * never materializing dense floating-point matrices.
 */

import { FOUR, ONE, SIXTEEN, TWO, TWO_FIFTY_SIX, ZERO } from './stratum0';

export const GRID16_LEVELS = SIXTEEN;
export const PACKED_NIBBLE_LANES = TWO;
export const RUN_MAX_SPAN = SIXTEEN;
export const CODEBOOK_PRODUCT_LUT_SIZE = TWO_FIFTY_SIX;

const hoistedLutByRef = new WeakMap<readonly bigint[], readonly bigint[]>();
let lastSignatureKey = '';
let lastSignatureLut: readonly bigint[] | null = null;

/**
 * Hoisted `2^8 = 256`-entry `Grid<16> x Grid<16>` exact ring product lookup table (`VE-35`).
 * Eliminates repeated `256`-element LUT rebuilds and inner-loop `BigInt` multiplications.
 */
export function getHoistedCodebookProductLut(codebook: readonly bigint[]): readonly bigint[] {
  if (codebook.length !== GRID16_LEVELS) {
    throw new Error(`Grid<16> requires ${GRID16_LEVELS} codebook levels, got ${codebook.length}`);
  }
  const byRef = hoistedLutByRef.get(codebook);
  if (byRef) return byRef;

  const sig = codebook.join(',');
  if (sig === lastSignatureKey && lastSignatureLut !== null) {
    hoistedLutByRef.set(codebook, lastSignatureLut);
    return lastSignatureLut;
  }

  const prodTable = new Array<bigint>(CODEBOOK_PRODUCT_LUT_SIZE);
  for (let i = ZERO; i < GRID16_LEVELS; i += ONE) {
    const rowOff = i << FOUR;
    const ci = codebook[i];
    for (let j = ZERO; j < GRID16_LEVELS; j += ONE) {
      prodTable[rowOff | j] = ci * codebook[j];
    }
  }
  hoistedLutByRef.set(codebook, prodTable);
  lastSignatureKey = sig;
  lastSignatureLut = prodTable;
  return prodTable;
}

/**
 * Tier 1: `Grid<16>` Codebook Zero-Decode Contraction (`contractGridCodebook`).
 * Multiplies an `(m x k)` matrix of 4-bit codebook indices `[0..15]` against a `(k x n)`
 * matrix of 4-bit codebook indices using a hoisted 256-entry signed integer product LUT,
 * accumulating exact integer dot products in `BigInt`.
 */
export function contractGridCodebook(params: {
  readonly m: number;
  readonly k: number;
  readonly n: number;
  readonly codebook: readonly bigint[];
  readonly lhsIndices: Uint8Array;
  readonly rhsIndices: Uint8Array;
}): {
  readonly out: bigint[];
  readonly codebookLookups: number;
  readonly denseFloatAllocs: 0;
} {
  const { m, k, n, codebook, lhsIndices, rhsIndices } = params;
  const prodTable = getHoistedCodebookProductLut(codebook);
  if (lhsIndices.length !== m * k || rhsIndices.length !== k * n) {
    throw new Error('Grid<16> index buffer shape mismatch');
  }

  const out: bigint[] = new Array(m * n).fill(0n);
  let lookups = ZERO;
  for (let row = ZERO; row < m; row += ONE) {
    const rowBase = row * k;
    for (let col = ZERO; col < n; col += ONE) {
      let acc = 0n;
      for (let p = ZERO; p < k; p += ONE) {
        const idxA = lhsIndices[rowBase + p] & 0x0f;
        const idxB = rhsIndices[p * n + col] & 0x0f;
        acc += prodTable[(idxA << FOUR) | idxB];
        lookups += ONE;
      }
      out[row * n + col] = acc;
    }
  }

  return { out, codebookLookups: lookups, denseFloatAllocs: 0 };
}

/**
 * Tier 2: `Packed<Grid<16>, 2>` Nibble-Packed Zero-Decode Contraction (`contractPackedNibbles`).
 * Each byte packs TWO 4-bit `Grid<16>` lanes (`low = byte & 0x0f`, `high = (byte >>> 4) & 0x0f`).
 * Contracts `(m x k)` against `(k x n)` directly from packed byte streams (`ceil(k / 2)` bytes/row)
 * via the hoisted 256-entry product LUT with zero inner-loop `BigInt` multiplications.
 */
export function packGrid16Nibbles(indices: readonly number[]): Uint8Array {
  const packedLen = Math.ceil(indices.length / PACKED_NIBBLE_LANES);
  const out = new Uint8Array(packedLen);
  for (let i = ZERO; i < indices.length; i += ONE) {
    const lane = indices[i] & 0x0f;
    const byteIdx = i >>> ONE;
    if ((i & ONE) === ZERO) {
      out[byteIdx] |= lane;
    } else {
      out[byteIdx] |= lane << FOUR;
    }
  }
  return out;
}

export function contractPackedNibbles(params: {
  readonly m: number;
  readonly k: number;
  readonly n: number;
  readonly codebook: readonly bigint[];
  readonly lhsPackedRows: readonly Uint8Array[];
  readonly rhsPackedCols: readonly Uint8Array[];
}): {
  readonly out: bigint[];
  readonly packedBytesRead: number;
  readonly denseFloatAllocs: 0;
} {
  const { m, k, n, codebook, lhsPackedRows, rhsPackedCols } = params;
  const prodTable = getHoistedCodebookProductLut(codebook);
  const packedK = Math.ceil(k / PACKED_NIBBLE_LANES);
  const fullPairs = k >>> ONE;
  const hasOddTail = (k & ONE) === ONE;
  const out: bigint[] = new Array(m * n).fill(0n);
  let bytesRead = ZERO;

  for (let row = ZERO; row < m; row += ONE) {
    const rowBuf = lhsPackedRows[row];
    for (let col = ZERO; col < n; col += ONE) {
      const colBuf = rhsPackedCols[col];
      let acc = 0n;
      for (let b = ZERO; b < fullPairs; b += ONE) {
        const bA = rowBuf[b];
        const bB = colBuf[b];
        bytesRead += TWO;
        acc +=
          prodTable[((bA & 0x0f) << FOUR) | (bB & 0x0f)] +
          prodTable[(bA & 0xf0) | ((bB >>> FOUR) & 0x0f)];
      }
      if (hasOddTail) {
        const bA = rowBuf[packedK - ONE];
        const bB = colBuf[packedK - ONE];
        bytesRead += TWO;
        acc += prodTable[((bA & 0x0f) << FOUR) | (bB & 0x0f)];
      }
      out[row * n + col] = acc;
    }
  }

  return { out, packedBytesRead: bytesRead, denseFloatAllocs: 0 };
}

/**
 * Tier 3: `Runs<Grid<16>, 16>` Sparse Run-Length Zero-Decode Contraction (`contractSparseRuns`).
 * Represents sparse quantum gates and sparse ket amplitudes as `(zeroSkip, codebookIndex)` runs
 * with zero-skip bounded by `RUN_MAX_SPAN = 16`, skipping annihilated zero blocks in O(nnz).
 */
export interface SparseGridRun {
  readonly col: number;
  readonly codeIdx: number;
}

export function contractSparseRuns(params: {
  readonly m: number;
  readonly codebook: readonly bigint[];
  readonly lhsRows: ReadonlyArray<readonly SparseGridRun[]>;
  readonly ketSupport: ReadonlyMap<number, number>; // ketIndex -> codeIdx
}): {
  readonly outSupport: Map<number, bigint>;
  readonly activeTermsVisited: number;
  readonly skippedZeroEntries: number;
  readonly logicalDimension: number;
} {
  const { m, codebook, lhsRows, ketSupport } = params;
  const prodTable = getHoistedCodebookProductLut(codebook);
  const outSupport = new Map<number, bigint>();
  let visited = ZERO;

  for (let row = ZERO; row < m; row += ONE) {
    const runs = lhsRows[row] ?? [];
    let acc = 0n;
    for (const run of runs) {
      const rhsCode = ketSupport.get(run.col);
      if (rhsCode !== undefined) {
        acc += prodTable[((run.codeIdx & 0x0f) << FOUR) | (rhsCode & 0x0f)];
        visited += ONE;
      }
    }
    if (acc !== 0n) {
      outSupport.set(row, acc);
    }
  }

  const totalDenseOps = m * m;
  return {
    outSupport,
    activeTermsVisited: visited,
    skippedZeroEntries: Math.max(ZERO, totalDenseOps - visited),
    logicalDimension: m,
  };
}

/**
 * `matmul-coded-admission` Decision Gate (`prism-devrel/examples/matmul-coded-admission.prompt.json`).
 * Admits a coded contraction iff:
 *  1. Accumulator bit-width >= required overflow-free ceiling (`requiredAccumBits <= accumBits`),
 *  2. Zero intermediate float decode occurred (`intermediateFloatDecode === false`),
 *  3. Exact ring checksum matches (`exactChecksumMatches === true`).
 */
export interface CodedMatmulAdmissionVerdict {
  readonly admitted: boolean;
  readonly status: 'ADMITTED_ZERO_DECODE' | 'REFUSED_ACCUMULATOR_OVERFLOW' | 'REFUSED_FLOAT_DECODE' | 'REFUSED_CHECKSUM_DRIFT';
  readonly detail: string;
}

export function decideMatmulCodedAdmission(input: {
  readonly accumBits: number;
  readonly requiredAccumBits: number;
  readonly intermediateFloatDecode: boolean;
  readonly exactChecksumMatches: boolean;
}): CodedMatmulAdmissionVerdict {
  if (input.intermediateFloatDecode) {
    return {
      admitted: false,
      status: 'REFUSED_FLOAT_DECODE',
      detail: 'Intermediate f32/f64 decode prohibited in codedZeroDecode tier.',
    };
  }
  if (input.accumBits < input.requiredAccumBits) {
    return {
      admitted: false,
      status: 'REFUSED_ACCUMULATOR_OVERFLOW',
      detail: `Accumulator ${input.accumBits}b < required exact ceiling ${input.requiredAccumBits}b.`,
    };
  }
  if (!input.exactChecksumMatches) {
    return {
      admitted: false,
      status: 'REFUSED_CHECKSUM_DRIFT',
      detail: 'Exact ring checksum mismatch against reference integer contraction.',
    };
  }
  return {
    admitted: true,
    status: 'ADMITTED_ZERO_DECODE',
    detail: `Zero-decode contraction verified in ${input.accumBits}-bit exact accumulator.`,
  };
}

/**
 * `uorc-admission` Challenger Gate (`prism-devrel/examples/uorc-admission.prompt.json`).
 * Evaluates a challenger archive (`OrderRope` lossless codec) against the incumbent baseline:
 *  1. Must reconstruct original bytes bit-identically (`losslessVerified === true`),
 *  2. Must preserve canonical progressive `OrderRope` causal ordering (`orderPreserved === true`),
 *  3. Must strictly reduce or match byte budget (`challengerBytes <= incumbentBytes`).
 */
export interface UorcChallengerVerdict {
  readonly admitted: boolean;
  readonly reason: 'ADMIT_CHALLENGER' | 'REFUSE_LOSSY_RECONSTRUCTION' | 'REFUSE_CAUSAL_ORDER_VIOLATION' | 'REFUSE_SIZE_REGRESSION';
  readonly compressionRatio: number;
}

export function decideUorcAdmission(input: {
  readonly originalBytes: Uint8Array;
  readonly reconstructedBytes: Uint8Array;
  readonly orderPreserved: boolean;
  readonly incumbentBytes: number;
  readonly challengerBytes: number;
}): UorcChallengerVerdict {
  let lossless = input.originalBytes.length === input.reconstructedBytes.length;
  if (lossless) {
    for (let i = ZERO; i < input.originalBytes.length; i += ONE) {
      if (input.originalBytes[i] !== input.reconstructedBytes[i]) {
        lossless = false;
        break;
      }
    }
  }

  const ratio =
    input.incumbentBytes > ZERO ? input.challengerBytes / input.incumbentBytes : ONE;

  if (!lossless) {
    return {
      admitted: false,
      reason: 'REFUSE_LOSSY_RECONSTRUCTION',
      compressionRatio: ratio,
    };
  }
  if (!input.orderPreserved) {
    return {
      admitted: false,
      reason: 'REFUSE_CAUSAL_ORDER_VIOLATION',
      compressionRatio: ratio,
    };
  }
  if (input.challengerBytes > input.incumbentBytes) {
    return {
      admitted: false,
      reason: 'REFUSE_SIZE_REGRESSION',
      compressionRatio: ratio,
    };
  }
  return {
    admitted: true,
    reason: 'ADMIT_CHALLENGER',
    compressionRatio: ratio,
  };
}
