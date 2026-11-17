# `qiskit-verdant-aqm` — Unbounded Prism-Verified Qiskit `BackendV2` & Primitives V2

`qiskit-verdant-aqm` publishes the production Qiskit `BackendV2` (`VerdantAqmBackend`), `VerdantAqmProvider`, `VerdantAqmSamplerV2`, and `VerdantAqmEstimatorV2` implementations of **Verdant AQM** (Abstract Quantum Machine).

## Core Architectural Guarantees

- **Zero Arbitrary Qubit Ceilings (`AQ-19`):** `backend.num_qubits` is `None` and `backend.coupling_map` is `None`. Circuits are never truncated at dense $2^{28}$ or $2^{32}$ array ceilings.
- **Dynamic Multi-Substrate Routing (`AQ-03`, `AQ-04`, `AQ-14`, `AQ-16`):**
  - Pure Clifford circuits route to packed arbitrary-width bit-plane $\mathbb{F}_2$ `StabilizerTableau` (`2,048+` qubits).
  - Clifford+$T$, Toffoli (`ccx`), and Fredkin (`cswap`) circuits route to arbitrary-precision sparse cyclotomic rings $\mathbb{Z}[\zeta_8]/\sqrt{2}^k$ (`4,096+` qubits on sparse-ket states) with exact integer norm preservation.
  - Continuous rotations (`rx, ry, rz, p, u, rxx, rzz`) route to `ExactSparseContinuum` with `< 1e-12` analytical fidelity.
- **Exact Analytical Primitives V2 (`AQ-20`):** `VerdantAqmEstimatorV2(default_precision=0.0)` evaluates exact `<psi | H | psi>` expectation values over `SparsePauliOp` Hamiltonians without shot noise.
- **Authoritative Upstream Oracle Verification (`AQ-21`):** Conformance-tested against upstream `Qiskit/qiskit` (`c68ee295b6fa403c67216eeb0f0fbbe12cc98b28`) test suites locked by SHA-256 in `upstream.toml`.

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
    VerdantAqmSamplerV2,
)

provider = VerdantAqmProvider()
backend = provider.get_backend("verdant_aqm_prism")

# 1. Execute a 4,096-qubit Clifford+T cat circuit without 2^4096 dense allocation
n = 4096
cat = QuantumCircuit(n, 2, name="cat_4096q")
cat.h(0)
for q in range(n - 1):
    cat.cx(q, q + 1)
cat.t(0)
cat.t(n - 1)
cat.measure([0, n - 1], [0, 1])

result = backend.run(transpile(cat, backend=backend), shots=1024, seed_simulator=42).result()
print("4,096q endpoint counts:", result.get_counts())

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
python3 -m unittest discover -s python/qiskit-verdant-aqm/tests -v
```
