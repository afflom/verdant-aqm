"""`qiskit-verdant-aqm` — Production Unbounded Qiskit BackendV2 & Primitives V2."""

from .atlas_utqc import (
    AtlasHolospaceBatchResult,
    AtlasMtcAxiomReport,
    AtlasUseCaseParams,
    CANONICAL_ATLAS_PARAMS,
    CompiledBraidSegment,
    SkWeaverCompileResult,
    build_atlas_generators,
    execute_atlas_holospace_batch,
    verify_atlas_mtc_axioms,
    weave_qasm_with_sk_weaver,
    weave_rotations_with_sk_weaver,
)
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
from .holo_bridge import (
    HoloArchiveInspection,
    HoloWasmGuestRuntime,
    compute_job_kappa,
    extract_verified_holo_wasm_bytes,
    inspect_holo_v4_archive,
    instantiate_holo_wasm_guest,
)
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
    "AtlasHolospaceBatchResult",
    "AtlasMtcAxiomReport",
    "AtlasUseCaseParams",
    "BitArray",
    "CANONICAL_ATLAS_PARAMS",
    "ClassicalRegister",
    "CompiledBraidSegment",
    "DataBin",
    "HAS_UPSTREAM_QISKIT",
    "HoloArchiveInspection",
    "HoloWasmGuestRuntime",
    "Parameter",
    "PrimitiveResult",
    "PubResult",
    "QuantumCircuit",
    "QuantumRegister",
    "SkWeaverCompileResult",
    "SparsePauliOp",
    "VerdantAqmBackend",
    "VerdantAqmEstimatorV2",
    "VerdantAqmJob",
    "VerdantAqmProvider",
    "VerdantAqmResult",
    "VerdantAqmSamplerV2",
    "VerdantAqmTarget",
    "build_atlas_generators",
    "compress_uorc_portable",
    "compute_job_kappa",
    "decode_uorc_url_hash",
    "decompress_uorc_portable",
    "encode_uorc_url_hash",
    "execute_atlas_holospace_batch",
    "extract_verified_holo_wasm_bytes",
    "inspect_holo_v4_archive",
    "instantiate_holo_wasm_guest",
    "is_uorc_archive",
    "verify_atlas_mtc_axioms",
    "verify_uorc_transport_boundary",
    "weave_qasm_with_sk_weaver",
    "weave_rotations_with_sk_weaver",
]


