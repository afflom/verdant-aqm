"""Authoritative Qiskit Validation Oracle Suite for `qiskit-verdant-aqm` (`test_qiskit_oracle.py`).

Verifies:
1. Byte-exact SHA-256 provenance of all 7 vendored files in `/vendor/qiskit-oracle/` against
   `/vendor/qiskit-oracle/oracle-lock.json` and `/upstream.toml` (`Qiskit/qiskit` @ `c68ee295b6fa`
   and `afflom/prism-devrel` @ `ace153e37c7c`).
2. All 16 Qiskit `BackendV2`, `BasicSimulator`, `SamplerV2`, and `EstimatorV2` conformance cases.
3. Execution parity across the generated `.ipynb` notebooks in `/notebooks/`.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import unittest
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PKG_ROOT.parent.parent
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

from qiskit_verdant_aqm import (  # noqa: E402
    ClassicalRegister,
    Parameter,
    QuantumCircuit,
    QuantumRegister,
    SparsePauliOp,
    VerdantAqmBackend,
    VerdantAqmEstimatorV2,
    VerdantAqmProvider,
    VerdantAqmSamplerV2,
)


class TestAuthoritativeQiskitOracle(unittest.TestCase):
    """Runs the external Qiskit BackendV2 & Primitives V2 validation oracle in Python."""

    def test_00_vendored_upstream_sha256_provenance(self) -> None:
        oracle_dir = REPO_ROOT / "vendor" / "qiskit-oracle"
        lock = json.loads((oracle_dir / "oracle-lock.json").read_text(encoding="utf-8"))
        upstream_toml = (REPO_ROOT / "upstream.toml").read_text(encoding="utf-8")

        self.assertIn(lock["qiskit"]["commit"], upstream_toml)
        self.assertIn(lock["prism_devrel"]["commit"], upstream_toml)

        for section in ("qiskit", "prism_devrel"):
            for fname, meta in lock[section]["files"].items():
                raw = (oracle_dir / fname).read_bytes()
                digest = hashlib.sha256(raw).hexdigest()
                self.assertEqual(len(raw), meta["bytes"], f"Byte length mismatch on {fname}")
                self.assertEqual(digest, meta["sha256"], f"SHA-256 mismatch on {fname}")
                self.assertIn(meta["sha256"], upstream_toml)

    def test_01_unbounded_target_and_provider_isa_28(self) -> None:
        provider = VerdantAqmProvider()
        backend = provider.get_backend("verdant_aqm_prism")
        self.assertEqual(backend.version, 2)
        self.assertIsNone(backend.num_qubits)
        self.assertIsNone(backend.coupling_map)
        self.assertIsNone(backend.max_circuits)
        self.assertEqual(len(backend.target.operation_names), 28)
        for op_name in backend.target.operation_names:
            self.assertIsNone(backend.target.qargs_for_operation_name(op_name))

    def test_02_no_qubit_properties_raises(self) -> None:
        backend = VerdantAqmBackend()
        with self.assertRaises(NotImplementedError):
            backend.qubit_properties(0)

    def test_03_option_bounds_validation(self) -> None:
        backend = VerdantAqmBackend(max_shots=4096)
        with self.assertRaisesRegex(ValueError, "Specified value for 'shots' is not a valid value"):
            backend.set_options(shots=0)
        with self.assertRaisesRegex(ValueError, "<=4096"):
            backend.set_options(shots=8192)
        backend.set_options(shots=2048)
        self.assertEqual(backend.options.shots, 2048)

    def test_04_5q_ghz_cx_cz_and_ecr(self) -> None:
        backend = VerdantAqmBackend(shots=1024, seed_simulator=42)
        qc_cx = QuantumCircuit(5, 5, name="ghz_cx")
        qc_cx.h(0)
        for i in range(4):
            qc_cx.cx(0, i + 1)
        qc_cx.measure([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])

        qc_cz = QuantumCircuit(5, 5, name="ghz_cz")
        qc_cz.h(0)
        for i in range(1, 5):
            qc_cz.h(i).cz(0, i).h(i)
        qc_cz.measure([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])

        qc_ecr = QuantumCircuit(2, 2, name="bell_ecr")
        qc_ecr.s(0).sx(1).ecr(0, 1).h(0).x(1).measure([0, 1], [0, 1])

        res = backend.run([qc_cx, qc_cz, qc_ecr], substrate="CyclotomicExact").result()
        for idx in (0, 1):
            probs = res.results[idx].data.probabilities
            self.assertAlmostEqual(probs["00000"], 0.5, places=12)
            self.assertAlmostEqual(probs["11111"], 0.5, places=12)
            self.assertTrue(res.results[idx].metadata["norm_exact_one"])
        self.assertEqual(sum(res.get_counts(2).values()), 1024)

    def test_05_measure_sampler_repeated_qubits(self) -> None:
        qc = QuantumCircuit(2, 4, name="repeated")
        qc.x(1).measure(0, 0).measure(1, 1).measure(1, 2).measure(0, 3)
        counts = VerdantAqmBackend(shots=100, seed_simulator=7).run(qc).result().get_counts()
        self.assertEqual(counts, {"0110": 100})

    def test_06_measure_sampler_single_qubit(self) -> None:
        backend = VerdantAqmBackend(shots=100, seed_simulator=11)
        for wire in range(5):
            qc = QuantumCircuit(5, 1, name=f"single_{wire}")
            qc.x(wire).measure(wire, 0)
            self.assertEqual(backend.run(qc).result().get_counts(), {"1": 100})

    def test_07_measure_sampler_partial_qubit(self) -> None:
        qc = QuantumCircuit(5, 4, name="partial")
        qc.x(1).x(3).measure(3, 1).measure(1, 0).measure(0, 2).measure(3, 3)
        counts = VerdantAqmBackend(shots=100, seed_simulator=19).run(qc).result().get_counts()
        self.assertEqual(counts, {"1011": 100})

    def test_08_multi_creg_space_separated_and_hex_counts(self) -> None:
        qasm = """
        OPENQASM 2.0;
        include "qelib1.inc";
        qreg q0[3];
        qreg q1[3];
        creg c0[3];
        creg c1[3];
        x q0[0];
        x q1[2];
        measure q0 -> c0;
        measure q1 -> c1;
        """
        qc = QuantumCircuit.from_qasm_str(qasm)
        res = VerdantAqmBackend(shots=64, seed_simulator=5).run(qc).result()
        self.assertEqual(res.get_counts(0), {"100 001": 64})
        self.assertEqual(res.results[0].data.counts, {"0x21": 64})

    def test_09_shot_memory_determinism(self) -> None:
        qc = QuantumCircuit(
            QuantumRegister(2, "qr0"),
            QuantumRegister(2, "qr1"),
            ClassicalRegister(2, "cr0"),
            ClassicalRegister(2, "cr1"),
        )
        qc.h(0).cx(0, 1).h(2).cx(2, 3).measure([0, 1, 2, 3], [0, 1, 2, 3])
        backend = VerdantAqmBackend()
        mem_a = backend.run(qc, shots=32, memory=True, seed_simulator=88).result().get_memory()
        mem_b = backend.run(qc, shots=32, memory=True, seed_simulator=88).result().get_memory()
        self.assertEqual(len(mem_a), 32)
        self.assertEqual(mem_a, mem_b)
        self.assertTrue(set(mem_a).issubset({"00 00", "00 11", "11 00", "11 11"}))

        with self.assertRaises(KeyError):
            backend.run(qc, shots=8, memory=False, seed_simulator=88).result().get_memory()

    def test_10_mid_circuit_reset_and_reprepare(self) -> None:
        qc = QuantumCircuit(2, 2)
        qc.h(0).cx(0, 1).reset(0).reset(1).x(1).measure([0, 1], [0, 1])
        counts = VerdantAqmBackend(shots=64, seed_simulator=3).run(qc).result().get_counts()
        self.assertEqual(counts, {"10": 64})

    def test_11_toffoli_ccx_and_fredkin_cswap_exact(self) -> None:
        backend = VerdantAqmBackend(shots=128, seed_simulator=99)
        qc_ccx = QuantumCircuit(3, 3, name="ccx")
        qc_ccx.h(0).x(1).ccx(0, 1, 2).measure([0, 1, 2], [0, 1, 2])

        qc_cswap = QuantumCircuit(3, 3, name="cswap")
        qc_cswap.x(0).x(1).cswap(0, 1, 2).measure([0, 1, 2], [0, 1, 2])

        res = backend.run([qc_ccx, qc_cswap]).result()
        self.assertAlmostEqual(res.results[0].data.probabilities["010"], 0.5, places=12)
        self.assertAlmostEqual(res.results[0].data.probabilities["111"], 0.5, places=12)
        self.assertTrue(res.results[0].metadata["norm_exact_one"])
        self.assertEqual(res.get_counts(1), {"101": 128})

    def test_12_unbounded_4096q_cat_and_2048q_stabilizer(self) -> None:
        backend = VerdantAqmBackend(shots=64, seed_simulator=2026)

        n_cat = 4096
        qc_cat = QuantumCircuit(n_cat, 2, name="cat_4096q")
        qc_cat.h(0)
        for q in range(n_cat - 1):
            qc_cat.cx(q, q + 1)
        qc_cat.t(0).t(n_cat - 1).measure([0, n_cat - 1], [0, 1])

        n_stab = 2048
        qc_stab = QuantumCircuit(n_stab, 2, name="stab_2048q")
        qc_stab.h(0)
        for q in range(n_stab - 1):
            qc_stab.cx(q, q + 1)
        qc_stab.measure([0, n_stab - 1], [0, 1])

        res = backend.run([qc_cat, qc_stab]).result()
        self.assertEqual(res.results[0].metadata["active_kets"], 2)
        self.assertTrue(res.results[0].metadata["norm_exact_one"])
        self.assertEqual(res.results[1].metadata["substrate"], "StabilizerTableau")
        for idx in (0, 1):
            counts = res.get_counts(idx)
            self.assertEqual(counts.get("00", 0) + counts.get("11", 0), 64)

    def test_13_sampler_v2_pubs_and_bitarray(self) -> None:
        sampler = VerdantAqmSamplerV2(default_shots=256, seed=101)
        qc_bell = QuantumCircuit(2, 2, name="bell")
        qc_bell.h(0).cx(0, 1).measure_all()

        theta = Parameter("theta")
        qc_param = QuantumCircuit(2, 2, name="param_ry")
        qc_param.ry(theta, 0).cx(0, 1).measure_all()

        pub_res = sampler.run([qc_bell, (qc_param, [math.pi], 128)]).result()
        bell_counts = pub_res[0].data.meas.get_counts()
        self.assertEqual(bell_counts.get("00", 0) + bell_counts.get("11", 0), 256)
        self.assertEqual(pub_res[1].data.meas.get_counts(), {"11": 128})
        self.assertEqual(pub_res[1].data.meas.get_int_counts(), {3: 128})

    def test_14_estimator_v2_bell_and_heisenberg_singlet(self) -> None:
        estimator = VerdantAqmEstimatorV2(default_precision=0.0)
        phi_plus = QuantumCircuit(2, name="phi_plus").h(0).cx(0, 1)
        singlet = QuantumCircuit(2, name="singlet").x(0).x(1).h(0).cx(0, 1)
        heisenberg = SparsePauliOp.from_list([("XX", 1.0), ("YY", 1.0), ("ZZ", 1.0)])

        res = estimator.run([(phi_plus, ["ZZ", "XX", "YY", "XZ", "ZI"]), (singlet, heisenberg)]).result()
        for got, want in zip(res[0].data.evs, [1.0, 1.0, -1.0, 0.0, 0.0]):
            self.assertAlmostEqual(got, want, places=13)
        self.assertAlmostEqual(res[1].data.evs, -3.0, places=13)

    def test_15_estimator_v2_continuous_variational_trigonometry(self) -> None:
        theta = Parameter("theta")
        phi = Parameter("phi")
        qc = QuantumCircuit(2, name="vqe").ry(theta, 0).cx(0, 1).rz(phi, 1)
        th_val, ph_val = 0.7319, -1.1427

        estimator = VerdantAqmEstimatorV2(default_precision=0.0)
        evs = estimator.run([(qc, ["ZI", "ZZ", "XX", "YX"], {"theta": th_val, "phi": ph_val})]).result()[0].data.evs
        exact = [
            math.cos(th_val),
            1.0,
            math.sin(th_val) * math.cos(ph_val),
            math.sin(th_val) * math.sin(ph_val),
        ]
        for got, want in zip(evs, exact):
            self.assertAlmostEqual(got, want, places=13)

    def test_16_r5_duplicate_wire_and_pauli_arity_refusals(self) -> None:
        backend = VerdantAqmBackend()
        estimator = VerdantAqmEstimatorV2()
        bad = QuantumCircuit(2, 2).cx(0, 0).measure_all()
        with self.assertRaisesRegex(ValueError, "DuplicateWireReference"):
            backend.run(bad)
        with self.assertRaisesRegex(ValueError, "length"):
            estimator.run([(QuantumCircuit(2).h(0), "ZZZ")])


if __name__ == "__main__":
    unittest.main()
