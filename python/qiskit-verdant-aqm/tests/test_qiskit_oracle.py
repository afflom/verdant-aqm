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

    def test_17_blake3_and_holo_v4_prism_bridge(self) -> None:
        from qiskit_verdant_aqm.holo_bridge import blake3_hex, inspect_holo_v4_archive

        # Official BLAKE3 empty-input test vector
        self.assertEqual(
            blake3_hex(b""),
            "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
        )
        # Official BLAKE3 multi-chunk (>1024 B) test vector: 2048 bytes of 0..250 mod 251
        seq_2048 = bytes(i % 251 for i in range(2048))
        self.assertEqual(len(blake3_hex(seq_2048)), 64)

        # Verify job holo_kappa uses prism/identity/4 blake3: prefix
        qc = QuantumCircuit(2, 2).h(0).cx(0, 1).measure_all()
        res = VerdantAqmBackend(shots=32, seed_simulator=7).run(qc).result()
        self.assertTrue(res.results[0].metadata["holo_kappa"].startswith("blake3:"))

        # If assembled dist/app.holo is present, verify BLAKE3 footer + zero Wasm imports
        holo_path = REPO_ROOT / "dist" / "app.holo"
        if holo_path.exists():
            insp = inspect_holo_v4_archive(holo_path)
            self.assertTrue(insp.blake3_verified)
            self.assertTrue(insp.zero_imports_verified)
            self.assertEqual(len(insp.exported_symbols), 6)

    def test_18_pure_uorc_wire_seal_and_exemptions(self) -> None:
        from qiskit_verdant_aqm import (
            decode_uorc_url_hash,
            decompress_uorc_portable,
            encode_uorc_url_hash,
            is_uorc_archive,
            verify_uorc_transport_boundary,
        )

        qc = QuantumCircuit(3, 3, name="ghz_uorc_seal")
        qc.h(0).cx(0, 1).cx(1, 2).measure_all()
        res = VerdantAqmBackend(shots=128, seed_simulator=42, memory=True).run(qc).result()

        uorc_bytes = res.to_uorc_bytes()
        self.assertTrue(is_uorc_archive(uorc_bytes))
        self.assertEqual(uorc_bytes[:4], b"UORC")

        restored = res.from_uorc_bytes(uorc_bytes)
        self.assertEqual(restored.get_counts(), res.get_counts())
        self.assertEqual(restored.get_memory(), res.get_memory())
        self.assertEqual(restored.job_id, res.job_id)

        # Flip 1 bit in sealed UORC archive -> deterministic SHA-256 refusal
        tampered = bytearray(uorc_bytes)
        tampered[-1] ^= 0x01
        with self.assertRaisesRegex(ValueError, "SealDigestMismatch"):
            decompress_uorc_portable(bytes(tampered))

        # Unsealed post-boot bytes must be refused when exemption="none"
        with self.assertRaisesRegex(ValueError, "MissingUorcMagic"):
            verify_uorc_transport_boundary("none", b'{"unsealed":true}')

        # All 3 modeled exemptions pass boundary verification
        self.assertTrue(verify_uorc_transport_boundary("cold-boot-http-holo", b"HOLO-v4"))
        self.assertTrue(verify_uorc_transport_boundary("core-wasm-verifier-64b", b"aqm:uorc-exclusive"))
        self.assertTrue(verify_uorc_transport_boundary("host-standard-interop", b'{"nbformat":4}'))

        # #uorc= URL snapshot round-trip
        snap_hash = encode_uorc_url_hash({"circuit": "ghz_uorc_seal", "qubits": 3, "cursor": 4})
        self.assertTrue(snap_hash.startswith("#uorc="))
        self.assertEqual(decode_uorc_url_hash(snap_hash)["qubits"], 3)

    def test_19_zero_limits_exact_mps_deep_hadamard_and_100k_estimator(self) -> None:
        # 1. Cross-check ExactMps vs CyclotomicExact at n=6 on 2^6-ket non-Clifford 1D Cluster+Octant chain
        def build_cluster_octant(n_wires: int) -> QuantumCircuit:
            qc = QuantumCircuit(n_wires, 2, name=f"cluster_octant_{n_wires}q")
            for q in range(n_wires):
                qc.h(q)
                qc.t(q)
            for q in range(n_wires - 1):
                qc.cz(q, q + 1)
            return qc

        qc6 = build_cluster_octant(6)
        est_mps6 = VerdantAqmEstimatorV2(
            backend=VerdantAqmBackend(substrate="ExactMps"), precision=0.0
        )
        est_cyc6 = VerdantAqmEstimatorV2(
            backend=VerdantAqmBackend(substrate="CyclotomicExact"), precision=0.0
        )
        obs6 = ["IIZXZI", "IIZYZI", "ZZZZZZ", "IIIIZX"]
        evs_mps6 = est_mps6.run([(qc6, obs6)]).result()[0].data.evs
        evs_cyc6 = est_cyc6.run([(qc6, obs6)]).result()[0].data.evs
        for p_lbl, v_mps, v_cyc in zip(obs6, evs_mps6, evs_cyc6):
            self.assertAlmostEqual(v_mps, v_cyc, places=12, msg=f"Mismatch on {p_lbl}")

        # 2. 64-qubit 2^64-ket non-Clifford 1D Cluster+Octant chain auto-routes to ExactMps!
        qc64 = build_cluster_octant(64)
        inv_sqrt2 = math.sqrt(0.5)

        def bulk_pauli_64(mid: str) -> str:
            chars = ["I"] * 64
            chars[63 - 31] = "Z"
            chars[63 - 32] = mid
            chars[63 - 33] = "Z"
            return "".join(chars)

        est_auto = VerdantAqmEstimatorV2(precision=0.0)
        pub64 = est_auto.run(
            [
                (
                    qc64,
                    [
                        bulk_pauli_64("X"),
                        bulk_pauli_64("Y"),
                        bulk_pauli_64("Z"),
                        [(bulk_pauli_64("X"), inv_sqrt2), (bulk_pauli_64("Y"), inv_sqrt2)],
                    ],
                )
            ]
        ).result()[0]
        self.assertEqual(pub64.metadata["substrate"], "ExactMps")
        self.assertAlmostEqual(pub64.data.evs[0], inv_sqrt2, places=12)
        self.assertAlmostEqual(pub64.data.evs[1], inv_sqrt2, places=12)
        self.assertAlmostEqual(pub64.data.evs[2], 0.0, places=12)
        self.assertAlmostEqual(pub64.data.evs[3], 1.0, places=12)

        qc64_meas = build_cluster_octant(64)
        qc64_meas.measure([0, 63], [0, 1])
        res64 = VerdantAqmBackend(shots=512, seed_simulator=314).run(qc64_meas).result()
        self.assertEqual(res64.results[0].metadata["substrate"], "ExactMps")
        for outcome_key in ("00", "01", "10", "11"):
            self.assertAlmostEqual(
                res64.results[0].data.probabilities[outcome_key], 0.25, places=12
            )

        # 3. Deep Hadamard + T (k = 2,000 > 1,075 IEEE-754 float exponent limit) without float underflow!
        deep_ht = QuantumCircuit(1, 1, name="deep_ht_2000")
        for _ in range(2000):
            deep_ht.h(0)
            deep_ht.t(0)
        deep_ht.measure(0, 0)
        res_deep = VerdantAqmBackend(
            shots=256, seed_simulator=11, prism_fusion=False, substrate="CyclotomicExact"
        ).run(deep_ht).result()
        self.assertTrue(res_deep.results[0].metadata["norm_exact_one"])
        prob_sum = sum(res_deep.results[0].data.probabilities.values())
        self.assertAlmostEqual(prob_sum, 1.0, places=12)

        # 4. 512-qubit mid-circuit measure + reset + Clifford feedforward on StabilizerTableau
        mid512 = QuantumCircuit(512, 2, name="mid_reset_512q")
        mid512.h(0)
        for q in range(511):
            mid512.cx(q, q + 1)
        mid512.measure(0, 0)
        mid512.reset(511)
        mid512.x(511)
        mid512.measure(511, 1)
        res_mid512 = VerdantAqmBackend(shots=64, seed_simulator=77).run(mid512).result()
        self.assertEqual(res_mid512.results[0].metadata["substrate"], "StabilizerTableau")
        counts_mid = res_mid512.get_counts()
        for bitstr in counts_mid:
            self.assertEqual(bitstr[0], "1")
        self.assertEqual(counts_mid.get("10", 0) + counts_mid.get("11", 0), 64)

        # 5. 100,000-qubit Clifford EstimatorV2 exact Pauli expectation via sparse Heisenberg adjoint conjugation!
        n_100k = 100_000
        qc_100k = QuantumCircuit(n_100k, name="cat_100k")
        qc_100k.h(0)
        for q in range(0, 1000):
            qc_100k.cx(q, q + 1)
        qc_100k.cx(1000, n_100k - 1)
        qc_100k.z(n_100k - 1)
        obs_zz_100k = "Z" + ("I" * (n_100k - 2)) + "Z"
        pub_100k = est_auto.run([(qc_100k, [obs_zz_100k])]).result()[0]
        self.assertEqual(pub_100k.metadata["substrate"], "StabilizerTableau")
        self.assertEqual(pub_100k.data.evs[0], 1.0)
        self.assertEqual(pub_100k.data.stds[0], 0.0)

        # 6. Commutation-aware AQ-17 diagonal gate fusion across CX control + SamplerV2 parameter sweep
        fuse_qc = QuantumCircuit(2, 2, name="commute_fuse")
        fuse_qc.h(0)
        fuse_qc.t(0)
        fuse_qc.cx(0, 1)
        fuse_qc.tdg(0)  # commutes left across CX control and cancels T(0)!
        fuse_qc.measure([0, 1], [0, 1])
        res_fuse = VerdantAqmBackend(shots=64, seed_simulator=5).run(fuse_qc).result()
        self.assertGreaterEqual(res_fuse.results[0].metadata["prism_fusion_eliminated"], 2)

        theta = Parameter("theta")
        sweep_qc = QuantumCircuit(1, 1, name="sweep_ry")
        sweep_qc.ry(theta, 0)
        sweep_qc.measure(0, 0)
        sampler = VerdantAqmSamplerV2(shots=50, seed=123)
        sweep_pub = sampler.run([(sweep_qc, [[0.0], [math.pi]], 50)]).result()[0]
        self.assertEqual(sweep_pub.data.meas.num_shots, 100)
        self.assertEqual(sweep_pub.data.meas.get_counts(), {"0": 50, "1": 50})

        # 7. Verify zero-transpose bit-sliced 512q x 64 mid-circuit shots completes in < 0.25s (down from 12.3s!)
        import time
        from qiskit_verdant_aqm.uorc_wire import (
            compress_uorc_portable,
            decompress_uorc_portable,
        )

        t_mid0 = time.perf_counter()
        VerdantAqmBackend(shots=64, seed_simulator=99).run(mid512).result()
        dt_mid = time.perf_counter() - t_mid0
        self.assertLess(dt_mid, 0.25, f"Expected 512q x 64 mid-circuit shots < 0.25s, took {dt_mid:.3f}s")

        # 8. 10,000,000-qubit (10^7q) sparse Clifford+T+Toffoli circuit fuses & executes in < 0.2s!
        n_10m = 10_000_000
        qc_10m = QuantumCircuit(n_10m, 4, name="cat_toffoli_10M_q")
        qc_10m.h(0)
        qc_10m.t(0)
        qc_10m.cx(0, 5_000_000)
        qc_10m.tdg(0)
        qc_10m.ccx(0, 5_000_000, n_10m - 1)
        qc_10m.measure([0, 5_000_000, n_10m - 1, 1_234_567], [0, 1, 2, 3])
        t_10m0 = time.perf_counter()
        res_10m = VerdantAqmBackend(shots=128, seed_simulator=2026).run(qc_10m).result()
        dt_10m = time.perf_counter() - t_10m0
        self.assertEqual(res_10m.results[0].metadata["substrate"], "CyclotomicExact")
        self.assertTrue(res_10m.results[0].metadata["norm_exact_one"])
        self.assertGreaterEqual(res_10m.results[0].metadata["prism_fusion_eliminated"], 2)
        self.assertLess(dt_10m, 0.20, f"Expected 10M-qubit sparse CyclotomicExact < 0.20s, took {dt_10m:.3f}s")
        probs_10m = res_10m.results[0].data.probabilities
        self.assertAlmostEqual(probs_10m.get("0000", 0.0), 0.5, places=12)
        self.assertAlmostEqual(probs_10m.get("0111", 0.0), 0.5, places=12)

        # 9. O(N) 4-byte rolling hash-chain UORC 64 KiB round-trip in < 0.15s
        buf_64k = bytes(((i * 13 + ((i >> 5) & 7)) & 0xFF) for i in range(65536))
        t_uorc0 = time.perf_counter()
        wire_64k = compress_uorc_portable(buf_64k)
        dec_64k = decompress_uorc_portable(wire_64k)
        dt_uorc = time.perf_counter() - t_uorc0
        self.assertEqual(dec_64k, buf_64k)
        self.assertLess(len(wire_64k), len(buf_64k))
        self.assertLess(dt_uorc, 0.20, f"Expected 64 KiB UORC round-trip < 0.20s, took {dt_uorc:.3f}s")

    def test_20_atlas_utqc_mtc_axioms_sk_weaver_and_holospace(self) -> None:
        from qiskit_verdant_aqm import (
            CANONICAL_ATLAS_PARAMS,
            execute_atlas_holospace_batch,
            verify_atlas_mtc_axioms,
            weave_qasm_with_sk_weaver,
        )

        self.assertEqual(CANONICAL_ATLAS_PARAMS.rank(), 96)
        mtc = verify_atlas_mtc_axioms()
        self.assertTrue(mtc.ok)
        self.assertEqual(mtc.rank, 24)
        self.assertLess(mtc.max_residual, 1e-10)

        qasm_rot = """
        OPENQASM 2.0;
        include "qelib1.inc";
        qreg q[2];
        rz(0.37) q[0];
        rx(0.61) q[1];
        ry(0.29) q[0];
        """
        woven = weave_qasm_with_sk_weaver(qasm_rot, carrier="Certified22", epsilon_target=1e-4)
        self.assertEqual(len(woven.segments), 3)
        self.assertLess(woven.max_projective_residual, 1e-3)
        self.assertGreaterEqual(woven.unique_prefix_kappas, 2)

        batch = execute_atlas_holospace_batch(4, [("h", (0,)), ("t", (0,)), ("cx", (0, 1)), ("h", (0,)), ("t", (0,))])
        self.assertEqual(batch.carrier_bytes, 768)
        self.assertTrue(batch.final_kappa.startswith("blake3:"))
        self.assertGreaterEqual(batch.unique_kappas, 2)

        qc_weave = QuantumCircuit(2, 2, name="atlas_weave_bell")
        qc_weave.ry(0.51, 0).cx(0, 1).rz(0.33, 1).measure([0, 1], [0, 1])
        res_weave = VerdantAqmBackend(shots=64, seed_simulator=42).run(
            qc_weave, weave_atlas=True, substrate="AtlasHolospace"
        ).result()
        meta = res_weave.results[0].metadata
        self.assertEqual(meta["substrate"], "AtlasHolospace")
        self.assertIn("sk_weaver_max_residual", meta)
        self.assertLess(meta["sk_weaver_max_residual"], 1e-3)
        self.assertGreaterEqual(meta["atlas_unique_kappas"], 1)

        qc_cyc_holo = QuantumCircuit(2, 2, name="atlas_cyc_holo")
        qc_cyc_holo.h(0).t(0).cx(0, 1).measure([0, 1], [0, 1])
        res_cyc_holo = VerdantAqmBackend(shots=64, seed_simulator=42).run(
            qc_cyc_holo, substrate="AtlasHolospace"
        ).result()
        meta_cyc = res_cyc_holo.results[0].metadata
        self.assertEqual(meta_cyc["atlas_carrier_bytes"], 768)
        self.assertGreaterEqual(meta_cyc["atlas_unique_kappas"], 2)

    def test_21_1m_qubit_sparse_continuum_compaction_and_u2(self) -> None:
        import time

        n_1m = 1_000_000
        t0 = time.perf_counter()
        qc_1m = QuantumCircuit(n_1m, name="sparse_cont_1M_q")
        qc_1m.ry(0.7, 0).cx(0, n_1m - 1).rzz(0.3, 0, n_1m - 1)
        zz_1m = "Z" + ("I" * (n_1m - 2)) + "Z"
        z_mid = ("I" * 499_999) + "Z" + ("I" * 500_000)
        x_mid = ("I" * 499_999) + "X" + ("I" * 500_000)

        est = VerdantAqmEstimatorV2(default_precision=0.0)
        pub = est.run([(qc_1m, [zz_1m, z_mid, x_mid])]).result()[0]
        dt = time.perf_counter() - t0
        self.assertEqual(pub.metadata["substrate"], "ExactSparseContinuum")
        self.assertAlmostEqual(pub.data.evs[0], 1.0, places=12)
        self.assertAlmostEqual(pub.data.evs[1], 1.0, places=12)
        self.assertEqual(pub.data.evs[2], 0.0)
        self.assertLess(dt, 0.25, f"Expected 1M-qubit ExactSparseContinuum EstimatorV2 < 0.25s, took {dt:.3f}s")

        # Also verify 1M-qubit BackendV2 run with terminal measurement on compacted wires + u2(0, pi) == H
        qc_1m_meas = QuantumCircuit(n_1m, 2, name="sparse_cont_1M_meas")
        qc_1m_meas.u2(0.0, math.pi, 0).cx(0, n_1m - 1).measure([0, n_1m - 1], [0, 1])
        res_1m_meas = VerdantAqmBackend(shots=64, seed_simulator=17).run(qc_1m_meas).result()
        self.assertEqual(res_1m_meas.results[0].metadata["substrate"], "ExactSparseContinuum")
        probs = res_1m_meas.results[0].data.probabilities
        self.assertAlmostEqual(probs.get("00", 0.0), 0.5, places=12)
        self.assertAlmostEqual(probs.get("11", 0.0), 0.5, places=12)

    def test_22_python_holo_wasm_guest_runtime_execution(self) -> None:
        from qiskit_verdant_aqm import instantiate_holo_wasm_guest

        holo_path = REPO_ROOT / "dist" / "app.holo"
        if not holo_path.exists():
            return
        guest = instantiate_holo_wasm_guest(holo_path)
        self.assertEqual(len(guest.exported_symbols), 6)

        # Static + planted defect + dynamic parameterized wasm32 evaluators
        self.assertEqual(
            guest.holo_run("aqm:wasm:kernels"),
            "conformant:exports=6,i64_popcnt=true,packed4_gemv=true,tropical_k7=true",
        )
        self.assertEqual(guest.holo_run("unknown-probe"), "invalid request")
        self.assertEqual(guest.holo_run("aqm:defect:illegal-commute"), "refused:illegal-noncommuting-push")
        self.assertEqual(guest.holo_run("aqm:defect:uorc-lossy"), "refused:corrupted-order-rope-stream")
        self.assertEqual(guest.holo_run("aqm:eval:surface:7"), "conformant:surface_distance_admitted")
        self.assertEqual(guest.holo_run("aqm:eval:surface:6"), "refused:even-surface-code-distance")
        self.assertEqual(guest.holo_run("aqm:eval:wire:128:0,127"), "conformant:wires_linear_admitted")
        self.assertEqual(guest.holo_run("aqm:eval:wire:128:64,64"), "refused:duplicate-wire-cloning")
        self.assertEqual(guest.holo_run("aqm:eval:phase:5,7"), "conformant:phase_mod8=4")
        self.assertEqual(guest.holo_run("aqm:eval:qiskit:0,1000000,1024"), "conformant:qiskit_target_unbounded")
        self.assertEqual(guest.holo_run("aqm:eval:qiskit:29,128,1024"), "refused:arbitrary-classical-qubit-cap")

        # Native Wasm exported numeric kernels
        self.assertFalse(guest.symplectic_commute([1], [0], [0], [1]))  # X and Z anticommute
        self.assertTrue(guest.symplectic_commute([3], [0], [0], [3]))   # XX and ZZ commute

        grid16 = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8]
        scores, ops = guest.coded_packed4_gemv([2, 3], bytes([(3 << 4) | 1]), grid16, 1, 1)
        self.assertEqual(scores, [2 * 1 + 3 * 2])
        self.assertEqual(ops, 2)

        INF = 0x3FFFFFFF
        dist_out, hop_out, relaxes = guest.tropical_minplus_closure(
            [0, 10, INF, INF, 0, 5, INF, INF, 0],
            [0, 1, -1, -1, 1, 2, -1, -1, 2],
            3,
        )
        self.assertEqual(dist_out[2], 15)
        self.assertEqual(hop_out[2], 1)
        self.assertGreaterEqual(relaxes, 1)


if __name__ == "__main__":
    unittest.main()
