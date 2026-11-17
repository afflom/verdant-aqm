# `qiskit-verdant-aqm` — Unbounded Prism-Verified Qiskit `BackendV2` & Primitives V2

`qiskit-verdant-aqm` publishes the production Qiskit `BackendV2` (`VerdantAqmBackend`), `VerdantAqmProvider`, `VerdantAqmSamplerV2`, and `VerdantAqmEstimatorV2` implementations of **Verdant AQM** (Abstract Quantum Machine).

## Core Architectural Guarantees

- **Zero Arbitrary Qubit Ceilings (`AQ-19`):** `backend.num_qubits` is `None` and `backend.coupling_map` is `None`. Circuits are never truncated at dense $2^{28}$ or $2^{32}$ array ceilings.
- **Dynamic Multi-Substrate Routing (`AQ-03`, `AQ-04`, `AQ-14`, `AQ-16`):**
  - Pure Clifford circuits (including mid-circuit `measure` and `reset`) route to bit-sliced $\mathbb{F}_2$ `StabilizerTableau` (`100,000+` qubits via Heisenberg adjoint conjugation and zero-transpose $Z$-collapse).
  - Clifford+$T$, Toffoli (`ccx`), and Fredkin (`cswap`) circuits with sparse ket support route to active-wire cyclotomic rings $\mathbb{Z}[\zeta_8]/\sqrt{2}^k$ (`10,000,000+` qubits) with exact integer norm preservation.
  - Bounded-entanglement 1D non-Clifford chains with $2^n$ dense ket support route to exact Galois-companion RREF `ExactMps` over $\mathbb{Q}(\zeta_8)$ (`64–256+` qubits).
  - Continuous rotations (`rx, ry, rz, p, u, cp, rxx, rzz`) route to `ExactSparseContinuum` with `< 1e-12` analytical fidelity.
  - Non-Clifford circuits with $\ge 2$ unentangled connected components (`max_c <= 16`) factor into exact tensor products (`DisjointProductSubsystemState`, `inv017`) in $\mathcal{O}(C \cdot 2^{\max_c})$ local kets (`1,000+` qubits).
- **Host Compute Saturation (`inv017`):** Multi-circuit batches, `SamplerV2` / `EstimatorV2` PUB sweeps, and mid-circuit shot loops automatically saturate live `os.cpu_count()` host compute lanes (`max_parallel_threads` option) with 100% bit-identical seeded reproducibility, verifiable via `prove_host_saturation()`.
- **Exact Analytical Primitives V2 (`AQ-20`):** `VerdantAqmEstimatorV2(default_precision=0.0)` evaluates exact `<psi | H | psi>` expectation values over `SparsePauliOp` Hamiltonians without shot noise.
- **Pure `UORC` Wire Custody (`AQ-22`):** `VerdantAqmResult.to_uorc_bytes()` and `VerdantAqmResult.from_uorc_bytes()` seal and verify job payloads in byte-identical `b"UORC"` + 32-byte SHA-256 containers compatible with the Rust and TypeScript codecs.
- **Authoritative Upstream Oracle Verification (`AQ-21`):** Conformance-tested across 25 suites derived from upstream `Qiskit/qiskit` (`c68ee295b6fa403c67216eeb0f0fbbe12cc98b28`) locked by SHA-256 in `upstream.toml`.

## Installation

```bash
pip install -e ./python/qiskit-verdant-aqm
```

## Quickstart

```python
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import SparsePauliOp
from qiskit_verdant_aqm import (
    VerdantAqmBackend,
    VerdantAqmEstimatorV2,
    VerdantAqmProvider,
    VerdantAqmResult,
    VerdantAqmSamplerV2,
)

provider = VerdantAqmProvider()
backend = provider.get_backend("verdant_aqm_prism")

# 1. Execute a 10,000,000-qubit sparse Clifford+T+Toffoli circuit without dense allocation
n = 10_000_000
cat = QuantumCircuit(n, 3, name="cat_toffoli_10M_q")
cat.h(0)
cat.t(0)
cat.cx(0, 5_000_000)
cat.tdg(0)
cat.ccx(0, 5_000_000, n - 1)
cat.measure([0, 5_000_000, n - 1], [0, 1, 2])

result = backend.run(transpile(cat, backend=backend), shots=1024, seed_simulator=42).result()
print("10,000,000q endpoint counts:", result.get_counts())

# Seal and verify the Qiskit Result inside a pure b"UORC" SHA-256 container
uorc_archive = result.to_uorc_bytes()
restored = VerdantAqmResult.from_uorc_bytes(uorc_archive)
assert restored.get_counts() == result.get_counts()

# 2. Evaluate exact Heisenberg singlet energy <XX + YY + ZZ> = -3.0
singlet = QuantumCircuit(2)
singlet.x(0)
singlet.x(1)
singlet.h(0)
singlet.cx(0, 1)

hamiltonian = SparsePauliOp.from_list([("XX", 1.0), ("YY", 1.0), ("ZZ", 1.0)])
ev = VerdantAqmEstimatorV2(default_precision=0.0).run([(singlet, hamiltonian)]).result()[0].data.evs
print("Exact Heisenberg singlet energy:", ev)
```

## Running the Authoritative Qiskit Validation Oracle

```bash
python3 -B -m unittest discover -s python/qiskit-verdant-aqm/tests -v
```
