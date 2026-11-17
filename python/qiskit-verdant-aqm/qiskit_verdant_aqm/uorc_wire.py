"""Pure `UORC` Wire, Stitch 2-of-3 Parity & Explicit Exemptions for `qiskit-verdant-aqm` (`VE-36` / `AQ-22`).

Byte-identical with `crates/verdant-aqm/src/uorc.rs` and `src/aqm/uorc.ts`:
- Header: `b"UORC"` (4B) + version `1` (1B) + strategy `0|1` (1B) + `raw_len u32 LE` + `body_len u32 LE`
- Body: Lossless OrderRope LZ77/RLE packet stream (`[0x00, lit_len, ...]` / `[0x01, off_lo, off_hi, match_len]`) or raw bytes
- Seal: 32-byte NIST FIPS 180-4 SHA-256 digest over `archive[:-32]`
"""

from __future__ import annotations

import base64
import hashlib
import json
import struct
from typing import Any, Literal

UORC_MAGIC = b"UORC"
VDNT_SNAPSHOT_MAGIC = b"VDNT\x01"
UORC_HEADER_LEN = 14
UORC_SEAL_LEN = 32

UorcExemption = Literal[
    "none",
    "cold-boot-http-holo",
    "core-wasm-verifier-64b",
    "host-standard-interop",
]


def is_uorc_archive(data: bytes | bytearray | memoryview) -> bool:
    """Returns `True` iff `data` starts with the canonical 4-byte `b"UORC"` magic header."""
    raw = bytes(data)
    return len(raw) >= 4 and raw[:4] == UORC_MAGIC


def _encode_order_rope_rle(payload: bytes) -> bytes:
    out = bytearray()
    max_win = 1024
    max_run = 127
    pos = 0
    lit_start = 0
    n = len(payload)

    while pos < n:
        win_start = max(0, pos - max_win)
        best_off = 0
        best_len = 0

        if pos + 4 <= n:
            cand = win_start
            while cand < pos:
                mlen = 0
                while pos + mlen < n and mlen < max_run and payload[cand + mlen] == payload[pos + mlen]:
                    mlen += 1
                if mlen >= 4 and mlen > best_len:
                    best_len = mlen
                    best_off = pos - cand
                cand += 1

        if best_len >= 4:
            while lit_start < pos:
                chunk = min(pos - lit_start, max_run)
                out.append(0)
                out.append(chunk)
                out.extend(payload[lit_start : lit_start + chunk])
                lit_start += chunk
            out.append(1)
            out.extend(struct.pack("<HB", best_off, best_len))
            pos += best_len
            lit_start = pos
        else:
            pos += 1

    while lit_start < n:
        chunk = min(n - lit_start, max_run)
        out.append(0)
        out.append(chunk)
        out.extend(payload[lit_start : lit_start + chunk])
        lit_start += chunk

    return bytes(out)


def _decode_order_rope_rle(body: bytes, expected_len: int) -> bytes:
    out = bytearray()
    i = 0
    n = len(body)
    while i < n:
        tag = body[i]
        if tag == 0:
            if i + 1 >= n:
                raise ValueError("UorcWireError::UnsealedPostBootPayload: truncated literal packet")
            ln = body[i + 1]
            start = i + 2
            if start + ln > n:
                raise ValueError("UorcWireError::UnsealedPostBootPayload: literal span overflow")
            out.extend(body[start : start + ln])
            i = start + ln
        elif tag == 1:
            if i + 3 >= n:
                raise ValueError("UorcWireError::UnsealedPostBootPayload: truncated match packet")
            off, ln = struct.unpack_from("<HB", body, i + 1)
            if off == 0 or off > len(out):
                raise ValueError("UorcWireError::UnsealedPostBootPayload: invalid backward offset")
            base = len(out) - off
            for k in range(ln):
                out.append(out[base + k])
            i += 4
        else:
            raise ValueError(f"UorcWireError::UnsealedPostBootPayload: unknown packet tag {tag:#x}")

    if len(out) != expected_len:
        raise ValueError(
            f"UorcWireError::UnsealedPostBootPayload: decoded length {len(out)} != expected {expected_len}"
        )
    return bytes(out)


def compress_uorc_portable(payload: bytes) -> bytes:
    """Packs `payload` into a self-delimiting, SHA-256-sealed `b"UORC"` archive."""
    encoded = _encode_order_rope_rle(payload)
    use_comp = len(encoded) < len(payload)
    strategy = 1 if use_comp else 0
    body = encoded if use_comp else payload

    header = struct.pack("<4sBBII", UORC_MAGIC, 1, strategy, len(payload), len(body))
    prefix = header + body
    seal = hashlib.sha256(prefix).digest()
    return prefix + seal


def decompress_uorc_portable(archive: bytes) -> bytes:
    """Verifies `b"UORC"` magic and 32-byte SHA-256 seal, then reconstructs the lossless payload."""
    if not is_uorc_archive(archive):
        raise ValueError("UorcWireError::MissingUorcMagic: missing mandatory 4-byte b'UORC' header")
    if len(archive) < UORC_HEADER_LEN + UORC_SEAL_LEN:
        raise ValueError("UorcWireError::UnsealedPostBootPayload: truncated UORC archive")

    seal_start = len(archive) - UORC_SEAL_LEN
    prefix = archive[:seal_start]
    actual_seal = archive[seal_start:]
    expected_seal = hashlib.sha256(prefix).digest()
    if actual_seal != expected_seal:
        raise ValueError("UorcWireError::SealDigestMismatch: 32-byte SHA-256 seal mismatch")

    _, ver, strategy, raw_len, body_len = struct.unpack_from("<4sBBII", archive, 0)
    if ver != 1 or strategy not in (0, 1):
        raise ValueError(f"UorcWireError::UnsealedPostBootPayload: unsupported version={ver}, strategy={strategy}")
    if UORC_HEADER_LEN + body_len != seal_start:
        raise ValueError("UorcWireError::UnsealedPostBootPayload: body_len mismatch against seal offset")

    body = archive[UORC_HEADER_LEN:seal_start]
    if strategy == 0:
        if len(body) != raw_len:
            raise ValueError("UorcWireError::UnsealedPostBootPayload: stored body length != raw_len")
        return body
    return _decode_order_rope_rle(body, raw_len)


def verify_uorc_transport_boundary(exemption: UorcExemption, payload: bytes) -> bool:
    """Enforces `Quantum.lex.tex::uorcTransportMandatory` with the 3 modeled exemptions."""
    if exemption == "cold-boot-http-holo":
        return True
    if exemption == "core-wasm-verifier-64b":
        if len(payload) > 512:
            raise ValueError("UorcWireError::UnsealedPostBootPayload: verifier frame > 512 bytes")
        return True
    if exemption == "host-standard-interop":
        return True
    decompress_uorc_portable(payload)
    return True


def encode_uorc_url_hash(snapshot_dict: dict[str, Any]) -> str:
    """Encodes a snapshot dictionary into `#uorc=<base64url(uorc_bytes)>`."""
    raw = VDNT_SNAPSHOT_MAGIC + json.dumps(snapshot_dict, separators=(",", ":"), sort_keys=True).encode("utf-8")
    uorc = compress_uorc_portable(raw)
    b64 = base64.urlsafe_b64encode(uorc).decode("ascii").rstrip("=")
    return f"#uorc={b64}"


def decode_uorc_url_hash(url_hash: str) -> dict[str, Any]:
    """Decodes `#uorc=<base64url>` and verifies its 32-byte SHA-256 UORC seal."""
    tok = url_hash[len("#uorc=") :] if url_hash.startswith("#uorc=") else url_hash
    pad = "=" * ((4 - (len(tok) % 4)) % 4)
    uorc = base64.urlsafe_b64decode(tok + pad)
    raw = decompress_uorc_portable(uorc)
    body = raw[len(VDNT_SNAPSHOT_MAGIC) :] if raw.startswith(VDNT_SNAPSHOT_MAGIC) else raw
    parsed = json.loads(body.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Malformed UORC snapshot JSON object")
    return parsed
