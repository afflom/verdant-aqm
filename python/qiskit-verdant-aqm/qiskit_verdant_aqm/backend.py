"""Unbounded Prism-Verified Qiskit `BackendV2` Runtime (`qiskit_verdant_aqm/backend.py`).

Implements `AQ-19` (`qiskit_backend_v2_unbounded`):
- Dynamically subclasses `qiskit.providers.BackendV2` and populates a native `qiskit.transpiler.Target`
  whenever `qiskit` is installed in the Python environment.
- Provides clean zero-dependency fallback `QuantumCircuit`, `QuantumRegister`, `ClassicalRegister`,
  `Parameter`, `Target`, `Job`, and `Result` classes when running standalone, so the full Qiskit
  validation oracle executes in any Python >= 3.10 environment.
- Never imposes artificial dense 2^n qubit caps (`num_qubits = None`, `coupling_map = None`):
  1. `StabilizerTableau` — arbitrary-width Python `int` bit-planes + `int.bit_count()` (`2,048q+`).
  2. `CyclotomicExact` — `int`-indexed sparse `Z[zeta_8] / sqrt(2)^k` exact algebra (`4,096q+`).
  3. `ExactSparseContinuum` — `int`-indexed sparse `complex128` amplitudes for `< 1e-12` continuous rotations.
"""

from __future__ import annotations

import bisect
import cmath
import json
import math
import random
import re
from dataclasses import dataclass, field
from typing import Any, Sequence

from .holo_bridge import compute_job_kappa
from .uorc_wire import compress_uorc_portable, decompress_uorc_portable

try:
    from qiskit.circuit import (  # type: ignore[import-not-found]
        Barrier as _QiskitBarrier,
        Measure as _QiskitMeasure,
        Parameter as _QiskitParameter,
        QuantumCircuit as _UpstreamQuantumCircuit,
        Reset as _QiskitReset,
    )
    from qiskit.circuit.library import (  # type: ignore[import-not-found]
        CCXGate,
        CHGate,
        CSwapGate,
        CXGate,
        CYGate,
        CZGate,
        ECRGate,
        HGate,
        IGate,
        PhaseGate,
        RXGate,
        RXXGate,
        RYGate,
        RZGate,
        RZZGate,
        SGate,
        SXGate,
        SXdgGate,
        SdgGate,
        SwapGate,
        TGate,
        TdgGate,
        UGate,
        XGate,
        YGate,
        ZGate,
    )
    from qiskit.providers import BackendV2 as _BaseBackendV2, JobV1 as _BaseJobV1, JobStatus as _JobStatus, Options as _QiskitOptions  # type: ignore[import-not-found]
    from qiskit.transpiler import Target as _QiskitTarget  # type: ignore[import-not-found]

    HAS_UPSTREAM_QISKIT = True
except Exception:  # pragma: no cover - clean standalone fallback
    HAS_UPSTREAM_QISKIT = False
    _BaseBackendV2 = object
    _BaseJobV1 = object
    _UpstreamQuantumCircuit = None


TARGET_ISA_28: tuple[tuple[str, int | str, int, bool, bool], ...] = (
    # (name, num_qubits, num_params, is_clifford, is_exact_cyclotomic)
    ("id", 1, 0, True, True),
    ("x", 1, 0, True, True),
    ("y", 1, 0, True, True),
    ("z", 1, 0, True, True),
    ("h", 1, 0, True, True),
    ("s", 1, 0, True, True),
    ("sdg", 1, 0, True, True),
    ("sx", 1, 0, True, True),
    ("sxdg", 1, 0, True, True),
    ("t", 1, 0, False, True),
    ("tdg", 1, 0, False, True),
    ("rx", 1, 1, False, False),
    ("ry", 1, 1, False, False),
    ("rz", 1, 1, False, False),
    ("p", 1, 1, False, False),
    ("u", 1, 3, False, False),
    ("cx", 2, 0, True, True),
    ("cz", 2, 0, True, True),
    ("cy", 2, 0, True, True),
    ("ch", 2, 0, False, True),
    ("swap", 2, 0, True, True),
    ("ecr", 2, 0, True, True),
    ("rxx", 2, 1, False, False),
    ("rzz", 2, 1, False, False),
    ("ccx", 3, 0, False, True),
    ("cswap", 3, 0, False, True),
    ("measure", 1, 0, True, True),
    ("reset", 1, 0, True, True),
    ("barrier", "variadic", 0, True, True),
)

# Note: 28 distinct computational/control instructions excluding `id` or 29 with `barrier`; expose exact 28 canonical ops + `id`:
ISA_INFO_MAP: dict[str, tuple[int | str, int, bool, bool]] = {
    name: (nq, npar, cliff, cyc) for name, nq, npar, cliff, cyc in TARGET_ISA_28
}

ISA_ALIASES: dict[str, str] = {
    "i": "id",
    "u1": "p",
    "u3": "u",
    "cnot": "cx",
    "toffoli": "ccx",
    "fredkin": "cswap",
}


class Parameter:
    """Symbolic rotation angle parameter compatible with `qiskit.circuit.Parameter`."""

    def __init__(self, name: str) -> None:
        self.name = str(name)

    def __repr__(self) -> str:
        return f"Parameter({self.name!r})"

    def __str__(self) -> str:
        return self.name


@dataclass(frozen=True)
class QuantumRegister:
    size: int
    name: str = "q"


@dataclass(frozen=True)
class ClassicalRegister:
    size: int
    name: str = "c"


@dataclass(frozen=True)
class NormalizedInstruction:
    name: str
    qubits: tuple[int, ...]
    clbits: tuple[int, ...] = ()
    params: tuple[float | str, ...] = ()


@dataclass
class NormalizedCircuit:
    name: str
    num_qubits: int
    num_clbits: int
    qregs: list[tuple[str, int]]
    cregs: list[tuple[str, int]]
    instructions: list[NormalizedInstruction]
    parameters: list[str]


class QuantumCircuit:
    """Standalone Qiskit-compatible `QuantumCircuit` builder (used when `qiskit` is not installed or directly)."""

    def __init__(self, *regs: int | QuantumRegister | ClassicalRegister, name: str | None = None) -> None:
        self.name = name or "circuit"
        self.qregs: list[QuantumRegister] = []
        self.cregs: list[ClassicalRegister] = []
        int_args: list[int] = []
        for item in regs:
            if isinstance(item, QuantumRegister):
                self.qregs.append(item)
            elif isinstance(item, ClassicalRegister):
                self.cregs.append(item)
            elif isinstance(item, int):
                int_args.append(item)
            else:
                raise TypeError(f"Unsupported register specification: {item!r}")

        if int_args:
            if int_args[0] > 0:
                self.qregs.append(QuantumRegister(int_args[0], "q"))
            if len(int_args) > 1 and int_args[1] > 0:
                self.cregs.append(ClassicalRegister(int_args[1], "c"))

        self._instructions: list[NormalizedInstruction] = []
        self._param_names: set[str] = set()

    @property
    def num_qubits(self) -> int:
        return sum(r.size for r in self.qregs)

    @property
    def num_clbits(self) -> int:
        return sum(r.size for r in self.cregs)

    @property
    def parameters(self) -> list[Parameter]:
        return [Parameter(n) for n in sorted(self._param_names)]

    def _norm_param(self, p: Any) -> float | str:
        if isinstance(p, (int, float)):
            return float(p)
        if hasattr(p, "name"):
            pname = str(p.name)
            self._param_names.add(pname)
            return pname
        s = str(p)
        for tok in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", s):
            if tok.lower() != "pi":
                self._param_names.add(tok)
        return s

    def append_op(
        self,
        name: str,
        qubits: Sequence[int],
        clbits: Sequence[int] = (),
        params: Sequence[Any] = (),
    ) -> QuantumCircuit:
        norm_p = tuple(self._norm_param(p) for p in params)
        self._instructions.append(
            NormalizedInstruction(
                name=name.lower(),
                qubits=tuple(int(q) for q in qubits),
                clbits=tuple(int(c) for c in clbits),
                params=norm_p,
            )
        )
        return self

    def id(self, q: int) -> QuantumCircuit: return self.append_op("id", (q,))
    def x(self, q: int) -> QuantumCircuit: return self.append_op("x", (q,))
    def y(self, q: int) -> QuantumCircuit: return self.append_op("y", (q,))
    def z(self, q: int) -> QuantumCircuit: return self.append_op("z", (q,))
    def h(self, q: int) -> QuantumCircuit: return self.append_op("h", (q,))
    def s(self, q: int) -> QuantumCircuit: return self.append_op("s", (q,))
    def sdg(self, q: int) -> QuantumCircuit: return self.append_op("sdg", (q,))
    def sx(self, q: int) -> QuantumCircuit: return self.append_op("sx", (q,))
    def sxdg(self, q: int) -> QuantumCircuit: return self.append_op("sxdg", (q,))
    def t(self, q: int) -> QuantumCircuit: return self.append_op("t", (q,))
    def tdg(self, q: int) -> QuantumCircuit: return self.append_op("tdg", (q,))
    def rx(self, theta: Any, q: int) -> QuantumCircuit: return self.append_op("rx", (q,), (), (theta,))
    def ry(self, theta: Any, q: int) -> QuantumCircuit: return self.append_op("ry", (q,), (), (theta,))
    def rz(self, theta: Any, q: int) -> QuantumCircuit: return self.append_op("rz", (q,), (), (theta,))
    def p(self, lam: Any, q: int) -> QuantumCircuit: return self.append_op("p", (q,), (), (lam,))
    def u(self, theta: Any, phi: Any, lam: Any, q: int) -> QuantumCircuit:
        return self.append_op("u", (q,), (), (theta, phi, lam))
    def cx(self, c: int, t: int) -> QuantumCircuit: return self.append_op("cx", (c, t))
    def cz(self, a: int, b: int) -> QuantumCircuit: return self.append_op("cz", (a, b))
    def cy(self, c: int, t: int) -> QuantumCircuit: return self.append_op("cy", (c, t))
    def ch(self, c: int, t: int) -> QuantumCircuit: return self.append_op("ch", (c, t))
    def swap(self, a: int, b: int) -> QuantumCircuit: return self.append_op("swap", (a, b))
    def ecr(self, a: int, b: int) -> QuantumCircuit: return self.append_op("ecr", (a, b))
    def rxx(self, theta: Any, a: int, b: int) -> QuantumCircuit: return self.append_op("rxx", (a, b), (), (theta,))
    def rzz(self, theta: Any, a: int, b: int) -> QuantumCircuit: return self.append_op("rzz", (a, b), (), (theta,))
    def ccx(self, c1: int, c2: int, t: int) -> QuantumCircuit: return self.append_op("ccx", (c1, c2, t))
    def cswap(self, c: int, a: int, b: int) -> QuantumCircuit: return self.append_op("cswap", (c, a, b))
    def reset(self, q: int) -> QuantumCircuit: return self.append_op("reset", (q,))

    def barrier(self, *qubits: int) -> QuantumCircuit:
        qs = qubits if qubits else tuple(range(self.num_qubits))
        return self.append_op("barrier", qs)

    def measure(self, qubit: int | Sequence[int], cbit: int | Sequence[int]) -> QuantumCircuit:
        qs = [qubit] if isinstance(qubit, int) else list(qubit)
        cs = [cbit] if isinstance(cbit, int) else list(cbit)
        if len(qs) != len(cs):
            raise ValueError(f"measure qubit/clbit length mismatch: {len(qs)} != {len(cs)}")
        for q, c in zip(qs, cs):
            self.append_op("measure", (q,), (c,))
        return self

    def measure_all(self) -> QuantumCircuit:
        n = self.num_qubits
        if self.num_clbits == 0:
            self.cregs.append(ClassicalRegister(n, "meas"))
        base = self.num_clbits - n
        for q in range(n):
            self.append_op("measure", (q,), (base + q,))
        return self

    @classmethod
    def from_qasm_str(cls, qasm: str, name: str = "qasm_circuit") -> QuantumCircuit:
        cleaned = re.sub(r"//[^\n]*", "", qasm)
        cleaned = re.sub(r"/\*[\s\S]*?\*/", "", cleaned)
        stmts = [s.strip() for s in cleaned.split(";") if s.strip()]
        qregs: list[QuantumRegister] = []
        cregs: list[ClassicalRegister] = []
        q_off: dict[str, int] = {}
        c_off: dict[str, int] = {}
        tq = 0
        tc = 0
        pending_ops: list[tuple[str, tuple[int, ...], tuple[int, ...], tuple[Any, ...]]] = []

        def res_q(tok: str) -> list[int]:
            m = re.match(r"^([a-zA-Z_]\w*)\[(\d+)\]$", tok.strip())
            if m:
                return [q_off[m.group(1)] + int(m.group(2))]
            rname = tok.strip()
            reg = next(r for r in qregs if r.name == rname)
            base = q_off[rname]
            return [base + i for i in range(reg.size)]

        def res_c(tok: str) -> list[int]:
            m = re.match(r"^([a-zA-Z_]\w*)\[(\d+)\]$", tok.strip())
            if m:
                return [c_off[m.group(1)] + int(m.group(2))]
            rname = tok.strip()
            reg = next(r for r in cregs if r.name == rname)
            base = c_off[rname]
            return [base + i for i in range(reg.size)]

        for st in stmts:
            if re.match(r"^(OPENQASM|include)\b", st, re.I):
                continue
            qm = re.match(r"^qreg\s+([a-zA-Z_]\w*)\[(\d+)\]$", st)
            if qm:
                rn, rsz = qm.group(1), int(qm.group(2))
                q_off[rn] = tq
                qregs.append(QuantumRegister(rsz, rn))
                tq += rsz
                continue
            cm = re.match(r"^creg\s+([a-zA-Z_]\w*)\[(\d+)\]$", st)
            if cm:
                rn, rsz = cm.group(1), int(cm.group(2))
                c_off[rn] = tc
                cregs.append(ClassicalRegister(rsz, rn))
                tc += rsz
                continue
            mm = re.match(r"^measure\s+(.+?)\s*->\s*(.+)$", st, re.I)
            if mm:
                qs, cs = res_q(mm.group(1)), res_c(mm.group(2))
                for q, c in zip(qs, cs):
                    pending_ops.append(("measure", (q,), (c,), ()))
                continue
            gm = re.match(r"^([a-zA-Z_]\w*)(?:\(([^)]*)\))?\s+(.+)$", st)
            if not gm:
                raise ValueError(f"Unsupported QASM statement: {st!r}")
            op = ISA_ALIASES.get(gm.group(1).lower(), gm.group(1).lower())
            params = tuple(p.strip() for p in gm.group(2).split(",") if p.strip()) if gm.group(2) else ()
            arg_lists = [res_q(tok) for tok in gm.group(3).split(",")]
            if op == "barrier":
                flat = tuple(q for sub in arg_lists for q in sub)
                pending_ops.append(("barrier", flat, (), ()))
            else:
                blen = max(len(a) for a in arg_lists)
                for k in range(blen):
                    qtuple = tuple(a[0] if len(a) == 1 else a[k] for a in arg_lists)
                    pending_ops.append((op, qtuple, (), params))

        qc = cls(*(qregs + cregs), name=name)
        for op, qs, cs, ps in pending_ops:
            qc.append_op(op, qs, cs, ps)
        return qc


def normalize_circuit(qc: Any) -> NormalizedCircuit:
    """Converts either an upstream `qiskit.QuantumCircuit` or standalone `QuantumCircuit` into `NormalizedCircuit`."""
    if isinstance(qc, NormalizedCircuit):
        return qc
    if isinstance(qc, QuantumCircuit):
        return NormalizedCircuit(
            name=qc.name,
            num_qubits=qc.num_qubits,
            num_clbits=qc.num_clbits,
            qregs=[(r.name, r.size) for r in qc.qregs],
            cregs=[(r.name, r.size) for r in qc.cregs],
            instructions=list(qc._instructions),
            parameters=[p.name for p in qc.parameters],
        )

    # Upstream `qiskit.QuantumCircuit` conversion
    qregs = [(r.name, r.size) for r in getattr(qc, "qregs", [])]
    cregs = [(r.name, r.size) for r in getattr(qc, "cregs", [])]
    if not qregs and getattr(qc, "num_qubits", 0) > 0:
        qregs = [("q", qc.num_qubits)]
    if not cregs and getattr(qc, "num_clbits", 0) > 0:
        cregs = [("c", qc.num_clbits)]

    instrs: list[NormalizedInstruction] = []
    for item in qc.data:
        op = item.operation
        qubits = tuple(qc.find_bit(q).index for q in item.qubits)
        clbits = tuple(qc.find_bit(c).index for c in item.clbits)
        params: list[float | str] = []
        for p in getattr(op, "params", ()):
            if isinstance(p, (int, float)):
                params.append(float(p))
            elif hasattr(p, "name") and not hasattr(p, "parameters"):
                params.append(str(p.name))
            else:
                params.append(str(p))
        instrs.append(
            NormalizedInstruction(
                name=ISA_ALIASES.get(op.name.lower(), op.name.lower()),
                qubits=qubits,
                clbits=clbits,
                params=tuple(params),
            )
        )

    param_names = sorted(str(p.name) for p in getattr(qc, "parameters", ()))
    return NormalizedCircuit(
        name=getattr(qc, "name", "qiskit_circuit"),
        num_qubits=int(qc.num_qubits),
        num_clbits=int(qc.num_clbits),
        qregs=qregs,
        cregs=cregs,
        instructions=instrs,
        parameters=param_names,
    )


class VerdantAqmTarget:
    """Unbounded all-to-all Qiskit `Target` descriptor (`num_qubits = None`)."""

    description = "Unbounded all-to-all Prism-verified Target for VerdantAqmBackend"
    num_qubits: int | None = None
    dt: float | None = None
    granularity: int = 1
    min_length: int = 1
    pulse_alignment: int = 1
    acquire_alignment: int = 1

    @property
    def operation_names(self) -> list[str]:
        # Canonical 28 Qiskit target operations
        return [name for name, *_ in TARGET_ISA_28 if name != "barrier"]

    def instruction_supported(self, operation_name: str, qargs: Sequence[int] | None = None) -> bool:
        canon = ISA_ALIASES.get(operation_name.lower(), operation_name.lower())
        if canon not in ISA_INFO_MAP:
            return False
        if qargs is None:
            return True
        arity = ISA_INFO_MAP[canon][0]
        if arity != "variadic" and len(qargs) != arity:
            return False
        if any((not isinstance(q, int) or q < 0) for q in qargs):
            return False
        if len(set(qargs)) != len(qargs):
            return False
        return True

    def qargs_for_operation_name(self, operation_name: str) -> None:
        if not self.instruction_supported(operation_name):
            raise KeyError(f"Operation '{operation_name}' is not in Target.")
        return None


def _build_upstream_qiskit_target() -> Any:
    """Builds a native `qiskit.transpiler.Target(num_qubits=None)` with global all-to-all instructions."""
    from qiskit.circuit import Parameter as QParam  # type: ignore[import-not-found]

    th, ph, lm = QParam("theta"), QParam("phi"), QParam("lam")
    target = _QiskitTarget(
        description="Unbounded all-to-all Prism-verified Target for VerdantAqmBackend",
        num_qubits=None,
    )
    global_ops = [
        IGate(), XGate(), YGate(), ZGate(), HGate(),
        SGate(), SdgGate(), SXGate(), SXdgGate(), TGate(), TdgGate(),
        RXGate(th), RYGate(th), RZGate(th), PhaseGate(lm), UGate(th, ph, lm),
        CXGate(), CZGate(), CYGate(), CHGate(), SwapGate(), ECRGate(),
        RXXGate(th), RZZGate(th), CCXGate(), CSwapGate(),
        _QiskitMeasure(), _QiskitReset(),
    ]
    for gate in global_ops:
        target.add_instruction(gate, {None: None})
    target.add_instruction(_QiskitBarrier, name="barrier")
    return target


def _eval_angle(expr: float | str, bindings: dict[str, float]) -> float:
    if isinstance(expr, (int, float)):
        return float(expr)
    s = expr.strip()
    if s in bindings:
        return float(bindings[s])
    env: dict[str, Any] = {"pi": math.pi, "PI": math.pi, **bindings}
    if not re.match(r"^[0-9a-zA-Z_+\-*/().\s]+$", s):
        raise ValueError(f"Unsafe or invalid parameter expression: {expr!r}")
    return float(eval(s, {"__builtins__": {}}, env))  # noqa: S307 - restricted arithmetic token set


def _format_qiskit_bitstring(clbits: list[int], cregs: list[tuple[str, int]]) -> str:
    if not clbits:
        return "0x0"
    if len(cregs) <= 1:
        return "".join("1" if b else "0" for b in reversed(clbits))
    segments: list[str] = []
    offset = 0
    slices: list[tuple[int, int]] = []
    for _name, sz in cregs:
        slices.append((offset, sz))
        offset += sz
    for start, sz in reversed(slices):
        seg = "".join("1" if clbits[start + k] else "0" for k in range(sz - 1, -1, -1))
        segments.append(seg)
    return " ".join(segments)


def _bitstring_to_hex(formatted: str) -> str:
    clean = formatted.replace(" ", "")
    return "0x0" if not clean else hex(int(clean, 2))


# ============================================================================
# Substrate 1: Unbounded Exact Cyclotomic Ring `Z[zeta_8] / sqrt(2)^k`
# ============================================================================

Z8 = tuple[int, int, int, int]  # a0 + a1*z + a2*z^2 + a3*z^3, z = exp(i*pi/4)


def _z8_add(a: Z8, b: Z8) -> Z8:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3])


def _z8_sub(a: Z8, b: Z8) -> Z8:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3])


def _z8_neg(a: Z8) -> Z8:
    return (-a[0], -a[1], -a[2], -a[3])


def _z8_mul_zeta(a: Z8, power_mod_8: int) -> Z8:
    r = a
    for _ in range(power_mod_8 % 8):
        r = (-r[3], r[0], r[1], r[2])
    return r


def _z8_mul_sqrt2(a: Z8) -> Z8:
    # (zeta - zeta^3) * (a0 + a1*z + a2*z^2 + a3*z^3)
    return (a[1] - a[3], a[0] + a[2], a[1] + a[3], a[2] - a[0])


def _z8_abs_sq(a: Z8) -> tuple[int, int]:
    # Returns exact (p, q) in Z[sqrt(2)] such that |a|^2 = p + q * sqrt(2)
    a0, a1, a2, a3 = a
    p = a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3
    q = a0 * a1 + a1 * a2 + a2 * a3 - a3 * a0
    return (p, q)


def _z8_to_complex(a: Z8, k: int) -> complex:
    # Arbitrary-depth BigInt right-shift so k > 1,075 never underflows IEEE-754 float (0.5 ** k == 0.0)!
    half_k = k // 2
    if half_k > 900:
        shift = half_k - 900
        a = (a[0] >> shift, a[1] >> shift, a[2] >> shift, a[3] >> shift)
        half_k = 900
    s = math.sqrt(0.5)
    re = a[0] + (a[1] - a[3]) * s
    im = a[2] + (a[1] + a[3]) * s
    scale = (0.5**half_k) * (s if (k & 1) else 1.0)
    return complex(re * scale, im * scale)


def _z8_prob_scaled(a: Z8, k_den: int) -> float:
    """Computes exact `|a|^2 / 2^k_den` in [0, 1] without IEEE-754 underflow/overflow at arbitrary Hadamard depth."""
    p, q_s2 = _z8_abs_sq(a)
    if k_den > 900:
        shift = k_den - 900
        return ((p >> shift) + (q_s2 >> shift) * math.sqrt(2.0)) * (0.5**900)
    return (p + q_s2 * math.sqrt(2.0)) * (0.5**k_den)


def _commutes_exact_steps(
    a: tuple[str, tuple[int, ...]], b: tuple[str, tuple[int, ...]]
) -> bool:
    """Legal gate-commutation oracle matching `prismKernel.ts::verifyGateCommutationLegal` (`AQ-17`)."""
    op_a, qa = a
    op_b, qb = b
    if set(qa).isdisjoint(qb):
        return True
    diag_1q = {"z", "s", "t", "_p8"}
    if op_a in diag_1q and op_b in diag_1q and qa == qb:
        return True
    # Diagonal Z_8 gates commute with CX control wire and both CZ wires!
    if op_a in diag_1q and op_b == "cx" and qa[0] == qb[0]:
        return True
    if op_b in diag_1q and op_a == "cx" and qb[0] == qa[0]:
        return True
    if op_a in diag_1q and op_b == "cz" and qa[0] in qb:
        return True
    if op_b in diag_1q and op_a == "cz" and qb[0] in qa:
        return True
    if op_a == "cz" and op_b == "cz":
        return True
    if op_a == "cx" and op_b == "cx" and qa[0] != qb[1] and qb[0] != qa[1]:
        return True
    return False


def _decompose_exact_gate_sequence(
    instructions: Sequence[NormalizedInstruction],
    bindings: dict[str, float],
    enable_fusion: bool = True,
) -> tuple[list[tuple[str, tuple[int, ...]]], int]:
    """Decomposes Clifford+T+CCX+CSWAP gates and runs commutation-aware AQ-17 Z_8 phase-monoid fusion."""
    raw: list[tuple[str, tuple[int, ...]]] = []

    def push_tdg(q: int) -> None:
        raw.extend((("z", (q,)), ("s", (q,)), ("t", (q,))))

    def push_sdg(q: int) -> None:
        raw.extend((("z", (q,)), ("s", (q,))))

    def push_toffoli(c1: int, c2: int, t: int) -> None:
        raw.append(("h", (t,)))
        raw.append(("cx", (c2, t)))
        push_tdg(t)
        raw.append(("cx", (c1, t)))
        raw.append(("t", (t,)))
        raw.append(("cx", (c2, t)))
        push_tdg(t)
        raw.append(("cx", (c1, t)))
        raw.append(("t", (c2,)))
        raw.append(("t", (t,)))
        raw.append(("h", (t,)))
        raw.append(("cx", (c1, c2)))
        raw.append(("t", (c1,)))
        push_tdg(c2)
        raw.append(("cx", (c1, c2)))

    for inst in instructions:
        c = ISA_ALIASES.get(inst.name, inst.name)
        qs = inst.qubits
        if c in ("id", "barrier"):
            continue
        if c in ("h", "x", "y", "z", "s", "t", "cx", "cz", "swap"):
            raw.append((c, qs))
        elif c == "sdg":
            push_sdg(qs[0])
        elif c == "tdg":
            push_tdg(qs[0])
        elif c == "sx":
            raw.extend((("h", (qs[0],)), ("s", (qs[0],)), ("h", (qs[0],))))
        elif c == "sxdg":
            raw.append(("h", (qs[0],)))
            push_sdg(qs[0])
            raw.append(("h", (qs[0],)))
        elif c == "p":
            ang = _eval_angle(inst.params[0], bindings)
            octant = int(round(ang / (math.pi / 4))) % 8
            if octant & 4:
                raw.append(("z", (qs[0],)))
            if octant & 2:
                raw.append(("s", (qs[0],)))
            if octant & 1:
                raw.append(("t", (qs[0],)))
        elif c == "cy":
            push_sdg(qs[1])
            raw.append(("cx", (qs[0], qs[1])))
            raw.append(("s", (qs[1],)))
        elif c == "ch":
            push_sdg(qs[1])
            raw.extend((("h", (qs[1],)), ("t", (qs[1],)), ("h", (qs[1],)), ("s", (qs[1],))))
            raw.append(("cx", (qs[0], qs[1])))
            push_sdg(qs[1])
            raw.append(("h", (qs[1],)))
            push_tdg(qs[1])
            raw.extend((("h", (qs[1],)), ("s", (qs[1],))))
        elif c == "ecr":
            raw.extend(
                (
                    ("h", (qs[0],)),
                    ("cx", (qs[1], qs[0])),
                    ("s", (qs[0],)),
                    ("cx", (qs[1], qs[0])),
                    ("h", (qs[0],)),
                    ("x", (qs[1],)),
                )
            )
        elif c == "ccx":
            push_toffoli(qs[0], qs[1], qs[2])
        elif c == "cswap":
            raw.append(("cx", (qs[2], qs[1])))
            push_toffoli(qs[0], qs[1], qs[2])
            raw.append(("cx", (qs[2], qs[1])))
        else:
            raise ValueError(f"Gate '{c}' requires continuous substrate.")

    if not enable_fusion:
        return raw, 0

    # Commutation-aware AQ-17 canonical Z_8 octant fusion & cascade involution cancellation
    phase_weight = {"z": 4, "s": 2, "t": 1}
    working: list[tuple[str, tuple[int, ...], int]] = []

    def push_fused(op_in: str, qs_in: tuple[int, ...], oct_in: int) -> None:
        op = "_p8" if op_in in phase_weight else op_in
        oct_val = phase_weight[op_in] if op_in in phase_weight else oct_in
        scan_limit = max(0, len(working) - 32)
        for k in range(len(working) - 1, scan_limit - 1, -1):
            prev_op, prev_qs, prev_oct = working[k]
            if len(qs_in) == 1 and len(prev_qs) == 1 and qs_in == prev_qs:
                if op == "_p8" and prev_op == "_p8":
                    total_oct = (prev_oct + oct_val) % 8
                    if total_oct == 0:
                        tail_reinsert = working[k + 1 :]
                        del working[k:]
                        for t_op, t_qs, t_oct in tail_reinsert:
                            push_fused(t_op, t_qs, t_oct)
                    else:
                        working[k] = ("_p8", qs_in, total_oct)
                    return
                if op in ("h", "x", "y") and prev_op == op:
                    tail_reinsert = working[k + 1 :]
                    del working[k:]
                    for t_op, t_qs, t_oct in tail_reinsert:
                        push_fused(t_op, t_qs, t_oct)
                    return
            elif len(qs_in) == 2 and len(prev_qs) == 2:
                same_ord = qs_in == prev_qs
                same_sym = qs_in == prev_qs or qs_in == (prev_qs[1], prev_qs[0])
                if (op == "cx" and prev_op == "cx" and same_ord) or (
                    op in ("cz", "swap") and prev_op == op and same_sym
                ):
                    tail_reinsert = working[k + 1 :]
                    del working[k:]
                    for t_op, t_qs, t_oct in tail_reinsert:
                        push_fused(t_op, t_qs, t_oct)
                    return

            if not _commutes_exact_steps((prev_op, prev_qs), (op, qs_in)):
                break

        working.append((op, qs_in, oct_val))

    for op_raw, qs_raw in raw:
        push_fused(op_raw, qs_raw, 0)

    expanded_out: list[tuple[str, tuple[int, ...]]] = []
    for op_w, qs_w, oct_w in working:
        if op_w == "_p8":
            if oct_w & 4:
                expanded_out.append(("z", qs_w))
            if oct_w & 2:
                expanded_out.append(("s", qs_w))
            if oct_w & 1:
                expanded_out.append(("t", qs_w))
        else:
            expanded_out.append((op_w, qs_w))

    return expanded_out, max(0, len(raw) - len(expanded_out))


def execute_sparse_cyclotomic(
    steps: Sequence[tuple[str, tuple[int, ...]]],
) -> tuple[dict[int, Z8], int, bool]:
    """Executes Clifford+T steps over arbitrary-precision `int` ket masks in `Z[zeta_8] / sqrt(2)^k`."""
    support: dict[int, Z8] = {0: (1, 0, 0, 0)}
    k = 0

    for op, qs in steps:
        if op == "h":
            bit = 1 << qs[0]
            visited: set[int] = set()
            nxt: dict[int, Z8] = {}
            for ket in support:
                k0 = ket & ~bit
                if k0 in visited:
                    continue
                visited.add(k0)
                k1 = k0 | bit
                a0 = support.get(k0, (0, 0, 0, 0))
                a1 = support.get(k1, (0, 0, 0, 0))
                y0 = _z8_add(a0, a1)
                y1 = _z8_sub(a0, a1)
                if any(y0):
                    nxt[k0] = y0
                if any(y1):
                    nxt[k1] = y1
            k += 1
            # Exact power-of-2 reduction when all integer coordinates are even and k >= 2
            while k >= 2 and nxt and all(((c & 1) == 0 for v in nxt.values() for c in v)):
                nxt = {ket: (v[0] >> 1, v[1] >> 1, v[2] >> 1, v[3] >> 1) for ket, v in nxt.items()}
                k -= 2
            support = nxt
        elif op == "x":
            bit = 1 << qs[0]
            support = {ket ^ bit: amp for ket, amp in support.items()}
        elif op == "z":
            bit = 1 << qs[0]
            support = {ket: (_z8_neg(amp) if (ket & bit) else amp) for ket, amp in support.items()}
        elif op == "y":
            bit = 1 << qs[0]
            # Y|0> = i|1> (z^2), Y|1> = -i|0> (z^6)
            support = {
                ket ^ bit: _z8_mul_zeta(amp, 6 if (ket & bit) else 2)
                for ket, amp in support.items()
            }
        elif op == "s":
            bit = 1 << qs[0]
            support = {ket: (_z8_mul_zeta(amp, 2) if (ket & bit) else amp) for ket, amp in support.items()}
        elif op == "t":
            bit = 1 << qs[0]
            support = {ket: (_z8_mul_zeta(amp, 1) if (ket & bit) else amp) for ket, amp in support.items()}
        elif op == "cx":
            cbit, tbit = 1 << qs[0], 1 << qs[1]
            support = {(ket ^ tbit if (ket & cbit) else ket): amp for ket, amp in support.items()}
        elif op == "cz":
            mask = (1 << qs[0]) | (1 << qs[1])
            support = {
                ket: (_z8_neg(amp) if (ket & mask) == mask else amp)
                for ket, amp in support.items()
            }
        elif op == "swap":
            b0, b1 = 1 << qs[0], 1 << qs[1]
            mask = b0 | b1
            nxt = {}
            for ket, amp in support.items():
                sub = ket & mask
                swapped = ket ^ mask if sub in (b0, b1) else ket
                nxt[swapped] = amp
            support = nxt

    total_p, total_q = 0, 0
    for amp in support.values():
        p, q = _z8_abs_sq(amp)
        total_p += p
        total_q += q

    # Check exact norm identity in Z[sqrt(2)]: sum |alpha|^2 == (sqrt(2)^k)^2 = 2^k!
    norm_exact_one = (total_p == (1 << k)) and (total_q == 0)
    return support, k, norm_exact_one


# ============================================================================
# Substrate 2: Unbounded Packed Bit-Plane `F_2` Stabilizer Tableau (`AQ-04`)
# ============================================================================


@dataclass
class PackedStabilizerTableau:
    """Column-packed Aaronson-Gottesman tableau using Python arbitrary-precision `int` bitmasks.

    Row indices `0..n-1` are destabilizers; row indices `n..2n-1` are stabilizers.
    `x_cols[q]` has bit `i` set iff generator `i` has `X` on qubit `q`.
    `z_cols[q]` has bit `i` set iff generator `i` has `Z` on qubit `q`.
    `r_mask` has bit `i` set iff generator `i` has `-1` phase.
    """

    num_qubits: int
    x_cols: list[int]
    z_cols: list[int]
    r_mask: int = 0

    @classmethod
    def ground_state(cls, n: int) -> PackedStabilizerTableau:
        x_cols = [1 << q for q in range(n)]
        z_cols = [1 << (n + q) for q in range(n)]
        return cls(n, x_cols, z_cols, 0)

    def copy(self) -> PackedStabilizerTableau:
        return PackedStabilizerTableau(self.num_qubits, list(self.x_cols), list(self.z_cols), self.r_mask)

    def apply_unitary(self, op: str, qs: tuple[int, ...]) -> None:
        if op == "h":
            q = qs[0]
            self.r_mask ^= self.x_cols[q] & self.z_cols[q]
            self.x_cols[q], self.z_cols[q] = self.z_cols[q], self.x_cols[q]
        elif op == "s":
            q = qs[0]
            self.r_mask ^= self.x_cols[q] & self.z_cols[q]
            self.z_cols[q] ^= self.x_cols[q]
        elif op == "x":
            q = qs[0]
            self.r_mask ^= self.z_cols[q]
        elif op == "z":
            q = qs[0]
            self.r_mask ^= self.x_cols[q]
        elif op == "y":
            q = qs[0]
            self.r_mask ^= self.x_cols[q] ^ self.z_cols[q]
        elif op == "cx":
            a, b = qs[0], qs[1]
            xa, za = self.x_cols[a], self.z_cols[a]
            xb, zb = self.x_cols[b], self.z_cols[b]
            all_rows = (1 << (2 * self.num_qubits)) - 1
            self.r_mask ^= xa & zb & (xb ^ za ^ all_rows)
            self.x_cols[b] = xb ^ xa
            self.z_cols[a] = za ^ zb
        elif op == "cz":
            a, b = qs[0], qs[1]
            self.apply_unitary("h", (b,))
            self.apply_unitary("cx", (a, b))
            self.apply_unitary("h", (b,))
        elif op == "swap":
            a, b = qs[0], qs[1]
            self.x_cols[a], self.x_cols[b] = self.x_cols[b], self.x_cols[a]
            self.z_cols[a], self.z_cols[b] = self.z_cols[b], self.z_cols[a]

    def _compile_affine_internal(
        self, measured_wires: Sequence[int], commit_first_outcome: int | None = None
    ) -> tuple[int, dict[int, tuple[int, int]]]:
        n = self.num_qubits
        rows = 2 * n
        full_mask = (1 << n) - 1
        row_x = [0] * rows
        row_z = [0] * rows
        row_r = [1 if (self.r_mask & (1 << r)) else 0 for r in range(rows)]
        row_coins = [0] * rows

        for q in range(n):
            q_bit = 1 << q
            cx = self.x_cols[q]
            while cx:
                lb = cx & -cx
                row_x[lb.bit_length() - 1] |= q_bit
                cx ^= lb
            cz = self.z_cols[q]
            while cz:
                lb = cz & -cz
                row_z[lb.bit_length() - 1] |= q_bit
                cz ^= lb

        def rowsum(h: int, i: int) -> None:
            x1, z1 = row_x[i], row_z[i]
            x2, z2 = row_x[h], row_z[h]
            nx1, nz1 = x1 ^ full_mask, z1 ^ full_mask
            nx2, nz2 = x2 ^ full_mask, z2 ^ full_mask
            pos = (x1 & z1 & nx2 & z2) | (x1 & nz1 & x2 & z2) | (nx1 & z1 & x2 & nz2)
            neg = (x1 & z1 & x2 & nz2) | (nx1 & z1 & x2 & z2) | (x1 & nz1 & nx2 & z2)
            acc = 2 * row_r[h] + 2 * row_r[i] + pos.bit_count() - neg.bit_count()
            row_r[h] = 1 if (acc & 3) == 2 else 0
            row_x[h] = x2 ^ x1
            row_z[h] = z2 ^ z1
            row_coins[h] ^= row_coins[i]

        wire_laws: dict[int, tuple[int, int]] = {}
        num_coins = 0

        for wire in measured_wires:
            if wire in wire_laws:
                continue
            w_bit = 1 << wire
            p_row = -1
            for p in range(n, rows):
                if row_x[p] & w_bit:
                    p_row = p
                    break

            if p_row >= 0:
                for h in range(rows):
                    if h != p_row and h != (p_row - n) and (row_x[h] & w_bit):
                        rowsum(h, p_row)
                dst = p_row - n
                row_x[dst] = row_x[p_row]
                row_z[dst] = row_z[p_row]
                row_r[dst] = row_r[p_row]
                row_coins[dst] = row_coins[p_row]

                row_x[p_row] = 0
                row_z[p_row] = w_bit
                row_r[p_row] = int(commit_first_outcome) if commit_first_outcome is not None else 0
                coin_bit = 1 << num_coins
                num_coins += 1
                row_coins[p_row] = coin_bit
                wire_laws[wire] = (0, coin_bit)

                if commit_first_outcome is not None:
                    self.x_cols = [0] * n
                    self.z_cols = [0] * n
                    new_r = 0
                    for r_idx in range(rows):
                        rb = 1 << r_idx
                        if row_r[r_idx]:
                            new_r |= rb
                        rx_val = row_x[r_idx]
                        while rx_val:
                            lb = rx_val & -rx_val
                            self.x_cols[lb.bit_length() - 1] |= rb
                            rx_val ^= lb
                        rz_val = row_z[r_idx]
                        while rz_val:
                            lb = rz_val & -rz_val
                            self.z_cols[lb.bit_length() - 1] |= rb
                            rz_val ^= lb
                    self.r_mask = new_r
            else:
                sx = 0
                sz = 0
                sr = 0
                scoins = 0
                for d_idx in range(n):
                    if row_x[d_idx] & w_bit:
                        s_row = d_idx + n
                        x1, z1 = row_x[s_row], row_z[s_row]
                        nx1, nz1 = x1 ^ full_mask, z1 ^ full_mask
                        nx2, nz2 = sx ^ full_mask, sz ^ full_mask
                        pos = (x1 & z1 & nx2 & sz) | (x1 & nz1 & sx & sz) | (nx1 & z1 & sx & nz2)
                        neg = (x1 & z1 & sx & nz2) | (nx1 & z1 & sx & sz) | (x1 & nz1 & nx2 & sz)
                        acc = 2 * sr + 2 * row_r[s_row] + pos.bit_count() - neg.bit_count()
                        sr = 1 if (acc & 3) == 2 else 0
                        sx ^= x1
                        sz ^= z1
                        scoins ^= row_coins[s_row]
                wire_laws[wire] = (sr, scoins)

        return num_coins, wire_laws

    def compile_affine_measurement_frame(
        self, measured_wires: Sequence[int]
    ) -> tuple[int, dict[int, tuple[int, int]]]:
        """Compiles Z-basis measurements into an exact F_2-affine frame (`inv013AffineStabilizerFrameExact`)."""
        return self._compile_affine_internal(measured_wires, commit_first_outcome=None)

    def measure_z(self, wire: int, rng: random.Random) -> int:
        """In-place single-wire projective Z collapse for mid-circuit reset/measurement paths."""
        stab_x = self.x_cols[wire] >> self.num_qubits
        if stab_x != 0:
            drawn = 1 if rng.random() >= 0.5 else 0
            self._compile_affine_internal([wire], commit_first_outcome=drawn)
            return drawn
        _, laws = self._compile_affine_internal([wire], commit_first_outcome=None)
        return laws[wire][0]


# ============================================================================
# Substrate 2B: Exact Rank-Revealing Tensor-Train MPS (`ExactMps`, `AQ-14`)
# ============================================================================


@dataclass
class MpsSite:
    chi_l: int
    chi_r: int
    m0: list[complex]  # row-major chi_l * chi_r
    m1: list[complex]  # row-major chi_l * chi_r


@dataclass
class ExactMpsTensorTrain:
    """1D Matrix Product State (`ExactMps`) with rank-revealing column-pivoted Gram-Schmidt QR compression."""

    num_qubits: int
    sites: list[MpsSite]
    max_bond_cap: int = 64

    @classmethod
    def ground_state(cls, n: int, max_bond_cap: int = 64) -> ExactMpsTensorTrain:
        sites = [MpsSite(1, 1, [1.0 + 0.0j], [0.0 + 0.0j]) for _ in range(n)]
        return cls(n, sites, max_bond_cap)

    def max_bond_dim(self) -> int:
        if self.num_qubits <= 1:
            return 1
        return max((s.chi_r for s in self.sites[:-1]), default=1)

    def apply_1q(self, q: int, op: str) -> None:
        s = self.sites[q]
        ln = s.chi_l * s.chi_r
        inv_s2 = math.sqrt(0.5)
        zeta = cmath.exp(1j * math.pi / 4.0)
        m0_out = [0j] * ln
        m1_out = [0j] * ln
        for idx in range(ln):
            u0, u1 = s.m0[idx], s.m1[idx]
            if op == "h":
                m0_out[idx] = (u0 + u1) * inv_s2
                m1_out[idx] = (u0 - u1) * inv_s2
            elif op == "x":
                m0_out[idx], m1_out[idx] = u1, u0
            elif op == "y":
                m0_out[idx], m1_out[idx] = -1j * u1, 1j * u0
            elif op == "z":
                m0_out[idx], m1_out[idx] = u0, -u1
            elif op == "s":
                m0_out[idx], m1_out[idx] = u0, 1j * u1
            elif op == "t":
                m0_out[idx], m1_out[idx] = u0, zeta * u1
            else:
                m0_out[idx], m1_out[idx] = u0, u1
        self.sites[q] = MpsSite(s.chi_l, s.chi_r, m0_out, m1_out)

    def _apply_adjacent_2q(self, k: int, op: str, reverse_ctrl: bool) -> None:
        sa = self.sites[k]
        sb = self.sites[k + 1]
        chi_l, chi_m, chi_r = sa.chi_l, sa.chi_r, sb.chi_r
        rows = 2 * chi_l
        cols = 2 * chi_r
        theta = [0j] * (rows * cols)

        for s_a in (0, 1):
            mat_a = sa.m0 if s_a == 0 else sa.m1
            for s_b in (0, 1):
                mat_b = sb.m0 if s_b == 0 else sb.m1
                for a in range(chi_l):
                    for g in range(chi_r):
                        acc = 0j
                        for b in range(chi_m):
                            acc += mat_a[a * chi_m + b] * mat_b[b * chi_r + g]
                        theta[(s_a * chi_l + a) * cols + (s_b * chi_r + g)] = acc

        for a in range(chi_l):
            for g in range(chi_r):
                i01 = (0 * chi_l + a) * cols + (1 * chi_r + g)
                i10 = (1 * chi_l + a) * cols + (0 * chi_r + g)
                i11 = (1 * chi_l + a) * cols + (1 * chi_r + g)
                if op == "cx":
                    if not reverse_ctrl:
                        theta[i10], theta[i11] = theta[i11], theta[i10]
                    else:
                        theta[i01], theta[i11] = theta[i11], theta[i01]
                elif op == "cz":
                    theta[i11] = -theta[i11]
                elif op == "swap":
                    theta[i01], theta[i10] = theta[i10], theta[i01]

        # Rank-revealing column-pivoted Modified Gram-Schmidt QR: Theta == Q * R with minimal exact rank!
        res_cols = [[theta[r * cols + j] for r in range(rows)] for j in range(cols)]
        max_col_sq = max(
            (sum(v.real * v.real + v.imag * v.imag for v in col) for col in res_cols),
            default=0.0,
        )
        tol_sq = 1e-26 * max(1e-30, max_col_sq)
        q_basis: list[list[complex]] = []
        r_rows: list[list[complex]] = []
        limit_rank = min(rows, cols, self.max_bond_cap)

        while len(q_basis) < limit_rank:
            best_j = -1
            best_sq = 0.0
            for j in range(cols):
                nsq = sum(v.real * v.real + v.imag * v.imag for v in res_cols[j])
                if nsq > best_sq:
                    best_sq = nsq
                    best_j = j
            if best_j < 0 or best_sq <= tol_sq:
                break
            inv_n = 1.0 / math.sqrt(best_sq)
            q_vec = [v * inv_n for v in res_cols[best_j]]
            r_row = [0j] * cols
            for j in range(cols):
                proj = sum(q_vec[r].conjugate() * res_cols[j][r] for r in range(rows))
                r_row[j] = proj
                if proj != 0j:
                    for r in range(rows):
                        res_cols[j][r] -= q_vec[r] * proj
            q_basis.append(q_vec)
            r_rows.append(r_row)

        if not q_basis:
            q_basis = [[0j] * rows]
            r_rows = [[0j] * cols]

        rank = len(q_basis)
        a0 = [q_basis[k_idx][0 * chi_l + a] for a in range(chi_l) for k_idx in range(rank)]
        a1 = [q_basis[k_idx][1 * chi_l + a] for a in range(chi_l) for k_idx in range(rank)]
        b0 = [r_rows[k_idx][0 * chi_r + g] for k_idx in range(rank) for g in range(chi_r)]
        b1 = [r_rows[k_idx][1 * chi_r + g] for k_idx in range(rank) for g in range(chi_r)]
        self.sites[k] = MpsSite(chi_l, rank, a0, a1)
        self.sites[k + 1] = MpsSite(rank, chi_r, b0, b1)

    def apply_2q(self, w0: int, w1: int, op: str) -> None:
        low, high = min(w0, w1), max(w0, w1)
        rev = w0 > w1
        for k in range(low, high - 1):
            self._apply_adjacent_2q(k, "swap", False)
        self._apply_adjacent_2q(high - 1, op, rev)
        for k in range(high - 2, low - 1, -1):
            self._apply_adjacent_2q(k, "swap", False)


def execute_exact_mps_steps(
    num_qubits: int, steps: Sequence[tuple[str, tuple[int, ...]]], max_bond_cap: int = 64
) -> ExactMpsTensorTrain:
    mps = ExactMpsTensorTrain.ground_state(num_qubits, max_bond_cap=max_bond_cap)
    for op, qs in steps:
        if len(qs) == 1:
            mps.apply_1q(qs[0], op)
        else:
            mps.apply_2q(qs[0], qs[1], op)
    return mps


def compute_exact_mps_pauli_expectation(mps: ExactMpsTensorTrain, pauli_label: str) -> float:
    """Exact `O(n * chi^3)` transfer-matrix contraction `<psi | P | psi> / <psi | psi>` with joint trace rescaling."""
    n = mps.num_qubits
    p_str = pauli_label.strip().upper()
    if len(p_str) != n:
        raise ValueError(f"Pauli observable '{p_str}' length ({len(p_str)}) != {n}")

    norm_env = [1.0 + 0.0j]
    op_env = [1.0 + 0.0j]

    def step_transfer(
        env: list[complex],
        b0: list[complex],
        b1: list[complex],
        k0: list[complex],
        k1: list[complex],
        dl: int,
        dr: int,
    ) -> list[complex]:
        out = [0j] * (dr * dr)
        for bra, ket in ((b0, k0), (b1, k1)):
            tmp = [0j] * (dl * dr)
            for a in range(dl):
                for b in range(dl):
                    ev = env[a * dl + b]
                    if ev == 0j:
                        continue
                    for g in range(dr):
                        tmp[a * dr + g] += ev * ket[b * dr + g]
            for a in range(dl):
                for g1 in range(dr):
                    cv = bra[a * dr + g1].conjugate()
                    if cv == 0j:
                        continue
                    for g2 in range(dr):
                        out[g1 * dr + g2] += cv * tmp[a * dr + g2]
        return out

    for q in range(n):
        s = mps.sites[q]
        dl, dr = s.chi_l, s.chi_r
        ch = p_str[n - 1 - q]
        if ch == "I":
            k0, k1 = s.m0, s.m1
        elif ch == "X":
            k0, k1 = s.m1, s.m0
        elif ch == "Z":
            k0, k1 = s.m0, [-v for v in s.m1]
        elif ch == "Y":
            k0, k1 = [-1j * v for v in s.m1], [1j * v for v in s.m0]
        else:
            raise ValueError(f"Unsupported Pauli character '{ch}' in '{p_str}'.")

        norm_env = step_transfer(norm_env, s.m0, s.m1, s.m0, s.m1, dl, dr)
        op_env = step_transfer(op_env, s.m0, s.m1, k0, k1, dl, dr)
        tr = sum(norm_env[g * dr + g].real for g in range(dr))
        scale = tr if tr > 1e-300 else 1.0
        norm_env = [v / scale for v in norm_env]
        op_env = [v / scale for v in op_env]

    denom = max(1e-30, norm_env[0].real)
    return op_env[0].real / denom


def sample_exact_mps_chain_rule(
    mps: ExactMpsTensorTrain,
    unique_wires: Sequence[int],
    shots: int,
    rng: random.Random,
) -> tuple[list[dict[int, int]], dict[int, float] | None]:
    """Sequential `O(n * chi^2)` per-shot chain-rule Born sampler + exact analytical marginals (`|W| <= 10`)."""
    n = mps.num_qubits
    right_envs: list[list[complex]] = [[1.0 + 0.0j] for _ in range(n + 1)]
    for q in range(n - 1, -1, -1):
        s = mps.sites[q]
        dl, dr = s.chi_l, s.chi_r
        r_next = right_envs[q + 1]
        cur = [0j] * (dl * dl)
        for mat in (s.m0, s.m1):
            tmp = [0j] * (dl * dr)
            for a in range(dl):
                for b in range(dr):
                    av = mat[a * dr + b]
                    if av == 0j:
                        continue
                    for g in range(dr):
                        tmp[a * dr + g] += av * r_next[b * dr + g]
            for a1 in range(dl):
                for g in range(dr):
                    tv = tmp[a1 * dr + g]
                    if tv == 0j:
                        continue
                    for a2 in range(dl):
                        cur[a1 * dl + a2] += tv * mat[a2 * dr + g].conjugate()
        tr = sum(abs(cur[a * dl + a].real) for a in range(dl))
        if tr > 0.0:
            cur = [v / tr for v in cur]
        right_envs[q] = cur

    if not unique_wires:
        return [{} for _ in range(shots)], {}

    meas_set = set(unique_wires)
    max_w = max(unique_wires)

    marginals: dict[int, float] | None = None
    if len(unique_wires) <= 10:
        wire_to_pos = {w: idx for idx, w in enumerate(unique_wires)}
        branches: list[tuple[int, list[complex]]] = [(0, [1.0 + 0.0j])]
        for q in range(max_w + 1):
            s = mps.sites[q]
            dl, dr = s.chi_l, s.chi_r
            bpos = wire_to_pos.get(q)

            def prop_one(env: list[complex], mat: list[complex]) -> list[complex]:
                out = [0j] * (dr * dr)
                tmp = [0j] * (dl * dr)
                for a in range(dl):
                    for b in range(dl):
                        ev = env[a * dl + b]
                        if ev == 0j:
                            continue
                        for g in range(dr):
                            tmp[a * dr + g] += ev * mat[b * dr + g]
                for a in range(dl):
                    for g1 in range(dr):
                        cv = mat[a * dr + g1].conjugate()
                        if cv == 0j:
                            continue
                        for g2 in range(dr):
                            out[g1 * dr + g2] += cv * tmp[a * dr + g2]
                return out

            nxt_b: list[tuple[int, list[complex]]] = []
            for mask, env in branches:
                e0 = prop_one(env, s.m0)
                e1 = prop_one(env, s.m1)
                if bpos is not None:
                    nxt_b.append((mask, e0))
                    nxt_b.append((mask | (1 << bpos), e1))
                else:
                    nxt_b.append((mask, [x + y for x, y in zip(e0, e1)]))
            j_tr = sum(max(0.0, env[g * dr + g].real) for _, env in nxt_b for g in range(dr))
            if j_tr > 0.0:
                nxt_b = [(m, [v / j_tr for v in env]) for m, env in nxt_b]
            branches = nxt_b

        tail_r = right_envs[max_w + 1]
        dt = mps.sites[max_w].chi_r
        raw_w: list[tuple[int, float]] = []
        w_sum = 0.0
        for mask, env in branches:
            val = 0.0
            for g1 in range(dt):
                for g2 in range(dt):
                    val += (env[g1 * dt + g2] * tail_r[g2 * dt + g1]).real
            pw = max(0.0, val)
            raw_w.append((mask, pw))
            w_sum += pw
        inv_s = 1.0 / max(1e-30, w_sum)
        marginals = {m: pw * inv_s for m, pw in raw_w if pw * inv_s > 1e-16}

    shot_outcomes: list[dict[int, int]] = []
    for _ in range(shots):
        out_map: dict[int, int] = {}
        vec = [1.0 + 0.0j]
        for q in range(max_w + 1):
            s = mps.sites[q]
            dl, dr = s.chi_l, s.chi_r
            r_mat = right_envs[q + 1]
            w0 = [0j] * dr
            w1 = [0j] * dr
            for a in range(dl):
                va = vec[a]
                if va == 0j:
                    continue
                for g in range(dr):
                    w0[g] += va * s.m0[a * dr + g]
                    w1[g] += va * s.m1[a * dr + g]

            def qweight(wv: list[complex]) -> float:
                acc = 0.0
                for g1 in range(dr):
                    if wv[g1] == 0j:
                        continue
                    for g2 in range(dr):
                        acc += (wv[g1] * r_mat[g1 * dr + g2] * wv[g2].conjugate()).real
                return max(0.0, acc)

            u0 = qweight(w0)
            u1 = qweight(w1)
            tot = u0 + u1
            p1 = min(1.0, max(0.0, u1 / tot)) if tot > 1e-30 else 0.5
            bit = 1 if rng.random() < p1 else 0
            if q in meas_set:
                out_map[q] = bit
            chosen = w1 if bit == 1 else w0
            nsq = sum(v.real * v.real + v.imag * v.imag for v in chosen)
            inv_n = 1.0 / math.sqrt(nsq) if nsq > 1e-30 else 1.0
            vec = [v * inv_n for v in chosen]
        shot_outcomes.append(out_map)

    return shot_outcomes, marginals


# ============================================================================
# Substrate 3: Unbounded Sparse Complex Continuum (`ExactSparseContinuum`)
# ============================================================================

EPS_PRUNE = 1e-15


def _apply_1q_sparse(
    state: dict[int, complex],
    wire: int,
    m00: complex,
    m01: complex,
    m10: complex,
    m11: complex,
) -> dict[int, complex]:
    bit = 1 << wire
    visited: set[int] = set()
    nxt: dict[int, complex] = {}
    for ket in state:
        k0 = ket & ~bit
        if k0 in visited:
            continue
        visited.add(k0)
        k1 = k0 | bit
        x0 = state.get(k0, 0j)
        x1 = state.get(k1, 0j)
        y0 = m00 * x0 + m01 * x1
        y1 = m10 * x0 + m11 * x1
        if abs(y0) > EPS_PRUNE:
            nxt[k0] = y0
        if abs(y1) > EPS_PRUNE:
            nxt[k1] = y1
    return nxt


def _apply_controlled_1q_sparse(
    state: dict[int, complex],
    controls: Sequence[int],
    target: int,
    m00: complex,
    m01: complex,
    m10: complex,
    m11: complex,
) -> dict[int, complex]:
    cmask = 0
    for c in controls:
        cmask |= 1 << c
    tbit = 1 << target
    visited: set[int] = set()
    nxt: dict[int, complex] = {}
    for ket, amp in state.items():
        if (ket & cmask) != cmask:
            nxt[ket] = amp
            continue
        k0 = ket & ~tbit
        if k0 in visited:
            continue
        visited.add(k0)
        k1 = k0 | tbit
        x0 = state.get(k0, 0j)
        x1 = state.get(k1, 0j)
        y0 = m00 * x0 + m01 * x1
        y1 = m10 * x0 + m11 * x1
        if abs(y0) > EPS_PRUNE:
            nxt[k0] = y0
        if abs(y1) > EPS_PRUNE:
            nxt[k1] = y1
    return nxt


def apply_unitary_sparse_continuum(
    state: dict[int, complex],
    inst: NormalizedInstruction,
    bindings: dict[str, float],
) -> dict[int, complex]:
    c = ISA_ALIASES.get(inst.name, inst.name)
    qs = inst.qubits
    s = math.sqrt(0.5)
    if c in ("id", "barrier"):
        return state
    if c == "x":
        return _apply_1q_sparse(state, qs[0], 0j, 1 + 0j, 1 + 0j, 0j)
    if c == "y":
        return _apply_1q_sparse(state, qs[0], 0j, -1j, 1j, 0j)
    if c == "z":
        return _apply_1q_sparse(state, qs[0], 1 + 0j, 0j, 0j, -1 + 0j)
    if c == "h":
        return _apply_1q_sparse(state, qs[0], s, s, s, -s)
    if c == "s":
        return _apply_1q_sparse(state, qs[0], 1 + 0j, 0j, 0j, 1j)
    if c == "sdg":
        return _apply_1q_sparse(state, qs[0], 1 + 0j, 0j, 0j, -1j)
    if c == "sx":
        return _apply_1q_sparse(state, qs[0], 0.5 + 0.5j, 0.5 - 0.5j, 0.5 - 0.5j, 0.5 + 0.5j)
    if c == "sxdg":
        return _apply_1q_sparse(state, qs[0], 0.5 - 0.5j, 0.5 + 0.5j, 0.5 + 0.5j, 0.5 - 0.5j)
    if c == "t":
        return _apply_1q_sparse(state, qs[0], 1 + 0j, 0j, 0j, cmath.exp(1j * math.pi / 4))
    if c == "tdg":
        return _apply_1q_sparse(state, qs[0], 1 + 0j, 0j, 0j, cmath.exp(-1j * math.pi / 4))
    if c == "rx":
        th = _eval_angle(inst.params[0], bindings)
        ch, sh = math.cos(th / 2), math.sin(th / 2)
        return _apply_1q_sparse(state, qs[0], ch, -1j * sh, -1j * sh, ch)
    if c == "ry":
        th = _eval_angle(inst.params[0], bindings)
        ch, sh = math.cos(th / 2), math.sin(th / 2)
        return _apply_1q_sparse(state, qs[0], ch, -sh, sh, ch)
    if c == "rz":
        th = _eval_angle(inst.params[0], bindings)
        return _apply_1q_sparse(state, qs[0], cmath.exp(-0.5j * th), 0j, 0j, cmath.exp(0.5j * th))
    if c == "p":
        lm = _eval_angle(inst.params[0], bindings)
        return _apply_1q_sparse(state, qs[0], 1 + 0j, 0j, 0j, cmath.exp(1j * lm))
    if c == "u":
        th = _eval_angle(inst.params[0], bindings)
        ph = _eval_angle(inst.params[1], bindings)
        lm = _eval_angle(inst.params[2], bindings)
        ch, sh = math.cos(th / 2), math.sin(th / 2)
        return _apply_1q_sparse(
            state,
            qs[0],
            ch,
            -cmath.exp(1j * lm) * sh,
            cmath.exp(1j * ph) * sh,
            cmath.exp(1j * (ph + lm)) * ch,
        )
    if c == "cx":
        return _apply_controlled_1q_sparse(state, (qs[0],), qs[1], 0j, 1 + 0j, 1 + 0j, 0j)
    if c == "cz":
        return _apply_controlled_1q_sparse(state, (qs[0],), qs[1], 1 + 0j, 0j, 0j, -1 + 0j)
    if c == "cy":
        return _apply_controlled_1q_sparse(state, (qs[0],), qs[1], 0j, -1j, 1j, 0j)
    if c == "ch":
        return _apply_controlled_1q_sparse(state, (qs[0],), qs[1], s, s, s, -s)
    if c == "swap":
        b0, b1 = 1 << qs[0], 1 << qs[1]
        mask = b0 | b1
        return {
            (ket ^ mask if (ket & mask) in (b0, b1) else ket): amp
            for ket, amp in state.items()
        }
    if c == "ecr":
        st = _apply_1q_sparse(state, qs[0], s, s, s, -s)
        st = _apply_controlled_1q_sparse(st, (qs[1],), qs[0], 0j, 1 + 0j, 1 + 0j, 0j)
        st = _apply_1q_sparse(st, qs[0], 1 + 0j, 0j, 0j, 1j)
        st = _apply_controlled_1q_sparse(st, (qs[1],), qs[0], 0j, 1 + 0j, 1 + 0j, 0j)
        st = _apply_1q_sparse(st, qs[0], s, s, s, -s)
        return _apply_1q_sparse(st, qs[1], 0j, 1 + 0j, 1 + 0j, 0j)
    if c == "rzz":
        th = _eval_angle(inst.params[0], bindings)
        b0, b1 = 1 << qs[0], 1 << qs[1]
        mask = b0 | b1
        p_same = cmath.exp(-0.5j * th)
        p_diff = cmath.exp(0.5j * th)
        return {
            ket: amp * (p_same if (ket & mask) in (0, mask) else p_diff)
            for ket, amp in state.items()
        }
    if c == "rxx":
        th = _eval_angle(inst.params[0], bindings)
        st = _apply_1q_sparse(state, qs[0], s, s, s, -s)
        st = _apply_1q_sparse(st, qs[1], s, s, s, -s)
        st = apply_unitary_sparse_continuum(
            st, NormalizedInstruction("rzz", qs, (), (th,)), bindings
        )
        st = _apply_1q_sparse(st, qs[0], s, s, s, -s)
        return _apply_1q_sparse(st, qs[1], s, s, s, -s)
    if c == "ccx":
        return _apply_controlled_1q_sparse(state, (qs[0], qs[1]), qs[2], 0j, 1 + 0j, 1 + 0j, 0j)
    if c == "cswap":
        cbit, b0, b1 = 1 << qs[0], 1 << qs[1], 1 << qs[2]
        mask = b0 | b1
        return {
            (ket ^ mask if (ket & cbit) and (ket & mask) in (b0, b1) else ket): amp
            for ket, amp in state.items()
        }
    raise ValueError(f"Unsupported instruction in sparse continuum: {inst.name!r}")


def _measure_or_reset_sparse(
    state: dict[int, complex],
    wire: int,
    rng: random.Random,
    reset_to_zero: bool,
) -> tuple[dict[int, complex], int]:
    bit = 1 << wire
    p1 = sum((amp.real * amp.real + amp.imag * amp.imag) for ket, amp in state.items() if (ket & bit))
    outcome = 1 if rng.random() < min(1.0, max(0.0, p1)) else 0
    prob = p1 if outcome == 1 else max(1e-16, 1.0 - p1)
    inv_norm = 1.0 / math.sqrt(prob)
    nxt: dict[int, complex] = {}
    for ket, amp in state.items():
        has1 = 1 if (ket & bit) else 0
        if has1 == outcome:
            target_ket = (ket & ~bit) if (reset_to_zero and outcome == 1) else ket
            nxt[target_ket] = amp * inv_norm
    return nxt, outcome


# ============================================================================
# Result, Job, and BackendV2 Classes
# ============================================================================


@dataclass
class ExperimentResultData:
    counts: dict[str, int]
    formatted_counts: dict[str, int]
    probabilities: dict[str, float]
    memory: list[str] | None = None


@dataclass
class ExperimentResult:
    shots: int
    success: bool
    status: str
    seed_simulator: int
    header: dict[str, Any]
    data: ExperimentResultData
    metadata: dict[str, Any]


@dataclass
class VerdantAqmResult:
    """Qiskit-compatible `Result` object supporting `get_counts()` and `get_memory()`."""

    backend_name: str
    backend_version: str
    job_id: str
    results: list[ExperimentResult]
    success: bool = True
    status: str = "COMPLETED"

    def _resolve(self, experiment: int | str | Any = 0) -> ExperimentResult:
        if isinstance(experiment, int):
            return self.results[experiment]
        exp_name = experiment if isinstance(experiment, str) else getattr(experiment, "name", str(experiment))
        for res in self.results:
            if res.header.get("name") == exp_name:
                return res
        raise KeyError(f"Experiment {exp_name!r} not found in Result.")

    def get_counts(self, experiment: int | str | Any = 0) -> dict[str, int] | list[dict[str, int]]:
        if experiment == 0 and len(self.results) > 1 and isinstance(experiment, bool):  # safety guard
            return dict(self.results[0].data.formatted_counts)
        return dict(self._resolve(experiment).data.formatted_counts)

    def get_memory(self, experiment: int | str | Any = 0) -> list[str]:
        exp = self._resolve(experiment)
        if exp.data.memory is None:
            raise KeyError(
                f"No memory for experiment {experiment!r}. Pass memory=True to VerdantAqmBackend.run()."
            )
        return list(exp.data.memory)

    def to_uorc_bytes(self) -> bytes:
        payload = {
            "schema": "verdant-aqm/qiskit-result/1",
            "backend_name": self.backend_name,
            "backend_version": self.backend_version,
            "job_id": self.job_id,
            "success": self.success,
            "status": self.status,
            "results": [
                {
                    "shots": r.shots,
                    "success": r.success,
                    "status": r.status,
                    "seed_simulator": r.seed_simulator,
                    "header": r.header,
                    "data": {
                        "counts": r.data.counts,
                        "formatted_counts": r.data.formatted_counts,
                        "probabilities": r.data.probabilities,
                        "memory": r.data.memory,
                    },
                    "metadata": r.metadata,
                }
                for r in self.results
            ],
        }
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return compress_uorc_portable(raw)

    @classmethod
    def from_uorc_bytes(cls, archive: bytes | bytearray | memoryview) -> VerdantAqmResult:
        raw = decompress_uorc_portable(bytes(archive))
        obj = json.loads(raw.decode("utf-8"))
        if not isinstance(obj, dict) or obj.get("schema") != "verdant-aqm/qiskit-result/1":
            raise ValueError("UorcWireError::CorruptedCodedBundle: Invalid Qiskit Result UORC payload schema")
        exp_list: list[ExperimentResult] = []
        for item in obj.get("results", []):
            d = item["data"]
            exp_list.append(
                ExperimentResult(
                    shots=int(item["shots"]),
                    success=bool(item["success"]),
                    status=str(item["status"]),
                    seed_simulator=int(item["seed_simulator"]),
                    header=dict(item["header"]),
                    data=ExperimentResultData(
                        counts=dict(d["counts"]),
                        formatted_counts=dict(d["formatted_counts"]),
                        probabilities=dict(d["probabilities"]),
                        memory=list(d["memory"]) if d.get("memory") is not None else None,
                    ),
                    metadata=dict(item["metadata"]),
                )
            )
        return cls(
            backend_name=str(obj["backend_name"]),
            backend_version=str(obj["backend_version"]),
            job_id=str(obj["job_id"]),
            results=exp_list,
            success=bool(obj.get("success", True)),
            status=str(obj.get("status", "COMPLETED")),
        )



class VerdantAqmJob(_BaseJobV1):  # type: ignore[misc]
    """Synchronous deterministic Qiskit `JobV1` wrapper."""

    def __init__(self, backend: VerdantAqmBackend, job_id: str, result: VerdantAqmResult) -> None:
        if HAS_UPSTREAM_QISKIT:
            super().__init__(backend, job_id)
        else:
            self._backend = backend
            self._job_id = job_id
        self._result = result

    def job_id(self) -> str:
        return str(self._job_id)

    def submit(self) -> None:
        return None

    def status(self) -> Any:
        return _JobStatus.DONE if HAS_UPSTREAM_QISKIT else "DONE"

    def done(self) -> bool:
        return True

    def result(self) -> VerdantAqmResult:
        return self._result


@dataclass
class _FallbackOptions:
    shots: int = 1024
    seed_simulator: int | None = None
    memory: bool = False
    prism_fusion: bool = True
    substrate: str = "auto"
    weave_atlas: bool = False
    max_shots: int | None = None


class VerdantAqmBackend(_BaseBackendV2):  # type: ignore[misc]
    """Production Unbounded Qiskit `BackendV2` powered by Verdant AQM & Prism (`AQ-19`)."""

    name = "verdant_aqm_prism"
    backend_version = "0.3.0"
    version = 2

    def __init__(self, **options: Any) -> None:
        max_shots = options.pop("max_shots", None)
        if HAS_UPSTREAM_QISKIT:
            super().__init__(
                name="verdant_aqm_prism",
                description="Prism-verified Unbounded Abstract Quantum Machine Qiskit BackendV2",
                backend_version="0.3.0",
            )
            self._target = _build_upstream_qiskit_target()
            if max_shots is not None:
                self._options.set_validator("shots", (1, int(max_shots)))
            self._max_shots = max_shots
            if options:
                self.set_options(**options)
        else:
            self.description = "Prism-verified Unbounded Abstract Quantum Machine Qiskit BackendV2"
            self._target = VerdantAqmTarget()
            self._max_shots = max_shots
            self._options = _FallbackOptions(max_shots=max_shots)
            if options:
                self.set_options(**options)

    @classmethod
    def _default_options(cls) -> Any:
        if HAS_UPSTREAM_QISKIT:
            opts = _QiskitOptions(
                shots=1024,
                seed_simulator=None,
                memory=False,
                prism_fusion=True,
                substrate="auto",
                weave_atlas=False,
            )
            opts.set_validator("shots", (1, None))
            return opts
        return _FallbackOptions()

    @property
    def target(self) -> Any:
        return self._target

    @property
    def num_qubits(self) -> None:
        return None

    @property
    def coupling_map(self) -> None:
        return None

    @property
    def max_circuits(self) -> None:
        return None

    @property
    def options(self) -> Any:
        return self._options

    def qubit_properties(self, qubit: int | list[int]) -> Any:
        raise NotImplementedError(
            "VerdantAqmBackend defines exact algebraic wires without physical T1/T2 decoherence properties."
        )

    def set_options(self, **fields: Any) -> None:
        if "max_shots" in fields:
            self._max_shots = fields.pop("max_shots")
            if HAS_UPSTREAM_QISKIT and self._max_shots is not None:
                self._options.set_validator("shots", (1, int(self._max_shots)))
        if "shots" in fields:
            shots = fields["shots"]
            if not isinstance(shots, int) or shots < 1 or (self._max_shots is not None and shots > self._max_shots):
                bound_msg = f" and <={self._max_shots}" if self._max_shots is not None else ""
                raise ValueError(
                    f"Specified value for 'shots' is not a valid value, must be >=1{bound_msg}"
                )
        if HAS_UPSTREAM_QISKIT:
            super().set_options(**fields)
        else:
            for k, v in fields.items():
                setattr(self._options, k, v)

    def _validate_circuit(self, circuit: NormalizedCircuit) -> None:
        if circuit.num_qubits < 1:
            raise ValueError(f"QuantumCircuit '{circuit.name}' must have at least 1 qubit.")
        for idx, inst in enumerate(circuit.instructions):
            canon = ISA_ALIASES.get(inst.name, inst.name)
            if canon not in ISA_INFO_MAP:
                raise ValueError(f"Unsupported Target instruction '{inst.name}' at step {idx}.")
            for q in inst.qubits:
                if q < 0 or q >= circuit.num_qubits:
                    raise ValueError(f"Qubit index q{q} out of bounds for {circuit.num_qubits} qubits.")
            if canon != "barrier" and len(set(inst.qubits)) != len(inst.qubits):
                raise ValueError(
                    f"DuplicateWireReference (AQ-02): '{inst.name}' at step {idx} references duplicate wires {inst.qubits}."
                )
            if canon == "measure":
                if len(inst.clbits) != 1 or inst.clbits[0] < 0 or inst.clbits[0] >= circuit.num_clbits:
                    raise ValueError(f"Invalid classical bit destination in measure at step {idx}.")

    def _select_substrate(
        self, circuit: NormalizedCircuit, bindings: dict[str, float]
    ) -> tuple[str, bool, bool]:
        pure_clifford = True
        exact_cyc = True
        seen_meas = False
        mid_circuit = False
        branching_wires: set[int] = set()
        max_span = 0
        has_3q = False

        for inst in circuit.instructions:
            c = ISA_ALIASES.get(inst.name, inst.name)
            if c in ("id", "barrier"):
                continue
            if c == "measure":
                seen_meas = True
                continue
            if c == "reset":
                mid_circuit = True
                # Reset is Z-basis projective collapse + conditional Pauli-X — 100% pure Clifford!
                continue
            if seen_meas:
                mid_circuit = True
            if c in ("h", "sx", "sxdg"):
                branching_wires.add(inst.qubits[0])
            elif c == "ch":
                branching_wires.add(inst.qubits[1])
            if len(inst.qubits) == 2:
                max_span = max(max_span, abs(inst.qubits[0] - inst.qubits[1]))
            elif len(inst.qubits) >= 3:
                has_3q = True
                max_span = max(max_span, max(inst.qubits) - min(inst.qubits))

            if c == "p":
                ang = _eval_angle(inst.params[0], bindings)
                ratio = ang / (math.pi / 4)
                if abs(ratio - round(ratio)) < 1e-11:
                    if int(round(ratio)) % 2 != 0:
                        pure_clifford = False
                else:
                    pure_clifford = False
                    exact_cyc = False
                continue
            _nq, _npar, cliff, cyc = ISA_INFO_MAP[c]
            if not cliff:
                pure_clifford = False
            if not cyc:
                exact_cyc = False

        if pure_clifford:
            return ("StabilizerTableau", True, True)
        if exact_cyc:
            prefer_mps = (not mid_circuit) and (not has_3q) and len(branching_wires) > 16 and max_span <= 4
            return ("ExactMps" if prefer_mps else "CyclotomicExact", False, True)
        return ("ExactSparseContinuum", False, False)

    def evaluate_exact_state(
        self, run_circuit: Any, bindings: dict[str, float] | None = None
    ) -> tuple[
        str,
        dict[int, complex] | PackedStabilizerTableau | ExactMpsTensorTrain | list[tuple[str, tuple[int, ...]]],
        NormalizedCircuit,
    ]:
        """Evaluates the exact pre-measurement state representation for analytical `EstimatorV2`."""
        bind = bindings or {}
        circuit = normalize_circuit(run_circuit)
        self._validate_circuit(circuit)
        unitary_ops = [
            i for i in circuit.instructions if ISA_ALIASES.get(i.name, i.name) not in ("measure", "reset", "barrier")
        ]
        unitary_circuit = NormalizedCircuit(
            circuit.name,
            circuit.num_qubits,
            circuit.num_clbits,
            circuit.qregs,
            circuit.cregs,
            unitary_ops,
            circuit.parameters,
        )
        auto_sub, is_cliff, is_cyc = self._select_substrate(unitary_circuit, bind)
        forced = str(getattr(self._options, "substrate", "auto"))
        sub = auto_sub if forced == "auto" else forced

        # O(gates) Heisenberg adjoint Pauli conjugation works for ANY Clifford qubit width n >= 1!
        if sub == "StabilizerTableau" and is_cliff:
            steps, _ = _decompose_exact_gate_sequence(unitary_ops, bind)
            return ("StabilizerTableau", steps, unitary_circuit)
        if sub == "ExactMps" and is_cyc:
            steps, _ = _decompose_exact_gate_sequence(unitary_ops, bind)
            mps = execute_exact_mps_steps(circuit.num_qubits, steps)
            return ("ExactMps", mps, unitary_circuit)
        if is_cyc and sub not in ("ExactSparseContinuum", "AtlasHolospace"):
            steps, _ = _decompose_exact_gate_sequence(unitary_ops, bind)
            cyc_map, k, _ = execute_sparse_cyclotomic(steps)
            sparse_c = {ket: _z8_to_complex(amp, k) for ket, amp in cyc_map.items()}
            return ("CyclotomicExact", sparse_c, unitary_circuit)
        sparse: dict[int, complex] = {0: 1.0 + 0.0j}
        for inst in unitary_ops:
            sparse = apply_unitary_sparse_continuum(sparse, inst, bind)
        return ("AtlasHolospace" if sub == "AtlasHolospace" else "ExactSparseContinuum", sparse, unitary_circuit)

    def run(self, run_input: Any, **run_options: Any) -> VerdantAqmJob:
        raw_list = list(run_input) if isinstance(run_input, (list, tuple)) else [run_input]
        circuits = [normalize_circuit(c) for c in raw_list]

        shots = run_options.get("shots", getattr(self._options, "shots", 1024))
        if not isinstance(shots, int) or shots < 1 or (self._max_shots is not None and shots > self._max_shots):
            bound_msg = f" and <={self._max_shots}" if self._max_shots is not None else ""
            raise ValueError(f"Specified value for 'shots' is not a valid value, must be >=1{bound_msg}")

        base_seed = run_options.get("seed_simulator", getattr(self._options, "seed_simulator", None))
        if base_seed is None:
            base_seed = 20260519
        record_memory = bool(run_options.get("memory", getattr(self._options, "memory", False)))
        forced_sub = str(run_options.get("substrate", getattr(self._options, "substrate", "auto")))
        use_fusion = bool(run_options.get("prism_fusion", getattr(self._options, "prism_fusion", True)))
        binds_list: list[dict[str, float]] = list(run_options.get("parameter_binds") or [{}])

        exp_results: list[ExperimentResult] = []
        exp_idx = 0
        for circuit in circuits:
            self._validate_circuit(circuit)
            for bind_map in binds_list:
                seed = (int(base_seed) + exp_idx * 7919) & 0xFFFFFFFF
                exp_idx += 1
                exp_results.append(
                    self._execute_single(
                        circuit, bind_map, shots, seed, record_memory, forced_sub, use_fusion
                    )
                )

        job_kappa = compute_job_kappa(
            {
                "backend": self.name,
                "shots": shots,
                "seed": base_seed,
                "results": [[r.header["name"], r.data.counts] for r in exp_results],
            }
        )
        job_id = f"vdnt-py-{job_kappa.split(':')[1][:20]}"
        return VerdantAqmJob(
            self,
            job_id,
            VerdantAqmResult(
                backend_name=self.name,
                backend_version=self.backend_version,
                job_id=job_id,
                results=exp_results,
            ),
        )

    def _execute_single(
        self,
        circuit: NormalizedCircuit,
        bindings: dict[str, float],
        shots: int,
        seed: int,
        memory: bool,
        forced_substrate: str,
        use_fusion: bool = True,
    ) -> ExperimentResult:
        rng = random.Random(seed)
        auto_sub, is_cliff, is_cyc = self._select_substrate(circuit, bindings)
        chosen_sub = auto_sub if forced_substrate == "auto" else forced_substrate

        first_non_unitary = next(
            (
                idx
                for idx, inst in enumerate(circuit.instructions)
                if ISA_ALIASES.get(inst.name, inst.name) in ("measure", "reset")
            ),
            len(circuit.instructions),
        )
        tail = circuit.instructions[first_non_unitary:]
        tail_pure_measure = all(
            ISA_ALIASES.get(inst.name, inst.name) in ("measure", "barrier") for inst in tail
        )

        formatted_counts: dict[str, int] = {}
        hex_counts: dict[str, int] = {}
        probabilities: dict[str, float] = {}
        shot_memory: list[str] = []
        active_kets = 1
        fusion_elim = 0
        norm_exact_one = True

        def record_shot(clbits: list[int]) -> None:
            fmt = _format_qiskit_bitstring(clbits, circuit.cregs)
            hx = _bitstring_to_hex(fmt)
            formatted_counts[fmt] = formatted_counts.get(fmt, 0) + 1
            hex_counts[hx] = hex_counts.get(hx, 0) + 1
            if memory:
                shot_memory.append(fmt)

        def sample_from_probabilities() -> None:
            """O(shots * log M) binary-search sampler over pre-grouped formatted outcomes."""
            items = sorted(probabilities.items(), key=lambda kv: kv[0])
            if not items:
                return
            fmt_tbl = [kv[0] for kv in items]
            hex_tbl = [_bitstring_to_hex(kv[0]) for kv in items]
            cum_tbl: list[float] = []
            acc = 0.0
            for _, pval in items:
                acc += pval
                cum_tbl.append(acc)
            cum_tbl[-1] = max(1.0, acc)
            last_idx = len(items) - 1
            for _ in range(shots):
                idx = bisect.bisect_left(cum_tbl, rng.random())
                if idx > last_idx:
                    idx = last_idx
                fmt = fmt_tbl[idx]
                hx = hex_tbl[idx]
                formatted_counts[fmt] = formatted_counts.get(fmt, 0) + 1
                hex_counts[hx] = hex_counts.get(hx, 0) + 1
                if memory:
                    shot_memory.append(fmt)

        if tail_pure_measure:
            prefix = circuit.instructions[:first_non_unitary]
            meas_ops = [i for i in tail if ISA_ALIASES.get(i.name, i.name) == "measure"]

            if chosen_sub == "StabilizerTableau" and is_cliff:
                steps, fusion_elim = _decompose_exact_gate_sequence(prefix, bindings, enable_fusion=use_fusion)
                base_tab = PackedStabilizerTableau.ground_state(circuit.num_qubits)
                for op, qs in steps:
                    base_tab.apply_unitary(op, qs)
                active_kets = circuit.num_qubits
                if meas_ops and circuit.num_clbits > 0:
                    unique_wires = list(dict.fromkeys(mop.qubits[0] for mop in meas_ops))
                    num_coins, wire_laws = base_tab.compile_affine_measurement_frame(unique_wires)
                    if num_coins <= 12:
                        branch_cnt = 1 << num_coins
                        inv_b = 1.0 / branch_cnt
                        for c_val in range(branch_cnt):
                            clbits = [0] * circuit.num_clbits
                            for mop in meas_ops:
                                base_b, mask_b = wire_laws[mop.qubits[0]]
                                clbits[mop.clbits[0]] = base_b ^ ((mask_b & c_val).bit_count() & 1)
                            fmt = _format_qiskit_bitstring(clbits, circuit.cregs)
                            probabilities[fmt] = probabilities.get(fmt, 0.0) + inv_b
                    for _ in range(shots):
                        coin_draw = rng.getrandbits(num_coins) if num_coins > 0 else 0
                        clbits = [0] * circuit.num_clbits
                        for mop in meas_ops:
                            base_b, mask_b = wire_laws[mop.qubits[0]]
                            clbits[mop.clbits[0]] = base_b ^ ((mask_b & coin_draw).bit_count() & 1)
                        record_shot(clbits)
                    if num_coins > 12:
                        for k_str, cnt in formatted_counts.items():
                            probabilities[k_str] = cnt / shots

            elif chosen_sub == "ExactMps" and is_cyc:
                steps, fusion_elim = _decompose_exact_gate_sequence(prefix, bindings, enable_fusion=use_fusion)
                mps = execute_exact_mps_steps(circuit.num_qubits, steps)
                active_kets = mps.max_bond_dim()
                norm_exact_one = True
                if meas_ops and circuit.num_clbits > 0:
                    unique_wires = list(dict.fromkeys(mop.qubits[0] for mop in meas_ops))
                    shot_maps, marginals = sample_exact_mps_chain_rule(mps, unique_wires, shots, rng)
                    if marginals is not None:
                        w_index = {w: idx for idx, w in enumerate(unique_wires)}
                        for mask, prob in marginals.items():
                            full_cl = [0] * circuit.num_clbits
                            for mop in meas_ops:
                                full_cl[mop.clbits[0]] = 1 if (mask & (1 << w_index[mop.qubits[0]])) else 0
                            fmt = _format_qiskit_bitstring(full_cl, circuit.cregs)
                            probabilities[fmt] = probabilities.get(fmt, 0.0) + prob
                    for omap in shot_maps:
                        full_cl = [0] * circuit.num_clbits
                        for mop in meas_ops:
                            full_cl[mop.clbits[0]] = omap.get(mop.qubits[0], 0)
                        record_shot(full_cl)
                    if marginals is None:
                        for k_str, cnt in formatted_counts.items():
                            probabilities[k_str] = cnt / shots

            elif is_cyc and chosen_sub not in ("ExactSparseContinuum", "AtlasHolospace"):
                steps, fusion_elim = _decompose_exact_gate_sequence(prefix, bindings, enable_fusion=use_fusion)
                cyc_support, k_den, norm_exact_one = execute_sparse_cyclotomic(steps)
                active_kets = len(cyc_support)
                if meas_ops and circuit.num_clbits > 0:
                    for ket, amp in cyc_support.items():
                        prob = _z8_prob_scaled(amp, k_den)
                        if prob > 1e-16:
                            full_cl = [0] * circuit.num_clbits
                            for m in meas_ops:
                                full_cl[m.clbits[0]] = 1 if (ket & (1 << m.qubits[0])) else 0
                            fmt = _format_qiskit_bitstring(full_cl, circuit.cregs)
                            probabilities[fmt] = probabilities.get(fmt, 0.0) + prob
                    sample_from_probabilities()
            else:
                sparse: dict[int, complex] = {0: 1.0 + 0.0j}
                for inst in prefix:
                    sparse = apply_unitary_sparse_continuum(sparse, inst, bindings)
                active_kets = len(sparse)
                mass = 0.0
                for ket, amp in sparse.items():
                    prob = amp.real * amp.real + amp.imag * amp.imag
                    mass += prob
                    if prob > 1e-16 and meas_ops and circuit.num_clbits > 0:
                        full_cl = [0] * circuit.num_clbits
                        for m in meas_ops:
                            full_cl[m.clbits[0]] = 1 if (ket & (1 << m.qubits[0])) else 0
                        fmt = _format_qiskit_bitstring(full_cl, circuit.cregs)
                        probabilities[fmt] = probabilities.get(fmt, 0.0) + prob
                norm_exact_one = abs(mass - 1.0) < 1e-11
                if meas_ops and circuit.num_clbits > 0:
                    sample_from_probabilities()
        elif chosen_sub == "StabilizerTableau" and is_cliff:
            # Polynomial Gottesman-Knill mid-circuit measurement & reset trajectory execution (scales to 512+ qubits!)
            prefix = circuit.instructions[:first_non_unitary]
            prefix_steps, fusion_elim = _decompose_exact_gate_sequence(prefix, bindings, enable_fusion=use_fusion)
            base_tab = PackedStabilizerTableau.ground_state(circuit.num_qubits)
            for op, qs in prefix_steps:
                base_tab.apply_unitary(op, qs)
            active_kets = circuit.num_qubits

            tail_compiled: list[tuple[str, Any]] = []
            for inst in tail:
                c = ISA_ALIASES.get(inst.name, inst.name)
                if c == "measure":
                    tail_compiled.append(("measure", (inst.qubits[0], inst.clbits[0])))
                elif c == "reset":
                    tail_compiled.append(("reset", inst.qubits[0]))
                elif c in ("id", "barrier"):
                    continue
                else:
                    sub_steps, _ = _decompose_exact_gate_sequence([inst], bindings, enable_fusion=False)
                    tail_compiled.append(("unitary", sub_steps))

            for _ in range(shots):
                cur_tab = base_tab.copy()
                full_cl = [0] * circuit.num_clbits
                for kind, payload in tail_compiled:
                    if kind == "measure":
                        w_idx, c_idx = payload
                        full_cl[c_idx] = cur_tab.measure_z(w_idx, rng)
                    elif kind == "reset":
                        w_idx = payload
                        if cur_tab.measure_z(w_idx, rng) == 1:
                            cur_tab.apply_unitary("x", (w_idx,))
                    else:
                        for op, qs in payload:
                            cur_tab.apply_unitary(op, qs)
                if circuit.num_clbits > 0:
                    record_shot(full_cl)
            for k_str, cnt in formatted_counts.items():
                probabilities[k_str] = cnt / shots
        else:
            # Dynamic mid-circuit measurement / reset trajectory execution with cached deterministic prefix!
            chosen_sub = "CyclotomicExact" if is_cyc else "ExactSparseContinuum"
            base_sparse: dict[int, complex] = {0: 1.0 + 0.0j}
            for inst in circuit.instructions[:first_non_unitary]:
                base_sparse = apply_unitary_sparse_continuum(base_sparse, inst, bindings)
            for _ in range(shots):
                sparse = dict(base_sparse)
                full_cl = [0] * circuit.num_clbits
                for inst in tail:
                    c = ISA_ALIASES.get(inst.name, inst.name)
                    if c == "measure":
                        sparse, bit = _measure_or_reset_sparse(sparse, inst.qubits[0], rng, False)
                        full_cl[inst.clbits[0]] = bit
                    elif c == "reset":
                        sparse, _ = _measure_or_reset_sparse(sparse, inst.qubits[0], rng, True)
                    else:
                        sparse = apply_unitary_sparse_continuum(sparse, inst, bindings)
                active_kets = max(active_kets, len(sparse))
                if circuit.num_clbits > 0:
                    record_shot(full_cl)
            for k_str, cnt in formatted_counts.items():
                probabilities[k_str] = cnt / shots

        holo_kappa = compute_job_kappa(
            {
                "name": circuit.name,
                "qubits": circuit.num_qubits,
                "substrate": chosen_sub,
                "counts": hex_counts,
            }
        )
        return ExperimentResult(
            shots=shots,
            success=True,
            status="DONE",
            seed_simulator=seed,
            header={
                "name": circuit.name,
                "n_qubits": circuit.num_qubits,
                "memory_slots": circuit.num_clbits,
                "qreg_sizes": circuit.qregs,
                "creg_sizes": circuit.cregs,
            },
            data=ExperimentResultData(
                counts=hex_counts,
                formatted_counts=formatted_counts,
                probabilities=probabilities,
                memory=shot_memory if memory else None,
            ),
            metadata={
                "substrate": chosen_sub,
                "active_kets": active_kets,
                "prism_fusion_eliminated": fusion_elim,
                "norm_exact_one": norm_exact_one,
                "holo_kappa": holo_kappa,
            },
        )
