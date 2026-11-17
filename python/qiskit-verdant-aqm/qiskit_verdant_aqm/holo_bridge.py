"""Hologram v4 (`VerdantAqm.holo`) Binary Inspector & Provenance Bridge (`holo_bridge.py`)."""

from __future__ import annotations

import hashlib
import json
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any


HOLO_MAGIC = b"HOLO"
HOLO_VERSION = 4


@dataclass(frozen=True)
class HoloArchiveInspection:
    """Verified structural summary of a binary `VerdantAqm.holo` v4 guest archive."""

    byte_length: int
    version: int
    section_count: int
    manifest_bytes: int
    wasm_bytes: int
    footer_hex: str


def inspect_holo_v4_archive(data: bytes | Path) -> HoloArchiveInspection:
    """Parses a binary `VerdantAqm.holo` v4 container and extracts section & footer metadata."""
    raw = data.read_bytes() if isinstance(data, Path) else bytes(data)
    if len(raw) < 64:
        raise ValueError(f"Archive too short ({len(raw)} B) to be a Hologram v4 container.")
    if raw[:4] != HOLO_MAGIC:
        raise ValueError(f"Invalid HOLO magic header: {raw[:4]!r}")

    version, flags, section_count = struct.unpack_from("<HHI", raw, 4)
    if version != HOLO_VERSION or flags != 0:
        raise ValueError(f"Unsupported HOLO header version={version}, flags={flags}")

    # Section directory starts at byte 16; each entry is 24 bytes: (kind:u32, flags:u32, offset:u64, length:u64)
    manifest_len = 0
    wasm_len = 0
    dir_offset = 16
    for idx in range(section_count):
        sec_kind, _sec_flags, sec_off, sec_len = struct.unpack_from(
            "<IIQQ", raw, dir_offset + idx * 24
        )
        if sec_off + sec_len > len(raw) - 32:
            raise ValueError(f"HOLO section {idx} exceeds archive payload boundary.")
        if sec_kind == 1:
            manifest_len = int(sec_len)
        elif sec_kind == 2 and wasm_len == 0:
            payload = raw[sec_off : sec_off + sec_len]
            if payload[:4] == b"\x00asm":
                wasm_len = int(sec_len)

    footer_hex = raw[-32:].hex()
    return HoloArchiveInspection(
        byte_length=len(raw),
        version=version,
        section_count=section_count,
        manifest_bytes=manifest_len,
        wasm_bytes=wasm_len,
        footer_hex=footer_hex,
    )


def compute_job_kappa(payload: dict[str, Any]) -> str:
    """Computes a canonical deterministic content-addressed digest for Qiskit job provenance."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"blake2s256:{hashlib.blake2s(canonical, digest_size=32).hexdigest()}"
