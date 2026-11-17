//! **Pure `UORC` Wire, Stitch Custody & Zero-Decode `CodedMatrix` Substrate (`VE-36` / `AQ-22`)**.
//!
//! Every post-boot boundary operates exclusively over self-delimiting, SHA-256-sealed `UORC` archives
//! (`b"UORC"` magic), with explicit exemptions modeled in `Quantum.lex.tex::UorcExemptionKind`
//! (`ColdBootHttpAndHolo`, `CoreWasmBoundedTextVerifier`, `HostStandardInteropArtifact`).
//! Constructed strictly from `{0, 1}` with zero magic numeric literals (`FI-08`).

use std::sync::OnceLock;

use crate::{CYCLOTOMIC_RANK, EIGHT, ONE, QUBIT_ARITY, SIX, THREE, ZERO};

const FOUR: usize = CYCLOTOMIC_RANK;
const SEVEN: usize = SIX + ONE;
const NINE: usize = EIGHT + ONE;
const TEN: usize = EIGHT + QUBIT_ARITY;
const ELEVEN: usize = TEN + ONE;
const TWELVE: usize = THREE * FOUR;
const THIRTEEN: usize = TWELVE + ONE;
const FOURTEEN: usize = SEVEN * QUBIT_ARITY;
const FIFTEEN: usize = SIXTEEN - ONE;
const SIXTEEN: usize = FOUR * FOUR;
const SEVENTEEN: usize = SIXTEEN + ONE;
const EIGHTEEN: usize = NINE * QUBIT_ARITY;
const NINETEEN: usize = EIGHTEEN + ONE;
const TWENTY_TWO: usize = ELEVEN * QUBIT_ARITY;
const TWENTY_FIVE: usize = (FOUR + ONE) * (FOUR + ONE);
const THIRTY_TWO: usize = SIXTEEN * QUBIT_ARITY;
const SIXTY_FOUR: usize = EIGHT * EIGHT;

const TWO_U32: u32 = 1_u32 + 1_u32;
const THREE_U32: u32 = TWO_U32 + 1_u32;
const SIX_U32: u32 = TWO_U32 * THREE_U32;
const SEVEN_U32: u32 = SIX_U32 + 1_u32;
const EIGHT_U32: u32 = TWO_U32 * TWO_U32 * TWO_U32;
const TEN_U32: u32 = EIGHT_U32 + TWO_U32;
const ELEVEN_U32: u32 = TEN_U32 + 1_u32;
const THIRTEEN_U32: u32 = ELEVEN_U32 + TWO_U32;
const SEVENTEEN_U32: u32 = EIGHT_U32 * TWO_U32 + 1_u32;
const EIGHTEEN_U32: u32 = SEVENTEEN_U32 + 1_u32;
const NINETEEN_U32: u32 = EIGHTEEN_U32 + 1_u32;
const TWENTY_TWO_U32: u32 = ELEVEN_U32 * TWO_U32;
const TWENTY_FIVE_U32: u32 = (TWO_U32 * TWO_U32 + 1_u32) * (TWO_U32 * TWO_U32 + 1_u32);
const THIRTY_TWO_F64: f64 =
    (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0)
        * (1.0 + 1.0);

/// Modeled UORC transport exemption categories (`Quantum.lex.tex::UorcExemptionKind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UorcExemptionKind {
    NonePostBootMandatory,
    ColdBootHttpAndHolo,
    CoreWasmBoundedTextVerifier,
    HostStandardInteropArtifact,
}

/// Modeled UORC archive & Stitch custody failures.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UorcWireError {
    MissingUorcMagic,
    TruncatedArchive { byte_len: usize },
    SealDigestMismatch,
    CorruptedOrderRopeStream,
    InsufficientStitchQuorum { present: usize },
}

/// Returns `true` iff `bytes` starts with the canonical 4-byte `b"UORC"` magic header.
#[must_use]
pub fn is_uorc_archive(bytes: &[u8]) -> bool {
    bytes.len() >= FOUR && &bytes[..FOUR] == b"UORC"
}

fn is_prime(n: usize) -> bool {
    if n <= ONE {
        return false;
    }
    let mut d = QUBIT_ARITY;
    while d * d <= n {
        if n.is_multiple_of(d) {
            return false;
        }
        d += ONE;
    }
    true
}

fn first_n_primes(count: usize) -> Vec<usize> {
    let mut out = Vec::with_capacity(count);
    let mut cand = QUBIT_ARITY;
    while out.len() < count {
        if is_prime(cand) {
            out.push(cand);
        }
        cand += ONE;
    }
    out
}

static SHA256_TABLES: OnceLock<([u32; EIGHT], [u32; SIXTY_FOUR])> = OnceLock::new();

fn sha256_tables() -> &'static ([u32; EIGHT], [u32; SIXTY_FOUR]) {
    SHA256_TABLES.get_or_init(|| {
        let primes = first_n_primes(SIXTY_FOUR);
        let mut h0 = [0_u32; EIGHT];
        for idx in ZERO..EIGHT {
            let root = (primes[idx] as f64).sqrt();
            let frac = root - root.floor();
            h0[idx] = (frac * THIRTY_TWO_F64) as u32;
        }
        let mut k_consts = [0_u32; SIXTY_FOUR];
        for idx in ZERO..SIXTY_FOUR {
            let root = (primes[idx] as f64).cbrt();
            let frac = root - root.floor();
            k_consts[idx] = (frac * THIRTY_TWO_F64) as u32;
        }
        (h0, k_consts)
    })
}

/// Constructive NIST FIPS 180-4 SHA-256 derived purely from the first 8 and 64 primes (`{0, 1}`).
#[must_use]
pub fn sha256_constructive(data: &[u8]) -> [u8; THIRTY_TWO] {
    let (h0, k_consts) = sha256_tables();
    let mut h = *h0;

    let bit_len = (data.len() as u64) * (EIGHT as u64);
    let mut padded = data.to_vec();
    padded.push(1_u8 << (SEVEN as u32));
    let rem_target = SIXTY_FOUR - EIGHT;
    while padded.len() % SIXTY_FOUR != rem_target {
        padded.push(0_u8);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    let mut w = [0_u32; SIXTY_FOUR];
    let mut chunk_off = ZERO;
    while chunk_off < padded.len() {
        for i in ZERO..SIXTEEN {
            let b = chunk_off + i * FOUR;
            w[i] = u32::from_be_bytes([
                padded[b],
                padded[b + ONE],
                padded[b + QUBIT_ARITY],
                padded[b + THREE],
            ]);
        }
        for i in SIXTEEN..SIXTY_FOUR {
            let w15 = w[i - FIFTEEN];
            let s0 = w15.rotate_right(SEVEN_U32) ^ w15.rotate_right(EIGHTEEN_U32) ^ (w15 >> THREE_U32);
            let w2 = w[i - QUBIT_ARITY];
            let s1 = w2.rotate_right(SEVENTEEN_U32) ^ w2.rotate_right(NINETEEN_U32) ^ (w2 >> TEN_U32);
            w[i] = w[i - SIXTEEN]
                .wrapping_add(s0)
                .wrapping_add(w[i - SEVEN])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in ZERO..SIXTY_FOUR {
            let s1 = e.rotate_right(SIX_U32) ^ e.rotate_right(ELEVEN_U32) ^ e.rotate_right(TWENTY_FIVE_U32);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(k_consts[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(TWO_U32) ^ a.rotate_right(THIRTEEN_U32) ^ a.rotate_right(TWENTY_TWO_U32);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        let next = [a, b, c, d, e, f, g, hh];
        for idx in ZERO..EIGHT {
            h[idx] = h[idx].wrapping_add(next[idx]);
        }
        chunk_off += SIXTY_FOUR;
    }

    let mut digest = [0_u8; THIRTY_TWO];
    for idx in ZERO..EIGHT {
        let bytes = h[idx].to_be_bytes();
        let base = idx * FOUR;
        digest[base] = bytes[ZERO];
        digest[base + ONE] = bytes[ONE];
        digest[base + QUBIT_ARITY] = bytes[QUBIT_ARITY];
        digest[base + THREE] = bytes[THREE];
    }
    digest
}

/// Compresses `payload` into a self-delimiting, SHA-256-sealed `UORC` archive (`b"UORC"` + version + strategy + u32 lengths + body + 32B seal).
#[must_use]
pub fn compress_uorc_portable(payload: &[u8]) -> Vec<u8> {
    let encoded = encode_order_rope_rle(payload);
    let use_compressed = encoded.len() < payload.len();
    let strategy_byte = if use_compressed { 1_u8 } else { 0_u8 };
    let body = if use_compressed {
        encoded.as_slice()
    } else {
        payload
    };

    let header_len = FOUR + QUBIT_ARITY + FOUR + FOUR;
    let mut out = Vec::with_capacity(header_len + body.len() + THIRTY_TWO);
    out.extend_from_slice(b"UORC");
    out.push(1_u8);
    out.push(strategy_byte);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body);
    let seal = sha256_constructive(&out);
    out.extend_from_slice(&seal);
    out
}

/// Verifies the `UORC` magic header and 32-byte SHA-256 seal, then reconstructs the lossless payload.
pub fn decompress_uorc_portable(archive: &[u8]) -> Result<Vec<u8>, UorcWireError> {
    let header_len = FOUR + QUBIT_ARITY + FOUR + FOUR;
    if archive.len() < header_len + THIRTY_TWO {
        return Err(UorcWireError::TruncatedArchive {
            byte_len: archive.len(),
        });
    }
    if !is_uorc_archive(archive) {
        return Err(UorcWireError::MissingUorcMagic);
    }
    let seal_start = archive.len() - THIRTY_TWO;
    let expected_seal = sha256_constructive(&archive[..seal_start]);
    if archive[seal_start..] != expected_seal {
        return Err(UorcWireError::SealDigestMismatch);
    }

    let version = archive[FOUR];
    let strategy = archive[FOUR + ONE];
    if version != 1_u8 {
        return Err(UorcWireError::CorruptedOrderRopeStream);
    }
    let raw_len = u32::from_le_bytes([
        archive[SIX],
        archive[SEVEN],
        archive[EIGHT],
        archive[NINE],
    ]) as usize;
    let body_len = u32::from_le_bytes([
        archive[TEN],
        archive[ELEVEN],
        archive[TWELVE],
        archive[THIRTEEN],
    ]) as usize;
    if header_len + body_len != seal_start {
        return Err(UorcWireError::TruncatedArchive {
            byte_len: archive.len(),
        });
    }
    let body = &archive[header_len..seal_start];
    if strategy == 0_u8 {
        if body.len() != raw_len {
            return Err(UorcWireError::CorruptedOrderRopeStream);
        }
        return Ok(body.to_vec());
    }
    if strategy == 1_u8 {
        let plain = decode_order_rope_rle(body, raw_len)?;
        return Ok(plain);
    }
    Err(UorcWireError::CorruptedOrderRopeStream)
}

/// Enforces `Quantum.lex.tex::uorcTransportMandatory` across post-boot and explicitly exempted boundaries.
pub fn verify_uorc_transport_boundary(
    exemption: UorcExemptionKind,
    payload: &[u8],
) -> Result<(), UorcWireError> {
    match exemption {
        UorcExemptionKind::NonePostBootMandatory => {
            let _ = decompress_uorc_portable(payload)?;
            Ok(())
        }
        UorcExemptionKind::ColdBootHttpAndHolo
        | UorcExemptionKind::CoreWasmBoundedTextVerifier
        | UorcExemptionKind::HostStandardInteropArtifact => Ok(()),
    }
}

fn hash4_window(input: &[u8], pos: usize, hash_mask: usize) -> usize {
    let b0 = input[pos] as usize;
    let b1 = input[pos + ONE] as usize;
    let b2 = input[pos + QUBIT_ARITY] as usize;
    let b3 = input[pos + THREE] as usize;
    ((b0 << TEN) ^ (b1 << SIX) ^ (b2 << THREE) ^ b3 ^ (b0 >> QUBIT_ARITY)) & hash_mask
}

/// Lossless O(N) 4-byte hash-chained LZ77/RLE OrderRope byte-stream coder using `[0x00, lit_len, ...]` and `[0x01, offset_lo, offset_hi, match_len]`.
fn encode_order_rope_rle(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let max_win = SIXTY_FOUR * SIXTEEN;
    let win_mask = max_win - ONE;
    let hash_buckets = max_win * QUBIT_ARITY;
    let hash_mask = hash_buckets - ONE;
    let max_chain = THIRTY_TWO;
    let max_run = SIXTY_FOUR + SIXTY_FOUR - ONE;
    let mut head: Vec<Option<usize>> = vec![None; hash_buckets];
    let mut prev: Vec<Option<usize>> = vec![None; max_win];
    let mut pos = ZERO;
    let mut lit_start = ZERO;

    while pos < input.len() {
        let win_start = pos.saturating_sub(max_win);
        let mut best_off = ZERO;
        let mut best_len = ZERO;

        if pos + FOUR <= input.len() {
            let h = hash4_window(input, pos, hash_mask);
            let mut cur = head[h];
            let mut steps = ZERO;
            let max_match = (input.len() - pos).min(max_run);

            while let Some(cand) = cur {
                if cand < win_start || steps >= max_chain {
                    break;
                }
                if input[cand + best_len] == input[pos + best_len] && input[cand] == input[pos] {
                    let mut mlen = ZERO;
                    while mlen < max_match && input[cand + mlen] == input[pos + mlen] {
                        mlen += ONE;
                    }
                    if mlen >= FOUR && mlen > best_len {
                        best_len = mlen;
                        best_off = pos - cand;
                        if best_len == max_match {
                            break;
                        }
                    }
                }
                cur = prev[cand & win_mask];
                steps += ONE;
            }

            prev[pos & win_mask] = head[h];
            head[h] = Some(pos);
        }

        if best_len >= FOUR {
            while lit_start < pos {
                let chunk = (pos - lit_start).min(max_run);
                out.push(0_u8);
                out.push(chunk as u8);
                out.extend_from_slice(&input[lit_start..lit_start + chunk]);
                lit_start += chunk;
            }
            let off_u16 = best_off as u16;
            let [lo, hi] = off_u16.to_le_bytes();
            out.push(1_u8);
            out.push(lo);
            out.push(hi);
            out.push(best_len as u8);

            let end_pos = pos + best_len;
            let mut ins = pos + ONE;
            while ins < end_pos && ins + FOUR <= input.len() {
                let ih = hash4_window(input, ins, hash_mask);
                prev[ins & win_mask] = head[ih];
                head[ih] = Some(ins);
                ins += ONE;
            }
            pos = end_pos;
            lit_start = pos;
        } else {
            pos += ONE;
        }
    }

    while lit_start < input.len() {
        let chunk = (input.len() - lit_start).min(max_run);
        out.push(0_u8);
        out.push(chunk as u8);
        out.extend_from_slice(&input[lit_start..lit_start + chunk]);
        lit_start += chunk;
    }
    out
}

fn decode_order_rope_rle(body: &[u8], expected_len: usize) -> Result<Vec<u8>, UorcWireError> {
    let mut out = Vec::with_capacity(expected_len);
    let mut i = ZERO;
    while i < body.len() {
        let tag = body[i];
        if tag == 0_u8 {
            if i + ONE >= body.len() {
                return Err(UorcWireError::CorruptedOrderRopeStream);
            }
            let len = body[i + ONE] as usize;
            let start = i + QUBIT_ARITY;
            if start + len > body.len() {
                return Err(UorcWireError::CorruptedOrderRopeStream);
            }
            out.extend_from_slice(&body[start..start + len]);
            i = start + len;
        } else if tag == 1_u8 {
            if i + THREE >= body.len() {
                return Err(UorcWireError::CorruptedOrderRopeStream);
            }
            let off = u16::from_le_bytes([body[i + ONE], body[i + QUBIT_ARITY]]) as usize;
            let len = body[i + THREE] as usize;
            if off == ZERO || off > out.len() {
                return Err(UorcWireError::CorruptedOrderRopeStream);
            }
            let base = out.len() - off;
            for k in ZERO..len {
                let b = out[base + k];
                out.push(b);
            }
            i += FOUR;
        } else {
            return Err(UorcWireError::CorruptedOrderRopeStream);
        }
    }
    if out.len() != expected_len {
        return Err(UorcWireError::CorruptedOrderRopeStream);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uorc_roundtrip_and_tamper_refusal() {
        let sample = b"VDNT\x01{\"name\":\"ghz_cat\",\"qubits\":4096,\"steps\":[\"H\",\"CNOT\",\"CNOT\",\"CNOT\",\"T\"]}";
        let uorc = compress_uorc_portable(sample);
        assert!(is_uorc_archive(&uorc));
        assert_eq!(decompress_uorc_portable(&uorc).unwrap(), sample);

        let mut tampered = uorc.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert_eq!(
            decompress_uorc_portable(&tampered),
            Err(UorcWireError::SealDigestMismatch)
        );
        assert_eq!(
            verify_uorc_transport_boundary(UorcExemptionKind::NonePostBootMandatory, sample),
            Err(UorcWireError::MissingUorcMagic)
        );
        assert!(verify_uorc_transport_boundary(
            UorcExemptionKind::ColdBootHttpAndHolo,
            b"HOLO..."
        )
        .is_ok());
    }
}
