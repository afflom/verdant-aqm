# Explanation: Prism Substrates, Algebraic Exactness & Honesty Gates

> **Audience (`Vera` · Formal Verification & Security Auditor):** Architectural rationale behind `verdant-aqm`'s multi-substrate design, external Qiskit oracle verification, and `Honesty.lex.tex` claim boundaries.

## Why Classical Dense State-Vectors Impose Contrived Limits

Conventional Qiskit simulators default to allocating a contiguous array of $2^n$ `complex128` floats before executing the first gate. That data structure conflates two distinct questions:

1. **Wire Index Addressability:** What is the largest wire index referenced by a `QuantumCircuit`?
2. **Algebraic Description Complexity:** How many stabilizer generators, tensor-train bonds, or non-zero cyclotomic basis kets are required to represent $|\psi\rangle$?

For Clifford circuits, stabilizer circuits, GHZ/cat states, algebraic reversible logic (`ccx`, `cswap`), low-bond MPS circuits, and sparse variational ansatze, the state's algebraic description scales polynomially in $n$ or linearly in active ket support $|\text{supp}(\psi)|$ — even at $n = 4{,}096$ wires. Imposing `num_qubits = 30` on `BackendV2` is an artifact of dense array indexing, not a law of quantum mechanics.

## How Prism Enforces Exactness Across Four Substrates

1. **$\mathbb{F}_2$ Symplectic Stabilizer Tableau (`AQ-04`, `AQ-18`):** Packs stabilizer and destabilizer generators into 32-bit / 64-bit column bit-planes. Commutativity is checked via `i64.popcnt` symplectic inner products inside the zero-import `wasm32` guest (`VerdantAqm.holo`).
2. **Sparse Cyclotomic Ring $\mathbb{Z}[\zeta_8]/\sqrt{2}^k$ (`AQ-03`, `AQ-17`):** Every amplitude is an exact 4-integer tuple $a_0 + a_1 \zeta_8 + a_2 \zeta_8^2 + a_3 \zeta_8^3$ indexed by an arbitrary-precision `BigInt` ket mask. Norm conservation $\sum |\alpha_x|^2 = 2^k$ holds as an exact integer identity in $\mathbb{Z}[\sqrt{2}]$ with zero floating-point drift.
3. **Exact Galois-Companion MPS (`AQ-14`):** Factorizes 1D states into tensor-train cores via exact $\mathbb{Q}(\zeta_8)$ row-reduced echelon form without lossy floating-point SVD singular-value truncation.
4. **Sparse Continuum & UOR Atlas (`AQ-16`, `AQ-20`):** Evaluates continuous rotations (`rx, ry, rz, p, u, rxx, rzz`) over `BigInt`-indexed sparse complex maps to `< 1e-12` analytical precision while optionally compiling $SU(2)$ angles into $PU(22)$ Fibonacci topological braids over the 96-vertex UOR Atlas (`FPdim^2 = 36`).

## External Oracle Authority vs Self-Referential Testing

Following `afflom/prism-devrel`, a backend must never grade its own conformance solely against hand-authored examples. `verdant-aqm` vendors upstream Qiskit test suites (`test_backend_v2.py`, `test_basic_simulator.py`, `test_backend_sampler_v2.py`, `test_backend_estimator_v2.py`) from `Qiskit/qiskit` (`c68ee295b6fa403c67216eeb0f0fbbe12cc98b28`) and locks their SHA-256 digests in `upstream.toml`. Both the TypeScript/Wasm oracle (`src/aqm/qiskitOracle.ts`) and the Python test suite (`python/qiskit-verdant-aqm/tests/test_qiskit_oracle.py`) verify these SHA-256 digests on every run before executing the 16 behavioral conformance gates.

## Pure `UORC` Post-Boot Wire (`VE-36` / `AQ-22`) & Explicit Exemptions

Every post-boot payload crossing a `verdant-aqm` wire, cache, or custody boundary — including `#uorc=` URL snapshots, OPFS `.uorc` cache entries, progressive `LOD0`–`LOD4` frames, Stitch 2-of-3 XOR shards, stride-8 rollback checkpoints, zero-decode `CDMX` `CodedMatrix` bundles, and serialized Qiskit `Result` archives — is framed in a self-delimiting `b"UORC"` container sealed by a trailing 32-byte FIPS 180-4 SHA-256 digest across Rust (`crates/verdant-aqm/src/uorc.rs`), TypeScript (`src/aqm/uorc.ts`), and Python (`qiskit_verdant_aqm/uorc_wire.py`).

Three explicit architectural boundaries are modeled in `Quantum.lex.tex::UorcExemptionKind` rather than bypassed ad hoc:

1. **`cold-boot-http-holo`:** Initial cold-boot HTML/CSS/JS assets and `VerdantAqm.holo` (`app.holo` v4, sealed by its own 32-byte BLAKE3 footer).
2. **`core-wasm-verifier-64b`:** Bounded UTF-8 verification queries (`<= 64` bytes on `holo_run`) crossing the zero-import `hologram:guest/core-wasm@1` sandbox.
3. **`host-standard-interop`:** Standard external scientific ecosystems (`nbformat` v4.5 `.ipynb` notebooks, in-memory Qiskit Python objects, and SHA-256-locked `vendor/qiskit-oracle/` files).

## Permanent Zero-Constants Parametric Ratchet (`FI-08` / `AQ-23`)

`model/parametric-ratchet.toml` (`spec = "prism/parametric-ratchet/1"`) locks six permanent zero ceilings across all 10 Lean 4 `.lex.tex` modules (`app/src/**/*.lex.tex`) and all Rust engine sources (`crates/verdant-aqm/src/**/*.rs`):

- `max_ontology_root_literal_gt_one_count = 0` and `max_ontology_root_string_field_count = 0`
- `max_classical_choice_count = 0` and `max_ungrounded_lex_module_count = 0`
- `max_domain_lex_magic_literal_count = 0` and `max_engine_rust_magic_literal_count = 0`

Every Hilbert dimension, bit-width, stride, magic byte, and SHA-256 round constant is derived constructively from `{0, 1}`. Any literal `> 1`, any `Classical.choice` reference, any ungrounded `.lex.tex` file, or any attempt to raise a ceiling above `0` fails `npm run ratchet` and `npm run verify:pages`.

## `Honesty.lex.tex` Three-Tier Claim Ledger & `devrel-publish-gate`

Per `Honesty.lex.tex` and `devrel-publish-gate.prompt.json`:

| Ledger Bucket | Meaning | `verdant-aqm` Scope |
| :--- | :--- | :--- |
| `some-true` | Proved constructively inside the Prism model | Wire linearity, $\mathbb{Z}[\zeta_8]$ norm preservation, $\mathbb{Z}_8$ fusion monoid, $\mathbb{F}_2$ symplectic commutativity, unbounded `Target` contract, `uorcTransportMandatory` exemptions, and `evaluateDevRelPublishGate` totality. |
| `build` | Verified empirically by deterministic runtime & oracle vectors | 36 `holo_run` Wasm vectors, 13 planted-defect refusal gates, 16 upstream Qiskit oracle cases, `prism/parametric-ratchet/1` 6-ceiling audit, `CS-01..CS-11` prose checks, and `.ipynb` notebook parity. |
| `open` | Explicitly out-of-scope or bounded by theoretical complexity | Physical QPU execution, cloud API transport, and worst-case dense Haar-random non-Clifford circuits at high $T$-rank where $|\text{supp}(\psi)|$ grows exponentially. |

`evaluateDevRelPublishGate(uncovered, undeclared, unverifiedNotebooks, pin)` emits `publish` only when every capability `AQ-01..AQ-23` is documented (`uncovered == 0`), zero unmodeled claims appear (`undeclared == 0`), every `.ipynb` cell executes cleanly (`unverifiedNotebooks == 0`), and `upstream.toml` SHA-256 hashes match (`pin == current`).

