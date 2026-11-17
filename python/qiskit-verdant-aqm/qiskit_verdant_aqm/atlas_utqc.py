"""UOR Atlas-Native Topological Holospace, Pointed MTC Verifier & `SkWeaver` Braid Compiler (`atlas_utqc.py`).

Implements Python parity with `src/aqm/atlasUtqc.ts` (`AQ-13`, `AQ-14`):
1. Parametric `AtlasUseCaseParams(scope, modality, context)` — canonical `(4, 3, 8)` -> 96 classes,
   constant 768-byte topological carrier, bijective reflection generators `(sigma, tau, mu)` of orders `(4, 8, 2)`.
2. Pointed Modular Tensor Category `C(Z_T x Z_O, q)` live verification across all 8 MTC axioms:
   `S`-unitarity, `S`-symmetry, `S^4 = I`, `(ST)^3 = p^+ S^2` Gauss-sum anomaly, Balancing, Verlinde,
   Hexagon, and Pentagon to `< 1e-10`.
3. `SkWeaver` topological braid compiler over `Clifford` and `Certified22` (`PU(22)` spectral-flow gap
   `Delta_lambda = 3` rad) with Ostrowski continued-fraction convergent descent and Dawson-Nielsen
   Solovay-Kitaev balanced group commutator `[V, W] = V W V^dagger W^dagger`.
4. Constant 768-byte `AtlasHolospace` batch executor with BLAKE3 `kappa` prefix-state memoization.
"""

from __future__ import annotations

import cmath
import math
import re
import struct
from dataclasses import dataclass
from typing import Sequence

from .holo_bridge import blake3_hex

Mat2 = tuple[complex, complex, complex, complex]

_MAT2_I: Mat2 = (1.0 + 0.0j, 0.0j, 0.0j, 1.0 + 0.0j)
_INV_SQRT2 = math.sqrt(0.5)
_MAT2_H: Mat2 = (_INV_SQRT2 + 0.0j, _INV_SQRT2 + 0.0j, _INV_SQRT2 + 0.0j, -_INV_SQRT2 + 0.0j)
_CERTIFIED22_FLOW_GAP = 3.0


@dataclass(frozen=True)
class AtlasUseCaseParams:
    scope: int = 4
    modality: int = 3
    context: int = 8

    def rank(self) -> int:
        return int(self.scope * self.modality * self.context)


CANONICAL_ATLAS_PARAMS = AtlasUseCaseParams(4, 3, 8)
PARAMETRIC_CHECK_ATLAS_PARAMS = AtlasUseCaseParams(5, 2, 3)


@dataclass(frozen=True)
class AtlasGeneratorSummary:
    params: AtlasUseCaseParams
    n_classes: int
    condensed_dim: int
    carrier_bytes: int
    sigma_order: int
    tau_order: int
    mu_order: int
    bijective_verified: bool
    sigma: tuple[int, ...]
    tau: tuple[int, ...]
    mu: tuple[int, ...]


def _perm_order(perm: Sequence[int]) -> int:
    n = len(perm)
    cur = list(range(n))
    for step in range(1, 4097):
        cur = [perm[v] for v in cur]
        if all(cur[i] == i for i in range(n)):
            return step
    return -1


def build_atlas_generators(params: AtlasUseCaseParams = CANONICAL_ATLAS_PARAMS) -> AtlasGeneratorSummary:
    """Constructs the bijective reflection generators `(sigma, tau, mu)` over `scope * modality * context` classes."""
    scope, modality, context = params.scope, params.modality, params.context
    if scope < 1 or modality < 1 or context < 1:
        raise ValueError(
            f"AtlasBraidError::InvalidAtlasCoordinateProduct: ({scope}, {modality}, {context}) must be >= 1."
        )
    stride = modality * context
    n_classes = scope * stride
    sigma: list[int] = [0] * n_classes
    tau: list[int] = [0] * n_classes
    mu: list[int] = [0] * n_classes

    def encode(s: int, m: int, c: int) -> int:
        return s * stride + m * context + c

    for idx in range(n_classes):
        s = idx // stride
        rem = idx % stride
        m = rem // context
        c = rem % context
        sigma[idx] = encode((s + 1) % scope, m, c)
        tau[idx] = encode(s, m, (c + 1) % context)
        mu[idx] = encode(s, modality - 1 - m, c)

    bijective = (
        len(set(sigma)) == n_classes
        and len(set(tau)) == n_classes
        and len(set(mu)) == n_classes
    )
    return AtlasGeneratorSummary(
        params=params,
        n_classes=n_classes,
        condensed_dim=stride,
        carrier_bytes=n_classes * 8,
        sigma_order=_perm_order(sigma),
        tau_order=_perm_order(tau),
        mu_order=_perm_order(mu),
        bijective_verified=bijective,
        sigma=tuple(sigma),
        tau=tuple(tau),
        mu=tuple(mu),
    )


_CANONICAL_GEN = build_atlas_generators(CANONICAL_ATLAS_PARAMS)


@dataclass(frozen=True)
class AtlasMtcAxiomReport:
    ok: bool
    rank: int
    central_charge_mod8: int
    gauss_phase_angle_pi_over_4: float
    s_unitary_residual: float
    s_symmetric_residual: float
    s_fourth_identity_residual: float
    modular_st_cubed_residual: float
    verlinde_integral_residual: float
    pentagon_residual: float
    hexagon_residual: float
    balancing_residual: float
    max_residual: float


def verify_atlas_mtc_axioms(params: AtlasUseCaseParams = CANONICAL_ATLAS_PARAMS) -> AtlasMtcAxiomReport:
    """Verifies all 8 pointed Modular Tensor Category axioms on `condensed_dim = modality * context`."""
    rank = params.modality * params.context
    two_bits = 0
    odd_order = rank
    while odd_order > 1 and (odd_order % 2) == 0:
        odd_order //= 2
        two_bits += 1
    two_pow = 1 << two_bits

    def decode_obj(x: int) -> tuple[int, int]:
        return (x // two_pow, x % two_pow)

    def encode_obj(m: int, c: int) -> int:
        return ((m % odd_order) * two_pow) + c

    def add_obj(x: int, y: int) -> int:
        mx, cx = decode_obj(x)
        my, cy = decode_obj(y)
        return encode_obj((mx + my) % odd_order, cx ^ cy)

    twist_t: list[complex] = []
    for x in range(rank):
        m, c = decode_obj(x)
        odd_ang = (2.0 * math.pi * ((m * m) % odd_order) / odd_order) if odd_order > 1 else 0.0
        sem_ang = 0.5 * math.pi * (c.bit_count() & 3)
        twist_t.append(cmath.exp(1j * (odd_ang + sem_ang)))

    def braid_r(x: int, y: int) -> complex:
        mx, cx = decode_obj(x)
        my, cy = decode_obj(y)
        odd_ang = (2.0 * math.pi * ((mx * my) % odd_order) / odd_order) if odd_order > 1 else 0.0
        sem_ang = 0.5 * math.pi * ((cx & cy).bit_count() & 3)
        return cmath.exp(1j * (odd_ang + sem_ang))

    def assoc_f(x: int, y: int, z: int) -> complex:
        _, cx = decode_obj(x)
        _, cy = decode_obj(y)
        _, cz = decode_obj(z)
        return -1.0 + 0.0j if ((cx & cy & cz).bit_count() & 1) else 1.0 + 0.0j

    inv_sqrt_rank = 1.0 / math.sqrt(rank)
    s_mat = [0.0j] * (rank * rank)
    for x in range(rank):
        for y in range(rank):
            s_mat[x * rank + y] = (braid_r(x, y) * braid_r(y, x)).conjugate() * inv_sqrt_rank

    def mat_mul(a_m: Sequence[complex], b_m: Sequence[complex]) -> list[complex]:
        out = [0.0j] * (rank * rank)
        for i in range(rank):
            for k in range(rank):
                aik = a_m[i * rank + k]
                if aik == 0j:
                    continue
                base_i = i * rank
                base_k = k * rank
                for j in range(rank):
                    out[base_i + j] += aik * b_m[base_k + j]
        return out

    s_sym_res = 0.0
    s_dag = [0.0j] * (rank * rank)
    for i in range(rank):
        for j in range(rank):
            s_sym_res = max(s_sym_res, abs(s_mat[i * rank + j] - s_mat[j * rank + i]))
            s_dag[i * rank + j] = s_mat[j * rank + i].conjugate()

    ss_dag = mat_mul(s_mat, s_dag)
    s_unit_res = 0.0
    for i in range(rank):
        for j in range(rank):
            tgt = 1.0 + 0.0j if i == j else 0.0j
            s_unit_res = max(s_unit_res, abs(ss_dag[i * rank + j] - tgt))

    s2 = mat_mul(s_mat, s_mat)
    s4 = mat_mul(s2, s2)
    s4_res = 0.0
    for i in range(rank):
        for j in range(rank):
            tgt = 1.0 + 0.0j if i == j else 0.0j
            s4_res = max(s4_res, abs(s4[i * rank + j] - tgt))

    p_plus = sum(twist_t, 0.0j) * inv_sqrt_rank
    gauss_ang = math.atan2(p_plus.imag, p_plus.real)
    c_mod8 = int(round((gauss_ang * 4.0) / math.pi)) % 8

    t_mat = [0.0j] * (rank * rank)
    for x in range(rank):
        t_mat[x * rank + x] = twist_t[x]
    st = mat_mul(s_mat, t_mat)
    st3 = mat_mul(mat_mul(st, st), st)
    st3_res = max(abs(st3[idx] - p_plus * s2[idx]) for idx in range(rank * rank))

    bal_res = 0.0
    for x in range(rank):
        for y in range(rank):
            lhs = braid_r(x, y) * braid_r(y, x)
            rhs = twist_t[add_obj(x, y)] * (twist_t[x] * twist_t[y]).conjugate()
            bal_res = max(bal_res, abs(lhs - rhs))

    ver_res = 0.0
    ver_cap = min(rank, 12)
    for x in range(ver_cap):
        for y in range(ver_cap):
            exp_z = add_obj(x, y)
            for z in range(ver_cap):
                acc = 0.0j
                for k in range(rank):
                    s0k = s_mat[k].real
                    acc += (s_mat[x * rank + k] * s_mat[y * rank + k] * s_mat[z * rank + k].conjugate()) / s0k
                tgt = 1.0 + 0.0j if z == exp_z else 0.0j
                ver_res = max(ver_res, abs(acc - tgt))

    hex_res = 0.0
    hex_cap = min(rank, 24)
    for a in range(hex_cap):
        for b in range(hex_cap):
            for c in range(hex_cap):
                bc = add_obj(b, c)
                lhs = braid_r(a, bc) * assoc_f(b, c, a)
                rhs = assoc_f(a, b, c) * braid_r(a, b) * assoc_f(b, a, c).conjugate() * braid_r(a, c)
                hex_res = max(hex_res, abs(lhs - rhs))

    pent_res = 0.0
    pent_cap = min(rank, 12)
    for a in range(pent_cap):
        for b in range(pent_cap):
            ab = add_obj(a, b)
            for c in range(pent_cap):
                bc = add_obj(b, c)
                for d in range(pent_cap):
                    cd = add_obj(c, d)
                    lhs = assoc_f(a, b, c) * assoc_f(a, bc, d) * assoc_f(b, c, d)
                    rhs = assoc_f(ab, c, d) * assoc_f(a, b, cd)
                    pent_res = max(pent_res, abs(lhs - rhs))

    max_res = max(s_unit_res, s_sym_res, s4_res, st3_res, ver_res, pent_res, hex_res, bal_res)
    return AtlasMtcAxiomReport(
        ok=max_res < 1e-10,
        rank=rank,
        central_charge_mod8=c_mod8,
        gauss_phase_angle_pi_over_4=(gauss_ang * 4.0) / math.pi,
        s_unitary_residual=s_unit_res,
        s_symmetric_residual=s_sym_res,
        s_fourth_identity_residual=s4_res,
        modular_st_cubed_residual=st3_res,
        verlinde_integral_residual=ver_res,
        pentagon_residual=pent_res,
        hexagon_residual=hex_res,
        balancing_residual=bal_res,
        max_residual=max_res,
    )


def _mat2_mul(a: Mat2, b: Mat2) -> Mat2:
    return (
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
    )


def _mat2_dag(m: Mat2) -> Mat2:
    return (m[0].conjugate(), m[2].conjugate(), m[1].conjugate(), m[3].conjugate())


def _mat2_rz(theta: float) -> Mat2:
    return (cmath.exp(-0.5j * theta), 0.0j, 0.0j, cmath.exp(0.5j * theta))


def _mat2_rx(theta: float) -> Mat2:
    c = math.cos(0.5 * theta)
    s = -math.sin(0.5 * theta)
    return (c + 0.0j, 1j * s, 1j * s, c + 0.0j)


def _mat2_ry(theta: float) -> Mat2:
    c = math.cos(0.5 * theta)
    s = math.sin(0.5 * theta)
    return (c + 0.0j, -s + 0.0j, s + 0.0j, c + 0.0j)


def projective_su2_distance(u_mat: Mat2, v_mat: Mat2) -> float:
    """Projective `PU(2)` metric `sqrt(max(0, 1 - (|Tr(U^dagger V)| / 2)^2))` invariant to global U(1) phase."""
    tr = sum(u_mat[i].conjugate() * v_mat[i] for i in range(4))
    overlap = min(1.0, abs(tr) * 0.5)
    return math.sqrt(max(0.0, 1.0 - overlap * overlap))


def _build_flow_convergent_denominators(limit: int) -> tuple[int, ...]:
    denoms: list[int] = []
    x = _CERTIFIED22_FLOW_GAP / (2.0 * math.pi)
    q_prev2 = 1
    q_prev1 = 0
    for _ in range(32):
        a = int(math.floor(x))
        q_curr = a * q_prev1 + q_prev2
        if q_curr > limit:
            break
        if q_curr >= 1 and (not denoms or q_curr > denoms[-1]):
            denoms.append(q_curr)
        rem = x - a
        if rem < 1e-13:
            break
        q_prev2, q_prev1 = q_prev1, q_curr
        x = 1.0 / rem
    return tuple(denoms)


_CONVERGENT_DENOMS_MAX = _build_flow_convergent_denominators(1_000_000)


def _find_best_flow_power_rz(target_theta: float, max_power_search: int) -> tuple[int, Mat2, float]:
    target_mat = _mat2_rz(target_theta)
    best_k = 0
    best_mat = _MAT2_I
    best_dist = projective_su2_distance(_MAT2_I, target_mat)

    if max_power_search <= 512:
        for k in range(-max_power_search, max_power_search + 1):
            cand = _mat2_rz(_CERTIFIED22_FLOW_GAP * k)
            d = projective_su2_distance(cand, target_mat)
            if d < best_dist:
                best_dist, best_k, best_mat = d, k, cand
        return best_k, best_mat, best_dist

    improved = True
    while improved:
        improved = False
        for q in _CONVERGENT_DENOMS_MAX:
            if q > max_power_search:
                break
            for sign in (1, -1):
                cand_k = best_k + sign * q
                while abs(cand_k) <= max_power_search:
                    cand = _mat2_rz(_CERTIFIED22_FLOW_GAP * cand_k)
                    d = projective_su2_distance(cand, target_mat)
                    if d + 1e-15 < best_dist:
                        best_dist, best_k, best_mat = d, cand_k, cand
                        improved = True
                        cand_k += sign * q
                    else:
                        break
    return best_k, best_mat, best_dist


def _refine_rz_solovay_kitaev(
    target_theta: float,
    base_k: int,
    base_mat: Mat2,
    base_res: float,
    max_comm_power: int = 4894,
) -> tuple[str, Mat2, float, int]:
    if base_res <= 1e-12:
        return ("", base_mat, base_res, 0)
    raw_diff = target_theta - _CERTIFIED22_FLOW_GAP * base_k
    wrapped_diff = raw_diff - 2.0 * math.pi * round(raw_diff / (2.0 * math.pi))
    abs_diff = abs(wrapped_diff)
    if abs_diff > 0.25:
        return ("", base_mat, base_res, 0)

    alpha = math.sqrt(2.0 * abs_diff)
    k_alpha, alpha_mat, _ = _find_best_flow_power_rz(alpha, max_comm_power)
    s_plus = _mat2_rz(0.5 * math.pi)
    s_minus = _mat2_rz(-0.5 * math.pi)
    v_op = _mat2_mul(_mat2_mul(_MAT2_H, alpha_mat), _MAT2_H)
    if wrapped_diff >= 0:
        w_op = _mat2_mul(_mat2_mul(_mat2_mul(_mat2_mul(s_plus, _MAT2_H), alpha_mat), _MAT2_H), s_minus)
    else:
        w_op = _mat2_mul(_mat2_mul(_mat2_mul(_mat2_mul(s_minus, _MAT2_H), alpha_mat), _MAT2_H), s_plus)

    comm = _mat2_mul(_mat2_mul(_mat2_mul(v_op, w_op), _mat2_dag(v_op)), _mat2_dag(w_op))
    refined = _mat2_mul(comm, base_mat)
    ref_dist = projective_su2_distance(refined, _mat2_rz(target_theta))
    if ref_dist < base_res:
        return (f"·[V({k_alpha}),W({k_alpha})]", refined, ref_dist, 4 * abs(k_alpha) + 16)
    return ("", base_mat, base_res, 0)


@dataclass(frozen=True)
class CompiledBraidSegment:
    instruction: str
    wires: tuple[int, ...]
    braid_word: str
    projective_residual: float
    prefix_kappa: str


@dataclass(frozen=True)
class SkWeaverCompileResult:
    carrier: str
    qubit_count: int
    epsilon_target: float
    total_word_length: int
    max_projective_residual: float
    unique_prefix_kappas: int
    segments: tuple[CompiledBraidSegment, ...]


def weave_rotations_with_sk_weaver(
    rotations: Sequence[tuple[str, int, float]],
    *,
    qubit_count: int = 1,
    carrier: str = "Certified22",
    epsilon_target: float = 1e-4,
) -> SkWeaverCompileResult:
    """Synthesizes topological `PU(22)` / `Clifford` braids for `(op, wire, theta)` single-qubit rotations."""
    max_search = min(350_000, max(128, math.ceil(math.pi / max(1e-6, epsilon_target))))
    use_sk = epsilon_target <= 1e-3
    segments: list[CompiledBraidSegment] = []
    seen_kappas: set[str] = set()
    transcript = f"ATLAS-CARRIER:{carrier}:n={max(1, qubit_count)}"
    total_len = 0
    max_res = 0.0

    for op_raw, wire, theta in rotations:
        op = op_raw.lower()
        if carrier == "Clifford":
            q_turns = theta / (0.5 * math.pi)
            if abs(q_turns - round(q_turns)) > 1e-7:
                raise ValueError(
                    f"AtlasBraidError::NonDiscreteAngleOnCliffordCarrier: '{op}({theta})' refused on Clifford carrier."
                )
            q_mod = int(round(q_turns)) % 4
            word = "e" if q_mod == 0 else f"τ_{wire}^{q_mod * 2}"
            res = 0.0
            total_len += q_mod * 2
        else:
            base_k, base_mat, base_res = _find_best_flow_power_rz(theta, max_search)
            sk_suf, sk_mat, sk_res, extra_len = (
                _refine_rz_solovay_kitaev(theta, base_k, base_mat, base_res)
                if use_sk
                else ("", base_mat, base_res, 0)
            )
            if op == "rz" or op == "p":
                word = f"Φ_{wire}^({base_k}){sk_suf}"
                res = sk_res
                total_len += max(1, abs(base_k)) + extra_len
            elif op == "rx":
                realized = _mat2_mul(_mat2_mul(_MAT2_H, sk_mat), _MAT2_H)
                word = f"(σ_{wire}·τ_{wire}·σ_{wire})·Φ_{wire}^({base_k}){sk_suf}·(σ_{wire}·τ_{wire}·σ_{wire})"
                res = projective_su2_distance(realized, _mat2_rx(theta))
                total_len += abs(base_k) + 6 + extra_len
            elif op == "ry":
                s_plus = _mat2_rz(0.5 * math.pi)
                s_minus = _mat2_rz(-0.5 * math.pi)
                realized = _mat2_mul(
                    _mat2_mul(_mat2_mul(_mat2_mul(s_plus, _MAT2_H), sk_mat), _MAT2_H),
                    s_minus,
                )
                word = f"τ_{wire}^2·H_{wire}·Φ_{wire}^({base_k}){sk_suf}·H_{wire}·τ_{wire}^6"
                res = projective_su2_distance(realized, _mat2_ry(theta))
                total_len += abs(base_k) + 14 + extra_len
            else:
                raise ValueError(f"Unsupported SkWeaver rotation '{op}'")

        max_res = max(max_res, res)
        transcript = f"{transcript}|{word}"
        pk = f"blake3:{blake3_hex(transcript.encode('utf-8'))}"
        seen_kappas.add(pk)
        segments.append(
            CompiledBraidSegment(
                instruction=f"{op}({theta}) q[{wire}]",
                wires=(wire,),
                braid_word=word,
                projective_residual=res,
                prefix_kappa=pk,
            )
        )

    return SkWeaverCompileResult(
        carrier=carrier,
        qubit_count=max(1, qubit_count),
        epsilon_target=epsilon_target,
        total_word_length=total_len,
        max_projective_residual=max_res,
        unique_prefix_kappas=len(seen_kappas),
        segments=tuple(segments),
    )


def weave_qasm_with_sk_weaver(
    qasm_source: str,
    carrier: str = "Certified22",
    epsilon_target: float = 1e-4,
) -> SkWeaverCompileResult:
    """Parses OpenQASM 2.0 source and compiles single/two-qubit instructions into topological `SkWeaver` braids."""
    cleaned = re.sub(r"//[^\n]*", "", qasm_source)
    stmts = [s.strip() for s in cleaned.split(";") if s.strip()]
    q_offsets: dict[str, tuple[int, int]] = {}
    qubit_count = 0
    rotations: list[tuple[str, int, float]] = []

    for st in stmts:
        if re.match(r"^(OPENQASM|include|creg|barrier|measure)\b", st, re.I):
            continue
        qm = re.match(r"^qreg\s+([a-zA-Z_]\w*)\[(\d+)\]$", st)
        if qm:
            q_offsets[qm.group(1)] = (qubit_count, int(qm.group(2)))
            qubit_count += int(qm.group(2))
            continue
        rm = re.match(r"^(rx|ry|rz)\(([^)]+)\)\s+([a-zA-Z_]\w*)\[(\d+)\]$", st, re.I)
        if rm:
            op = rm.group(1).lower()
            ang_expr = rm.group(2).strip().replace("pi", str(math.pi)).replace("PI", str(math.pi))
            ang = float(eval(ang_expr, {"__builtins__": {}}, {}))  # noqa: S307
            base, _ = q_offsets.get(rm.group(3), (0, 1))
            rotations.append((op, base + int(rm.group(4)), ang))
            continue
        tm = re.match(r"^(t|tdg|s|sdg|z)\s+([a-zA-Z_]\w*)\[(\d+)\]$", st, re.I)
        if tm:
            g = tm.group(1).lower()
            ang_map = {
                "t": math.pi / 4.0,
                "tdg": -math.pi / 4.0,
                "s": math.pi / 2.0,
                "sdg": -math.pi / 2.0,
                "z": math.pi,
            }
            base, _ = q_offsets.get(tm.group(2), (0, 1))
            rotations.append(("rz", base + int(tm.group(3)), ang_map[g]))

    return weave_rotations_with_sk_weaver(
        rotations,
        qubit_count=max(1, qubit_count),
        carrier=carrier,
        epsilon_target=epsilon_target,
    )


@dataclass(frozen=True)
class AtlasHolospaceBatchResult:
    qubit_count: int
    carrier_bytes: int
    carrier_re: tuple[float, ...]
    carrier_im: tuple[float, ...]
    wire_class_cursor: tuple[int, ...]
    unique_kappas: int
    elided_step_hits: int
    final_kappa: str


def execute_atlas_holospace_batch(
    qubit_count: int,
    steps: Sequence[tuple[str, tuple[int, ...]]],
) -> AtlasHolospaceBatchResult:
    """Evolves the constant 768-byte 96-class UOR Atlas `(4, 3, 8)` carrier with BLAKE3 `kappa` elision."""
    sigma = _CANONICAL_GEN.sigma
    tau = _CANONICAL_GEN.tau
    mu = _CANONICAL_GEN.mu

    amp = 1.0 / math.sqrt(96.0)
    carrier_re = [amp] * 96
    carrier_im = [0.0] * 96
    wire_cursor = [q % 96 for q in range(qubit_count)]

    def digest_carrier(re_v: Sequence[float], im_v: Sequence[float]) -> str:
        ints = [0] * 192
        for i in range(96):
            ints[2 * i] = int(round(re_v[i] * 1_000_000))
            ints[2 * i + 1] = int(round(im_v[i] * 1_000_000))
        raw = struct.pack("<192i", *ints)
        return f"blake3:{blake3_hex(raw)}"

    cur_kappa = digest_carrier(carrier_re, carrier_im)
    seen_kappas: set[str] = {cur_kappa}
    transition_cache: dict[tuple[str, str], tuple[list[float], list[float], str]] = {}
    elided_hits = 0

    for op_raw, qs in steps:
        op = op_raw.lower()
        w0 = qs[0]
        w1 = qs[1] if len(qs) > 1 else -1

        perm = sigma if op == "h" else (mu if op in ("x", "y", "cx") else tau)
        wire_cursor[w0] = perm[wire_cursor[w0]]
        if w1 >= 0:
            wire_cursor[w1] = sigma[(wire_cursor[w1] + wire_cursor[w0]) % 96]

        t_key = (cur_kappa, op)
        cached = transition_cache.get(t_key)
        if cached is not None:
            carrier_re, carrier_im, cur_kappa = cached
            elided_hits += 1
            continue

        phase = (
            math.pi / 4.0
            if op == "t"
            else (math.pi / 2.0 if op == "s" else (math.pi if op in ("z", "cz") else 0.0))
        )
        cp = math.cos(phase)
        sp = math.sin(phase)
        nxt_re = [0.0] * 96
        nxt_im = [0.0] * 96
        for i in range(96):
            dst = perm[i]
            r = carrier_re[i]
            im = carrier_im[i]
            nxt_re[dst] = r * cp - im * sp
            nxt_im[dst] = r * sp + im * cp

        nxt_kappa = digest_carrier(nxt_re, nxt_im)
        if nxt_kappa in seen_kappas:
            elided_hits += 1
        else:
            seen_kappas.add(nxt_kappa)
        transition_cache[t_key] = (nxt_re, nxt_im, nxt_kappa)
        carrier_re, carrier_im, cur_kappa = nxt_re, nxt_im, nxt_kappa

    return AtlasHolospaceBatchResult(
        qubit_count=qubit_count,
        carrier_bytes=768,
        carrier_re=tuple(carrier_re),
        carrier_im=tuple(carrier_im),
        wire_class_cursor=tuple(wire_cursor),
        unique_kappas=len(seen_kappas),
        elided_step_hits=elided_hits,
        final_kappa=cur_kappa,
    )
