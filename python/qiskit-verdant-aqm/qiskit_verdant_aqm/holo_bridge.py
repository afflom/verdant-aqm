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


def compute_job_kappa(payload: dict[str, Any]) -> str:
    """Computes a canonical `prism/identity/4` BLAKE3 digest for Qiskit job provenance."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"blake3:{blake3_hex(canonical)}"
