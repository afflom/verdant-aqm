# How-To Guide: Scale Past Dense Qubit Ceilings & Migrate from Qiskit Aer

> **Audience (`Iris` · Practitioner How-To):** Quantum algorithm engineers migrating existing `BasicSimulator` or `AerSimulator` workflows to `VerdantAqmBackend` and scaling structured circuits beyond 30 qubits.

Classical dense state-vector simulators allocate $2^n$ complex numbers ($16 \times 2^n$ bytes in `complex128`), exhausting 64 GiB of RAM at $n = 32$ qubits. `VerdantAqmBackend` eliminates hardcoded qubit ceilings by routing each `QuantumCircuit` to the algebraic substrate matching its gate set.

## Substrate Selection Matrix

| Circuit Structure | Selected Prism Substrate | Scaling Law | Representative Regime |
| :--- | :--- | :--- | :--- |
| Pure Clifford + mid-circuit `measure` / `reset` (`h, s, sdg, sx, x, y, z, cx, cz, swap, ecr`) | `StabilizerTableau` (`AQ-04`) | $\mathcal{O}(n^2 / 32)$ bit-planes & $\mathcal{O}(\text{gates})$ adjoint Pauli | `2,048+` qubits sampling; `100,000+` qubits `EstimatorV2` |
| Sparse-support Clifford + $T$ / Toffoli / Fredkin (`t, tdg, ch, ccx, cswap`) | `CyclotomicExact` (`AQ-03`) | $\mathcal{O}(|\text{supp}(\psi)|)$ in $\mathbb{Z}[\zeta_8]$ | `4,096+` qubits on sparse-ket manifolds |
| Wide dense-superposition 1D non-Clifford chains (`branching > 16`, local span) | `ExactMps` (`AQ-14`) | $\mathcal{O}(n \cdot \chi^3)$ over $\mathbb{Q}(\zeta_8)$ | `64+` qubits at full $2^{64}$ basis-ket support |
| Continuous rotations (`rx, ry, rz, p, u, rxx, rzz`) | `ExactSparseContinuum` + `AtlasHolospace` (`AQ-16`, `AQ-20`) | $\mathcal{O}(|\text{supp}(\psi)|)$ `BigInt`-indexed kets | `< 1e-12` VQE & QAOA expectations |

## Task 1: Replace `BasicSimulator` or `AerSimulator` in Existing Qiskit Code

Swap the backend import while keeping `transpile`, `QuantumCircuit`, `SamplerV2`, and `EstimatorV2` calls unchanged:

```python
from qiskit import QuantumCircuit, transpile
from qiskit_verdant_aqm import VerdantAqmBackend

backend = VerdantAqmBackend(shots=2048, seed_simulator=2026)

qc = QuantumCircuit(4, 4)
qc.h(0)
qc.cx(0, 1)
qc.ccx(0, 1, 2)
qc.cswap(2, 1, 3)
qc.measure([0, 1, 2, 3], [0, 1, 2, 3])

isa_circuit = transpile(qc, backend=backend)
result = backend.run(isa_circuit).result()
print(result.get_counts())
```

Because `VerdantAqmBackend.target` registers all 28 standard Qiskit instructions globally (`qargs = None`), `transpile(qc, backend=backend)` preserves native `ccx`, `cswap`, `ecr`, `rxx`, and `rzz` gates without decomposing across synthetic SWAP chains.

## Task 2: Execute a 4,096-Qubit Clifford+$T$ Cat Circuit

Construct a 4,096-qubit entangled GHZ state with non-Clifford $T$ gates on the boundary wires:

```python
from qiskit import QuantumCircuit
from qiskit_verdant_aqm import VerdantAqmBackend

n_qubits = 4096
qc = QuantumCircuit(n_qubits, 2, name="cat_4096q")
qc.h(0)
for q in range(n_qubits - 1):
    qc.cx(q, q + 1)
qc.t(0)
qc.t(n_qubits - 1)
qc.measure([0, n_qubits - 1], [0, 1])

res = VerdantAqmBackend(shots=1024, seed_simulator=42).run(qc).result()
print("Counts (endpoints):", res.get_counts())
print("Active sparse Z[zeta_8] kets:", res.results[0].metadata["active_kets"])
```

`VerdantAqmBackend` indexes basis kets as arbitrary-precision integers (`BigInt` in TypeScript/Wasm, `int` in Python). Only the 2 non-zero kets $|00\dots 0\rangle$ and $|11\dots 1\rangle$ are materialized, avoiding $2^{4096}$ memory allocation while preserving exact $\mathbb{Z}[\zeta_8]$ phase coherence.

## Task 3: Attach `SkWeaver` Topological Braid Certificates (`AQ-16`)

Enable `weave_atlas=True` when running continuous-angle circuits (`rx, ry, rz`) to synthesize certified $PU(22)$ Fibonacci topological braids over the 96-vertex UOR Atlas:

```python
backend = VerdantAqmBackend(weave_atlas=True)
vqe = QuantumCircuit(2, 2)
vqe.ry(0.7319, 0)
vqe.cx(0, 1)
vqe.rz(-1.1427, 1)
vqe.measure_all()

exp = backend.run(vqe, shots=512).result().results[0]
print("SkWeaver PU(22) projective residual:", exp.metadata.get("sk_weaver_max_residual"))
```

## Related Documentation

- Review exact option validators and exception rules in [`qiskit-verdant-aqm` API, Target ISA & CLI Reference](../reference/qiskit-backend-v2-and-primitives-api.md).
- Inspect worst-case exponential ket-support boundaries in [Prism Substrates, Algebraic Exactness & Honesty Gates](../explanation/prism-substrates-and-honesty-gates.md).
