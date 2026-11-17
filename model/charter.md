# Verdant AQM — Model Charter & Authorities

## 1. Purpose & Constructive Boundary

`verdant-aqm` is a Prism-verified, zero-magic-constant Abstract Quantum Machine derived from `verdant-engine` across 8 constructive strata. It executes, formally verifies, journals, progressively streams, and spatially visualizes deterministic quantum computation in the browser and WebAssembly worker environments without hardware QPUs, external cloud APIs, or lossy floating-point amplitude drift.

## 2. Two-Tier Prism / Runtime Split

1. **Formal Law, Parametric Ratchet & Core-Wasm Verifier (`app/src/*.lex.tex` -> `hologram:guest/core-wasm@1` + `prismKernel`)**:
   Proves qubit wire linearity (`inv001WireLinearityNoCloning`), Kahn circuit DAG acyclicity, exact cyclotomic $\ell_2$ norm conservation (`inv004CyclotomicNormConserved`), $\mathbb{Z}_8$ phase-monoid fusion (`inv011PhaseOctantFusionIdentity`), unbounded Qiskit `Target` admission (`inv012QiskitBackendRefusesClassicalCap`), pure `UORC` post-boot wire framing (`inv013UorcPostBootMandatoryUnlessExempt`), zero parametric ratchet ceilings (`inv015ParametricRatchetZeroCeilings`), and bit-sliced mod-4 $Z$-collapse (`inv016BitSlicedStabilizerCollapseMod4`) constructively from `{0, 1}` with zero `Classical.choice` (`FI-08`, `spec = "prism/parametric-ratchet/1"`).
2. **Semiring Tensor Execution, Unbounded Qiskit SDK & Spatial Workbench (`src/aqm/*`, `python/qiskit-verdant-aqm/`, `crates/verdant-aqm/`)**:
   Contracts active-wire Clifford+$T$+Toffoli circuits (`10,000,000+` qubits) over $\mathbb{Z}[\zeta_8] / (\sqrt{2})^k$, compresses 1D non-Clifford chains over $\mathbb{Q}(\zeta_8)$ Galois-RREF Matrix Product States (`ExactMps`), simulates `100,000+`-qubit Clifford circuits and mid-circuit resets over 32-row column bit-planes in $\mathbb{F}_2$, computes causal lightcones and rotated `[[d^2, 1, d]]` surface-code recovery paths via `wasm32` tropical $(\min, +)$ / $(\max, +)$ kernels, publishes Qiskit `BackendV2` + `SamplerV2` + `EstimatorV2` and `nbformat` v4.5 Jupyter notebooks, journals unbounded Born-rule collapses with stride-8 checkpoints and `#uorc=` URLs (retaining `#vdnt=` backward compatibility), seals all post-boot state and `CDMX` zero-decode matrices inside `b"UORC"` SHA-256 containers (`VE-36`), shards custody across `Stitch` 2-of-3 XOR parity fragments, and renders 3D Bloch manifolds via WebGL2 PBR and a deterministic `16x16` software tile rasterizer.

## 3. External Some-True Authorities (`R2`)

- **NC-2010**: Michael A. Nielsen & Isaac L. Chuang, *Quantum Computation and Quantum Information*, 10th Anniversary Ed., Cambridge University Press, 2010 (`some-true` authority for Clifford+T gate matrices and Born-rule projective measurement semantics).
- **GK-1998**: Daniel Gottesman, *The Heisenberg Representation of Quantum Computers*, arXiv:quant-ph/9807006, 1998; Scott Aaronson & Daniel Gottesman, *Improved Simulation of Stabilizer Circuits*, Phys. Rev. A 70, 052328, 2004 (`some-true` authority for binary symplectic Pauli-tableau updates).
- **GS-2012**: Brett Giles & Peter Selinger, *Exact Synthesis of Multiqubit Clifford+T Circuits*, Phys. Rev. A 87, 032332, 2013 (`some-true` authority for exact dyadic cyclotomic ring $\mathbb{Z}[\zeta_8] / (\sqrt{2})^k$ representation).
- **FMMC-2012**: Austin G. Fowler, Matteo Mariantoni, John M. Martinis & Andrew N. Cleland, *Surface codes: Towards practical large-scale quantum computation*, Phys. Rev. A 86, 032324, 2012 (`some-true` authority for rotated surface-code stabilizer plaquettes and minimum-weight syndrome matching).
- **QASM-2.0 / QISKIT-V2**: Cross et al., *Open Quantum Assembly Language*, arXiv:1707.03429, 2017, and `Qiskit/qiskit` `BackendV2` / Primitives V2 (`c68ee295b6fa403c67216eeb0f0fbbe12cc98b28`, locked in `upstream.toml`).
