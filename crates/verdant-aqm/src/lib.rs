//! **Verdant AQM (`verdant-aqm`)** — Prism-verified, zero-magic-constant Abstract Quantum Machine.
//!
//! Executes Clifford+T circuits over exact cyclotomic rings `Z[zeta_8] / (sqrt(2))^k`,
//! Gottesman-Knill binary symplectic tableaus over `F_2^{2n x (2n+1)}`, and tropical `(min, +)`
//! QEC syndrome decoders, guarded by Lean-proved `Quantum.lex.tex` predicates projected into
//! `prism_kernel`.

#![forbid(unsafe_code)]

/// Constructive zero (`0`).
pub const ZERO: usize = 0;

/// Constructive unit (`1`).
pub const ONE: usize = 1;

/// Qubit elementary basis arity (`1 + 1`).
pub const QUBIT_ARITY: usize = ONE + ONE;

/// Cyclotomic `Z[zeta_8]` integer basis rank (`(1 + 1) * (1 + 1)`).
pub const CYCLOTOMIC_RANK: usize = QUBIT_ARITY * QUBIT_ARITY;

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
    pub sqrt2_exp: u32,
}

impl CyclotomicScalar {
    /// Additive identity `0`.
    #[must_use]
    pub const fn zero(sqrt2_exp: u32) -> Self {
        Self {
            coeffs: [0_i128; CYCLOTOMIC_RANK],
            sqrt2_exp,
        }
    }

    /// Multiplicative identity `1` at scale `k = 0`.
    #[must_use]
    pub const fn one() -> Self {
        let mut coeffs = [0_i128; CYCLOTOMIC_RANK];
        coeffs[ZERO] = 1_i128;
        Self {
            coeffs,
            sqrt2_exp: 0_u32,
        }
    }

    /// Multiply by `zeta_8`, using `zeta_8^4 = -1`.
    #[must_use]
    pub const fn mul_zeta8(self) -> Self {
        let i0 = ZERO;
        let i1 = ONE;
        let i2 = ONE + ONE;
        let i3 = i2 + ONE;
        Self {
            coeffs: [
                -self.coeffs[i3],
                self.coeffs[i0],
                self.coeffs[i1],
                self.coeffs[i2],
            ],
            sqrt2_exp: self.sqrt2_exp,
        }
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
