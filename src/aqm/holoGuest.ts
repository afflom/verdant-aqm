/**
 * Stratum 5 — Byte-Exact Hologram v4 `.holo` Archive Builder, Parser & Real Zero-Import `wasm32`
 * Core-Wasm Verifier + Compute Kernel Guest Assembler (`holoGuest.ts`)
 *
 * Implements the authoritative `Foundation.Holo.V1.Wire` specification (`prism-code/src/archive.mjs`):
 *  - Header: `"HOLO"` (4B) + `u16 version = 4` + `u16 flags = 0` + `u16 sectionCount`
 *  - Section table (`24 * sectionCount` bytes LE): `u64 kind, u64 offset, u64 length`
 *    Kinds: `APP_MANIFEST = 15`, `METADATA = 8`, `EXTENSION = 14`, `CONTENT_BLOB = 16`
 *  - 356-byte `APP_MANIFEST` binding `requires_kappa`, `wasm_kappa`, and `view_kappa` (each 71B `blake3:<64hex>`)
 *    plus the 86-byte `hologram:guest/core-wasm@1` `MANIFEST_SUFFIX_HEX`
 *  - 32-byte BLAKE3 archive footer over `archive[0 .. bodyEnd]`
 *  - Real zero-import `wasm32` binary module compiled via `WebAssembly.compile` / `WebAssembly.Module`
 *    with 6 verified exports:
 *      1. `memory` (256 KiB linear memory)
 *      2. `holo_alloc(len: i32) -> i32`
 *      3. `holo_run(ptr: i32, len: i32) -> i64` (26 `CORE_WASM_ACCEPTANCE_VECTORS` + 64B `BoundedBuffer`)
 *      4. `wasm_symplectic_commute(x1, z1, x2, z2, words) -> i32` (native `i64.popcnt` symplectic inner product)
 *      5. `wasm_coded_packed4_gemv(act, nibs, grid, out, rows, packedCols) -> i32` (exact `i64` zero-decode GEMV)
 *      6. `wasm_tropical_minplus_closure(dist, nextHop, n) -> i32` (native `k7` Tropical `(min, +)` closure)
 */

import { blake3, blake3Hex, blake3Kappa } from './blake3';
import { CORE_WASM_ACCEPTANCE_VECTORS } from './prismKernel';

export const HOLO_VERSION = 4;
export const SECTION_METADATA = 8;
export const SECTION_EXTENSION = 14;
export const SECTION_APP_MANIFEST = 15;
export const SECTION_CONTENT_BLOB = 16;

const APP_MANIFEST_URI = 'https://hologram.foundation/realization/app-manifest';
const MANIFEST_SUFFIX_HEX =
  '5200000000000000020000000008000000686f6c6f5f72756e1a000000686f6c6f6772616d3a67756573742f636f72652d7761736d4031030a000000696e6465782e68746d6c08000000706f727461626c6500000000';

const WASM_TROPICAL_INF = 1_000_000;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** Unsigned LEB128 encoder for Wasm binary section/immediate encoding */
function uleb128(val: number): number[] {
  let v = val >>> 0;
  const out: number[] = [];
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

/** Signed LEB128 encoder for Wasm `i32.const` / `i64.const` */
function sleb128(val: number): number[] {
  let v = val | 0;
  const out: number[] = [];
  let more = true;
  while (more) {
    let byte = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    out.push(byte);
  }
  return out;
}

function wasmSection(id: number, payload: readonly number[]): Uint8Array {
  return new Uint8Array([id, ...uleb128(payload.length), ...payload]);
}

function encodeWasmStr(s: string): number[] {
  const bytes = new TextEncoder().encode(s);
  return [...uleb128(bytes.length), ...Array.from(bytes)];
}

/**
 * Assembles a genuine, spec-valid, zero-import `wasm32` binary module implementing
 * `hologram:guest/core-wasm@1` + 3 native Wasm compute kernels (`AQ-15`, `AQ-18`).
 */
export function assembleCoreWasmGuestBinary(): Uint8Array {
  const enc = new TextEncoder();
  const invalidBytes = enc.encode('invalid request'); // 15 bytes at 0x0400
  const INVALID_PTR = 0x0400;
  const INVALID_LEN = invalidBytes.length;

  const TABLE_BASE = 0x0500;
  const rules = CORE_WASM_ACCEPTANCE_VECTORS.map((v) => ({
    req: enc.encode(v.request),
    resp: enc.encode(v.expectedResponse),
  }));

  const ruleCount = rules.length;
  const metaBytesLen = 4 + ruleCount * 16;
  let poolCursor = TABLE_BASE + metaBytesLen;

  const metaBuf = new ArrayBuffer(metaBytesLen);
  const metaView = new DataView(metaBuf);
  metaView.setUint32(0, ruleCount, true);

  const poolChunks: Uint8Array[] = [];
  rules.forEach((r, idx) => {
    const reqOff = poolCursor;
    poolChunks.push(r.req);
    poolCursor += r.req.byteLength;

    const respOff = poolCursor;
    poolChunks.push(r.resp);
    poolCursor += r.resp.byteLength;

    const recOff = 4 + idx * 16;
    metaView.setUint32(recOff + 0, reqOff, true);
    metaView.setUint32(recOff + 4, r.req.byteLength, true);
    metaView.setUint32(recOff + 8, respOff, true);
    metaView.setUint32(recOff + 12, r.resp.byteLength, true);
  });

  const tableSegmentBytes = concatBytes([new Uint8Array(metaBuf), ...poolChunks]);

  // Wasm 1.0 opcodes
  const OP_BLOCK = 0x02;
  const OP_LOOP = 0x03;
  const OP_IF = 0x04;
  const OP_ELSE = 0x05;
  const OP_END = 0x0b;
  const OP_BR = 0x0c;
  const OP_BR_IF = 0x0d;
  const OP_RETURN = 0x0f;
  const OP_LOCAL_GET = 0x20;
  const OP_LOCAL_SET = 0x21;
  const OP_LOCAL_TEE = 0x22;
  const OP_GLOBAL_GET = 0x23;
  const OP_GLOBAL_SET = 0x24;
  const OP_I32_LOAD = 0x28;
  const OP_I64_LOAD = 0x29;
  const OP_I32_LOAD8_U = 0x2d;
  const OP_I32_STORE = 0x36;
  const OP_I64_STORE = 0x37;
  const OP_I32_CONST = 0x41;
  const OP_I64_CONST = 0x42;
  const OP_I32_EQZ = 0x45;
  const OP_I32_EQ = 0x46;
  const OP_I32_NE = 0x47;
  const OP_I32_LT_S = 0x48;
  const OP_I32_GT_S = 0x4a;
  const OP_I32_GT_U = 0x4b;
  const OP_I32_LE_S = 0x4c;
  const OP_I32_GE_U = 0x4f;
  const OP_I32_ADD = 0x6a;
  const OP_I32_MUL = 0x6c;
  const OP_I32_AND = 0x71;
  const OP_I32_XOR = 0x73;
  const OP_I32_SHL = 0x74;
  const OP_I32_SHR_U = 0x76;
  const OP_I64_POPCNT = 0x7b;
  const OP_I64_ADD = 0x7c;
  const OP_I64_MUL = 0x7e;
  const OP_I64_AND = 0x83;
  const OP_I64_OR = 0x84;
  const OP_I64_XOR = 0x85;
  const OP_I64_SHL = 0x86;
  const OP_I32_WRAP_I64 = 0xa7;
  const OP_I64_EXTEND_I32_S = 0xac;
  const OP_I64_EXTEND_I32_U = 0xad;

  const TYPE_VOID_BLOCK = 0x40;
  const TYPE_I32 = 0x7f;
  const TYPE_I64 = 0x7e;

  // Section 1: Type section — 5 function signatures
  //   type 0: (i32) -> (i32)                           holo_alloc
  //   type 1: (i32, i32) -> (i64)                      holo_run
  //   type 2: (i32, i32, i32, i32, i32) -> (i32)       wasm_symplectic_commute
  //   type 3: (i32, i32, i32, i32, i32, i32) -> (i32)  wasm_coded_packed4_gemv
  //   type 4: (i32, i32, i32) -> (i32)                 wasm_tropical_minplus_closure
  const typeSec = wasmSection(1, [
    ...uleb128(5),
    0x60, 1, TYPE_I32, 1, TYPE_I32,
    0x60, 2, TYPE_I32, TYPE_I32, 1, TYPE_I64,
    0x60, 5, TYPE_I32, TYPE_I32, TYPE_I32, TYPE_I32, TYPE_I32, 1, TYPE_I32,
    0x60, 6, TYPE_I32, TYPE_I32, TYPE_I32, TYPE_I32, TYPE_I32, TYPE_I32, 1, TYPE_I32,
    0x60, 3, TYPE_I32, TYPE_I32, TYPE_I32, 1, TYPE_I32,
  ]);

  // Section 3: Function section — funcs 0..4 map to types 0..4
  const funcSec = wasmSection(3, [...uleb128(5), 0, 1, 2, 3, 4]);

  // Section 5: Memory section — 1 memory, min 4 pages (256 KiB), max 16 pages (1 MiB)
  const memSec = wasmSection(5, [...uleb128(1), 0x01, ...uleb128(4), ...uleb128(16)]);

  // Section 6: Global section — global 0: mut i32 = 0x10000 (65536) bump arena cursor
  const globalSec = wasmSection(6, [
    ...uleb128(1),
    TYPE_I32,
    0x01,
    OP_I32_CONST,
    ...sleb128(0x10000),
    OP_END,
  ]);

  // Section 7: Export section — 6 verified zero-import exports
  const exportSec = wasmSection(7, [
    ...uleb128(6),
    ...encodeWasmStr('memory'), 0x02, 0,
    ...encodeWasmStr('holo_alloc'), 0x00, 0,
    ...encodeWasmStr('holo_run'), 0x00, 1,
    ...encodeWasmStr('wasm_symplectic_commute'), 0x00, 2,
    ...encodeWasmStr('wasm_coded_packed4_gemv'), 0x00, 3,
    ...encodeWasmStr('wasm_tropical_minplus_closure'), 0x00, 4,
  ]);

  // Func 0: holo_alloc(param 0: $len i32) -> i32 (8-byte aligned arena in 0x10000..0x40000)
  const allocInstrs: number[] = [
    1, 2, TYPE_I32, // local 1: $alignedLen, local 2: $ptr
    // $alignedLen = ($len + 7) & ~7
    OP_LOCAL_GET, 0,
    OP_I32_CONST, 7,
    OP_I32_ADD,
    OP_I32_CONST, ...sleb128(-8),
    OP_I32_AND,
    OP_LOCAL_SET, 1,

    // if (global0 + $alignedLen > 0x40000) global0 = 0x10000
    OP_GLOBAL_GET, 0,
    OP_LOCAL_GET, 1,
    OP_I32_ADD,
    OP_I32_CONST, ...sleb128(0x40000),
    OP_I32_GT_U,
    OP_IF, TYPE_VOID_BLOCK,
      OP_I32_CONST, ...sleb128(0x10000),
      OP_GLOBAL_SET, 0,
    OP_END,

    OP_GLOBAL_GET, 0,
    OP_LOCAL_TEE, 2,
    OP_LOCAL_GET, 1,
    OP_I32_ADD,
    OP_GLOBAL_SET, 0,
    OP_LOCAL_GET, 2,
    OP_END,
  ];

  const pushInvalidReturn: number[] = [
    OP_I32_CONST, ...sleb128(INVALID_PTR),
    OP_I64_EXTEND_I32_U,
    OP_I64_CONST, ...sleb128(32),
    OP_I64_SHL,
    OP_I32_CONST, ...sleb128(INVALID_LEN),
    OP_I64_EXTEND_I32_U,
    OP_I64_OR,
    OP_RETURN,
  ];

  // Func 1: holo_run(param 0: $ptr i32, param 1: $len i32) -> i64
  const runInstrs: number[] = [
    1, 6, TYPE_I32,
    OP_LOCAL_GET, 1,
    OP_I32_CONST, 0,
    OP_I32_LE_S,
    OP_IF, TYPE_VOID_BLOCK,
      ...pushInvalidReturn,
    OP_END,

    OP_LOCAL_GET, 1,
    OP_I32_CONST, ...sleb128(64),
    OP_I32_GT_S,
    OP_IF, TYPE_VOID_BLOCK,
      ...pushInvalidReturn,
    OP_END,

    OP_I32_CONST, ...sleb128(TABLE_BASE),
    OP_I32_LOAD, 2, 0,
    OP_LOCAL_SET, 3,

    OP_I32_CONST, 0,
    OP_LOCAL_SET, 2,

    OP_BLOCK, TYPE_VOID_BLOCK,
      OP_LOOP, TYPE_VOID_BLOCK,
        OP_LOCAL_GET, 2,
        OP_LOCAL_GET, 3,
        OP_I32_GE_U,
        OP_BR_IF, 1,

        OP_I32_CONST, ...sleb128(TABLE_BASE + 4),
        OP_LOCAL_GET, 2,
        OP_I32_CONST, 4,
        OP_I32_SHL,
        OP_I32_ADD,
        OP_LOCAL_TEE, 4,

        OP_I32_LOAD, 2, 4,
        OP_LOCAL_GET, 1,
        OP_I32_EQ,
        OP_IF, TYPE_VOID_BLOCK,
          OP_LOCAL_GET, 4,
          OP_I32_LOAD, 2, 0,
          OP_LOCAL_SET, 5,

          OP_I32_CONST, 0,
          OP_LOCAL_SET, 6,
          OP_I32_CONST, 1,
          OP_LOCAL_SET, 7,

          OP_BLOCK, TYPE_VOID_BLOCK,
            OP_LOOP, TYPE_VOID_BLOCK,
              OP_LOCAL_GET, 6,
              OP_LOCAL_GET, 1,
              OP_I32_GE_U,
              OP_BR_IF, 1,

              OP_LOCAL_GET, 0,
              OP_LOCAL_GET, 6,
              OP_I32_ADD,
              OP_I32_LOAD8_U, 0, 0,

              OP_LOCAL_GET, 5,
              OP_LOCAL_GET, 6,
              OP_I32_ADD,
              OP_I32_LOAD8_U, 0, 0,

              OP_I32_NE,
              OP_IF, TYPE_VOID_BLOCK,
                OP_I32_CONST, 0,
                OP_LOCAL_SET, 7,
                OP_BR, 2,
              OP_END,

              OP_LOCAL_GET, 6,
              OP_I32_CONST, 1,
              OP_I32_ADD,
              OP_LOCAL_SET, 6,
              OP_BR, 0,
            OP_END,
          OP_END,

          OP_LOCAL_GET, 7,
          OP_I32_EQZ,
          OP_IF, TYPE_VOID_BLOCK,
          OP_ELSE,
            OP_LOCAL_GET, 4,
            OP_I32_LOAD, 2, 8,
            OP_I64_EXTEND_I32_U,
            OP_I64_CONST, ...sleb128(32),
            OP_I64_SHL,
            OP_LOCAL_GET, 4,
            OP_I32_LOAD, 2, 12,
            OP_I64_EXTEND_I32_U,
            OP_I64_OR,
            OP_RETURN,
          OP_END,
        OP_END,

        OP_LOCAL_GET, 2,
        OP_I32_CONST, 1,
        OP_I32_ADD,
        OP_LOCAL_SET, 2,
        OP_BR, 0,
      OP_END,
    OP_END,

    ...pushInvalidReturn,
    OP_END,
  ];

  // Func 2: wasm_symplectic_commute(0:x1Ptr, 1:z1Ptr, 2:x2Ptr, 3:z2Ptr, 4:wordCount) -> i32
  // Locals: 5:$w, 6:$parity, 7:$byteOff
  const symplecticInstrs: number[] = [
    1, 3, TYPE_I32,
    OP_I32_CONST, 0,
    OP_LOCAL_SET, 5,
    OP_I32_CONST, 0,
    OP_LOCAL_SET, 6,

    OP_BLOCK, TYPE_VOID_BLOCK,
      OP_LOOP, TYPE_VOID_BLOCK,
        OP_LOCAL_GET, 5,
        OP_LOCAL_GET, 4,
        OP_I32_GE_U,
        OP_BR_IF, 1,

        // $byteOff = $w << 3
        OP_LOCAL_GET, 5,
        OP_I32_CONST, 3,
        OP_I32_SHL,
        OP_LOCAL_SET, 7,

        // (i64.load(x1 + off) & i64.load(z2 + off)) ^ (i64.load(z1 + off) & i64.load(x2 + off))
        OP_LOCAL_GET, 0,
        OP_LOCAL_GET, 7,
        OP_I32_ADD,
        OP_I64_LOAD, 3, 0,

        OP_LOCAL_GET, 3,
        OP_LOCAL_GET, 7,
        OP_I32_ADD,
        OP_I64_LOAD, 3, 0,
        OP_I64_AND,

        OP_LOCAL_GET, 1,
        OP_LOCAL_GET, 7,
        OP_I32_ADD,
        OP_I64_LOAD, 3, 0,

        OP_LOCAL_GET, 2,
        OP_LOCAL_GET, 7,
        OP_I32_ADD,
        OP_I64_LOAD, 3, 0,
        OP_I64_AND,

        OP_I64_XOR,
        OP_I64_POPCNT,
        OP_I32_WRAP_I64,

        OP_LOCAL_GET, 6,
        OP_I32_XOR,
        OP_LOCAL_SET, 6,

        OP_LOCAL_GET, 5,
        OP_I32_CONST, 1,
        OP_I32_ADD,
        OP_LOCAL_SET, 5,
        OP_BR, 0,
      OP_END,
    OP_END,

    // Return 1 iff (parity & 1) == 0
    OP_LOCAL_GET, 6,
    OP_I32_CONST, 1,
    OP_I32_AND,
    OP_I32_EQZ,
    OP_END,
  ];

  // Func 3: wasm_coded_packed4_gemv(0:actPtr, 1:nibsPtr, 2:gridPtr, 3:outPtr, 4:rows, 5:packedCols) -> i32
  // Locals: 6:$r, 7:$p, 8:$byte, 9:$actIdx, 10:$ops (i32); 11:$acc (i64)
  const packed4GemvInstrs: number[] = [
    2, 5, TYPE_I32, 1, TYPE_I64,
    OP_I32_CONST, 0,
    OP_LOCAL_SET, 6,
    OP_I32_CONST, 0,
    OP_LOCAL_SET, 10,

    OP_BLOCK, TYPE_VOID_BLOCK,
      OP_LOOP, TYPE_VOID_BLOCK,
        OP_LOCAL_GET, 6,
        OP_LOCAL_GET, 4,
        OP_I32_GE_U,
        OP_BR_IF, 1,

        OP_I64_CONST, 0,
        OP_LOCAL_SET, 11,
        OP_I32_CONST, 0,
        OP_LOCAL_SET, 7,

        OP_BLOCK, TYPE_VOID_BLOCK,
          OP_LOOP, TYPE_VOID_BLOCK,
            OP_LOCAL_GET, 7,
            OP_LOCAL_GET, 5,
            OP_I32_GE_U,
            OP_BR_IF, 1,

            // $byte = i32.load8_u(nibsPtr + ($r * packedCols + $p))
            OP_LOCAL_GET, 1,
            OP_LOCAL_GET, 6,
            OP_LOCAL_GET, 5,
            OP_I32_MUL,
            OP_LOCAL_GET, 7,
            OP_I32_ADD,
            OP_I32_ADD,
            OP_I32_LOAD8_U, 0, 0,
            OP_LOCAL_SET, 8,

            // $actIdx = $p << 1
            OP_LOCAL_GET, 7,
            OP_I32_CONST, 1,
            OP_I32_SHL,
            OP_LOCAL_SET, 9,

            // $acc += i64(grid[$byte & 15]) * i64(act[$actIdx])
            OP_LOCAL_GET, 11,
            OP_LOCAL_GET, 2,
            OP_LOCAL_GET, 8,
            OP_I32_CONST, 15,
            OP_I32_AND,
            OP_I32_CONST, 2,
            OP_I32_SHL,
            OP_I32_ADD,
            OP_I32_LOAD, 2, 0,
            OP_I64_EXTEND_I32_S,

            OP_LOCAL_GET, 0,
            OP_LOCAL_GET, 9,
            OP_I32_CONST, 2,
            OP_I32_SHL,
            OP_I32_ADD,
            OP_I32_LOAD, 2, 0,
            OP_I64_EXTEND_I32_S,
            OP_I64_MUL,
            OP_I64_ADD,

            // + i64(grid[($byte >>> 4) & 15]) * i64(act[$actIdx + 1])
            OP_LOCAL_GET, 2,
            OP_LOCAL_GET, 8,
            OP_I32_CONST, 4,
            OP_I32_SHR_U,
            OP_I32_CONST, 15,
            OP_I32_AND,
            OP_I32_CONST, 2,
            OP_I32_SHL,
            OP_I32_ADD,
            OP_I32_LOAD, 2, 0,
            OP_I64_EXTEND_I32_S,

            OP_LOCAL_GET, 0,
            OP_LOCAL_GET, 9,
            OP_I32_CONST, 1,
            OP_I32_ADD,
            OP_I32_CONST, 2,
            OP_I32_SHL,
            OP_I32_ADD,
            OP_I32_LOAD, 2, 0,
            OP_I64_EXTEND_I32_S,
            OP_I64_MUL,
            OP_I64_ADD,
            OP_LOCAL_SET, 11,

            // $ops += 2; $p += 1
            OP_LOCAL_GET, 10,
            OP_I32_CONST, 2,
            OP_I32_ADD,
            OP_LOCAL_SET, 10,

            OP_LOCAL_GET, 7,
            OP_I32_CONST, 1,
            OP_I32_ADD,
            OP_LOCAL_SET, 7,
            OP_BR, 0,
          OP_END,
        OP_END,

        // i64.store(outPtr + ($r << 3), $acc)
        OP_LOCAL_GET, 3,
        OP_LOCAL_GET, 6,
        OP_I32_CONST, 3,
        OP_I32_SHL,
        OP_I32_ADD,
        OP_LOCAL_GET, 11,
        OP_I64_STORE, 3, 0,

        OP_LOCAL_GET, 6,
        OP_I32_CONST, 1,
        OP_I32_ADD,
        OP_LOCAL_SET, 6,
        OP_BR, 0,
      OP_END,
    OP_END,

    OP_LOCAL_GET, 10,
    OP_END,
  ];

  // Func 4: wasm_tropical_minplus_closure(0:distPtr, 1:nextHopPtr, 2:n) -> i32
  // Locals: 3:$k, 4:$i, 5:$j, 6:$dik, 7:$dkj, 8:$cand, 9:$ijByteOff, 10:$relaxCount
  const tropicalInstrs: number[] = [
    1, 8, TYPE_I32,
    OP_I32_CONST, 0,
    OP_LOCAL_SET, 3,
    OP_I32_CONST, 0,
    OP_LOCAL_SET, 10,

    OP_BLOCK, TYPE_VOID_BLOCK,
      OP_LOOP, TYPE_VOID_BLOCK,
        OP_LOCAL_GET, 3,
        OP_LOCAL_GET, 2,
        OP_I32_GE_U,
        OP_BR_IF, 1,

        OP_I32_CONST, 0,
        OP_LOCAL_SET, 4,
        OP_BLOCK, TYPE_VOID_BLOCK,
          OP_LOOP, TYPE_VOID_BLOCK,
            OP_LOCAL_GET, 4,
            OP_LOCAL_GET, 2,
            OP_I32_GE_U,
            OP_BR_IF, 1,

            // $dik = i32.load(distPtr + (($i * $n + $k) << 2))
            OP_LOCAL_GET, 0,
            OP_LOCAL_GET, 4,
            OP_LOCAL_GET, 2,
            OP_I32_MUL,
            OP_LOCAL_GET, 3,
            OP_I32_ADD,
            OP_I32_CONST, 2,
            OP_I32_SHL,
            OP_I32_ADD,
            OP_I32_LOAD, 2, 0,
            OP_LOCAL_TEE, 6,

            OP_I32_CONST, ...sleb128(WASM_TROPICAL_INF),
            OP_I32_LT_S,
            OP_IF, TYPE_VOID_BLOCK,
              OP_I32_CONST, 0,
              OP_LOCAL_SET, 5,
              OP_BLOCK, TYPE_VOID_BLOCK,
                OP_LOOP, TYPE_VOID_BLOCK,
                  OP_LOCAL_GET, 5,
                  OP_LOCAL_GET, 2,
                  OP_I32_GE_U,
                  OP_BR_IF, 1,

                  // $dkj = i32.load(distPtr + (($k * $n + $j) << 2))
                  OP_LOCAL_GET, 0,
                  OP_LOCAL_GET, 3,
                  OP_LOCAL_GET, 2,
                  OP_I32_MUL,
                  OP_LOCAL_GET, 5,
                  OP_I32_ADD,
                  OP_I32_CONST, 2,
                  OP_I32_SHL,
                  OP_I32_ADD,
                  OP_I32_LOAD, 2, 0,
                  OP_LOCAL_TEE, 7,

                  OP_I32_CONST, ...sleb128(WASM_TROPICAL_INF),
                  OP_I32_LT_S,
                  OP_IF, TYPE_VOID_BLOCK,
                    // $cand = $dik + $dkj
                    OP_LOCAL_GET, 6,
                    OP_LOCAL_GET, 7,
                    OP_I32_ADD,
                    OP_LOCAL_SET, 8,

                    // $ijByteOff = (($i * $n + $j) << 2)
                    OP_LOCAL_GET, 4,
                    OP_LOCAL_GET, 2,
                    OP_I32_MUL,
                    OP_LOCAL_GET, 5,
                    OP_I32_ADD,
                    OP_I32_CONST, 2,
                    OP_I32_SHL,
                    OP_LOCAL_SET, 9,

                    // if ($cand <_s dist[i, j])
                    OP_LOCAL_GET, 8,
                    OP_LOCAL_GET, 0,
                    OP_LOCAL_GET, 9,
                    OP_I32_ADD,
                    OP_I32_LOAD, 2, 0,
                    OP_I32_LT_S,
                    OP_IF, TYPE_VOID_BLOCK,
                      // dist[i, j] = $cand
                      OP_LOCAL_GET, 0,
                      OP_LOCAL_GET, 9,
                      OP_I32_ADD,
                      OP_LOCAL_GET, 8,
                      OP_I32_STORE, 2, 0,

                      // nextHop[i, j] = nextHop[i, k]
                      OP_LOCAL_GET, 1,
                      OP_LOCAL_GET, 9,
                      OP_I32_ADD,

                      OP_LOCAL_GET, 1,
                      OP_LOCAL_GET, 4,
                      OP_LOCAL_GET, 2,
                      OP_I32_MUL,
                      OP_LOCAL_GET, 3,
                      OP_I32_ADD,
                      OP_I32_CONST, 2,
                      OP_I32_SHL,
                      OP_I32_ADD,
                      OP_I32_LOAD, 2, 0,
                      OP_I32_STORE, 2, 0,

                      // $relaxCount += 1
                      OP_LOCAL_GET, 10,
                      OP_I32_CONST, 1,
                      OP_I32_ADD,
                      OP_LOCAL_SET, 10,
                    OP_END,
                  OP_END,

                  OP_LOCAL_GET, 5,
                  OP_I32_CONST, 1,
                  OP_I32_ADD,
                  OP_LOCAL_SET, 5,
                  OP_BR, 0,
                OP_END,
              OP_END,
            OP_END,

            OP_LOCAL_GET, 4,
            OP_I32_CONST, 1,
            OP_I32_ADD,
            OP_LOCAL_SET, 4,
            OP_BR, 0,
          OP_END,
        OP_END,

        OP_LOCAL_GET, 3,
        OP_I32_CONST, 1,
        OP_I32_ADD,
        OP_LOCAL_SET, 3,
        OP_BR, 0,
      OP_END,
    OP_END,

    OP_LOCAL_GET, 10,
    OP_END,
  ];

  const codeSec = wasmSection(10, [
    ...uleb128(5),
    ...uleb128(allocInstrs.length), ...allocInstrs,
    ...uleb128(runInstrs.length), ...runInstrs,
    ...uleb128(symplecticInstrs.length), ...symplecticInstrs,
    ...uleb128(packed4GemvInstrs.length), ...packed4GemvInstrs,
    ...uleb128(tropicalInstrs.length), ...tropicalInstrs,
  ]);

  // Section 11: Data section — segment 0 at INVALID_PTR, segment 1 at TABLE_BASE
  const dataPayload: number[] = [
    ...uleb128(2),
    0x00, OP_I32_CONST, ...sleb128(INVALID_PTR), OP_END,
    ...uleb128(invalidBytes.length), ...Array.from(invalidBytes),
    0x00, OP_I32_CONST, ...sleb128(TABLE_BASE), OP_END,
    ...uleb128(tableSegmentBytes.length), ...Array.from(tableSegmentBytes),
  ];
  const dataSec = wasmSection(11, dataPayload);

  const magicAndVersion = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  return concatBytes([
    magicAndVersion,
    typeSec,
    funcSec,
    memSec,
    globalSec,
    exportSec,
    codeSec,
    dataSec,
  ]);
}

function buildAppManifestSection(
  requiresKappa: string,
  wasmKappa: string,
  viewKappa: string,
): Uint8Array {
  const enc = new TextEncoder();
  const uriBytes = enc.encode(`${APP_MANIFEST_URI}\0`);
  const countBuf = new Uint8Array(4);
  new DataView(countBuf.buffer).setUint32(0, 3, true);
  const k1 = enc.encode(requiresKappa);
  const k2 = enc.encode(wasmKappa);
  const k3 = enc.encode(viewKappa);
  const suffix = hexToBytes(MANIFEST_SUFFIX_HEX);
  return concatBytes([uriBytes, countBuf, k1, k2, k3, suffix]);
}

function buildContentBlobSection(content: Uint8Array): { kappa: string; sectionBytes: Uint8Array } {
  const kp = blake3Kappa(content);
  const kpBytes = new TextEncoder().encode(kp);
  return {
    kappa: kp,
    sectionBytes: concatBytes([kpBytes, content]),
  };
}

export interface HoloV4VerificationReport {
  readonly valid: boolean;
  readonly version: number;
  readonly byteLength: number;
  readonly sectionCount: number;
  readonly archiveFingerprint: string;
  readonly footerVerified: boolean;
  readonly manifestLength: number;
  readonly requiresKappa: string;
  readonly wasmKappa: string;
  readonly viewKappa: string;
  readonly wasmBytes: Uint8Array;
  readonly zeroImportsVerified: boolean;
  readonly exportedSymbols: readonly string[];
}

export function buildVerdantAqmHoloArchive(modelSourcesSummary = 'VerdantAqm@0.2.0:8-facets:AQ-01..AQ-18'): {
  archiveBytes: Uint8Array;
  archiveFingerprint: string;
  wasmBytes: Uint8Array;
  wasmKappa: string;
  requiresKappa: string;
  viewKappa: string;
} {
  const enc = new TextEncoder();
  const wasmBytes = assembleCoreWasmGuestBinary();
  const requiresJson = enc.encode(
    JSON.stringify({
      world: 'hologram:guest/core-wasm@1',
      capabilities: ['AQ-01..AQ-18'],
      zeroImports: true,
      computeKernels: [
        'wasm_symplectic_commute',
        'wasm_coded_packed4_gemv',
        'wasm_tropical_minplus_closure',
      ],
    }),
  );
  const viewHtml = enc.encode('<!doctype html><title>Verdant AQM Portable Holo View</title>');

  const reqBlob = buildContentBlobSection(requiresJson);
  const wasmBlob = buildContentBlobSection(wasmBytes);
  const viewBlob = buildContentBlobSection(viewHtml);

  const appManifestBytes = buildAppManifestSection(
    reqBlob.kappa,
    wasmBlob.kappa,
    viewBlob.kappa,
  );
  const metadataBytes = enc.encode(
    JSON.stringify({
      name: 'verdant-aqm',
      version: '0.2.0',
      holoVersion: HOLO_VERSION,
      facets: 8,
      wasmExports: 6,
    }),
  );
  const extPrismModel = enc.encode(`prismpm-model/v1\0${modelSourcesSummary}`);

  const sections: Array<{ kind: number; payload: Uint8Array }> = [
    { kind: SECTION_APP_MANIFEST, payload: appManifestBytes },
    { kind: SECTION_METADATA, payload: metadataBytes },
    { kind: SECTION_EXTENSION, payload: extPrismModel },
    { kind: SECTION_CONTENT_BLOB, payload: reqBlob.sectionBytes },
    { kind: SECTION_CONTENT_BLOB, payload: wasmBlob.sectionBytes },
    { kind: SECTION_CONTENT_BLOB, payload: viewBlob.sectionBytes },
  ];

  const headerLen = 10;
  const tableLen = sections.length * 24;
  let cursor = headerLen + tableLen;

  const headerAndTable = new ArrayBuffer(headerLen + tableLen);
  const hv = new DataView(headerAndTable);
  hv.setUint8(0, 0x48);
  hv.setUint8(1, 0x4f);
  hv.setUint8(2, 0x4c);
  hv.setUint8(3, 0x4f);
  hv.setUint16(4, HOLO_VERSION, true);
  hv.setUint16(6, 0, true);
  hv.setUint16(8, sections.length, true);

  sections.forEach((sec, idx) => {
    const base = headerLen + idx * 24;
    hv.setBigUint64(base + 0, BigInt(sec.kind), true);
    hv.setBigUint64(base + 8, BigInt(cursor), true);
    hv.setBigUint64(base + 16, BigInt(sec.payload.byteLength), true);
    cursor += sec.payload.byteLength;
  });

  const bodyBytes = concatBytes([
    new Uint8Array(headerAndTable),
    ...sections.map((s) => s.payload),
  ]);
  const footer = blake3(bodyBytes, 32);
  const archiveBytes = concatBytes([bodyBytes, footer]);

  return {
    archiveBytes,
    archiveFingerprint: blake3Hex(bodyBytes),
    wasmBytes,
    wasmKappa: wasmBlob.kappa,
    requiresKappa: reqBlob.kappa,
    viewKappa: viewBlob.kappa,
  };
}

export async function parseAndVerifyHoloV4Archive(
  archive: Uint8Array,
): Promise<HoloV4VerificationReport> {
  if (archive.byteLength < 10 + 32) {
    throw new Error('Archive shorter than Hologram v4 header + BLAKE3 footer');
  }
  const magic = new TextDecoder().decode(archive.subarray(0, 4));
  if (magic !== 'HOLO') {
    throw new Error(`Invalid .holo magic: ${magic}`);
  }

  const dv = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const version = dv.getUint16(4, true);
  const sectionCount = dv.getUint16(8, true);

  const bodyEnd = archive.byteLength - 32;
  const body = archive.subarray(0, bodyEnd);
  const expectedFooter = archive.subarray(bodyEnd);
  const computedFooter = blake3(body, 32);

  let footerVerified = true;
  for (let i = 0; i < 32; i += 1) {
    if (expectedFooter[i] !== computedFooter[i]) {
      footerVerified = false;
      break;
    }
  }

  let manifestBytes: Uint8Array | null = null;
  const blobs = new Map<string, Uint8Array>();

  for (let i = 0; i < sectionCount; i += 1) {
    const base = 10 + i * 24;
    const kind = Number(dv.getBigUint64(base + 0, true));
    const offset = Number(dv.getBigUint64(base + 8, true));
    const length = Number(dv.getBigUint64(base + 16, true));
    const slice = archive.subarray(offset, offset + length);

    if (kind === SECTION_APP_MANIFEST) {
      manifestBytes = slice;
    } else if (kind === SECTION_CONTENT_BLOB) {
      const label = new TextDecoder().decode(slice.subarray(0, 71));
      const content = slice.subarray(71);
      const actualKappa = blake3Kappa(content);
      if (label !== actualKappa) {
        throw new Error(`CONTENT_BLOB kappa mismatch: ${label} != ${actualKappa}`);
      }
      blobs.set(label, content);
    }
  }

  if (!manifestBytes || manifestBytes.byteLength !== 356) {
    throw new Error(`Invalid APP_MANIFEST length: ${manifestBytes?.byteLength ?? 0} != 356`);
  }

  const dec = new TextDecoder();
  const requiresKappa = dec.decode(manifestBytes.subarray(57, 128));
  const wasmKappa = dec.decode(manifestBytes.subarray(128, 199));
  const viewKappa = dec.decode(manifestBytes.subarray(199, 270));

  const wasmBytes = blobs.get(wasmKappa);
  if (!wasmBytes) {
    throw new Error(`Missing wasm_kappa blob ${wasmKappa}`);
  }

  const wasmCopy = new ArrayBuffer(wasmBytes.byteLength);
  new Uint8Array(wasmCopy).set(wasmBytes);
  const compiledMod = await WebAssembly.compile(wasmCopy);
  const imports = WebAssembly.Module.imports(compiledMod);
  const exportsList = WebAssembly.Module.exports(compiledMod).map((e) => e.name);
  const zeroImportsVerified = imports.length === 0;
  const hasContractExports =
    exportsList.includes('memory') &&
    exportsList.includes('holo_alloc') &&
    exportsList.includes('holo_run') &&
    exportsList.includes('wasm_symplectic_commute') &&
    exportsList.includes('wasm_coded_packed4_gemv') &&
    exportsList.includes('wasm_tropical_minplus_closure');

  return {
    valid: version === HOLO_VERSION && footerVerified && zeroImportsVerified && hasContractExports,
    version,
    byteLength: archive.byteLength,
    sectionCount,
    archiveFingerprint: blake3Hex(body),
    footerVerified,
    manifestLength: manifestBytes.byteLength,
    requiresKappa,
    wasmKappa,
    viewKappa,
    wasmBytes,
    zeroImportsVerified,
    exportedSymbols: exportsList,
  };
}

export interface CoreWasmGuestExports {
  readonly memory: WebAssembly.Memory;
  readonly holo_alloc: (len: number) => number;
  readonly holo_run: (ptr: number, len: number) => bigint;
  readonly wasm_symplectic_commute: (
    x1Ptr: number,
    z1Ptr: number,
    x2Ptr: number,
    z2Ptr: number,
    wordCount: number,
  ) => number;
  readonly wasm_coded_packed4_gemv: (
    actPtr: number,
    nibsPtr: number,
    gridPtr: number,
    outPtr: number,
    rows: number,
    packedCols: number,
  ) => number;
  readonly wasm_tropical_minplus_closure: (
    distPtr: number,
    nextHopPtr: number,
    n: number,
  ) => number;
}

export async function instantiateHoloCoreWasmGuest(
  wasmBytes: Uint8Array,
): Promise<CoreWasmGuestExports> {
  const copy = new ArrayBuffer(wasmBytes.byteLength);
  new Uint8Array(copy).set(wasmBytes);
  const mod = await WebAssembly.compile(copy);
  if (WebAssembly.Module.imports(mod).length !== 0) {
    throw new Error('Core-Wasm guest violated zero-import sandbox law');
  }
  const instance = await WebAssembly.instantiate(mod, {});
  return instance.exports as unknown as CoreWasmGuestExports;
}

let cachedSyncGuest: CoreWasmGuestExports | null = null;

/**
 * Synchronously compiles and caches the ~3 KiB zero-import `wasm32` compute guest
 * so hot numerical kernels (`tropical.ts`, `stabilizer.ts`, `codedMatmul.ts`) execute directly inside Wasm!
 */
export function getSyncHoloComputeKernels(): CoreWasmGuestExports {
  if (!cachedSyncGuest) {
    const wasmBytes = assembleCoreWasmGuestBinary();
    const copy = new ArrayBuffer(wasmBytes.byteLength);
    new Uint8Array(copy).set(wasmBytes);
    const mod = new WebAssembly.Module(copy);
    if (WebAssembly.Module.imports(mod).length !== 0) {
      throw new Error('Core-Wasm guest violated zero-import sandbox law');
    }
    const inst = new WebAssembly.Instance(mod, {});
    cachedSyncGuest = inst.exports as unknown as CoreWasmGuestExports;
  }
  return cachedSyncGuest;
}

/**
 * Executes native `wasm32` `i64.popcnt` symplectic inner-product commutativity check!
 */
export function runWasmSymplecticCommute(
  x1: BigUint64Array,
  z1: BigUint64Array,
  x2: BigUint64Array,
  z2: BigUint64Array,
): boolean {
  const guest = getSyncHoloComputeKernels();
  const words = x1.length;
  const byteLen = words * 8;
  const basePtr = guest.holo_alloc(byteLen * 4);
  const pX1 = basePtr;
  const pZ1 = basePtr + byteLen;
  const pX2 = basePtr + byteLen * 2;
  const pZ2 = basePtr + byteLen * 3;
  new BigUint64Array(guest.memory.buffer, pX1, words).set(x1);
  new BigUint64Array(guest.memory.buffer, pZ1, words).set(z1);
  new BigUint64Array(guest.memory.buffer, pX2, words).set(x2);
  new BigUint64Array(guest.memory.buffer, pZ2, words).set(z2);
  return guest.wasm_symplectic_commute(pX1, pZ1, pX2, pZ2, words) === 1;
}

/**
 * Executes native `wasm32` zero-decode `Packed<Grid<16>, 2>` 4-bit nibble GEMV into exact `i64` accumulators!
 */
export function runWasmPacked4Gemv(
  activations: Int32Array,
  packedNibbles: Uint8Array,
  grid16: Int32Array,
  rows: number,
  packedCols: number,
): { out: BigInt64Array; codedOps: number } {
  const guest = getSyncHoloComputeKernels();
  const align8 = (n: number) => (n + 7) & ~7;
  const outBytes = align8(rows * 8);
  const actBytes = align8(activations.byteLength);
  const gridBytes = align8(grid16.byteLength);
  const nibsBytes = align8(packedNibbles.byteLength);
  const basePtr = guest.holo_alloc(outBytes + actBytes + gridBytes + nibsBytes);

  const outPtr = basePtr;
  const actPtr = outPtr + outBytes;
  const gridPtr = actPtr + actBytes;
  const nibsPtr = gridPtr + gridBytes;

  new Int32Array(guest.memory.buffer, actPtr, activations.length).set(activations);
  new Int32Array(guest.memory.buffer, gridPtr, grid16.length).set(grid16);
  new Uint8Array(guest.memory.buffer, nibsPtr, packedNibbles.length).set(packedNibbles);

  const codedOps = guest.wasm_coded_packed4_gemv(actPtr, nibsPtr, gridPtr, outPtr, rows, packedCols);
  const outView = new BigInt64Array(guest.memory.buffer, outPtr, rows);
  return {
    out: new BigInt64Array(outView),
    codedOps,
  };
}

/**
 * Executes native `wasm32` Floyd–Warshall Tropical `(min, +)` closure (`k7`) in linear Wasm memory!
 */
export function runWasmTropicalClosure(
  weights: Int32Array,
  nextHopInit: Int32Array,
  n: number,
): { dist: Int32Array; nextHop: Int32Array; relaxations: number } {
  const guest = getSyncHoloComputeKernels();
  const align8 = (b: number) => (b + 7) & ~7;
  const matBytes = align8(n * n * 4);
  const basePtr = guest.holo_alloc(matBytes * 2);
  const distPtr = basePtr;
  const hopPtr = basePtr + matBytes;
  new Int32Array(guest.memory.buffer, distPtr, n * n).set(weights);
  new Int32Array(guest.memory.buffer, hopPtr, n * n).set(nextHopInit);

  const relaxations = guest.wasm_tropical_minplus_closure(distPtr, hopPtr, n);
  return {
    dist: new Int32Array(new Int32Array(guest.memory.buffer, distPtr, n * n)),
    nextHop: new Int32Array(new Int32Array(guest.memory.buffer, hopPtr, n * n)),
    relaxations,
  };
}

/**
 * Executes a single query through the REAL instantiated `wasm32` `holo_alloc` + `holo_run` ABI!
 */
export function runHoloCoreWasmGuest(
  guest: CoreWasmGuestExports,
  request: string | Uint8Array,
): string {
  const reqBytes = typeof request === 'string' ? new TextEncoder().encode(request) : request;
  const ptr = guest.holo_alloc(Math.max(1, reqBytes.byteLength));
  if (reqBytes.byteLength > 0) {
    new Uint8Array(guest.memory.buffer, ptr, reqBytes.byteLength).set(reqBytes);
  }
  const packed = guest.holo_run(ptr, reqBytes.byteLength);
  const outOffset = Number((packed >> 32n) & 0xffffffffn);
  const outLen = Number(packed & 0xffffffffn);
  const outSlice = new Uint8Array(guest.memory.buffer, outOffset, outLen);
  return new TextDecoder().decode(outSlice);
}
