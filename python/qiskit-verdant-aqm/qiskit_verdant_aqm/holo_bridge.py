"""Hologram v4 (`VerdantAqm.holo`) Binary Verifier & Official BLAKE3 Bridge (`holo_bridge.py`).

Implements exact zero-dependency RFC/spec BLAKE3 hashing (`prism/identity/4`) in pure Python >= 3.10
and cryptographically verifies `VerdantAqm.holo` v4 archives (`HOLO` header, 32-byte BLAKE3 body
digest, zero Wasm imports, and exported `hologram:guest/core-wasm@1` kernel symbols).
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

HOLO_MAGIC = b"HOLO"
HOLO_VERSION = 4

_IV = (
    0x6A09E667,
    0xBB67AE85,
    0x3C6EF372,
    0xA54FF53A,
    0x510E527F,
    0x9B05688C,
    0x1F83D9AB,
    0x5BE0CD19,
)

_MSG_PERMUTATION = (2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8)

_CHUNK_START = 1 << 0
_CHUNK_END = 1 << 1
_PARENT = 1 << 2
_ROOT = 1 << 3
_BLOCK_LEN = 64
_CHUNK_LEN = 1024


def _rotr32(x: int, n: int) -> int:
    x &= 0xFFFFFFFF
    return ((x >> n) | ((x << (32 - n)) & 0xFFFFFFFF)) & 0xFFFFFFFF


def _g(state: list[int], a: int, b: int, c: int, d: int, mx: int, my: int) -> None:
    state[a] = (state[a] + state[b] + mx) & 0xFFFFFFFF
    state[d] = _rotr32(state[d] ^ state[a], 16)
    state[c] = (state[c] + state[d]) & 0xFFFFFFFF
    state[b] = _rotr32(state[b] ^ state[c], 12)
    state[a] = (state[a] + state[b] + my) & 0xFFFFFFFF
    state[d] = _rotr32(state[d] ^ state[a], 8)
    state[c] = (state[c] + state[d]) & 0xFFFFFFFF
    state[b] = _rotr32(state[b] ^ state[c], 7)


def _compress(
    chaining_value: tuple[int, ...],
    block_words: list[int],
    counter: int,
    block_len: int,
    flags: int,
) -> list[int]:
    state = [
        chaining_value[0],
        chaining_value[1],
        chaining_value[2],
        chaining_value[3],
        chaining_value[4],
        chaining_value[5],
        chaining_value[6],
        chaining_value[7],
        _IV[0],
        _IV[1],
        _IV[2],
        _IV[3],
        counter & 0xFFFFFFFF,
        (counter >> 32) & 0xFFFFFFFF,
        block_len & 0xFFFFFFFF,
        flags & 0xFFFFFFFF,
    ]
    m = list(block_words)
    for r in range(7):
        _g(state, 0, 4, 8, 12, m[0], m[1])
        _g(state, 1, 5, 9, 13, m[2], m[3])
        _g(state, 2, 6, 10, 14, m[4], m[5])
        _g(state, 3, 7, 11, 15, m[6], m[7])
        _g(state, 0, 5, 10, 15, m[8], m[9])
        _g(state, 1, 6, 11, 12, m[10], m[11])
        _g(state, 2, 7, 8, 13, m[12], m[13])
        _g(state, 3, 4, 9, 14, m[14], m[15])
        if r < 6:
            m = [m[_MSG_PERMUTATION[i]] for i in range(16)]
    for i in range(8):
        state[i] ^= state[i + 8]
        state[i + 8] ^= chaining_value[i]
    return state


def _words_from_little_endian_bytes(block: bytes) -> list[int]:
    padded = block.ljust(64, b"\x00")
    return list(struct.unpack("<16I", padded))


def _chunk_output(chunk_bytes: bytes, chunk_counter: int) -> tuple[tuple[int, ...], list[int], int, int]:
    cv: tuple[int, ...] = _IV
    if not chunk_bytes:
        return (cv, [0] * 16, 0, _CHUNK_START | _CHUNK_END)

    pos = 0
    blocks_total = (len(chunk_bytes) + _BLOCK_LEN - 1) // _BLOCK_LEN
    for b_idx in range(blocks_total):
        blk = chunk_bytes[pos : pos + _BLOCK_LEN]
        pos += _BLOCK_LEN
        fl = 0
        if b_idx == 0:
            fl |= _CHUNK_START
        if b_idx == blocks_total - 1:
            fl |= _CHUNK_END
        words = _words_from_little_endian_bytes(blk)
        if b_idx == blocks_total - 1:
            return (cv, words, len(blk), fl)
        out = _compress(cv, words, chunk_counter, len(blk), fl)
        cv = tuple(out[:8])
    return (cv, [0] * 16, 0, _CHUNK_START | _CHUNK_END)


def _parent_output(left_cv: tuple[int, ...], right_cv: tuple[int, ...]) -> tuple[tuple[int, ...], list[int], int, int]:
    return (_IV, list(left_cv) + list(right_cv), _BLOCK_LEN, _PARENT)


def blake3_bytes(data: bytes) -> bytes:
    """Computes the exact 32-byte official BLAKE3 digest of `data`."""
    if not data:
        cv, words, blen, fl = _chunk_output(b"", 0)
        out = _compress(cv, words, 0, blen, fl | _ROOT)
        return struct.pack("<8I", *out[:8])

    cv_stack: list[tuple[int, ...]] = []
    chunk_counter = 0
    offset = 0

    while offset + _CHUNK_LEN < len(data):
        chunk = data[offset : offset + _CHUNK_LEN]
        offset += _CHUNK_LEN
        c_cv, c_words, c_blen, c_fl = _chunk_output(chunk, chunk_counter)
        new_cv: tuple[int, ...] = tuple(_compress(c_cv, c_words, chunk_counter, c_blen, c_fl)[:8])
        chunk_counter += 1
        total_chunks = chunk_counter
        while (total_chunks & 1) == 0:
            p_cv, p_words, p_blen, p_fl = _parent_output(cv_stack.pop(), new_cv)
            new_cv = tuple(_compress(p_cv, p_words, 0, p_blen, p_fl)[:8])
            total_chunks >>= 1
        cv_stack.append(new_cv)

    last_chunk = data[offset:]
    root_cv, root_words, root_blen, root_fl = _chunk_output(last_chunk, chunk_counter)
    while cv_stack:
        current_cv = tuple(_compress(root_cv, root_words, chunk_counter if root_fl != _PARENT else 0, root_blen, root_fl)[:8])
        root_cv, root_words, root_blen, root_fl = _parent_output(cv_stack.pop(), current_cv)
        chunk_counter = 0

    final_words = _compress(root_cv, root_words, chunk_counter if (root_fl & _PARENT) == 0 else 0, root_blen, root_fl | _ROOT)
    return struct.pack("<8I", *final_words[:8])


def blake3_hex(data: bytes) -> str:
    """Computes the 64-character lowercase hexadecimal official BLAKE3 digest of `data`."""
    return blake3_bytes(data).hex()


def _read_leb128_u32(buf: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return result, pos
        shift += 7


def _inspect_wasm_imports_and_exports(wasm: bytes) -> tuple[bool, tuple[str, ...]]:
    """Parses Wasm binary sections to prove zero host imports and extract exported symbol names."""
    if wasm[:4] != b"\x00asm":
        raise ValueError("Invalid WebAssembly magic header in HOLO guest section.")
    pos = 8
    has_imports = False
    exports: list[str] = []
    while pos < len(wasm):
        sec_id = wasm[pos]
        pos += 1
        sec_len, pos = _read_leb128_u32(wasm, pos)
        sec_end = pos + sec_len
        if sec_id == 2:  # Import section
            imp_count, cur = _read_leb128_u32(wasm, pos)
            if imp_count > 0:
                has_imports = True
        elif sec_id == 7:  # Export section
            exp_count, cur = _read_leb128_u32(wasm, pos)
            for _ in range(exp_count):
                name_len, cur = _read_leb128_u32(wasm, cur)
                name = wasm[cur : cur + name_len].decode("utf-8")
                cur += name_len + 1  # +1 for export kind byte
                _idx, cur = _read_leb128_u32(wasm, cur)
                exports.append(name)
        pos = sec_end
    return (not has_imports, tuple(exports))


@dataclass(frozen=True)
class HoloArchiveInspection:
    """Cryptographically verified summary of a binary `VerdantAqm.holo` v4 guest archive."""

    byte_length: int
    version: int
    section_count: int
    manifest_bytes: int
    wasm_bytes: int
    footer_hex: str
    blake3_verified: bool
    zero_imports_verified: bool
    exported_symbols: tuple[str, ...]


def inspect_holo_v4_archive(data: bytes | Path) -> HoloArchiveInspection:
    """Parses and BLAKE3-verifies a binary `Foundation.Holo.V1.Wire` (`VerdantAqm.holo` v4) container."""
    raw = data.read_bytes() if isinstance(data, Path) else bytes(data)
    if len(raw) < 42:
        raise ValueError(f"Archive too short ({len(raw)} B) to be a Hologram v4 container.")
    if raw[:4] != HOLO_MAGIC:
        raise ValueError(f"Invalid HOLO magic header: {raw[:4]!r}")

    version, flags, section_count = struct.unpack_from("<HHH", raw, 4)
    if version != HOLO_VERSION or flags != 0:
        raise ValueError(f"Unsupported HOLO header version={version}, flags={flags}")

    footer_hex = raw[-32:].hex()
    computed_hex = blake3_hex(raw[:-32])
    blake3_ok = footer_hex == computed_hex
    if not blake3_ok:
        raise ValueError(
            f"HOLO BLAKE3 footer mismatch: recorded {footer_hex} != computed {computed_hex}"
        )

    manifest_bytes_slice: bytes | None = None
    blobs: dict[str, bytes] = {}
    dir_offset = 10
    body_end = len(raw) - 32
    for idx in range(section_count):
        sec_kind, sec_off, sec_len = struct.unpack_from("<QQQ", raw, dir_offset + idx * 24)
        if sec_off + sec_len > body_end:
            raise ValueError(f"HOLO section {idx} exceeds archive payload boundary.")
        sec_slice = raw[sec_off : sec_off + sec_len]
        if sec_kind == 15:  # SECTION_APP_MANIFEST
            manifest_bytes_slice = sec_slice
        elif sec_kind == 16:  # SECTION_CONTENT_BLOB
            label = sec_slice[:71].decode("utf-8")
            content = sec_slice[71:]
            actual_kappa = f"blake3:{blake3_hex(content)}"
            if label != actual_kappa:
                raise ValueError(f"CONTENT_BLOB kappa mismatch: {label} != {actual_kappa}")
            blobs[label] = content

    if manifest_bytes_slice is None or len(manifest_bytes_slice) != 356:
        raise ValueError(f"Invalid APP_MANIFEST length: {0 if manifest_bytes_slice is None else len(manifest_bytes_slice)}")

    wasm_kappa = manifest_bytes_slice[128:199].decode("utf-8")
    wasm_payload = blobs.get(wasm_kappa, b"")
    if not wasm_payload:
        raise ValueError(f"Missing wasm_kappa CONTENT_BLOB {wasm_kappa}")

    zero_imports, exported_syms = _inspect_wasm_imports_and_exports(wasm_payload)
    return HoloArchiveInspection(
        byte_length=len(raw),
        version=version,
        section_count=section_count,
        manifest_bytes=len(manifest_bytes_slice),
        wasm_bytes=len(wasm_payload),
        footer_hex=footer_hex,
        blake3_verified=blake3_ok,
        zero_imports_verified=zero_imports,
        exported_symbols=exported_syms,
    )


def extract_verified_holo_wasm_bytes(data: bytes | Path) -> bytes:
    """Verifies a Hologram v4 `.holo` archive (or raw `.wasm` binary) and returns the zero-import `wasm32` bytes."""
    raw = data.read_bytes() if isinstance(data, Path) else bytes(data)
    if raw[:4] == b"\x00asm":
        zero_imp, _ = _inspect_wasm_imports_and_exports(raw)
        if not zero_imp:
            raise ValueError("Core-Wasm guest violated zero-import sandbox law.")
        return raw

    # Full BLAKE3 + manifest + CONTENT_BLOB verification
    inspect_holo_v4_archive(raw)
    _, _, section_count = struct.unpack_from("<HHH", raw, 4)
    manifest_bytes_slice: bytes | None = None
    blobs: dict[str, bytes] = {}
    for idx in range(section_count):
        sec_kind, sec_off, sec_len = struct.unpack_from("<QQQ", raw, 10 + idx * 24)
        sec_slice = raw[sec_off : sec_off + sec_len]
        if sec_kind == 15:
            manifest_bytes_slice = sec_slice
        elif sec_kind == 16:
            blobs[sec_slice[:71].decode("utf-8")] = sec_slice[71:]
    assert manifest_bytes_slice is not None
    wasm_kappa = manifest_bytes_slice[128:199].decode("utf-8")
    return blobs[wasm_kappa]


def _read_leb128_s64(buf: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        shift += 7
        if (b & 0x80) == 0:
            if shift < 64 and (b & 0x40) != 0:
                result |= -(1 << shift)
            elif shift >= 64 and (result & (1 << 63)) != 0:
                result -= 1 << 64
            return result, pos


def _s32(v: int) -> int:
    u = v & 0xFFFFFFFF
    return u - 0x100000000 if (u & 0x80000000) else u


def _u32(v: int) -> int:
    return v & 0xFFFFFFFF


def _s64(v: int) -> int:
    u = v & 0xFFFFFFFFFFFFFFFF
    return u - 0x10000000000000000 if (u & 0x8000000000000000) else u


def _u64(v: int) -> int:
    return v & 0xFFFFFFFFFFFFFFFF


@dataclass(frozen=True)
class _WasmFuncDef:
    param_count: int
    result_count: int
    local_count: int
    instrs: tuple[tuple[int, int, int], ...]  # (op, imm1, imm2)
    end_map: dict[int, int]
    else_map: dict[int, int]


def _decode_wasm_instructions(
    code_bytes: bytes,
) -> tuple[tuple[tuple[int, int, int], ...], dict[int, int], dict[int, int]]:
    pos = 0
    instrs: list[tuple[int, int, int]] = []
    ctrl_stack: list[tuple[int, int]] = []  # (op, instr_idx)
    end_map: dict[int, int] = {}
    else_map: dict[int, int] = {}

    while pos < len(code_bytes):
        op = code_bytes[pos]
        pos += 1
        idx = len(instrs)
        if op in (0x02, 0x03, 0x04):  # block, loop, if
            bt = code_bytes[pos]
            pos += 1
            arity = 0 if bt == 0x40 else 1
            instrs.append((op, arity, 0))
            ctrl_stack.append((op, idx))
        elif op == 0x05:  # else
            instrs.append((op, 0, 0))
            if not ctrl_stack or ctrl_stack[-1][0] != 0x04:
                raise ValueError("Malformed Wasm: else without matching if")
            else_map[ctrl_stack[-1][1]] = idx
        elif op == 0x0B:  # end
            instrs.append((op, 0, 0))
            if ctrl_stack:
                _, start_idx = ctrl_stack.pop()
                end_map[start_idx] = idx
        elif op in (0x0C, 0x0D, 0x10, 0x20, 0x21, 0x22, 0x23, 0x24):
            imm, pos = _read_leb128_u32(code_bytes, pos)
            instrs.append((op, imm, 0))
        elif op in (0x28, 0x29, 0x2D, 0x36, 0x37, 0x3A):
            align, pos = _read_leb128_u32(code_bytes, pos)
            offset, pos = _read_leb128_u32(code_bytes, pos)
            instrs.append((op, align, offset))
        elif op == 0x41:  # i32.const
            val, pos = _read_leb128_s64(code_bytes, pos)
            instrs.append((op, _u32(val), 0))
        elif op == 0x42:  # i64.const
            val, pos = _read_leb128_s64(code_bytes, pos)
            instrs.append((op, _u64(val), 0))
        else:
            instrs.append((op, 0, 0))

    return tuple(instrs), end_map, else_map


class HoloWasmGuestRuntime:
    """Zero-dependency Wasm 1.0 sandbox executing `VerdantAqm.holo` (`hologram:guest/core-wasm@1`)."""

    def __init__(self, wasm_bytes: bytes) -> None:
        if wasm_bytes[:4] != b"\x00asm":
            raise ValueError("Invalid WebAssembly binary magic header.")

        pos = 8
        func_sigs: list[tuple[int, int]] = []
        func_type_indices: list[int] = []
        min_pages = 1
        globals_list: list[int] = []
        exports: dict[str, tuple[int, int]] = {}
        raw_bodies: list[bytes] = []
        data_segments: list[tuple[int, bytes]] = []

        while pos < len(wasm_bytes):
            sec_id = wasm_bytes[pos]
            pos += 1
            sec_len, pos = _read_leb128_u32(wasm_bytes, pos)
            sec_end = pos + sec_len
            cur = pos

            if sec_id == 1:  # Type section
                cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                for _ in range(cnt):
                    if wasm_bytes[cur] != 0x60:
                        raise ValueError("Unsupported Wasm type form")
                    cur += 1
                    p_cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                    cur += p_cnt
                    r_cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                    cur += r_cnt
                    func_sigs.append((p_cnt, r_cnt))
            elif sec_id == 2:  # Import section
                imp_cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                if imp_cnt != 0:
                    raise ValueError("Core-Wasm guest violated zero-import sandbox law.")
            elif sec_id == 3:  # Function section
                cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                for _ in range(cnt):
                    t_idx, cur = _read_leb128_u32(wasm_bytes, cur)
                    func_type_indices.append(t_idx)
            elif sec_id == 5:  # Memory section
                cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                if cnt >= 1:
                    flags = wasm_bytes[cur]
                    cur += 1
                    min_pages, cur = _read_leb128_u32(wasm_bytes, cur)
                    if flags & 1:
                        _, cur = _read_leb128_u32(wasm_bytes, cur)
            elif sec_id == 6:  # Global section
                cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                for _ in range(cnt):
                    cur += 2  # valtype + mutability
                    op = wasm_bytes[cur]
                    cur += 1
                    if op in (0x41, 0x42):
                        init_val, cur = _read_leb128_s64(wasm_bytes, cur)
                    else:
                        raise ValueError(f"Unsupported global init opcode 0x{op:02x}")
                    if wasm_bytes[cur] != 0x0B:
                        raise ValueError("Expected OP_END in global init")
                    cur += 1
                    globals_list.append(_u32(init_val))
            elif sec_id == 7:  # Export section
                cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                for _ in range(cnt):
                    n_len, cur = _read_leb128_u32(wasm_bytes, cur)
                    name = wasm_bytes[cur : cur + n_len].decode("utf-8")
                    cur += n_len
                    kind = wasm_bytes[cur]
                    cur += 1
                    idx, cur = _read_leb128_u32(wasm_bytes, cur)
                    exports[name] = (kind, idx)
            elif sec_id == 10:  # Code section
                cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                for _ in range(cnt):
                    b_len, cur = _read_leb128_u32(wasm_bytes, cur)
                    raw_bodies.append(wasm_bytes[cur : cur + b_len])
                    cur += b_len
            elif sec_id == 11:  # Data section
                cnt, cur = _read_leb128_u32(wasm_bytes, cur)
                for _ in range(cnt):
                    mode, cur = _read_leb128_u32(wasm_bytes, cur)
                    if mode != 0:
                        raise ValueError("Unsupported passive data segment")
                    if wasm_bytes[cur] != 0x41:
                        raise ValueError("Expected i32.const in data offset")
                    cur += 1
                    d_off, cur = _read_leb128_s64(wasm_bytes, cur)
                    if wasm_bytes[cur] != 0x0B:
                        raise ValueError("Expected OP_END in data offset")
                    cur += 1
                    d_len, cur = _read_leb128_u32(wasm_bytes, cur)
                    data_segments.append((_u32(d_off), wasm_bytes[cur : cur + d_len]))
                    cur += d_len

            pos = sec_end

        self.memory = bytearray(max(1, min_pages) * 65536)
        for d_off, payload in data_segments:
            self.memory[d_off : d_off + len(payload)] = payload

        self.globals = globals_list
        self.exports = exports
        self._funcs: list[_WasmFuncDef] = []
        for f_idx, body in enumerate(raw_bodies):
            p_cnt, r_cnt = func_sigs[func_type_indices[f_idx]]
            b_cur = 0
            decl_cnt, b_cur = _read_leb128_u32(body, b_cur)
            extra_locals = 0
            for _ in range(decl_cnt):
                l_cnt, b_cur = _read_leb128_u32(body, b_cur)
                b_cur += 1  # valtype
                extra_locals += l_cnt
            instrs, end_map, else_map = _decode_wasm_instructions(body[b_cur:])
            self._funcs.append(
                _WasmFuncDef(
                    param_count=p_cnt,
                    result_count=r_cnt,
                    local_count=p_cnt + extra_locals,
                    instrs=instrs,
                    end_map=end_map,
                    else_map=else_map,
                )
            )

    @property
    def exported_symbols(self) -> tuple[str, ...]:
        return tuple(self.exports.keys())

    def invoke_export(self, name: str, *args: int) -> int | None:
        kind, f_idx = self.exports[name]
        if kind != 0:
            raise ValueError(f"Export '{name}' is not a function")
        return self._call_func(f_idx, list(args))

    def _call_func(self, func_idx: int, args: list[int]) -> int | None:
        fn = self._funcs[func_idx]
        locals_arr = [0] * fn.local_count
        for i in range(fn.param_count):
            locals_arr[i] = args[i]

        stack: list[int] = []
        # Label tuple: (kind, arity, start_pc, end_pc, stack_height)
        func_end_pc = len(fn.instrs) - 1
        labels: list[tuple[int, int, int, int, int]] = [(0x00, fn.result_count, 0, func_end_pc, 0)]
        instrs = fn.instrs
        end_map = fn.end_map
        else_map = fn.else_map
        mem = self.memory
        pc = 0

        def do_branch(depth: int) -> int:
            nonlocal stack, labels
            target_idx = len(labels) - 1 - depth
            kind, arity, start_pc, end_pc, height = labels[target_idx]
            if kind == 0x03:  # loop: jump back to start_pc + 1, keep label on stack
                ret_vals: list[int] = []
                del labels[target_idx + 1 :]
                del stack[height:]
                stack.extend(ret_vals)
                return start_pc + 1
            else:
                ret_vals = stack[-arity:] if arity > 0 else []
                del labels[target_idx:]
                del stack[height:]
                stack.extend(ret_vals)
                return end_pc + 1

        while pc < len(instrs):
            op, imm1, imm2 = instrs[pc]
            if op == 0x20:  # local.get
                stack.append(locals_arr[imm1])
                pc += 1
            elif op == 0x21:  # local.set
                locals_arr[imm1] = stack.pop()
                pc += 1
            elif op == 0x22:  # local.tee
                locals_arr[imm1] = stack[-1]
                pc += 1
            elif op == 0x23:  # global.get
                stack.append(self.globals[imm1])
                pc += 1
            elif op == 0x24:  # global.set
                self.globals[imm1] = _u32(stack.pop())
                pc += 1
            elif op == 0x41 or op == 0x42:  # i32.const / i64.const
                stack.append(imm1)
                pc += 1
            elif op == 0x02 or op == 0x03:  # block / loop
                labels.append((op, imm1, pc, end_map[pc], len(stack)))
                pc += 1
            elif op == 0x04:  # if
                cond = _u32(stack.pop())
                e_pc = end_map[pc]
                if cond != 0:
                    labels.append((op, imm1, pc, e_pc, len(stack)))
                    pc += 1
                else:
                    el_pc = else_map.get(pc)
                    if el_pc is not None:
                        labels.append((op, imm1, pc, e_pc, len(stack)))
                        pc = el_pc + 1
                    else:
                        pc = e_pc + 1
            elif op == 0x05:  # else (reached from end of truthy branch)
                _, arity, _, e_pc, height = labels.pop()
                ret_v = stack[-arity:] if arity > 0 else []
                del stack[height:]
                stack.extend(ret_v)
                pc = e_pc + 1
            elif op == 0x0B:  # end
                _, arity, _, _, height = labels.pop()
                ret_v = stack[-arity:] if arity > 0 else []
                del stack[height:]
                stack.extend(ret_v)
                if not labels:
                    return stack[-1] if fn.result_count > 0 else None
                pc += 1
            elif op == 0x0C:  # br
                pc = do_branch(imm1)
                if not labels:
                    return stack[-1] if fn.result_count > 0 else None
            elif op == 0x0D:  # br_if
                cond = _u32(stack.pop())
                if cond != 0:
                    pc = do_branch(imm1)
                    if not labels:
                        return stack[-1] if fn.result_count > 0 else None
                else:
                    pc += 1
            elif op == 0x0F:  # return
                return stack[-1] if fn.result_count > 0 else None
            elif op == 0x10:  # call
                callee = self._funcs[imm1]
                c_args = [stack.pop() for _ in range(callee.param_count)]
                c_args.reverse()
                res = self._call_func(imm1, c_args)
                if callee.result_count > 0 and res is not None:
                    stack.append(res)
                pc += 1
            elif op == 0x1A:  # drop
                stack.pop()
                pc += 1
            elif op == 0x28:  # i32.load
                addr = _u32(stack.pop()) + imm2
                stack.append(struct.unpack_from("<I", mem, addr)[0])
                pc += 1
            elif op == 0x29:  # i64.load
                addr = _u32(stack.pop()) + imm2
                stack.append(struct.unpack_from("<Q", mem, addr)[0])
                pc += 1
            elif op == 0x2D:  # i32.load8_u
                addr = _u32(stack.pop()) + imm2
                stack.append(mem[addr])
                pc += 1
            elif op == 0x36:  # i32.store
                val = _u32(stack.pop())
                addr = _u32(stack.pop()) + imm2
                struct.pack_into("<I", mem, addr, val)
                pc += 1
            elif op == 0x37:  # i64.store
                val = _u64(stack.pop())
                addr = _u32(stack.pop()) + imm2
                struct.pack_into("<Q", mem, addr, val)
                pc += 1
            elif op == 0x3A:  # i32.store8
                val = stack.pop() & 0xFF
                addr = _u32(stack.pop()) + imm2
                mem[addr] = val
                pc += 1
            elif op == 0x45:  # i32.eqz
                stack.append(1 if _u32(stack.pop()) == 0 else 0)
                pc += 1
            elif op == 0x46:  # i32.eq
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(1 if a == b else 0)
                pc += 1
            elif op == 0x47:  # i32.ne
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(1 if a != b else 0)
                pc += 1
            elif op == 0x48:  # i32.lt_s
                b, a = _s32(stack.pop()), _s32(stack.pop())
                stack.append(1 if a < b else 0)
                pc += 1
            elif op == 0x49:  # i32.lt_u
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(1 if a < b else 0)
                pc += 1
            elif op == 0x4A:  # i32.gt_s
                b, a = _s32(stack.pop()), _s32(stack.pop())
                stack.append(1 if a > b else 0)
                pc += 1
            elif op == 0x4B:  # i32.gt_u
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(1 if a > b else 0)
                pc += 1
            elif op == 0x4C:  # i32.le_s
                b, a = _s32(stack.pop()), _s32(stack.pop())
                stack.append(1 if a <= b else 0)
                pc += 1
            elif op == 0x4D:  # i32.le_u
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(1 if a <= b else 0)
                pc += 1
            elif op == 0x4E:  # i32.ge_s
                b, a = _s32(stack.pop()), _s32(stack.pop())
                stack.append(1 if a >= b else 0)
                pc += 1
            elif op == 0x4F:  # i32.ge_u
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(1 if a >= b else 0)
                pc += 1
            elif op == 0x6A:  # i32.add
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(_u32(a + b))
                pc += 1
            elif op == 0x6B:  # i32.sub
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(_u32(a - b))
                pc += 1
            elif op == 0x6C:  # i32.mul
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(_u32(a * b))
                pc += 1
            elif op == 0x71:  # i32.and
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(a & b)
                pc += 1
            elif op == 0x72:  # i32.or
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(a | b)
                pc += 1
            elif op == 0x73:  # i32.xor
                b, a = _u32(stack.pop()), _u32(stack.pop())
                stack.append(a ^ b)
                pc += 1
            elif op == 0x74:  # i32.shl
                b, a = _u32(stack.pop()) & 31, _u32(stack.pop())
                stack.append(_u32(a << b))
                pc += 1
            elif op == 0x76:  # i32.shr_u
                b, a = _u32(stack.pop()) & 31, _u32(stack.pop())
                stack.append(a >> b)
                pc += 1
            elif op == 0x7B:  # i64.popcnt
                stack.append(_u64(stack.pop()).bit_count())
                pc += 1
            elif op == 0x7C:  # i64.add
                b, a = _u64(stack.pop()), _u64(stack.pop())
                stack.append(_u64(a + b))
                pc += 1
            elif op == 0x7E:  # i64.mul
                b, a = _u64(stack.pop()), _u64(stack.pop())
                stack.append(_u64(a * b))
                pc += 1
            elif op == 0x83:  # i64.and
                b, a = _u64(stack.pop()), _u64(stack.pop())
                stack.append(a & b)
                pc += 1
            elif op == 0x84:  # i64.or
                b, a = _u64(stack.pop()), _u64(stack.pop())
                stack.append(a | b)
                pc += 1
            elif op == 0x85:  # i64.xor
                b, a = _u64(stack.pop()), _u64(stack.pop())
                stack.append(a ^ b)
                pc += 1
            elif op == 0x86:  # i64.shl
                b, a = _u64(stack.pop()) & 63, _u64(stack.pop())
                stack.append(_u64(a << b))
                pc += 1
            elif op == 0xA7:  # i32.wrap_i64
                stack.append(_u32(stack.pop()))
                pc += 1
            elif op == 0xAC:  # i64.extend_i32_s
                stack.append(_u64(_s32(stack.pop())))
                pc += 1
            elif op == 0xAD:  # i64.extend_i32_u
                stack.append(_u32(stack.pop()))
                pc += 1
            elif op == 0x01:  # nop
                pc += 1
            else:
                raise RuntimeError(f"Unsupported Wasm opcode 0x{op:02x} at pc={pc}")

        return stack[-1] if (fn.result_count > 0 and stack) else None

    def holo_alloc(self, length: int) -> int:
        res = self.invoke_export("holo_alloc", max(1, int(length)))
        assert res is not None
        return _u32(res)

    def holo_run(self, request: str | bytes) -> str:
        req_bytes = request.encode("utf-8") if isinstance(request, str) else bytes(request)
        ptr = self.holo_alloc(max(1, len(req_bytes)))
        if req_bytes:
            self.memory[ptr : ptr + len(req_bytes)] = req_bytes
        packed = self.invoke_export("holo_run", ptr, len(req_bytes))
        assert packed is not None
        u_packed = _u64(packed)
        out_off = (u_packed >> 32) & 0xFFFFFFFF
        out_len = u_packed & 0xFFFFFFFF
        return bytes(self.memory[out_off : out_off + out_len]).decode("utf-8")

    def symplectic_commute(
        self,
        x1: list[int] | tuple[int, ...],
        z1: list[int] | tuple[int, ...],
        x2: list[int] | tuple[int, ...],
        z2: list[int] | tuple[int, ...],
    ) -> bool:
        words = len(x1)
        byte_len = words * 8
        base = self.holo_alloc(byte_len * 4)
        for arr_idx, arr in enumerate((x1, z1, x2, z2)):
            off = base + arr_idx * byte_len
            for w_idx, w_val in enumerate(arr):
                struct.pack_into("<Q", self.memory, off + w_idx * 8, _u64(w_val))
        out = self.invoke_export(
            "wasm_symplectic_commute",
            base,
            base + byte_len,
            base + 2 * byte_len,
            base + 3 * byte_len,
            words,
        )
        return out == 1

    def coded_packed4_gemv(
        self,
        activations: list[int] | tuple[int, ...],
        packed_nibbles: bytes | bytearray,
        grid16: list[int] | tuple[int, ...],
        rows: int,
        packed_cols: int,
    ) -> tuple[list[int], int]:
        align8 = lambda n: (n + 7) & ~7
        out_b = align8(rows * 8)
        act_b = align8(len(activations) * 4)
        grid_b = align8(len(grid16) * 4)
        nibs_b = align8(len(packed_nibbles))
        base = self.holo_alloc(out_b + act_b + grid_b + nibs_b)
        out_ptr = base
        act_ptr = out_ptr + out_b
        grid_ptr = act_ptr + act_b
        nibs_ptr = grid_ptr + grid_b

        for i, v in enumerate(activations):
            struct.pack_into("<i", self.memory, act_ptr + i * 4, int(v))
        for i, v in enumerate(grid16):
            struct.pack_into("<i", self.memory, grid_ptr + i * 4, int(v))
        self.memory[nibs_ptr : nibs_ptr + len(packed_nibbles)] = bytes(packed_nibbles)

        ops = self.invoke_export(
            "wasm_coded_packed4_gemv", act_ptr, nibs_ptr, grid_ptr, out_ptr, rows, packed_cols
        )
        assert ops is not None
        scores = [
            struct.unpack_from("<q", self.memory, out_ptr + r * 8)[0] for r in range(rows)
        ]
        return scores, _u32(ops)

    def tropical_minplus_closure(
        self,
        weights: list[int] | tuple[int, ...],
        next_hop_init: list[int] | tuple[int, ...],
        n: int,
    ) -> tuple[list[int], list[int], int]:
        mat_b = ((n * n * 4) + 7) & ~7
        base = self.holo_alloc(mat_b * 2)
        dist_ptr = base
        hop_ptr = base + mat_b
        for i, w in enumerate(weights):
            struct.pack_into("<i", self.memory, dist_ptr + i * 4, int(w))
        for i, h in enumerate(next_hop_init):
            struct.pack_into("<i", self.memory, hop_ptr + i * 4, int(h))

        relaxes = self.invoke_export("wasm_tropical_minplus_closure", dist_ptr, hop_ptr, n)
        assert relaxes is not None
        dist_out = [struct.unpack_from("<i", self.memory, dist_ptr + i * 4)[0] for i in range(n * n)]
        hop_out = [struct.unpack_from("<i", self.memory, hop_ptr + i * 4)[0] for i in range(n * n)]
        return dist_out, hop_out, _u32(relaxes)


def instantiate_holo_wasm_guest(data: bytes | Path) -> HoloWasmGuestRuntime:
    """Verifies `VerdantAqm.holo` (BLAKE3 + zero-import law) and instantiates the `wasm32` guest in Python."""
    wasm_bytes = extract_verified_holo_wasm_bytes(data)
    return HoloWasmGuestRuntime(wasm_bytes)


def compute_job_kappa(payload: dict[str, Any]) -> str:
    """Computes a canonical `prism/identity/4` BLAKE3 digest for Qiskit job provenance."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"blake3:{blake3_hex(canonical)}"
