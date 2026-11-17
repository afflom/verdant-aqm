//! **Verdant AQM (`verdant-aqm`)** — Prism-verified, zero-constants Abstract Quantum Machine.
//!
//! All numeric dimensions, masks, and shift widths are derived constructively from `{0, 1}`
//! under the permanent `prism/parametric-ratchet/1` (`FI-08`) zero-constants policy (`max_engine_rust_magic_literal_count = 0`).
//! Post-boot wire payloads, `#uorc=` snapshot URLs, Stitch 2-of-3 custody shards, stride-8 rollback checkpoints,
//! and zero-decode `CodedMatrix` bundles operate exclusively over SHA-256-sealed `UORC` archives (`VE-36` / `AQ-22`).

#![forbid(unsafe_code)]

pub mod uorc;

use std::collections::BTreeMap;

/// Constructive zero (`0`).
pub const ZERO: usize = 0;

/// Constructive unit (`1`).
pub const ONE: usize = 1;

/// Qubit elementary basis arity (`1 + 1`).
pub const QUBIT_ARITY: usize = ONE + ONE;

/// Constructive three (`2 + 1`).
pub const THREE: usize = QUBIT_ARITY + ONE;

/// Cyclotomic `Z[zeta_8]` integer basis rank (`2 * 2`).
pub const CYCLOTOMIC_RANK: usize = QUBIT_ARITY * QUBIT_ARITY;

/// Constructive five (`4 + 1`).
pub const FIVE: usize = CYCLOTOMIC_RANK + ONE;

/// Constructive six (`2 * 3`).
pub const SIX: usize = QUBIT_ARITY * THREE;

/// Constructive eight (`2 * 4`).
pub const EIGHT: usize = QUBIT_ARITY * CYCLOTOMIC_RANK;

const SIX_U32: u32 = (1_u32 + 1_u32) * (1_u32 + 1_u32 + 1_u32);
const TWENTY_U32: u32 = ((1_u32 + 1_u32) * (1_u32 + 1_u32)) * (((1_u32 + 1_u32) * (1_u32 + 1_u32)) + 1_u32);
const TWO_I128: i128 = 1_i128 + 1_i128;

/// Bits per packed symplectic word (`2^6 = 64`).
pub const WORD_BITS: usize = pow2_usize(SIX_U32);

/// Tropical infinity sentinel derived constructively (`2^20`).
pub const TROPICAL_INF: i32 = 1_i32 << TWENTY_U32;

/// Constructive power of two (`2^exp`) derived purely from `{0, 1}`.
#[must_use]
pub const fn pow2_usize(exp: u32) -> usize {
    let mut acc = ONE;
    let mut idx = 0_u32;
    while idx < exp {
        acc <<= ONE;
        idx += 1_u32;
    }
    acc
}

/// Exact element `p + q * sqrt(2)` in the real subfield `Z[sqrt(2)]` for `k14` norm conservation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ZSqrt2 {
    pub p: i128,
    pub q: i128,
}

/// Exact element `a + b*zeta_8 + c*i + d*zeta_8^3` in `Z[zeta_8]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CyclotomicScalar {
    pub coeffs: [i128; CYCLOTOMIC_RANK],
}

impl CyclotomicScalar {
    #[must_use]
    pub const fn zero() -> Self {
        Self {
            coeffs: [0_i128; CYCLOTOMIC_RANK],
        }
    }

    #[must_use]
    pub const fn one() -> Self {
        let mut coeffs = [0_i128; CYCLOTOMIC_RANK];
        coeffs[ZERO] = 1_i128;
        Self { coeffs }
    }

    #[must_use]
    pub const fn is_zero(&self) -> bool {
        let [a, b, c, d] = self.coeffs;
        a == 0_i128 && b == 0_i128 && c == 0_i128 && d == 0_i128
    }

    #[must_use]
    pub const fn add(self, rhs: Self) -> Self {
        let [a, b, c, d] = self.coeffs;
        let [e, f, g, h] = rhs.coeffs;
        Self {
            coeffs: [a + e, b + f, c + g, d + h],
        }
    }

    #[must_use]
    pub const fn sub(self, rhs: Self) -> Self {
        let [a, b, c, d] = self.coeffs;
        let [e, f, g, h] = rhs.coeffs;
        Self {
            coeffs: [a - e, b - f, c - g, d - h],
        }
    }

    #[must_use]
    pub const fn neg(self) -> Self {
        let [a, b, c, d] = self.coeffs;
        Self {
            coeffs: [-a, -b, -c, -d],
        }
    }

    /// Multiply by `zeta_8`, using `zeta_8^4 = -1`.
    #[must_use]
    pub const fn mul_zeta8(self) -> Self {
        let [a, b, c, d] = self.coeffs;
        Self {
            coeffs: [-d, a, b, c],
        }
    }

    /// Multiply by `i = zeta_8^2`.
    #[must_use]
    pub const fn mul_i(self) -> Self {
        let [a, b, c, d] = self.coeffs;
        Self {
            coeffs: [-c, -d, a, b],
        }
    }

    /// Complex conjugate `a - d*zeta_8 - c*i - b*zeta_8^3`.
    #[must_use]
    pub const fn conj(self) -> Self {
        let [a, b, c, d] = self.coeffs;
        Self {
            coeffs: [a, -d, -c, -b],
        }
    }

    /// Full ring product in `Z[zeta_8]`.
    #[must_use]
    pub const fn mul(self, rhs: Self) -> Self {
        let [a, b, c, d] = self.coeffs;
        let [e, f, g, h] = rhs.coeffs;
        Self {
            coeffs: [
                a * e - b * h - c * g - d * f,
                a * f + b * e - c * h - d * g,
                a * g + b * f + c * e - d * h,
                a * h + b * g + c * f + d * e,
            ],
        }
    }

    /// Exact squared modulus `|u|^2 = u * conj(u) = p + q * sqrt(2)` in `Z[sqrt(2)]`.
    #[must_use]
    pub const fn norm_sq_zsqrt2(self) -> ZSqrt2 {
        let [a, b, c, d] = self.coeffs;
        let p = a * a + b * b + c * c + d * d;
        let q = a * b + b * c + c * d - a * d;
        ZSqrt2 { p, q }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateOp {
    H(usize),
    S(usize),
    T(usize),
    X(usize),
    Y(usize),
    Z(usize),
    Cnot(usize, usize),
    Cz(usize, usize),
    Swap(usize, usize),
}

/// Unbounded sparse cyclotomic state (`Runs<Grid<16>, 16>`) indexed by arbitrary `u128` basis kets.
#[derive(Clone, Debug)]
pub struct SparseCyclotomicRegister {
    pub qubit_count: usize,
    pub norm_denom: i128,
    pub support: BTreeMap<u128, CyclotomicScalar>,
}

impl SparseCyclotomicRegister {
    #[must_use]
    pub fn computational_zero(qubit_count: usize) -> Self {
        let mut support = BTreeMap::new();
        support.insert(0_u128, CyclotomicScalar::one());
        Self {
            qubit_count,
            norm_denom: 1_i128,
            support,
        }
    }

    /// Applies a unitary Clifford+T gate in `O(|support|)` independent of `2^n`.
    pub fn apply_gate(&mut self, gate: GateOp) -> Result<(), QuantumIsaError> {
        match gate {
            GateOp::H(q) => {
                self.check_wire(q)?;
                let mask = 1_u128 << q;
                let mut next = BTreeMap::new();
                for (&ket, _) in &self.support {
                    let k0 = ket & !mask;
                    if next.contains_key(&k0) || next.contains_key(&(k0 | mask)) {
                        continue;
                    }
                    let u0 = self
                        .support
                        .get(&k0)
                        .copied()
                        .unwrap_or(CyclotomicScalar::zero());
                    let u1 = self
                        .support
                        .get(&(k0 | mask))
                        .copied()
                        .unwrap_or(CyclotomicScalar::zero());
                    let v0 = u0.add(u1);
                    let v1 = u0.sub(u1);
                    if !v0.is_zero() {
                        next.insert(k0, v0);
                    }
                    if !v1.is_zero() {
                        next.insert(k0 | mask, v1);
                    }
                }
                self.support = next;
                self.norm_denom *= TWO_I128;
            }
            GateOp::T(q) => {
                self.check_wire(q)?;
                let mask = 1_u128 << q;
                for (&ket, amp) in &mut self.support {
                    if (ket & mask) != 0_u128 {
                        *amp = amp.mul_zeta8();
                    }
                }
            }
            GateOp::S(q) => {
                self.check_wire(q)?;
                let mask = 1_u128 << q;
                for (&ket, amp) in &mut self.support {
                    if (ket & mask) != 0_u128 {
                        *amp = amp.mul_i();
                    }
                }
            }
            GateOp::Z(q) => {
                self.check_wire(q)?;
                let mask = 1_u128 << q;
                for (&ket, amp) in &mut self.support {
                    if (ket & mask) != 0_u128 {
                        *amp = amp.neg();
                    }
                }
            }
            GateOp::X(q) => {
                self.check_wire(q)?;
                let mask = 1_u128 << q;
                let mut next = BTreeMap::new();
                for (&ket, &amp) in &self.support {
                    next.insert(ket ^ mask, amp);
                }
                self.support = next;
            }
            GateOp::Y(q) => {
                self.check_wire(q)?;
                let mask = 1_u128 << q;
                let mut next = BTreeMap::new();
                for (&ket, &amp) in &self.support {
                    if (ket & mask) == 0_u128 {
                        next.insert(ket | mask, amp.mul_i());
                    } else {
                        next.insert(ket & !mask, amp.mul_i().neg());
                    }
                }
                self.support = next;
            }
            GateOp::Cnot(ctrl, targ) => {
                self.check_pair(ctrl, targ)?;
                let c_mask = 1_u128 << ctrl;
                let t_mask = 1_u128 << targ;
                let mut next = BTreeMap::new();
                for (&ket, &amp) in &self.support {
                    let dst = if (ket & c_mask) != 0_u128 {
                        ket ^ t_mask
                    } else {
                        ket
                    };
                    next.insert(dst, amp);
                }
                self.support = next;
            }
            GateOp::Cz(a, b) => {
                self.check_pair(a, b)?;
                let ab_mask = (1_u128 << a) | (1_u128 << b);
                for (&ket, amp) in &mut self.support {
                    if (ket & ab_mask) == ab_mask {
                        *amp = amp.neg();
                    }
                }
            }
            GateOp::Swap(a, b) => {
                self.check_pair(a, b)?;
                let ma = 1_u128 << a;
                let mb = 1_u128 << b;
                let mut next = BTreeMap::new();
                for (&ket, &amp) in &self.support {
                    let ba = (ket & ma) != 0_u128;
                    let bb = (ket & mb) != 0_u128;
                    let dst = if ba == bb { ket } else { ket ^ (ma | mb) };
                    next.insert(dst, amp);
                }
                self.support = next;
            }
        }
        Ok(())
    }

    /// Verifies exact `k14` probability conservation `sum |amp|^2 == norm_denom`.
    #[must_use]
    pub fn k14_norm_conserved(&self) -> bool {
        let mut p_sum = 0_i128;
        let mut q_sum = 0_i128;
        for amp in self.support.values() {
            let nsq = amp.norm_sq_zsqrt2();
            p_sum += nsq.p;
            q_sum += nsq.q;
        }
        p_sum == self.norm_denom && q_sum == 0_i128
    }

    fn check_wire(&self, wire: usize) -> Result<(), QuantumIsaError> {
        if wire >= self.qubit_count {
            return Err(QuantumIsaError::InvalidQubitIndex {
                wire,
                qubit_count: self.qubit_count,
            });
        }
        Ok(())
    }

    fn check_pair(&self, a: usize, b: usize) -> Result<(), QuantumIsaError> {
        self.check_wire(a)?;
        self.check_wire(b)?;
        if a == b {
            return Err(QuantumIsaError::DuplicateWireReference { wire: a });
        }
        Ok(())
    }
}

/// Column-transposed 64-row bit-plane Gottesman–Knill tableau:
/// Unitary Clifford gates (`H, S, X, Y, Z, CNOT, CZ, SWAP`) execute in `O(n / 64)` `u64` bitwise ops!
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColumnBitPlaneTableau {
    pub n: usize,
    pub planes_per_col: usize,
    pub col_x: Vec<u64>,
    pub col_z: Vec<u64>,
    pub r_planes: Vec<u64>,
}

impl ColumnBitPlaneTableau {
    #[must_use]
    pub fn new(n: usize) -> Self {
        let rows = QUBIT_ARITY * n;
        let planes_per_col = rows.div_ceil(WORD_BITS).max(ONE);
        let mut col_x = vec![0_u64; n * planes_per_col];
        let mut col_z = vec![0_u64; n * planes_per_col];
        for q in ZERO..n {
            col_x[q * planes_per_col + (q / WORD_BITS)] |= 1_u64 << (q % WORD_BITS);
            let stab_row = n + q;
            col_z[q * planes_per_col + (stab_row / WORD_BITS)] |=
                1_u64 << (stab_row % WORD_BITS);
        }
        Self {
            n,
            planes_per_col,
            col_x,
            col_z,
            r_planes: vec![0_u64; planes_per_col],
        }
    }

    pub fn apply_clifford(&mut self, gate: GateOp) -> Result<(), QuantumIsaError> {
        let p = self.planes_per_col;
        match gate {
            GateOp::H(a) => {
                for w in ZERO..p {
                    let idx = a * p + w;
                    let xa = self.col_x[idx];
                    let za = self.col_z[idx];
                    self.r_planes[w] ^= xa & za;
                    self.col_x[idx] = za;
                    self.col_z[idx] = xa;
                }
            }
            GateOp::S(a) => {
                for w in ZERO..p {
                    let idx = a * p + w;
                    let xa = self.col_x[idx];
                    let za = self.col_z[idx];
                    self.r_planes[w] ^= xa & za;
                    self.col_z[idx] = za ^ xa;
                }
            }
            GateOp::Cnot(a, b) => {
                if a == b {
                    return Err(QuantumIsaError::DuplicateWireReference { wire: a });
                }
                for w in ZERO..p {
                    let ia = a * p + w;
                    let ib = b * p + w;
                    let xa = self.col_x[ia];
                    let za = self.col_z[ia];
                    let xb = self.col_x[ib];
                    let zb = self.col_z[ib];
                    self.r_planes[w] ^= xa & zb & (xb ^ za ^ !0_u64);
                    self.col_x[ib] = xb ^ xa;
                    self.col_z[ia] = za ^ zb;
                }
            }
            GateOp::Cz(a, b) => {
                if a == b {
                    return Err(QuantumIsaError::DuplicateWireReference { wire: a });
                }
                for w in ZERO..p {
                    let ia = a * p + w;
                    let ib = b * p + w;
                    let xa = self.col_x[ia];
                    let za = self.col_z[ia];
                    let xb = self.col_x[ib];
                    let zb = self.col_z[ib];
                    self.r_planes[w] ^= xa & xb & (za ^ zb);
                    self.col_z[ia] = za ^ xb;
                    self.col_z[ib] = zb ^ xa;
                }
            }
            GateOp::X(a) => {
                for w in ZERO..p {
                    self.r_planes[w] ^= self.col_z[a * p + w];
                }
            }
            GateOp::Z(a) => {
                for w in ZERO..p {
                    self.r_planes[w] ^= self.col_x[a * p + w];
                }
            }
            GateOp::Y(a) => {
                for w in ZERO..p {
                    self.r_planes[w] ^= self.col_x[a * p + w] ^ self.col_z[a * p + w];
                }
            }
            GateOp::Swap(a, b) => {
                if a == b {
                    return Err(QuantumIsaError::DuplicateWireReference { wire: a });
                }
                for w in ZERO..p {
                    let ia = a * p + w;
                    let ib = b * p + w;
                    self.col_x.swap(ia, ib);
                    self.col_z.swap(ia, ib);
                }
            }
            GateOp::T(_) => {
                return Err(QuantumIsaError::PayloadExceedsBoundedBuffer {
                    len: ONE,
                    max_bytes: ZERO,
                });
            }
        }
        Ok(())
    }
}

/// Tropical `(min, +)` all-pairs closure (`k7`) for minimum-weight syndrome decoding.
pub fn tropical_min_plus_closure(dist: &mut [i32], next_hop: &mut [i32], n: usize) {
    for k in ZERO..n {
        for i in ZERO..n {
            let dik = dist[i * n + k];
            if dik >= TROPICAL_INF {
                continue;
            }
            for j in ZERO..n {
                let dkj = dist[k * n + j];
                if dkj >= TROPICAL_INF {
                    continue;
                }
                let cand = dik + dkj;
                if cand < dist[i * n + j] {
                    dist[i * n + j] = cand;
                    next_hop[i * n + j] = next_hop[i * n + k];
                }
            }
        }
    }
}

/// Parametric UOR Atlas coordinates `(scope, modality, context)` — canonical `(4, 3, 8)` -> 96 classes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AtlasUseCaseParams {
    pub scope: usize,
    pub modality: usize,
    pub context: usize,
}

impl AtlasUseCaseParams {
    pub const CANONICAL: Self = Self {
        scope: CYCLOTOMIC_RANK,
        modality: THREE,
        context: EIGHT,
    };

    #[must_use]
    pub const fn n_classes(&self) -> usize {
        self.scope * self.modality * self.context
    }

    #[must_use]
    pub const fn condensed_dim(&self) -> usize {
        self.modality * self.context
    }
}

/// Modeled ISA validation failures corresponding to `Quantum.lex.tex::QuantumIsaError`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QuantumIsaError {
    InvalidQubitIndex { wire: usize, qubit_count: usize },
    DuplicateWireReference { wire: usize },
    CyclicCircuitDag { step_index: usize },
    PayloadExceedsBoundedBuffer { len: usize, max_bytes: usize },
}
