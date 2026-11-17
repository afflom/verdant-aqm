"""`qiskit-verdant-aqm` — Production Unbounded Qiskit BackendV2 & Primitives V2."""

from .backend import (
    ClassicalRegister,
    HAS_UPSTREAM_QISKIT,
    Parameter,
    QuantumCircuit,
    QuantumRegister,
    VerdantAqmBackend,
    VerdantAqmJob,
    VerdantAqmResult,
    VerdantAqmTarget,
)
from .holo_bridge import HoloArchiveInspection, compute_job_kappa, inspect_holo_v4_archive
from .primitives import (
    BitArray,
    DataBin,
    PrimitiveResult,
    PubResult,
    SparsePauliOp,
    VerdantAqmEstimatorV2,
    VerdantAqmSamplerV2,
)
from .provider import VerdantAqmProvider

__version__ = "0.3.0"

__all__ = [
    "BitArray",
    "ClassicalRegister",
    "DataBin",
    "HAS_UPSTREAM_QISKIT",
    "HoloArchiveInspection",
    "Parameter",
    "PrimitiveResult",
    "PubResult",
    "QuantumCircuit",
    "QuantumRegister",
    "SparsePauliOp",
    "VerdantAqmBackend",
    "VerdantAqmEstimatorV2",
    "VerdantAqmJob",
    "VerdantAqmProvider",
    "VerdantAqmResult",
    "VerdantAqmSamplerV2",
    "VerdantAqmTarget",
    "compute_job_kappa",
    "inspect_holo_v4_archive",
]
