# Tutorial: Run Your First Unbounded Qiskit Circuit on `VerdantAqmBackend`

> **Audience (`Kai` · Newcomer Tutorial):** Quantum programmers installing `qiskit-verdant-aqm` or opening the browser Jupyter lab for the first time.

In this tutorial, you will instantiate `VerdantAqmBackend` (`AQ-19`), execute a 3-qubit GHZ+$T$ circuit, inspect little-endian `get_counts()` and per-shot `get_memory()`, and compute exact Pauli expectations with `VerdantAqmEstimatorV2` (`AQ-20`).

## Prerequisites

- Python `3.10+` with `qiskit>=1.0` (or the in-browser **Qiskit & Notebooks** workspace in `verdant-aqm`).
- Install the local Python package in editable mode:

```bash
pip install -e ./python/qiskit-verdant-aqm
```

## Step 1: Inspect the Unbounded Backend and Target

Create a Python script or Jupyter cell that loads `VerdantAqmProvider` and queries `VerdantAqmBackend`:

```python
from qiskit import QuantumCircuit
from qiskit_verdant_aqm import VerdantAqmProvider

provider = VerdantAqmProvider()
backend = provider.get_backend("verdant_aqm_prism")

print("Backend:", backend.name, backend.backend_version)
print("Unbounded num_qubits:", backend.num_qubits)
print("Supported operations:", len(backend.target.operation_names))
```

Expected output:

```text
Backend: verdant_aqm_prism 0.3.0
Unbounded num_qubits: None
Supported operations: 28
```

Notice that `backend.num_qubits` is `None` and `backend.coupling_map` is `None`. Unlike hardware-emulated backends capped at 28 or 32 dense state-vector wires, `VerdantAqmBackend` accepts any positive wire count $n \ge 1$ with all-to-all connectivity.

## Step 2: Build and Run a 3-Qubit GHZ + $T$ Circuit

Construct a 3-qubit GHZ state decorated with an octant $T$ phase gate and redundant $T^8 = I$ gates to observe Prism `AQ-17` gate fusion:

```python
qc = QuantumCircuit(3, 3, name="ghz_octant")
qc.h(0)
qc.cx(0, 1)
qc.cx(1, 2)
for _ in range(9):
    qc.t(2)  # 9 T gates fuse algebraically in Z_8 to a single T gate!
qc.measure([0, 1, 2], [0, 1, 2])

job = backend.run(qc, shots=1024, seed_simulator=42, memory=True)
result = job.result()
print("Counts:", result.get_counts())
print("First 4 shots:", result.get_memory()[:4])
print("Metadata:", result.results[0].metadata)
```

Expected output:

- `result.get_counts()` contains only `'000'` and `'111'` drawn from exact $\mathbb{Z}[\zeta_8]/\sqrt{2}^k$ amplitudes (`AQ-03`).
- `metadata["prism_fusion_eliminated"]` reports `8` eliminated gates (`AQ-17`).
- `metadata["norm_exact_one"]` is `True`, confirming zero floating-point amplitude drift.

## Step 3: Evaluate Exact Analytical Pauli Expectations (`EstimatorV2`)

Use `VerdantAqmEstimatorV2` with `precision=0.0` to compute exact expectation values without shot noise:

```python
from qiskit.quantum_info import SparsePauliOp
from qiskit_verdant_aqm import VerdantAqmEstimatorV2

bell = QuantumCircuit(2, name="phi_plus")
bell.h(0)
bell.cx(0, 1)

hamiltonian = SparsePauliOp.from_list([("ZZ", 1.0), ("XX", 1.0), ("YY", -1.0)])
estimator = VerdantAqmEstimatorV2(default_precision=0.0)
pub_result = estimator.run([(bell, hamiltonian)]).result()[0]

print("Exact <ZZ + XX - YY>:", pub_result.data.evs)  # 3.0
print("Standard error:", pub_result.data.stds)       # 0.0
```

Because $|\Phi^+\rangle = \frac{|00\rangle + |11\rangle}{\sqrt{2}}$ is a simultaneous $+1$ eigenstate of $ZZ$, $XX$, and $-YY$, `pub_result.data.evs` evaluates to `3.0` with `0.0` variance.

## Next Steps

- Continue to [Scale Past Dense Qubit Ceilings & Migrate from Aer](../how-to/unbounded-megascale-and-aer-migration.md) to run 4,096-qubit cat states and 2,048-qubit stabilizer circuits.
- Consult the [`qiskit-verdant-aqm` API, Target ISA & CLI Reference](../reference/qiskit-backend-v2-and-primitives-api.md) for all 28 target instructions and option bounds.
