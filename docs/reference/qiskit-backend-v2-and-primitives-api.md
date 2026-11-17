# Reference: `qiskit-verdant-aqm` API, Target ISA & Provenance Pins

> **Audience (`Otto` · SDK Integrator & Maintainer Reference):** Complete technical specification of classes, options, target instructions, bit-ordering rules, and SHA-256 oracle locks.

## Package Entry Points (`pyproject.toml`)

- **Distribution Name:** `qiskit-verdant-aqm` (`0.3.0`, `Apache-2.0`)
- **Import Module:** `qiskit_verdant_aqm`
- **Qiskit Plugin Entry Point:** `[project.entry-points."qiskit.backends"] verdant_aqm_prism = "qiskit_verdant_aqm:VerdantAqmBackend"`

## Core Classes

### `VerdantAqmProvider`

| Method | Signature | Description |
| :--- | :--- | :--- |
| `backends` | `backends(name: str \| None = None) -> list[VerdantAqmBackend]` | Returns `[VerdantAqmBackend()]` or filters by backend name. |
| `get_backend` | `get_backend(name: str = "verdant_aqm_prism") -> VerdantAqmBackend` | Returns `VerdantAqmBackend`; raises `KeyError` / `QiskitBackendNotFoundError` for unknown names. |

### `VerdantAqmBackend` (`BackendV2` · `AQ-19`)

| Property / Method | Value / Signature | Contract |
| :--- | :--- | :--- |
| `name` | `"verdant_aqm_prism"` | Canonical Qiskit V2 backend identifier. |
| `version` | `2` | Qiskit `BackendV2` interface version. |
| `num_qubits` | `None` | Unbounded wire capacity (`AQ-19`); refuses artificial dense ceilings. |
| `coupling_map` | `None` | Global all-to-all wire connectivity without SWAP routing overhead. |
| `max_circuits` | `None` | Unrestricted multi-experiment batch execution. |
| `qubit_properties(qubit)` | Raises `NotImplementedError` | Conforms to `test_backend_v2.py::test_no_qubit_properties_raises`. |
| `set_options(**fields)` | Validates `shots >= 1` and `<= max_shots` | Conforms to `test_backend_v2.py::test_option_bounds` (`ValueError` on invalid bounds). |
| `run(run_input, **options)` | Returns `VerdantAqmJob` | Validates wire linearity (`AQ-02`), executes across Prism substrates, and signs `holo_kappa`. |

### Supported Backend Options

| Option | Default | Type | Behavior |
| :--- | :--- | :--- | :--- |
| `shots` | `1024` | `int` | Positive integer shot count (`>= 1`). |
| `seed_simulator` | `None` | `int \| None` | Deterministic PRNG seed for reproducible `get_counts()` and `get_memory()`. |
| `memory` | `False` | `bool` | When `True`, records ordered per-shot bitstrings in `Result.get_memory()`. |
| `prism_fusion` | `True` | `bool` | Applies `AQ-17` $\mathbb{Z}_8$ phase-monoid gate fusion prior to contraction. |
| `substrate` | `"auto"` | `"auto" \| "StabilizerTableau" \| "DisjointProductState" \| "CyclotomicExact" \| "ExactMps" \| "ExactSparseContinuum" \| "AtlasHolospace"` | Overrides automatic substrate routing when set explicitly. |
| `weave_atlas` | `False` | `bool` | Synthesizes `SkWeaver` $PU(22)$ topological braid diagnostics for continuous rotations (`AQ-16`). |
| `max_shots` | `None` | `int \| None` | Optional upper shot bound used by Qiskit option-validator suites. |
| `max_parallel_threads` | `None` | `int \| None` | Optional thread pool bound; `None` saturates all detected logical host cores (`os.cpu_count()`). |

### Host Saturation & Partition Utilities (`inv017`)

| Function | Signature | Description |
| :--- | :--- | :--- |
| `prove_host_saturation` | `prove_host_saturation() -> dict[str, Any]` | Executes empirical multi-lane throughput benchmarks and returns a BLAKE3 `proof_kappa` attestation. |
| `detect_host_parallel_lanes` | `detect_host_parallel_lanes(work_units: int, requested_threads: int \| None = None) -> int` | Returns `min(detected_cores, work_units)` without hardcoded concurrency ceilings. |
| `partition_disjoint_circuit_wires` | `partition_disjoint_circuit_wires(num_qubits: int, ops: Sequence[Any]) -> tuple[list[list[int]], int]` | Factors unentangled connected wire components via Union-Find for $\mathcal{O}(C \cdot 2^{\max |c|})$ execution. |

## 28-Instruction `VerdantAqmTarget` ISA

| Gate(s) | Arity | Parameters | Exact $\mathbb{Z}[\zeta_8]$ | Pure Clifford | Semantics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id, x, y, z, h` | 1q | 0 | Yes | Yes | Identity, Pauli involutions, Hadamard. |
| `s, sdg, sx, sxdg` | 1q | 0 | Yes | Yes | $\pm \pi/2$ phase and $\sqrt{X}$ / $\sqrt{X}^\dagger$ Clifford gates. |
| `t, tdg` | 1q | 0 | Yes | No | $\pm \pi/4$ octant phase gates in $\mathbb{Z}[\zeta_8]$. |
| `rx, ry, rz, p` | 1q | 1 (`theta` / `lam`) | Multiples of $\pi/4$ (`p`) | Multiples of $\pi/2$ (`p`) | Continuous single-qubit rotations. |
| `u` (aliases `u1, u2, u3`) | 1q | 3 (`theta, phi, lam`) | No | No | Universal Euler gate $U(\theta, \phi, \lambda)$. |
| `cx, cz, cy, swap, ecr` | 2q | 0 | Yes | Yes | Two-qubit Clifford entanglers and echoed cross-resonance (`ecr`). |
| `ch` | 2q | 0 | Yes | No | Exact controlled-Hadamard via $V^\dagger X V$ in $\mathbb{Z}[\zeta_8]$. |
| `rxx, rzz` | 2q | 1 (`theta`) | No | No | Two-qubit Ising $XX$ and $ZZ$ rotations. |
| `ccx, cswap` | 3q | 0 | Yes | No | 3-qubit Toffoli (6-CNOT + 7-$T$) and Fredkin controlled-SWAP. |
| `measure, reset, barrier` | 1q / variadic | 0 | Yes | Yes | Projective Born collapse, $|0\rangle$ reset, and DAG fence. |

## Classical Register & Pauli Endianness Contract

1. **Single `ClassicalRegister(m)`:** Bitstrings are formatted little-endian `c[m-1]...c[1]c[0]`.
2. **Multiple `ClassicalRegister`s (`cr0, cr1, ...`):** Registers are joined with single spaces in reverse declaration order (`"cr_last ... cr0"`), matching Qiskit `BasicSimulator`.
3. **Pauli Observables (`VerdantAqmEstimatorV2` · `AQ-20`):** Right-most character of an $n$-character Pauli label acts on `q[0]`, and left-most character acts on `q[n-1]`.

## Authoritative Upstream Provenance (`upstream.toml`)

| Authority Repository | Pinned Commit | Vendored Verification Artifacts |
| :--- | :--- | :--- |
| `https://github.com/Qiskit/qiskit` | `c68ee295b6fa403c67216eeb0f0fbbe12cc98b28` | `test_backend_v2.py`, `test_basic_simulator.py`, `test_backend_sampler_v2.py`, `test_backend_estimator_v2.py` |
| `https://github.com/afflom/prism-devrel` | `ace153e37c7c29646f3efa6e273c3c4f8c9fb8bc` | `devrel-publish-gate.prompt.json`, `standard.json`, `content.json` |

## Verification CLI Commands

```bash
# Run TypeScript + Wasm + Qiskit Oracle + DevRel Publish Gate suite
npm test

# Run standalone Python Qiskit BackendV2 + Oracle unittest suite
npm run test:python

# Regenerate deterministic Jupyter .ipynb notebooks
npm run generate:notebooks
```
