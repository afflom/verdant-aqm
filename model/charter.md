# Verdant AQM — Model Charter & Authorities

## 1. Purpose & Constructive Boundary

`verdant-aqm` is a Prism-verified, zero-magic-constant Abstract Quantum Machine derived from `verdant-engine` across 8 constructive strata. It executes, formally verifies, journals, progressively streams, and spatially visualizes deterministic quantum computation in the browser and WebAssembly worker environments without hardware QPUs, external cloud APIs, or lossy floating-point amplitude drift.

## 2. Two-Tier Prism / Runtime Split

1. **Formal Law & Core-Wasm Verifier (`app/src/Quantum.lex.tex` -> `hologram:guest/core-wasm@1` + `prismKernel`)**:
   Proves qubit wire linearity (`wiresDistinctAndBounded`), Kahn circuit DAG acyclicity (`circuitDagAcyclic`), exact cyclotomic $\ell_2$ norm conservation (`normConservedScaled`), symplectic stabilizer commutativity (`stabilizerCommutes`), and accumulator bit-width safety (`128`-bit exact accumulators) constructively from `{0, 1}` with zero `Classical.choice`.
2. **Semiring Tensor Execution & Spatial Workbench (`src/aqm/*` + Studio 3D)**:
   Contracts Clifford+T circuits over $\mathbb{Z}[\zeta_8] / (\sqrt{2})^k$, simulates large Clifford surface-code lattices over $\mathbb{F}_2^{2n \times (2n+1)}$, computes causal lightcones and QEC minimum-weight syndrome recovery paths via tropical $(\min, +)$ / $(\max, +)$ semirings, journals Born-rule collapses in a SHA-256-chained `DeterministicInputJournal` with 64-frame rollback and `#vdnt=` snapshot URLs, packs progressive `UORC-SHA256-CHAIN-v1` LOD0–LOD4 streams, shards state across `Stitch` 2-of-3 XOR parity fragments signed with `prism/identity/4`, and renders 3D Bloch manifolds and surface-code lattices via WebGL2 PBR and a deterministic `16x16` software tile rasterizer.

## 3. External Some-True Authorities (`R2`)

- **NC-2010**: Michael A. Nielsen & Isaac L. Chuang, *Quantum Computation and Quantum Information*, 10th Anniversary Ed., Cambridge University Press, 2010 (`some-true` authority for Clifford+T gate matrices and Born-rule projective measurement semantics).
- **GK-1998**: Daniel Gottesman, *The Heisenberg Representation of Quantum Computers*, arXiv:quant-ph/9807006, 1998; Scott Aaronson & Daniel Gottesman, *Improved Simulation of Stabilizer Circuits*, Phys. Rev. A 70, 052328, 2004 (`some-true` authority for binary symplectic Pauli-tableau updates).
- **GS-2012**: Brett Giles & Peter Selinger, *Exact Synthesis of Multiqubit Clifford+T Circuits*, Phys. Rev. A 87, 032332, 2013 (`some-true` authority for exact dyadic cyclotomic ring $\mathbb{Z}[\zeta_8] / (\sqrt{2})^k$ representation).
- **FMMC-2012**: Austin G. Fowler, Matteo Mariantoni, John M. Martinis & Andrew N. Cleland, *Surface codes: Towards practical large-scale quantum computation*, Phys. Rev. A 86, 032324, 2012 (`some-true` authority for rotated surface-code stabilizer plaquettes and minimum-weight syndrome matching).
- **QASM-3.0**: Cross et al., *OpenQASM 3: A broader and deeper quantum assembly language*, ACM Trans. Quantum Comput. 3(3), 2022 (`some-true` authority for gate mnemonics and textual interchange).
