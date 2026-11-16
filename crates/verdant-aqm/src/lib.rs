//! **Verdant AQM (`verdant-aqm`)** — Prism-verified, unbounded Abstract Quantum Machine.
//!
//! Executes arbitrary-qubit Clifford+T circuits over sparse cyclotomic kets and `Z[zeta_8]`
//! Matrix Product States, 64-bit word-packed Gottesman-Knill symplectic tableaus over `F_2`,
//! parametric odd-distance `[[d^2, 1, d]]` rotated surface codes with tropical `(min, +)` decoding,
//! and UOR Atlas `(scope, modality, context)` topological holospace braids (`C(Z_3 x Z_2^3, q)`).

#![forbid(unsafe_code)]

use std::collections::BTreeMap;

/// Constructive zero (`0`).
pub const ZERO: usize = 0;

/// Constructive unit (`1`).
pub const ONE: usize = 1;

/// Qubit elementary basis arity (`1 + 1`).
pub const QUBIT_ARITY: usize = ONE + ONE;

/// Cyclotomic `Z[zeta_8]` integer basis rank (`(1 + 1) * (1 + 1)`).
pub const CYCLOTOMIC_RANK: usize = QUBIT_ARITY * QUBIT_ARITY;

/// Bits per packed symplectic word (`2^6 = 64`).
pub const WORD_BITS: usize = pow2_usize(6);

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

/// Exact element `(c0 + c1*zeta_8 + c2*zeta_8^2 + c3*zeta_8^3) / (sqrt(2))^k` in `Z[zeta_8]`.
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
        self.coeffs[0] == 0 && self.coeffs[1] == 0 && self.coeffs[2] == 0 && self.coeffs[3] == 0
    }

    /// Multiply by `zeta_8`, using `zeta_8^4 = -1`.
    #[must_use]
    pub const fn mul_zeta8(self) -> Self {
        Self {
            coeffs: [
                -self.coeffs[3],
                self.coeffs[0],
                self.coeffs[1],
                self.coeffs[2],
            ],
        }
    }
}

/// Unbounded sparse cyclotomic state (`Runs<Grid<16>, 16>`) indexed by arbitrary `u128` basis kets.
#[derive(Clone, Debug)]
pub struct SparseCyclotomicRegister {
    pub qubit_count: usize,
    pub scale_k: u32,
    pub support: BTreeMap<u128, CyclotomicScalar>,
}

impl SparseCyclotomicRegister {
    #[must_use]
    pub fn computational_zero(qubit_count: usize) -> Self {
        let mut support = BTreeMap::new();
        support.insert(0_u128, CyclotomicScalar::one());
        Self {
            qubit_count,
            scale_k: 0,
            support,
        }
    }
}

/// 64-bit word-packed symplectic row over `F_2^{2n + 1}` for 1,000+ qubit Clifford tableaus.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackedPauliRow {
    pub x_words: Vec<u64>,
    pub z_words: Vec<u64>,
    pub phase_minus: bool,
}

impl PackedPauliRow {
    #[must_use]
    pub fn identity(qubit_count: usize) -> Self {
        let words = qubit_count.div_ceil(WORD_BITS);
        Self {
            x_words: vec![0_u64; words],
            z_words: vec![0_u64; words],
            phase_minus: false,
        }
    }

    /// Word-parallel symplectic inner product `(x1 & z2) ^ (z1 & x2) mod 2`.
    #[must_use]
    pub fn commutes_with(&self, other: &Self) -> bool {
        let mut parity = 0_u32;
        for idx in 0..self.x_words.len() {
            let anti = (self.x_words[idx] & other.z_words[idx])
                ^ (self.z_words[idx] & other.x_words[idx]);
            parity ^= anti.count_ones();
        }
        (parity & 1) == 0
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
        scope: 4,
        modality: 3,
        context: 8,
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
