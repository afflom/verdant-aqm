# Verdant AQM — Qiskit Backend & Prism Documentation Hub

> **Audience (`Wren` · Catalog & DevRel Author):** Entry point for quantum developers, Qiskit users, transpiler maintainers, and formal verification auditors working with `verdant-aqm` and `qiskit-verdant-aqm`.

`verdant-aqm` is a Prism-verified Abstract Quantum Machine that publishes a commercial-grade Qiskit `BackendV2` (`VerdantAqmBackend`), Qiskit Primitives V2 (`VerdantAqmSamplerV2`, `VerdantAqmEstimatorV2`), and interactive Jupyter Notebooks without hardware QPUs, cloud API keys, or arbitrary classical dense $2^n$ qubit limits.

## Diataxis Guide Map

| Quadrant | Guide | Persona | Focus |
| :--- | :--- | :--- | :--- |
| **Tutorial** | [Quickstart with `VerdantAqmBackend` and Jupyter](./tutorials/01-quickstart-qiskit-backend.md) | **Kai** (Newcomer) | Construct a Bell pair, inspect `Result.get_counts()`, and verify `holo_kappa` provenance in 5 minutes. |
| **How-To Guide** | [Scale Past Dense Qubit Ceilings & Migrate from Aer](./how-to/unbounded-megascale-and-aer-migration.md) | **Iris** (Modeler) | Execute 4,096-qubit Clifford+T circuits, 2,048-qubit stabilizer rings, and variational `SparsePauliOp` sweeps. |
| **Reference** | [`qiskit-verdant-aqm` API, Target ISA & CLI Reference](./reference/qiskit-backend-v2-and-primitives-api.md) | **Otto** (Maintainer) | Complete 28-instruction `Target` table, `BackendV2` options, `SamplerV2` / `EstimatorV2` signatures, and `upstream.toml` pins. |
| **Explanation** | [Prism Substrates, Algebraic Exactness & Honesty Gates](./explanation/prism-substrates-and-honesty-gates.md) | **Vera** (Auditor) | Why sparse $\mathbb{Z}[\zeta_8]$, $\mathbb{F}_2$ tableaus, and UOR Atlas avoid classical $2^n$ state-vector bottlenecks, plus `Honesty.lex.tex` boundaries. |

## Architecture & Routing Figure

```
QuantumCircuit / PUBs (Qiskit BackendV2 · SamplerV2 · EstimatorV2)
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│  Prism Invariant Guard (AQ-01, AQ-02, AQ-15, AQ-17, AQ-19..AQ-23)  │
│  - Unbounded Target (num_qubits = None, coupling_map = None)       │
│  - No-Cloning Wire Linearity & Z_8 Phase-Monoid Gate Fusion        │
│  - Pure UORC Post-Boot Wire (VE-36) & Parametric Ratchet (FI-08)   │
└───────┬────────────────────┬───────────────────┬───────────────────┘
        │                    │                   │
        ▼                    ▼                   ▼
┌────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│ F_2 Symplectic │  │ Sparse Z[zeta_8] │  │ Sparse Continuum & Atlas │
│ Tableau (AQ-04)│  │ & Galois MPS     │  │ SkWeaver PU(22) (AQ-16)  │
│ 2,048q+ O(n/32)│  │ 4,096q+ (AQ-03/14│  │ rx,ry,rz,u,rxx,rzz <1e-12│
└────────────────┘  └──────────────────┘  └──────────────────────────┘
```

*Figure 1: Every Qiskit circuit submitted to `VerdantAqmBackend` passes Prism wire-linearity validation before dynamic routing to the highest-performance exact algebraic or sparse-continuum substrate.*

## Complete Capability Coverage Ledger (`AQ-01` – `AQ-23`)

Every capability declared in `model/ids.toml` and `app/src/Features.lex.tex` is documented and regression-verified:

| ID | Capability Name | Stratum | Primary Verification Surface |
| :--- | :--- | :--- | :--- |
| `AQ-01` | `constructive_hilbert_bounds` | 0 | Constructive $2^n$ arithmetic and `BoundedBuffer` payload framing (`stratum0.ts`). |
| `AQ-02` | `quantum_wire_linearity` | 1 | Rejects duplicate multi-qubit wire tuples such as `cx(0, 0)` (`Quantum.lex.tex`). |
| `AQ-03` | `exact_cyclotomic_amplitudes` | 1 | Sparse $\mathbb{Z}[\zeta_8]/\sqrt{2}^k$ exact Clifford+$T$ + Toffoli engine (`cyclotomic.ts`). |
| `AQ-04` | `symplectic_stabilizer_tableau` | 1 | Packed 32-bit column bit-plane Gottesman-Knill simulator (`stabilizer.ts`). |
| `AQ-05` | `tropical_lightcone_and_qec` | 1 | $(\max,+)$ causal lightcones and $(\min,+)$ rotated surface-code MWPM (`tropical.ts`). |
| `AQ-06` | `coded_zero_decode_slm_guard` | 1 | 4-bit codebook `coded_gemm` SLM router gated by Prism invariants (`slm.ts`). |
| `AQ-07` | `reversible_measurement_journal` | 2 | SHA-256 hash-chained collapse journal and `#uorc=` snapshot tokens (`journal.ts`). |
| `AQ-08` | `bloch_and_lattice_3d_manifold` | 3 | Interactive Three.js 3D Bloch manifold, surface-code pillars, and lightcones (`QuantumViewport3D.tsx`). |
| `AQ-09` | `software_tile_raster_parity` | 3 | Deterministic $16 \times 16$ CPU software tile PBR rasterizer (`tileRasterizer.ts`). |
| `AQ-10` | `uorc_progressive_state_lod` | 4 | Five-tier (`LOD0`–`LOD4`) progressive state streaming (`uorc.ts`). |
| `AQ-11` | `stitch_erasure_quantum_custody` | 5 | 2-of-3 XOR erasure-coded custody shards with BLAKE3 integrity (`uorc.ts`). |
| `AQ-12` | `cybernetic_salience_observer` | 6 | Leaky integrate-and-fire salience allocation across active wires (`slm.ts`). |
| `AQ-13` | `modal_quantum_sonification` | 7 | Phase-coherent Web Audio modal synthesis driven by purity and syndromes (`sonification.ts`). |
| `AQ-14` | `exact_cyclotomic_mps_compression` | 1 | Exact $\mathbb{Q}(\zeta_8)$ Galois-companion RREF tensor-train factorization (`mps.ts`). |
| `AQ-15` | `portable_hologram_v4_wasm_guest` | 0 | Binary `.holo` v4 archive with 32-byte BLAKE3 footer and zero-import `wasm32` verifier (`holoGuest.ts`). |
| `AQ-16` | `uor_atlas_topological_utqc` | 1 | 96-vertex UOR Atlas $D_4$ MTC (`FPdim^2 = 36`) and `SkWeaver` $PU(22)$ compiler (`atlasUtqc.ts`). |
| `AQ-17` | `prism_phase_monoid_fusion` | 1 | Exact $\mathbb{Z}_8$ phase-polynomial gate fusion and involution cancellation (`prismKernel.ts`). |
| `AQ-18` | `wasm32_simd_bitplane_kernels` | 1 | Compiled zero-import `wasm32` `i64.popcnt`, 4-bit `coded_gemm`, and $(\min,+)$ kernels (`holoGuest.ts`). |
| `AQ-19` | `qiskit_backend_v2_unbounded` | 1 | Production unbounded Qiskit `BackendV2`, `Target`, `Provider`, and `Result` (`qiskitBackend.ts`). |
| `AQ-20` | `qiskit_primitives_v2_exact` | 1 | Exact analytical (`precision=0.0`) and shot-sampled `SamplerV2` & `EstimatorV2` (`qiskitBackend.ts`). |
| `AQ-21` | `devrel_notebook_and_oracle_gate` | 7 | `prism-devrel` Diataxis notebooks, content checks (`CS-01..CS-11`), and Qiskit upstream oracle (`qiskitOracle.ts`). |
| `AQ-22` | `uorc_exclusive_post_boot_wire` | 4 | Pure `UORC` post-boot wire (`b"UORC"` magic + 32B SHA-256 seal), `#uorc=` URLs, OPFS `.uorc` cache, `CDMX` zero-decode bundles, stride-8 checkpoints, and 3 explicit boundary exemptions (`uorc.ts`, `uorc_wire.py`, `uorc.rs`). |
| `AQ-23` | `parametric_zero_constants_ratchet` | 0 | Permanent `prism/parametric-ratchet/1` (`FI-08`) enforcing all 6 zero ceilings (`0` literals `> 1`, `0` `Classical.choice`, `0` ungrounded `.lex.tex` modules) across Lean 4 and Rust (`ratchet.ts`, `parametric-ratchet.toml`). |

