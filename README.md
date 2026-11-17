# Verdant AQM — Prism-Verified Abstract Quantum Machine & Unbounded Qiskit Backend

> **Reader guide (`Wren` · Catalog & DevRel Author, with paths for `Kai`, `Iris`, `Vera`, and `Otto`):**
> - **Question at entry:** How do I run, verify, and scale quantum circuits and Qiskit primitives without hardware QPUs, cloud API keys, or dense $2^n$ state-vector ceilings?
> - **Outcome:** Run the interactive 3D and Jupyter workbench locally, execute `qiskit-verdant-aqm` (`BackendV2`, `SamplerV2`, `EstimatorV2`) in Python or WebAssembly, and audit all eight `.lex.tex` Prism facets against `prism/parametric-ratchet/1`.

Verdant AQM executes, formally verifies, journals, streams, and renders deterministic quantum programs in Python and the browser. Every circuit passes constructive Prism invariants before routing to an exact algebraic or sparse-continuum engine with zero artificial qubit limits.

```
QuantumCircuit / PUBs  ──▶  qiskit-verdant-aqm (BackendV2 · SamplerV2 · EstimatorV2)
OpenQASM 2.0 / Studio  ──▶  & Interactive Browser Workbench (Studio 3D · Jupyter Lab)
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Prism Verification & Wire Boundary (app/src/*.lex.tex · VerdantAqm.holo v4)     │
│  • Wire Linearity (No-Cloning) & Kahn DAG Acyclicity (AQ-01, AQ-02)              │
│  • Z_8 Phase-Monoid Fusion & Involution Cancellation (AQ-17)                     │
│  • Pure b"UORC" + SHA-256 Post-Boot Wire (VE-36 / AQ-22)                         │
│  • Permanent Zero-Constants Parametric Ratchet (FI-08 / AQ-23: 6/6 ceilings = 0) │
└───────┬──────────────────┬──────────────────┬──────────────────┬─────────────────┘
        │                  │                  │                  │
        ▼                  ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────────┐
│ F_2 Bit-Plane │  │ Sparse        │  │ Exact Q(z_8)  │  │ Sparse Continuum &      │
│ Tableau       │  │ Z[z_8]/sqrt2^k│  │ Galois-RREF   │  │ UOR Atlas SkWeaver      │
│ (AQ-04/AQ-18) │  │ (AQ-03)       │  │ MPS (AQ-14)   │  │ PU(22) Braids (AQ-16)   │
│ 100,000q+     │  │ 10,000,000q+  │  │ 64q+ 2^64-ket │  │ rx,ry,rz,u,rxx < 1e-12  │
└───────────────┘  └───────────────┘  └───────────────┘  └─────────────────────────┘
```

*Figure 1: Circuit and Primitive Unified Bloc (PUB) submissions pass constructive Prism checks inside the zero-import `VerdantAqm.holo` boundary before dynamic routing to the matching algebraic or topological substrate.*

| Execution Substrate | Algebraic Ring / Domain | Routed Circuit Class | Verified Scale & Complexity |
| :--- | :--- | :--- | :--- |
| **`StabilizerTableau`** (`AQ-04`, `AQ-18`) | $\mathbb{F}_2$ 32-row column bit-planes + `wasm32` `i64.popcnt` | Arbitrary Clifford + mid-circuit `measure` / `reset` + Heisenberg `EstimatorV2` | `100,000+` qubits ($\mathcal{O}(n / 32)$ unitary step, $\mathcal{O}(n)$ zero-transpose $Z$-collapse) |
| **`CyclotomicExact`** (`AQ-03`, `AQ-17`) | $\mathbb{Z}[\zeta_8] / (\sqrt{2})^k$ sparse active-wire map | Clifford+$T$, `ccx` (Toffoli), `cswap` (Fredkin), sparse cat & oracle states | `10,000,000+` qubits ($\mathcal{O}(\|\text{active kets}\|)$, exact integer $\ell_2$ norm $= 1$) |
| **`ExactMps`** (`AQ-14`) | $\mathbb{Q}(\zeta_8)$ Galois-companion RREF tensor train | Bounded-entanglement 1D non-Clifford chains with $2^n$ dense support | `64–256+` qubits ($\mathcal{O}(n \cdot \chi^3)$ exact rank compression, zero SVD drift) |
| **`ExactSparseContinuum`** (`AQ-19`, `AQ-20`) | Sparse active-ket $\mathbb{C}$ map | Parametric `rx, ry, rz, p, u, cp, rxx, rzz` & variational `EstimatorV2` sweeps | `< 1e-12` analytical parity against upstream `Qiskit/qiskit` reference suites |
| **`AtlasHolospace`** (`AQ-16`) | 96-vertex UOR Atlas $D_4$ MTC ($\mathcal{FP}\dim^2 = 36$) & $PU(22)$ | Topological Fibonacci/Ising-class anyon braids & `SkWeaver` synthesis | `16,384+` braid wires via BLAKE3 $\kappa$ prefix memoization (`768 B` carrier) |

## Quickstart by reader persona

Choose the path that matches your role in [`model/content.json`](./model/content.json) and [`app/src/Architecture.lex.tex`](./app/src/Architecture.lex.tex):

- **Kai (`qiskitSdkAndDevRelUser` — Tutorial):** Start with [Quickstart with `VerdantAqmBackend` and Jupyter](./docs/tutorials/01-quickstart-qiskit-backend.md) or open [`notebooks/01_quickstart_bell_and_sampler_v2.ipynb`](./notebooks/01_quickstart_bell_and_sampler_v2.ipynb).
- **Iris (`quantumAlgorithmEngineer` — How-to):** Follow [Scale Past Dense Qubit Ceilings and Migrate from Aer](./docs/how-to/unbounded-megascale-and-aer-migration.md) and [`notebooks/02_megascale_4096q_and_estimator_v2.ipynb`](./notebooks/02_megascale_4096q_and_estimator_v2.ipynb).
- **Otto (`browserRuntimeOperator` — Reference):** Look up gates, options, and CLI commands in [`qiskit-verdant-aqm` API, Target ISA, and CLI Reference](./docs/reference/qiskit-backend-v2-and-primitives-api.md).
- **Vera (`formalVerificationAuditor` — Explanation):** Audit proofs, oracle locks, and honesty gates in [Prism Substrates, Algebraic Exactness, and Honesty Gates](./docs/explanation/prism-substrates-and-honesty-gates.md) and [`CONFORMANCE.md`](./CONFORMANCE.md).
- **Wren (`qecTopologicalResearcher` — Catalog & QEC):** Browse the full capability map in [Verdant AQM Documentation Hub](./docs/index.md) and [`notebooks/03_surface_code_qec_and_atlas_utqc.ipynb`](./notebooks/03_surface_code_qec_and_atlas_utqc.ipynb).

### 1. Run the interactive browser studio & Jupyter workbench

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to inspect the five synchronized workspaces:
1. **Studio 3D:** Three.js WebGL2 PBR Bloch vectors, rotated `[[d^2, 1, d]]` surface-code syndrome lattices, tropical $(\min, +)$ recovery paths, and a deterministic `16x16` CPU software tile rasterizer (`AQ-08`, `AQ-09`).
2. **Qiskit & Notebooks:** Live browser execution of Qiskit Python cells, `nbformat` v4.5 `.ipynb` export, 16-case upstream `Qiskit/qiskit` oracle runner, and `prism-devrel` Diataxis reader (`AQ-19`, `AQ-20`, `AQ-21`).
3. **Circuit & Rollback:** Step-by-step SHA-256-chained Born-rule measurement journal, stride-8 checkpoint replay, and `#uorc=` snapshot URLs (`AQ-07`, `AQ-22`).
4. **Prism & Core-Wasm:** Live Web Worker execution of the zero-import `wasm32` `VerdantAqm.holo` v4 guest across all 36 `holo_run` vectors and 13 planted-defect refusal gates (`AQ-01`, `AQ-15`, `AQ-18`).
5. **UORC & Custody:** Progressive `LOD0..LOD4` streaming, 2-of-3 XOR `Stitch` erasure custody shards, `CDMX` zero-decode `CodedMatrix` contractions, and `prism/parametric-ratchet/1` telemetry (`AQ-10`, `AQ-11`, `AQ-22`, `AQ-23`).

### 2. Install & run the Python `qiskit-verdant-aqm` package

```bash
pip install -e ./python/qiskit-verdant-aqm
```

```python
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import SparsePauliOp
from qiskit_verdant_aqm import (
    VerdantAqmBackend,
    VerdantAqmEstimatorV2,
    VerdantAqmProvider,
    VerdantAqmSamplerV2,
)

provider = VerdantAqmProvider()
backend = provider.get_backend("verdant_aqm_prism")
assert backend.num_qubits is None and backend.coupling_map is None

# 1. Execute a 10,000,000-qubit sparse Clifford+T+Toffoli circuit in milliseconds
qc = QuantumCircuit(10_000_000, 3, name="sparse_10M_q")
qc.h(0)
qc.t(0)
qc.cx(0, 5_000_000)
qc.tdg(0)
qc.ccx(0, 5_000_000, 9_999_999)
qc.measure([0, 5_000_000, 9_999_999], [0, 1, 2])

res = backend.run(transpile(qc, backend=backend), shots=256, seed_simulator=42).result()
print("10M-qubit GHZ+Toffoli counts:", res.get_counts())

# 2. Evaluate exact analytical SparsePauliOp expectations (precision = 0.0)
bell = QuantumCircuit(2)
bell.h(0)
bell.cx(0, 1)
obs = SparsePauliOp.from_list([("ZZ", 0.5), ("XX", 0.5)])
ev = VerdantAqmEstimatorV2(default_precision=0.0).run([(bell, obs)]).result()[0].data.evs
print("Exact Bell <0.5 ZZ + 0.5 XX>:", ev)
```

### 3. Run the verification, ratchet, oracle, and GitHub Pages gates

```bash
# 1. Enforce permanent zero-constants parametric ratchet (FI-08: 6/6 ceilings = 0)
npm run ratchet

# 2. Run TypeScript typecheck, 36 Wasm guest vectors, 13 R5 defect gates & 16 TS oracle cases
npm run lint && npm test

# 3. Run the 20-test Python Qiskit BackendV2 / SamplerV2 / EstimatorV2 validation oracle
npm run test:python

# 4. Assemble and verify the GitHub Pages artifact bundle (app.holo, notebooks, docs, weight gate)
npm run build:pages && npm run verify:pages
```

## Prism eight-facet model & formal guarantees

Verdant AQM grounds every runtime invariant in eight constructive `.lex.tex` specifications registered in [`app/lexlean.toml`](./app/lexlean.toml) with zero `Classical.choice` and zero magic domain constants:

| Facet | Specification Module | Grounded Invariants & Decisions |
| :--- | :--- | :--- |
| **Stratum 0 Ontology** | [`app/src/Foundation/Ontology/V1/Model.lex.tex`](./app/src/Foundation/Ontology/V1/Model.lex.tex), [`Bytes.lex.tex`](./app/src/Foundation/Bytes.lex.tex) | Constructive `OctantIndex`, `Byte`, `Word64`, and `BoundedBuffer` derived from `{0, 1}` with zero numeric literals $> 1$. |
| **Quantum Law** | [`app/src/Quantum.lex.tex`](./app/src/Quantum.lex.tex) | Wire linearity (`inv001`), $\mathbb{Z}[\zeta_8]$ norm conservation (`inv004`), $\mathbb{Z}_8$ phase fusion (`inv011`), unbounded Qiskit `Target` (`inv012`), pure `UORC` wire (`inv013`), zero ratchet ceilings (`inv015`), and bit-sliced mod-4 $Z$-collapse (`inv016`). |
| **Architecture** | [`app/src/Architecture.lex.tex`](./app/src/Architecture.lex.tex) | ISO/IEC/IEEE 42010 architecture views mapping 5 stakeholders, 7 concerns, and 12 system components (`architectureValid`). |
| **Design** | [`app/src/Design.lex.tex`](./app/src/Design.lex.tex) | ISO 19450 Object-Process Methodology links and UML 2.5.1 six-state deterministic lifecycle machine (`designValid`). |
| **Features** | [`app/src/Features.lex.tex`](./app/src/Features.lex.tex), [`model/ids.toml`](./model/ids.toml) | Complete capability registry `AQ-01` through `AQ-23` traced to Gherkin acceptance scenarios in [`features/suites/aqm.feature`](./features/suites/aqm.feature). |
| **Security** | [`app/src/Security.lex.tex`](./app/src/Security.lex.tex) | STRIDE threat controls: zero-import `wasm32` sandbox, BLAKE3 `.holo` footer, 32-byte SHA-256 `UORC` seal, and SHA-256 oracle locks (`strideEnumerated`). |
| **Quality** | [`app/src/Quality.lex.tex`](./app/src/Quality.lex.tex), [`model/measures.toml`](./model/measures.toml) | ISO/IEC 25010:2023 pinned thresholds `QM-01` through `QM-10` (`pinnedQualityThresholdsHold`). |
| **Compliance & Honesty** | [`app/src/Compliance.lex.tex`](./app/src/Compliance.lex.tex), [`app/src/Honesty.lex.tex`](./app/src/Honesty.lex.tex) | Three-tier claim ledger (`some-true`, `build`, `open`) and `evaluateDevRelPublishGate` refusing unverified notebooks or filler prose. |

## Pure `UORC` post-boot wire (`VE-36`) & parametric ratchet (`FI-08`)

- **Pure `UORC` Wire (`AQ-22`):** Every post-boot state frame (`LOD0..LOD4`), `#uorc=` URL snapshot, OPFS `.uorc` cache entry, 2-of-3 `Stitch` custody shard, stride-8 rollback checkpoint, `CDMX` zero-decode `CodedMatrix` bundle, and serialized Qiskit `Result` (`to_uorc_bytes()` / `from_uorc_bytes()`) carries a byte-identical `b"UORC"` header, `O(N)` rolling hash-chain LZ77/RLE payload, and 32-byte FIPS 180-4 SHA-256 seal across Rust (`crates/verdant-aqm/src/uorc.rs`), TypeScript (`src/aqm/uorc.ts`), and Python (`qiskit_verdant_aqm/uorc_wire.py`). Only the three boundaries modeled in `Quantum::UorcExemption` (`cold-boot-http-holo`, `core-wasm-verifier-64b`, `host-standard-interop`) cross raw host bytes.
- **Permanent Parametric Ratchet (`AQ-23`):** [`model/parametric-ratchet.toml`](./model/parametric-ratchet.toml) pins all six ceilings of `prism/parametric-ratchet/1` to `0` across all 10 `.lex.tex` modules and the Rust crate (`crates/verdant-aqm/`), verified continuously by `npm run ratchet` and six planted-violation mutation tests.

## Repository layout

```
verdant-aqm/
├── app/                          # 8 Prism .lex.tex facets + Stratum 0 ontology (lexlean.toml)
├── crates/verdant-aqm/           # Zero-std Rust guest & pure UORC codec (lib.rs, uorc.rs)
├── python/qiskit-verdant-aqm/    # PEP 621 Apache-2.0 Qiskit BackendV2 & Primitives V2 package
│   ├── qiskit_verdant_aqm/       # VerdantAqmBackend, Target, Provider, SamplerV2, EstimatorV2
│   └── tests/test_qiskit_oracle.py
├── notebooks/                    # Pre-verified nbformat v4.5 Jupyter notebooks (.ipynb)
├── docs/                         # prism-devrel CS-01..CS-11 Diataxis guides (4 quadrants)
├── model/                        # Charter, ids.toml, ledger.toml, measures.toml, content.json, ratchet
├── vendor/qiskit-oracle/         # SHA-256-locked Qiskit/qiskit & prism-devrel oracle files
├── bootstrap/                    # Notebook generator, ratchet gate, Pages assembler & weight gate
├── ci/kappa-cache.ts             # Input-addressed BLAKE3 VerdantAqm.holo v4 builder & verifier
├── src/                          # Browser workbench (Three.js Studio 3D, Qiskit lab, Wasm kernels)
├── upstream.toml                 # Cryptographic commit & SHA-256 pins for external oracles
└── CONFORMANCE.md                # Full facet-to-runtime traceability & substrate matrix
```

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
