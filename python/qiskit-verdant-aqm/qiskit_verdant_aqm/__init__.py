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
from .uorc_wire import (
    compress_uorc_portable,
    decode_uorc_url_hash,
    decompress_uorc_portable,
    encode_uorc_url_hash,
    is_uorc_archive,
    verify_uorc_transport_boundary,
)

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
    "compress_uorc_portable",
    "compute_job_kappa",
    "decode_uorc_url_hash",
    "decompress_uorc_portable",
    "encode_uorc_url_hash",
    "inspect_holo_v4_archive",
    "is_uorc_archive",
    "verify_uorc_transport_boundary",
]

