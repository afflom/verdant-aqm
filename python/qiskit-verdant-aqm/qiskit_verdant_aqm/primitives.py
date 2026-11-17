"""Qiskit Primitives V2 (`VerdantAqmSamplerV2` & `VerdantAqmEstimatorV2`) (`primitives.py`).

Implements `AQ-20` (`qiskit_primitives_v2_exact`):
- `VerdantAqmSamplerV2`: PUB execution, parameter binding sweeps, and `BitArray` containers.
- `VerdantAqmEstimatorV2`: Exact analytical (`precision=0.0`, zero shot variance) and shot-sampled
  (`precision>0.0`) `<psi | H | psi>` expectations over little-endian `SparsePauliOp` Hamiltonians.
"""

from __future__ import annotations

import math
import random
import re
from dataclasses import dataclass
from typing import Any, Sequence

_NON_IDENTITY_PAULI_RE = re.compile(r"[^I]")

from .backend import (
    ExactMpsTensorTrain,
    PackedStabilizerTableau,
    VerdantAqmBackend,
    compute_exact_mps_pauli_expectation,
    normalize_circuit,
)
from .holo_bridge import compute_job_kappa


class BitArray:
    """Qiskit Primitives V2 `BitArray` container (`get_counts`, `get_int_counts`, `get_bitstrings`)."""

    def __init__(self, bitstrings: Sequence[str], num_bits: int) -> None:
        self._bitstrings = [s.replace(" ", "") for s in bitstrings]
        self.num_shots = len(self._bitstrings)
        self.num_bits = int(num_bits)

    def get_counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for bs in self._bitstrings:
            out[bs] = out.get(bs, 0) + 1
        return out

    def get_int_counts(self) -> dict[int, int]:
        out: dict[int, int] = {}
        for bs in self._bitstrings:
            val = int(bs, 2) if bs else 0
            out[val] = out.get(val, 0) + 1
        return out

    def get_bitstrings(self) -> list[str]:
        return list(self._bitstrings)


class SparsePauliOp:
    """Qiskit-compatible `SparsePauliOp` (`from_list([("ZZ", 1.0), ...])`)."""

    def __init__(self, labels: Sequence[str], coeffs: Sequence[float | complex] | None = None) -> None:
        if coeffs is None:
            coeffs = [1.0] * len(labels)
        if len(labels) != len(coeffs):
            raise ValueError("SparsePauliOp labels and coeffs length mismatch.")
        self.paulis = [str(lbl).upper() for lbl in labels]
        self.coeffs = [float(c.real if hasattr(c, "real") else c) for c in coeffs]

    @classmethod
    def from_list(cls, items: Sequence[tuple[str, float | complex]]) -> SparsePauliOp:
        return cls([lbl for lbl, _ in items], [c for _, c in items])

    def to_list(self) -> list[tuple[str, float]]:
        return list(zip(self.paulis, self.coeffs))


@dataclass
class DataBin:
    meas: BitArray | None = None
    c: BitArray | None = None
    evs: float | list[float] | None = None
    stds: float | list[float] | None = None


@dataclass
class PubResult:
    data: DataBin
    metadata: dict[str, Any]


class PrimitiveResult(list[PubResult]):
    """Indexable `PrimitiveResult` list returned by `SamplerV2` and `EstimatorV2` jobs."""


class _PrimitiveJob:
    def __init__(self, job_id: str, results: list[PubResult]) -> None:
        self._job_id = job_id
        self._results = PrimitiveResult(results)

    def job_id(self) -> str:
        return self._job_id

    def status(self) -> str:
        return "DONE"

    def done(self) -> bool:
        return True

    def result(self) -> PrimitiveResult:
        return self._results


def _normalize_param_sweeps(param_names: list[str], raw_values: Any) -> list[dict[str, float]]:
    if raw_values is None:
        return [{}]
    if isinstance(raw_values, dict):
        return [{str(k): float(v) for k, v in raw_values.items()}]
    seq = list(raw_values)
    if not seq:
        return [{}]
    if isinstance(seq[0], (list, tuple)):
        return [
            {name: float(vec[idx]) for idx, name in enumerate(param_names)}
            for vec in seq
        ]
    return [{name: float(seq[idx]) for idx, name in enumerate(param_names)}]


def _compute_pauli_expectation_sparse(
    state: dict[int, complex], num_qubits: int, pauli_label: str
) -> float:
    p_str = pauli_label.strip().upper()
    if len(p_str) != num_qubits:
        raise ValueError(
            f"Pauli observable '{p_str}' length ({len(p_str)}) must equal circuit num_qubits ({num_qubits})."
        )
    wire_to_compact: dict[int, int] | None = getattr(state, "wire_to_compact", None)
    flip_mask = 0
    z_mask = 0
    y_count = 0
    # Qiskit little-endian Pauli convention: right-most char acts on q[0]!
    for m in _NON_IDENTITY_PAULI_RE.finditer(p_str):
        idx = m.start()
        ch = m.group(0)
        q = num_qubits - 1 - idx
        if wire_to_compact is not None:
            c_wire = wire_to_compact.get(q)
            if c_wire is None:
                # Untouched wire remains in |0>: <0|X|0> = <0|Y|0> = 0, <0|Z|0> = +1
                if ch in ("X", "Y"):
                    return 0.0
                if ch == "Z":
                    continue
                raise ValueError(f"Unsupported Pauli character '{ch}' in '{p_str}'.")
            bit = 1 << c_wire
        else:
            bit = 1 << q

        if ch == "X":
            flip_mask |= bit
        elif ch == "Z":
            z_mask |= bit
        elif ch == "Y":
            flip_mask |= bit
            z_mask |= bit
            y_count += 1
        else:
            raise ValueError(f"Unsupported Pauli character '{ch}' in '{p_str}'.")

    # Y|b> = i * (-1)^b |b ^ 1>; across y_count Y gates, global factor is i^(y_count)
    i_phase = (1 + 0j, 1j, -1 + 0j, -1j)[y_count & 3]
    acc = 0.0
    for ket, amp in state.items():
        partner = ket ^ flip_mask
        bra = state.get(partner)
        if bra is None:
            continue
        parity = (ket & z_mask).bit_count() & 1
        sign = -1.0 if parity else 1.0
        term = bra.conjugate() * (sign * i_phase * amp)
        acc += term.real
    return acc


def _compute_pauli_expectation_clifford_adjoint(
    steps: Sequence[tuple[str, tuple[int, ...]]],
    num_qubits: int,
    pauli_label: str,
) -> float:
    """Exact `O(|gates| + |support|)` Heisenberg adjoint Pauli conjugator (`<0 | U^dagger P U | 0>`).

    Evaluates 100,000+ qubit Clifford `SparsePauliOp` observables in milliseconds without `n x n` tableau allocation!
    """
    p_str = pauli_label.strip().upper()
    if len(p_str) != num_qubits:
        raise ValueError(f"Pauli observable '{p_str}' length ({len(p_str)}) != {num_qubits}")

    # Sparse active wire dictionaries so even 100,000-qubit observables with sparse non-I Paulis stay O(1) memory!
    px: dict[int, int] = {}
    pz: dict[int, int] = {}
    phase_mod4 = 0  # 0:+1, 1:+i, 2:-1, 3:-i  (P = i^phase_mod4 * prod_q X^{px[q]} Z^{pz[q]})

    for m in _NON_IDENTITY_PAULI_RE.finditer(p_str):
        idx = m.start()
        ch = m.group(0)
        q = num_qubits - 1 - idx
        if ch == "X":
            px[q] = 1
        elif ch == "Z":
            pz[q] = 1
        elif ch == "Y":
            px[q] = 1
            pz[q] = 1
            phase_mod4 = (phase_mod4 + 1) & 3
        else:
            raise ValueError(f"Unsupported Pauli character '{ch}' in '{p_str}'.")

    for op, qs in reversed(steps):
        q0 = qs[0]
        if op == "h":
            x0, z0 = px.get(q0, 0), pz.get(q0, 0)
            if x0 and z0:
                phase_mod4 = (phase_mod4 + 2) & 3
            if z0:
                px[q0] = 1
            else:
                px.pop(q0, None)
            if x0:
                pz[q0] = 1
            else:
                pz.pop(q0, None)
        elif op == "s":
            if px.get(q0, 0):
                phase_mod4 = (phase_mod4 + 3) & 3
                if pz.get(q0, 0):
                    pz.pop(q0, None)
                else:
                    pz[q0] = 1
        elif op == "x":
            if pz.get(q0, 0):
                phase_mod4 = (phase_mod4 + 2) & 3
        elif op == "z":
            if px.get(q0, 0):
                phase_mod4 = (phase_mod4 + 2) & 3
        elif op == "y":
            if px.get(q0, 0) ^ pz.get(q0, 0):
                phase_mod4 = (phase_mod4 + 2) & 3
        elif op == "cx":
            c, t = qs[0], qs[1]
            xc = px.get(c, 0)
            zt = pz.get(t, 0)
            if zt:
                if pz.get(c, 0):
                    pz.pop(c, None)
                else:
                    pz[c] = 1
            if xc:
                if px.get(t, 0):
                    px.pop(t, None)
                else:
                    px[t] = 1
        elif op == "cz":
            a, b = qs[0], qs[1]
            xa = px.get(a, 0)
            xb = px.get(b, 0)
            if xa and xb:
                phase_mod4 = (phase_mod4 + 2) & 3
            if xb:
                if pz.get(a, 0):
                    pz.pop(a, None)
                else:
                    pz[a] = 1
            if xa:
                if pz.get(b, 0):
                    pz.pop(b, None)
                else:
                    pz[b] = 1
        elif op == "swap":
            a, b = qs[0], qs[1]
            xa, xb = px.pop(a, 0), px.pop(b, 0)
            if xb:
                px[a] = 1
            if xa:
                px[b] = 1
            za, zb = pz.pop(a, 0), pz.pop(b, 0)
            if zb:
                pz[a] = 1
            if za:
                pz[b] = 1

    if px:
        return 0.0
    if phase_mod4 == 0:
        return 1.0
    if phase_mod4 == 2:
        return -1.0
    return 0.0


def _compute_pauli_expectation_stabilizer(
    tab: PackedStabilizerTableau, pauli_label: str
) -> float:
    n = tab.num_qubits
    p_str = pauli_label.strip().upper()
    if len(p_str) != n:
        raise ValueError(f"Pauli observable '{p_str}' length ({len(p_str)}) != {n}")

    obs_x: list[int] = [0] * n
    obs_z: list[int] = [0] * n
    for q in range(n):
        ch = p_str[n - 1 - q]
        if ch in ("X", "Y"):
            obs_x[q] = 1
        if ch in ("Z", "Y"):
            obs_z[q] = 1

    stab_anti = 0
    for q in range(n):
        if obs_x[q]:
            stab_anti ^= tab.z_cols[q] >> n
        if obs_z[q]:
            stab_anti ^= tab.x_cols[q] >> n
    if stab_anti != 0:
        return 0.0

    dest_anti = 0
    for q in range(n):
        if obs_x[q]:
            dest_anti ^= tab.z_cols[q] & ((1 << n) - 1)
        if obs_z[q]:
            dest_anti ^= tab.x_cols[q] & ((1 << n) - 1)

    scratch_x = [0] * n
    scratch_z = [0] * n
    scratch_r = 0
    cur = dest_anti
    while cur:
        lb = cur & -cur
        d_idx = lb.bit_length() - 1
        sb = 1 << (d_idx + n)
        ri = 2 if (tab.r_mask & sb) else 0
        g_sum = 0
        for q in range(n):
            x1 = 1 if (tab.x_cols[q] & sb) else 0
            z1 = 1 if (tab.z_cols[q] & sb) else 0
            x2, z2 = scratch_x[q], scratch_z[q]
            if x1 == 1 and z1 == 1:
                g_sum += z2 - x2
            elif x1 == 1 and z1 == 0:
                g_sum += z2 * (2 * x2 - 1)
            elif x1 == 0 and z1 == 1:
                g_sum += x2 * (1 - 2 * z2)
            scratch_x[q] ^= x1
            scratch_z[q] ^= z1
        scratch_r = (scratch_r + ri + g_sum) % 4
        cur ^= lb

    return -1.0 if scratch_r == 2 else 1.0


def _normalize_obs_terms(obs: Any) -> list[tuple[str, float]]:
    if isinstance(obs, str):
        return [(obs, 1.0)]
    if hasattr(obs, "to_list"):
        return [(str(lbl), float(c.real if hasattr(c, "real") else c)) for lbl, c in obs.to_list()]
    if isinstance(obs, (list, tuple)) and obs and isinstance(obs[0], (list, tuple)) and len(obs[0]) == 2:
        return [(str(lbl), float(c.real if hasattr(c, "real") else c)) for lbl, c in obs]
    raise TypeError(f"Unsupported observable specification: {obs!r}")


def _is_observable_sequence(obs: Any) -> bool:
    if isinstance(obs, str) or hasattr(obs, "to_list"):
        return False
    if isinstance(obs, (list, tuple)):
        if not obs:
            return False
        first = obs[0]
        if isinstance(first, (list, tuple)) and len(first) == 2 and isinstance(first[0], str) and isinstance(first[1], (int, float)):
            return False
        return True
    return False


class VerdantAqmSamplerV2:
    """Production Qiskit Primitives V2 `SamplerV2` backed by `VerdantAqmBackend`."""

    def __init__(
        self,
        *,
        backend: VerdantAqmBackend | None = None,
        default_shots: int = 1024,
        shots: int | None = None,
        seed: int = 42,
    ) -> None:
        self.default_shots = int(shots if shots is not None else default_shots)
        self.backend = backend or VerdantAqmBackend(shots=self.default_shots, seed_simulator=seed)

    def run(self, pubs: Sequence[Any], *, shots: int | None = None) -> _PrimitiveJob:
        pub_results: list[PubResult] = []
        for pub in pubs:
            if isinstance(pub, tuple) or isinstance(pub, list):
                qc_raw = pub[0]
                param_vals = pub[1] if len(pub) > 1 else None
                pub_shots = int(pub[2]) if len(pub) > 2 and pub[2] is not None else None
            else:
                qc_raw = pub
                param_vals = None
                pub_shots = None

            norm_qc = normalize_circuit(qc_raw)
            eff_shots = pub_shots or shots or self.default_shots
            sweeps = _normalize_param_sweeps(norm_qc.parameters, param_vals)
            res = self.backend.run(
                norm_qc, shots=eff_shots, memory=True, parameter_binds=sweeps
            ).result()
            exp = res.results[0]
            all_mem: list[str] = []
            for b_idx in range(len(res.results)):
                all_mem.extend(res.get_memory(b_idx))
            ba = BitArray(all_mem, norm_qc.num_clbits)
            pub_results.append(
                PubResult(
                    data=DataBin(meas=ba, c=ba),
                    metadata={
                        "shots": eff_shots * len(sweeps),
                        "substrate": exp.metadata["substrate"],
                        "holo_kappa": exp.metadata["holo_kappa"],
                    },
                )
            )
        jid = f"sampler-v2-{compute_job_kappa({'pubs': len(pub_results)}).split(':')[1][:16]}"
        return _PrimitiveJob(jid, pub_results)


class VerdantAqmEstimatorV2:
    """Production Qiskit Primitives V2 `EstimatorV2` backed by `VerdantAqmBackend`."""

    def __init__(
        self,
        *,
        backend: VerdantAqmBackend | None = None,
        default_precision: float = 0.0,
        precision: float | None = None,
        seed: int = 42,
    ) -> None:
        self.default_precision = float(precision if precision is not None else default_precision)
        self._seed = seed
        self.backend = backend or VerdantAqmBackend(seed_simulator=seed)

    def run(self, pubs: Sequence[Any], *, precision: float | None = None) -> _PrimitiveJob:
        rng = random.Random(self._seed)
        results: list[PubResult] = []

        for pub in pubs:
            qc_raw = pub[0]
            obs_raw = pub[1]
            param_vals = pub[2] if len(pub) > 2 else None
            pub_prec = float(pub[3]) if len(pub) > 3 and pub[3] is not None else None
            eff_prec = pub_prec if pub_prec is not None else (precision if precision is not None else self.default_precision)
            if eff_prec < 0.0:
                raise ValueError(f"Target precision must be >= 0.0, got {eff_prec}")

            norm_qc = normalize_circuit(qc_raw)
            sweeps = _normalize_param_sweeps(norm_qc.parameters, param_vals)
            multi_obs = _is_observable_sequence(obs_raw)
            obs_list = list(obs_raw) if multi_obs else [obs_raw]

            evs: list[float] = []
            stds: list[float] = []
            last_sub = "CyclotomicExact"

            for bind_map in sweeps:
                sub, state_obj, _ = self.backend.evaluate_exact_state(norm_qc, bind_map)
                last_sub = sub
                for obs in obs_list:
                    terms = _normalize_obs_terms(obs)
                    exact_ev = 0.0
                    var_sum = 0.0
                    for p_lbl, coeff in terms:
                        if isinstance(state_obj, list):
                            texp = _compute_pauli_expectation_clifford_adjoint(
                                state_obj, norm_qc.num_qubits, p_lbl
                            )
                        elif isinstance(state_obj, ExactMpsTensorTrain):
                            texp = compute_exact_mps_pauli_expectation(state_obj, p_lbl)
                        elif isinstance(state_obj, PackedStabilizerTableau):
                            texp = _compute_pauli_expectation_stabilizer(state_obj, p_lbl)
                        else:
                            texp = _compute_pauli_expectation_sparse(state_obj, norm_qc.num_qubits, p_lbl)
                        exact_ev += coeff * texp
                        var_sum += coeff * coeff * max(0.0, 1.0 - texp * texp)

                    if eff_prec == 0.0:
                        evs.append(0.0 if abs(exact_ev) < 1e-15 else exact_ev)
                        stds.append(0.0)
                    else:
                        shots = max(16, math.ceil(1.0 / (eff_prec * eff_prec)))
                        std = math.sqrt(var_sum / shots)
                        evs.append(rng.gauss(exact_ev, std))
                        stds.append(std)

            scalar = (not multi_obs) and len(sweeps) == 1
            kappa = compute_job_kappa({"circuit": norm_qc.name, "evs": evs, "precision": eff_prec})
            results.append(
                PubResult(
                    data=DataBin(
                        evs=evs[0] if scalar else evs,
                        stds=stds[0] if scalar else stds,
                    ),
                    metadata={
                        "target_precision": eff_prec,
                        "exact_analytical": eff_prec == 0.0,
                        "substrate": last_sub,
                        "holo_kappa": kappa,
                    },
                )
            )

        jid = f"estimator-v2-{compute_job_kappa({'pubs': len(results)}).split(':')[1][:16]}"
        return _PrimitiveJob(jid, results)
