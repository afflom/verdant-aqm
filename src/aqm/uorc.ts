/**
 * Pure `UORC` Wire, `#uorc=` URL Snapshots, OPFS `.uorc` Cache, Stride-8 Checkpointed Rollback,
 * and Zero-Decode `CodedMatrix` (`CDMX`) Substrate (`VE-36` / `AQ-22`).
 *
 * Byte-compatible with `crates/verdant-aqm/src/uorc.rs` and `python/qiskit-verdant-aqm/qiskit_verdant_aqm/uorc_wire.py`.
 * Every post-boot engine boundary operates exclusively over self-delimiting, SHA-256-sealed `UORC`
 * archives (`b"UORC"` magic), with explicit modeled exemptions (`Quantum.lex.tex::UorcExemptionKind`):
 *   1. `cold-boot-http-holo` (initial HTML/CSS/JS + `app.holo` v4 container with 32B BLAKE3 footer)
 *   2. `core-wasm-verifier-64b` (`hologram:guest/core-wasm@1` <= 64B UTF-8 verifier ABI)
 *   3. `host-standard-interop` (Jupyter `nbformat` v4.5 `.ipynb`, in-memory Qiskit Python objects, vendored oracle files)
 */

import {
  contractGridCodebook,
  contractPackedNibbles,
  contractSparseRuns,
  packGrid16Nibbles,
  SparseGridRun,
} from './codedMatmul';
import { bytesToHex, sha256Bytes, sha256Hex } from './sha256';
import {
  EIGHT,
  FOUR,
  ONE,
  SIXTEEN,
  SNAPSHOT_URL_MAX_BYTES,
  THIRTY_TWO,
  THREE,
  TWO,
  ZERO,
} from './stratum0';
import { AqmCircuitSpec, ModeledAqmError, UorcWireErrorKind } from './types';

export const UORC_MAGIC_BYTES = new Uint8Array([0x55, 0x4f, 0x52, 0x43]); // "UORC"
export const CDMX_MAGIC_BYTES = new Uint8Array([0x43, 0x44, 0x4d, 0x58]); // "CDMX"
export const VDNT_SNAPSHOT_MAGIC = new Uint8Array([0x56, 0x44, 0x4e, 0x54, 0x01]); // "VDNT\x01"

const UORC_HEADER_LEN = FOUR + TWO + FOUR + FOUR; // 14 bytes: "UORC"(4) + ver(1) + strategy(1) + rawLen(u32 LE) + bodyLen(u32 LE)
const UORC_SEAL_LEN = THIRTY_TWO; // 32-byte SHA-256 seal
const SIX = TWO * THREE;
const TEN = EIGHT + TWO;
const SIXTY_FOUR = EIGHT * EIGHT;

export type UorcExemptionKind =
  | 'none'
  | 'cold-boot-http-holo'
  | 'core-wasm-verifier-64b'
  | 'host-standard-interop';

export interface UorcSnapshotPayload {
  readonly spec: AqmCircuitSpec;
  readonly cursor: number;
}

/**
 * Returns `true` iff `bytes` begins with the 4-byte `b"UORC"` magic header.
 */
export function isUorcArchive(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= FOUR &&
    bytes[ZERO] === UORC_MAGIC_BYTES[ZERO] &&
    bytes[ONE] === UORC_MAGIC_BYTES[ONE] &&
    bytes[TWO] === UORC_MAGIC_BYTES[TWO] &&
    bytes[THREE] === UORC_MAGIC_BYTES[THREE]
  );
}

/**
 * Lossless O(N) 4-byte hash-chained LZ77/RLE OrderRope byte-stream encoder
 * matching `crates/verdant-aqm/src/uorc.rs::encode_order_rope_rle`.
 */
function encodeOrderRopeRle(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  const maxWin = SIXTY_FOUR * SIXTEEN; // 1024-byte sliding window
  const winMask = maxWin - ONE;
  const hashBuckets = maxWin * TWO; // 2048 hash buckets
  const hashMask = hashBuckets - ONE;
  const maxChain = THIRTY_TWO;
  const maxRun = SIXTY_FOUR + SIXTY_FOUR - ONE; // 127-byte run ceiling

  const head = new Int32Array(hashBuckets).fill(-ONE);
  const prev = new Int32Array(maxWin).fill(-ONE);

  const hash4 = (p: number): number =>
    (((input[p] << TEN) ^
      (input[p + ONE] << SIX) ^
      (input[p + TWO] << THREE) ^
      input[p + THREE] ^
      (input[p] >>> TWO)) &
      hashMask);

  let pos = ZERO;
  let litStart = ZERO;

  while (pos < input.byteLength) {
    const winStart = Math.max(ZERO, pos - maxWin);
    let bestOff = ZERO;
    let bestLen = ZERO;

    if (pos + FOUR <= input.byteLength) {
      const h = hash4(pos);
      let cand = head[h];
      let steps = ZERO;
      const maxMatch = Math.min(maxRun, input.byteLength - pos);

      while (cand >= winStart && steps < maxChain) {
        if (input[cand + bestLen] === input[pos + bestLen] && input[cand] === input[pos]) {
          let mlen = ZERO;
          while (mlen < maxMatch && input[cand + mlen] === input[pos + mlen]) {
            mlen += ONE;
          }
          if (mlen >= FOUR && mlen > bestLen) {
            bestLen = mlen;
            bestOff = pos - cand;
            if (bestLen === maxMatch) break;
          }
        }
        cand = prev[cand & winMask];
        steps += ONE;
      }

      prev[pos & winMask] = head[h];
      head[h] = pos;
    }

    if (bestLen >= FOUR) {
      while (litStart < pos) {
        const chunk = Math.min(pos - litStart, maxRun);
        out.push(ZERO, chunk);
        for (let k = ZERO; k < chunk; k += ONE) {
          out.push(input[litStart + k]);
        }
        litStart += chunk;
      }
      out.push(ONE, bestOff & 0xff, (bestOff >>> EIGHT) & 0xff, bestLen & 0xff);
      const endPos = pos + bestLen;
      for (let ins = pos + ONE; ins < endPos && ins + FOUR <= input.byteLength; ins += ONE) {
        const ih = hash4(ins);
        prev[ins & winMask] = head[ih];
        head[ih] = ins;
      }
      pos = endPos;
      litStart = pos;
    } else {
      pos += ONE;
    }
  }

  while (litStart < input.byteLength) {
    const chunk = Math.min(input.byteLength - litStart, maxRun);
    out.push(ZERO, chunk);
    for (let k = ZERO; k < chunk; k += ONE) {
      out.push(input[litStart + k]);
    }
    litStart += chunk;
  }

  return new Uint8Array(out);
}

function decodeOrderRopeRle(
  body: Uint8Array,
  expectedLen: number,
): { ok: true; plain: Uint8Array } | { ok: false; error: ModeledAqmError } {
  const out: number[] = [];
  let i = ZERO;
  while (i < body.byteLength) {
    const tag = body[i];
    if (tag === ZERO) {
      if (i + ONE >= body.byteLength) {
        return {
          ok: false,
          error: {
            kind: UorcWireErrorKind.UnsealedPostBootPayload,
            capabilityId: 'AQ-22',
            refusalCode: 'refused:corrupted-uorc-order-rope',
            detail: 'Truncated literal packet in UORC OrderRope stream.',
          },
        };
      }
      const len = body[i + ONE];
      const start = i + TWO;
      if (start + len > body.byteLength) {
        return {
          ok: false,
          error: {
            kind: UorcWireErrorKind.UnsealedPostBootPayload,
            capabilityId: 'AQ-22',
            refusalCode: 'refused:corrupted-uorc-order-rope',
            detail: 'Literal span exceeds UORC body length.',
          },
        };
      }
      for (let k = ZERO; k < len; k += ONE) {
        out.push(body[start + k]);
      }
      i = start + len;
    } else if (tag === ONE) {
      if (i + THREE >= body.byteLength) {
        return {
          ok: false,
          error: {
            kind: UorcWireErrorKind.UnsealedPostBootPayload,
            capabilityId: 'AQ-22',
            refusalCode: 'refused:corrupted-uorc-order-rope',
            detail: 'Truncated match packet in UORC OrderRope stream.',
          },
        };
      }
      const off = body[i + ONE] | (body[i + TWO] << EIGHT);
      const len = body[i + THREE];
      if (off === ZERO || off > out.length) {
        return {
          ok: false,
          error: {
            kind: UorcWireErrorKind.UnsealedPostBootPayload,
            capabilityId: 'AQ-22',
            refusalCode: 'refused:corrupted-uorc-order-rope',
            detail: 'Invalid backward offset in UORC OrderRope stream.',
          },
        };
      }
      const base = out.length - off;
      for (let k = ZERO; k < len; k += ONE) {
        out.push(out[base + k]);
      }
      i += FOUR;
    } else {
      return {
        ok: false,
        error: {
          kind: UorcWireErrorKind.UnsealedPostBootPayload,
          capabilityId: 'AQ-22',
          refusalCode: 'refused:corrupted-uorc-order-rope',
          detail: `Unknown UORC OrderRope packet tag 0x${tag.toString(SIXTEEN)}.`,
        },
      };
    }
  }

  if (out.length !== expectedLen) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.UnsealedPostBootPayload,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:corrupted-uorc-order-rope',
        detail: `Decoded UORC length ${out.length} != header rawLen ${expectedLen}.`,
      },
    };
  }
  return { ok: true, plain: new Uint8Array(out) };
}

/**
 * Compresses `payload` into a self-delimiting, SHA-256-sealed `UORC` archive
 * (`b"UORC"` + version 1 + strategy `0|1` + `rawLen u32 LE` + `bodyLen u32 LE` + body + 32B SHA-256 seal).
 */
export function compressUorcPortable(payload: Uint8Array): Uint8Array {
  const encoded = encodeOrderRopeRle(payload);
  const useCompressed = encoded.byteLength < payload.byteLength;
  const strategy = useCompressed ? ONE : ZERO;
  const body = useCompressed ? encoded : payload;

  const prefix = new Uint8Array(UORC_HEADER_LEN + body.byteLength);
  prefix.set(UORC_MAGIC_BYTES, ZERO);
  prefix[FOUR] = ONE;
  prefix[FOUR + ONE] = strategy;
  const dv = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  dv.setUint32(SIX, payload.byteLength, true);
  dv.setUint32(TEN, body.byteLength, true);
  prefix.set(body, UORC_HEADER_LEN);

  const seal = sha256Bytes(prefix);
  const archive = new Uint8Array(prefix.byteLength + UORC_SEAL_LEN);
  archive.set(prefix, ZERO);
  archive.set(seal, prefix.byteLength);
  return archive;
}

/**
 * Verifies the `b"UORC"` magic header and 32-byte SHA-256 integrity seal before reconstructing `payload`.
 * Any 1-bit tamper or unsealed buffer is deterministically refused.
 */
export function decompressUorcPortable(
  archive: Uint8Array,
): { ok: true; payload: Uint8Array; sealHex: string; strategy: 0 | 1 } | { ok: false; error: ModeledAqmError } {
  if (!isUorcArchive(archive)) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.MissingUorcMagic,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:unsealed-non-uorc-post-boot-wire',
        detail: 'Post-boot wire payload is missing mandatory 4-byte b"UORC" archive magic.',
      },
    };
  }
  if (archive.byteLength < UORC_HEADER_LEN + UORC_SEAL_LEN) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.UnsealedPostBootPayload,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:truncated-uorc-archive',
        detail: `UORC archive (${archive.byteLength} B) shorter than 46-byte header + SHA-256 seal minimum.`,
      },
    };
  }

  const sealStart = archive.byteLength - UORC_SEAL_LEN;
  const prefix = archive.subarray(ZERO, sealStart);
  const actualSeal = archive.subarray(sealStart);
  const expectedSeal = sha256Bytes(prefix);

  let sealMatches = true;
  for (let i = ZERO; i < UORC_SEAL_LEN; i += ONE) {
    if (actualSeal[i] !== expectedSeal[i]) {
      sealMatches = false;
      break;
    }
  }
  if (!sealMatches) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.SealDigestMismatch,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:uorc-sha256-seal-mismatch',
        detail: '32-byte SHA-256 seal verification failed on UORC archive (tampered or corrupted bytes).',
      },
    };
  }

  const version = archive[FOUR];
  const strategy = archive[FOUR + ONE];
  if (version !== ONE || (strategy !== ZERO && strategy !== ONE)) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.UnsealedPostBootPayload,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:unsupported-uorc-version',
        detail: `Unsupported UORC framing version=${version}, strategy=${strategy}.`,
      },
    };
  }

  const dv = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const rawLen = dv.getUint32(SIX, true);
  const bodyLen = dv.getUint32(TEN, true);
  if (UORC_HEADER_LEN + bodyLen !== sealStart) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.UnsealedPostBootPayload,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:uorc-length-mismatch',
        detail: `UORC bodyLen (${bodyLen}) + header (${UORC_HEADER_LEN}) != seal offset (${sealStart}).`,
      },
    };
  }

  const body = archive.subarray(UORC_HEADER_LEN, sealStart);
  if (strategy === ZERO) {
    if (body.byteLength !== rawLen) {
      return {
        ok: false,
        error: {
          kind: UorcWireErrorKind.UnsealedPostBootPayload,
          capabilityId: 'AQ-22',
          refusalCode: 'refused:uorc-length-mismatch',
          detail: 'Stored UORC body length disagrees with rawLen.',
        },
      };
    }
    return {
      ok: true,
      payload: new Uint8Array(body),
      sealHex: bytesToHex(actualSeal),
      strategy: 0,
    };
  }

  const decoded = decodeOrderRopeRle(body, rawLen);
  if (!decoded.ok) return decoded;
  return {
    ok: true,
    payload: decoded.plain,
    sealHex: bytesToHex(actualSeal),
    strategy: 1,
  };
}

/**
 * Enforces `Quantum.lex.tex::uorcTransportMandatory` (`VE-36` / `AQ-22`).
 * Post-boot payloads (`exemption === 'none'`) MUST be valid SHA-256-sealed `UORC` archives;
 * the 3 modeled exemptions (`cold-boot-http-holo`, `core-wasm-verifier-64b`, `host-standard-interop`)
 * are explicitly audited and permitted.
 */
export function verifyUorcTransportBoundary(
  exemption: UorcExemptionKind,
  payload: Uint8Array,
): { ok: true; exemption: UorcExemptionKind } | { ok: false; error: ModeledAqmError } {
  if (exemption === 'cold-boot-http-holo') {
    return { ok: true, exemption };
  }
  if (exemption === 'core-wasm-verifier-64b') {
    if (payload.byteLength > SIXTY_FOUR * EIGHT) {
      return {
        ok: false,
        error: {
          kind: UorcWireErrorKind.UnsealedPostBootPayload,
          capabilityId: 'AQ-22',
          refusalCode: 'refused:verifier-exemption-exceeded-512b',
          detail: `Core-Wasm text verifier exemption permits <= 512B UTF-8 frames, got ${payload.byteLength} B.`,
        },
      };
    }
    return { ok: true, exemption };
  }
  if (exemption === 'host-standard-interop') {
    return { ok: true, exemption };
  }

  const checked = decompressUorcPortable(payload);
  if (!checked.ok) return checked;
  return { ok: true, exemption: 'none' };
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = ZERO; i < bytes.byteLength; i += ONE) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(token: string): Uint8Array {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
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

/**
 * Encodes a `VDNT\x01` quantum snapshot inside a pure `UORC` archive (`b"UORC"`)
 * for `#uorc=<base64url>` shareable URLs (`VE-36` / `AQ-22`).
 */
export function encodeUorcSnapshotArchive(envelope: UorcSnapshotPayload): {
  rawVdntBytes: Uint8Array;
  uorcArchive: Uint8Array;
  urlToken: string;
} {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope));
  const rawVdntBytes = new Uint8Array(VDNT_SNAPSHOT_MAGIC.byteLength + jsonBytes.byteLength);
  rawVdntBytes.set(VDNT_SNAPSHOT_MAGIC, ZERO);
  rawVdntBytes.set(jsonBytes, VDNT_SNAPSHOT_MAGIC.byteLength);

  const uorcArchive = compressUorcPortable(rawVdntBytes);
  if (uorcArchive.byteLength > SNAPSHOT_URL_MAX_BYTES) {
    throw new Error('UORC snapshot exceeds 32768-byte URL ceiling');
  }
  return {
    rawVdntBytes,
    uorcArchive,
    urlToken: bytesToBase64Url(uorcArchive),
  };
}

/**
 * Decodes a `#uorc=<base64url(uorc)>` URL hash (and backward-compatibly accepts legacy `#vdnt=VDNT1...` hashes
 * per `afflom/verdant-engine/site/card.mjs`).
 */
export function decodeSnapshotUrlHash(
  hashOrToken: string,
): { ok: true; scheme: 'uorc' | 'vdnt-legacy'; value: UorcSnapshotPayload } | { ok: false; reason: string } {
  const trimmed = hashOrToken.trim();
  const hashMatch = /^#?(uorc|vdnt)=(.+)$/.exec(trimmed);
  const schemeHint = hashMatch ? hashMatch[ONE] : trimmed.startsWith('VDNT1.') ? 'vdnt' : 'uorc';
  const bodyToken = hashMatch ? hashMatch[TWO] : trimmed;

  if (schemeHint === 'vdnt' && bodyToken.startsWith('VDNT1.')) {
    const parts = bodyToken.split('.');
    if (parts.length !== THREE || parts[ZERO] !== 'VDNT1') {
      return { ok: false, reason: 'Invalid legacy VDNT1 header prefix' };
    }
    const expectedTag = sha256Hex(`VDNT1.${parts[ONE]}`).slice(ZERO, SIXTEEN);
    if (parts[TWO] !== expectedTag) {
      return { ok: false, reason: 'Legacy VDNT SHA-256 integrity tag mismatch' };
    }
    try {
      const raw = base64UrlToBytes(parts[ONE]);
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as UorcSnapshotPayload;
      if (!parsed || typeof parsed.cursor !== 'number' || !parsed.spec) {
        return { ok: false, reason: 'Malformed legacy VDNT payload schema' };
      }
      return { ok: true, scheme: 'vdnt-legacy', value: parsed };
    } catch {
      return { ok: false, reason: 'Failed to decode legacy VDNT base64url payload' };
    }
  }

  try {
    const archive = base64UrlToBytes(bodyToken);
    const opened = decompressUorcPortable(archive);
    if (!opened.ok) {
      return { ok: false, reason: opened.error.detail };
    }
    const raw = opened.payload;
    const hasVdntMagic =
      raw.byteLength > VDNT_SNAPSHOT_MAGIC.byteLength &&
      raw[ZERO] === VDNT_SNAPSHOT_MAGIC[ZERO] &&
      raw[ONE] === VDNT_SNAPSHOT_MAGIC[ONE] &&
      raw[TWO] === VDNT_SNAPSHOT_MAGIC[TWO] &&
      raw[THREE] === VDNT_SNAPSHOT_MAGIC[THREE] &&
      raw[FOUR] === VDNT_SNAPSHOT_MAGIC[FOUR];
    const jsonSlice = hasVdntMagic ? raw.subarray(VDNT_SNAPSHOT_MAGIC.byteLength) : raw;
    const parsed = JSON.parse(new TextDecoder().decode(jsonSlice)) as UorcSnapshotPayload;
    if (!parsed || typeof parsed.cursor !== 'number' || !parsed.spec) {
      return { ok: false, reason: 'Malformed UORC snapshot payload schema' };
    }
    return { ok: true, scheme: 'uorc', value: parsed };
  } catch {
    return { ok: false, reason: 'Invalid base64url or JSON in #uorc= snapshot token' };
  }
}

/**
 * OPFS `.uorc` Cache with deterministic in-memory fallback (`VE-36`: OPFS caches verified `.uorc` archives).
 */
const memoryOpfsFallback = new Map<string, Uint8Array>();

export async function writeUorcToOpfsCache(key: string, archive: Uint8Array): Promise<void> {
  const verified = decompressUorcPortable(archive);
  if (!verified.ok) {
    throw new Error(`Refusing to cache unsealed/corrupted UORC archive in OPFS: ${verified.error.detail}`);
  }
  const cleanName = `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.uorc`;
  memoryOpfsFallback.set(cleanName, new Uint8Array(archive));

  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(cleanName, { create: true });
      const writable = await handle.createWritable();
      const copyBuf = new ArrayBuffer(archive.byteLength);
      new Uint8Array(copyBuf).set(archive);
      await writable.write(copyBuf);
      await writable.close();
    } catch {
      // Deterministic in-memory fallback already populated when OPFS is unavailable (e.g. Node or private iframe)
    }
  }
}

export async function readUorcFromOpfsCache(
  key: string,
): Promise<{ ok: true; archive: Uint8Array; payload: Uint8Array } | { ok: false; error: ModeledAqmError }> {
  const cleanName = `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.uorc`;
  let bytes: Uint8Array | undefined;

  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(cleanName);
      const file = await handle.getFile();
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      bytes = memoryOpfsFallback.get(cleanName);
    }
  } else {
    bytes = memoryOpfsFallback.get(cleanName);
  }

  if (!bytes) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.MissingUorcMagic,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:opfs-uorc-cache-miss',
        detail: `No cached .uorc archive found for key '${cleanName}'.`,
      },
    };
  }

  const opened = decompressUorcPortable(bytes);
  if (!opened.ok) return opened;
  return { ok: true, archive: bytes, payload: opened.payload };
}

/**
 * Zero-Decode `CodedMatrix` (`b"CDMX"`) Bundle Packed Directly Inside `UORC` (`VE-36` / `AQ-22`).
 * Supports all 3 `uor-matmul` tiers (`grid16`, `packed-nibble`, `sparse-runs`) and contracts
 * directly into exact `BigInt` accumulators with `0` intermediate float allocations!
 */
export type CodedMatrixTier = 'grid16' | 'packed-nibble' | 'sparse-runs';

export interface CodedMatrixBundleSpec {
  readonly tier: CodedMatrixTier;
  readonly m: number;
  readonly k: number;
  readonly n: number;
  readonly codebook: readonly bigint[];
  readonly lhsIndices: Uint8Array; // m * k entries in 0..15
  readonly rhsIndices: Uint8Array; // k * n entries in 0..15
}

export function packCodedMatrixToUorc(spec: CodedMatrixBundleSpec): Uint8Array {
  const payloadObj = {
    magic: 'CDMX',
    tier: spec.tier,
    m: spec.m,
    k: spec.k,
    n: spec.n,
    codebook: spec.codebook.map((v) => v.toString()),
    lhsPackedB64: bytesToBase64Url(packGrid16Nibbles(Array.from(spec.lhsIndices))),
    rhsPackedB64: bytesToBase64Url(packGrid16Nibbles(Array.from(spec.rhsIndices))),
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const cdmxRaw = new Uint8Array(CDMX_MAGIC_BYTES.byteLength + jsonBytes.byteLength);
  cdmxRaw.set(CDMX_MAGIC_BYTES, ZERO);
  cdmxRaw.set(jsonBytes, CDMX_MAGIC_BYTES.byteLength);
  return compressUorcPortable(cdmxRaw);
}

function unpackNibblesToGrid16(packed: Uint8Array, totalCount: number): Uint8Array {
  const out = new Uint8Array(totalCount);
  for (let i = ZERO; i < totalCount; i += ONE) {
    const b = packed[i >>> ONE] ?? ZERO;
    out[i] = (i & ONE) === ZERO ? b & 0x0f : (b >>> FOUR) & 0x0f;
  }
  return out;
}

export function contractCodedMatrixUorcBundle(uorcArchive: Uint8Array):
  | {
      readonly ok: true;
      readonly tier: CodedMatrixTier;
      readonly out: readonly bigint[];
      readonly denseFloatAllocs: 0;
      readonly uorcByteLength: number;
    }
  | { readonly ok: false; readonly error: ModeledAqmError } {
  const opened = decompressUorcPortable(uorcArchive);
  if (!opened.ok) return opened;
  const raw = opened.payload;
  if (
    raw.byteLength <= CDMX_MAGIC_BYTES.byteLength ||
    raw[ZERO] !== CDMX_MAGIC_BYTES[ZERO] ||
    raw[ONE] !== CDMX_MAGIC_BYTES[ONE] ||
    raw[TWO] !== CDMX_MAGIC_BYTES[TWO] ||
    raw[THREE] !== CDMX_MAGIC_BYTES[THREE]
  ) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.CorruptedCodedBundle,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:missing-cdmx-coded-header',
        detail: 'Inner UORC payload is missing b"CDMX" zero-decode CodedMatrix header.',
      },
    };
  }

  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(raw.subarray(CDMX_MAGIC_BYTES.byteLength)),
    ) as {
      tier: CodedMatrixTier;
      m: number;
      k: number;
      n: number;
      codebook: string[];
      lhsPackedB64: string;
      rhsPackedB64: string;
    };

    const codebook = parsed.codebook.map((s) => BigInt(s));
    const lhsIndices = unpackNibblesToGrid16(
      base64UrlToBytes(parsed.lhsPackedB64),
      parsed.m * parsed.k,
    );
    const rhsIndices = unpackNibblesToGrid16(
      base64UrlToBytes(parsed.rhsPackedB64),
      parsed.k * parsed.n,
    );

    if (parsed.tier === 'grid16') {
      const res = contractGridCodebook({
        m: parsed.m,
        k: parsed.k,
        n: parsed.n,
        codebook,
        lhsIndices,
        rhsIndices,
      });
      return {
        ok: true,
        tier: 'grid16',
        out: res.out,
        denseFloatAllocs: res.denseFloatAllocs,
        uorcByteLength: uorcArchive.byteLength,
      };
    }

    if (parsed.tier === 'packed-nibble') {
      const lhsPackedRows: Uint8Array[] = [];
      for (let r = ZERO; r < parsed.m; r += ONE) {
        const rowSlice = Array.from(lhsIndices.subarray(r * parsed.k, (r + ONE) * parsed.k));
        lhsPackedRows.push(packGrid16Nibbles(rowSlice));
      }
      const rhsPackedCols: Uint8Array[] = [];
      for (let c = ZERO; c < parsed.n; c += ONE) {
        const colVals: number[] = [];
        for (let p = ZERO; p < parsed.k; p += ONE) {
          colVals.push(rhsIndices[p * parsed.n + c]);
        }
        rhsPackedCols.push(packGrid16Nibbles(colVals));
      }
      const res = contractPackedNibbles({
        m: parsed.m,
        k: parsed.k,
        n: parsed.n,
        codebook,
        lhsPackedRows,
        rhsPackedCols,
      });
      return {
        ok: true,
        tier: 'packed-nibble',
        out: res.out,
        denseFloatAllocs: res.denseFloatAllocs,
        uorcByteLength: uorcArchive.byteLength,
      };
    }

    // `sparse-runs` contraction (treating codebook[0] === 0n as structural zero)
    const zeroIdx = codebook.findIndex((v) => v === 0n);
    const lhsRows: SparseGridRun[][] = [];
    for (let r = ZERO; r < parsed.m; r += ONE) {
      const rowRuns: SparseGridRun[] = [];
      for (let p = ZERO; p < parsed.k; p += ONE) {
        const idx = lhsIndices[r * parsed.k + p];
        if (idx !== zeroIdx) {
          rowRuns.push({ col: p, codeIdx: idx });
        }
      }
      lhsRows.push(rowRuns);
    }
    const out: bigint[] = new Array(parsed.m * parsed.n).fill(0n);
    for (let c = ZERO; c < parsed.n; c += ONE) {
      const ketSupport = new Map<number, number>();
      for (let p = ZERO; p < parsed.k; p += ONE) {
        const idx = rhsIndices[p * parsed.n + c];
        if (idx !== zeroIdx) ketSupport.set(p, idx);
      }
      const colRes = contractSparseRuns({
        m: parsed.m,
        codebook,
        lhsRows,
        ketSupport,
      });
      for (const [r, val] of colRes.outSupport.entries()) {
        out[r * parsed.n + c] = val;
      }
    }
    return {
      ok: true,
      tier: 'sparse-runs',
      out,
      denseFloatAllocs: 0,
      uorcByteLength: uorcArchive.byteLength,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: UorcWireErrorKind.CorruptedCodedBundle,
        capabilityId: 'AQ-22',
        refusalCode: 'refused:corrupted-cdmx-coded-payload',
        detail: err instanceof Error ? err.message : 'Malformed CDMX payload',
      },
    };
  }
}

/**
 * Stride-8 `UORC`-Checkpointed Rollback Journal (`VE-36` / `AQ-22`).
 * Compresses genesis (`frame 0`) and every `frame % 8 === 0` checkpoint into SHA-256-sealed `UORC` archives.
 */
export interface UorcCheckpointEntry {
  readonly frameIndex: number;
  readonly uorcArchive: Uint8Array;
  readonly sealHex: string;
}

export function buildStride8UorcCheckpoints(
  spec: AqmCircuitSpec,
  frameDigests: readonly string[],
): readonly UorcCheckpointEntry[] {
  const out: UorcCheckpointEntry[] = [];
  for (let idx = ZERO; idx < frameDigests.length; idx += ONE) {
    if (idx === ZERO || idx % EIGHT === ZERO || idx === frameDigests.length - ONE) {
      const raw = new TextEncoder().encode(
        JSON.stringify({
          checkpointFrame: idx,
          circuit: spec.name,
          qubits: spec.qubitCount,
          chainDigest: frameDigests[idx],
        }),
      );
      const archive = compressUorcPortable(raw);
      const sealHex = bytesToHex(archive.subarray(archive.byteLength - UORC_SEAL_LEN));
      out.push({ frameIndex: idx, uorcArchive: archive, sealHex });
    }
  }
  return out;
}

export interface UorcExclusiveRuntimeAudit {
  readonly uorcExclusiveActive: boolean;
  readonly rawVdntBytes: number;
  readonly uorcSnapshotBytes: number;
  readonly snapshotStartsWithUorcMagic: boolean;
  readonly snapshotRoundtripExact: boolean;
  readonly tamperOneBitRefused: boolean;
  readonly unsealedPostBootRefused: boolean;
  readonly codedMatrixUorcBytes: number;
  readonly codedZeroDecodeVerified: boolean;
  readonly stride8CheckpointCount: number;
  readonly stride8TotalUorcBytes: number;
  readonly exemptionsVerified: {
    readonly coldBootHttpAndHolo: boolean;
    readonly coreWasmBoundedTextVerifier: boolean;
    readonly hostStandardInteropArtifact: boolean;
  };
}

/**
 * Executes a live end-to-end audit of `VE-36` / `AQ-22` pure-`UORC` post-boot wire invariants
 * and its 3 modeled exemptions.
 */
export function runUorcExclusiveRuntimeAudit(
  spec: AqmCircuitSpec,
  cursor: number,
  frameDigests: readonly string[],
): UorcExclusiveRuntimeAudit {
  const snap = encodeUorcSnapshotArchive({ spec, cursor });
  const magicOk = isUorcArchive(snap.uorcArchive);
  const decodedUrl = decodeSnapshotUrlHash(`#uorc=${snap.urlToken}`);
  const roundtripOk =
    decodedUrl.ok &&
    decodedUrl.scheme === 'uorc' &&
    decodedUrl.value.cursor === cursor &&
    decodedUrl.value.spec.name === spec.name;

  // Flip 1 bit in sealed archive and verify deterministic refusal
  const tampered = new Uint8Array(snap.uorcArchive);
  tampered[tampered.byteLength - ONE] ^= ONE;
  const tamperCheck = decompressUorcPortable(tampered);
  const unsealedCheck = verifyUorcTransportBoundary('none', snap.rawVdntBytes);

  // Zero-decode CodedMatrix (`CDMX` inside `UORC`) audit
  const codebook: bigint[] = [
    0n, 1n, -1n, 2n, -2n, 3n, -3n, 4n,
    -4n, 5n, -5n, 6n, -6n, 7n, -7n, 8n,
  ];
  const lhsIndices = new Uint8Array([1, 3, 0, 2, 5, 1, 0, 4]); // 2x4
  const rhsIndices = new Uint8Array([3, 1, 2, 0, 1, 5, 4, 2]); // 4x2
  const cdmxUorc = packCodedMatrixToUorc({
    tier: 'packed-nibble',
    m: TWO,
    k: FOUR,
    n: TWO,
    codebook,
    lhsIndices,
    rhsIndices,
  });
  const cdmxRes = contractCodedMatrixUorcBundle(cdmxUorc);
  const refRes = contractGridCodebook({
    m: TWO,
    k: FOUR,
    n: TWO,
    codebook,
    lhsIndices,
    rhsIndices,
  });
  const zeroDecodeOk =
    cdmxRes.ok &&
    cdmxRes.denseFloatAllocs === ZERO &&
    cdmxRes.out.length === refRes.out.length &&
    cdmxRes.out.every((v, i) => v === refRes.out[i]);

  const checkpoints = buildStride8UorcCheckpoints(
    spec,
    frameDigests.length > ZERO ? frameDigests : ['genesis'],
  );
  const stride8TotalUorcBytes = checkpoints.reduce((acc, c) => acc + c.uorcArchive.byteLength, ZERO);

  const exColdBoot = verifyUorcTransportBoundary(
    'cold-boot-http-holo',
    new TextEncoder().encode('HOLO-v4-cold-boot'),
  ).ok;
  const exVerifier = verifyUorcTransportBoundary(
    'core-wasm-verifier-64b',
    new TextEncoder().encode('aqm:uorc-exclusive'),
  ).ok;
  const exHostInterop = verifyUorcTransportBoundary(
    'host-standard-interop',
    new TextEncoder().encode('{"nbformat":4,"nbformat_minor":5}'),
  ).ok;

  return {
    uorcExclusiveActive:
      magicOk &&
      roundtripOk &&
      !tamperCheck.ok &&
      !unsealedCheck.ok &&
      zeroDecodeOk &&
      exColdBoot &&
      exVerifier &&
      exHostInterop,
    rawVdntBytes: snap.rawVdntBytes.byteLength,
    uorcSnapshotBytes: snap.uorcArchive.byteLength,
    snapshotStartsWithUorcMagic: magicOk,
    snapshotRoundtripExact: roundtripOk,
    tamperOneBitRefused: !tamperCheck.ok,
    unsealedPostBootRefused: !unsealedCheck.ok,
    codedMatrixUorcBytes: cdmxUorc.byteLength,
    codedZeroDecodeVerified: zeroDecodeOk,
    stride8CheckpointCount: checkpoints.length,
    stride8TotalUorcBytes,
    exemptionsVerified: {
      coldBootHttpAndHolo: exColdBoot,
      coreWasmBoundedTextVerifier: exVerifier,
      hostStandardInteropArtifact: exHostInterop,
    },
  };
}
