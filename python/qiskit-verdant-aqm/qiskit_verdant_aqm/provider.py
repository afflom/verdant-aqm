"""Qiskit Provider Entry Point (`VerdantAqmProvider`) for `qiskit-verdant-aqm`."""

from __future__ import annotations

from typing import Any

from .backend import VerdantAqmBackend


class VerdantAqmProvider:
    """Provider exposing the unbounded Prism-verified `VerdantAqmBackend` (`BackendV2`)."""

    name = "verdant-aqm"

    def __init__(self, **default_options: Any) -> None:
        self._default_options = dict(default_options)

    def backends(self, name: str | None = None, **_filters: Any) -> list[VerdantAqmBackend]:
        backend = VerdantAqmBackend(**self._default_options)
        if name is not None and name not in (backend.name, "verdant_aqm"):
            return []
        return [backend]

    def get_backend(self, name: str = "verdant_aqm_prism", **options: Any) -> VerdantAqmBackend:
        merged = {**self._default_options, **options}
        if name not in ("verdant_aqm_prism", "verdant_aqm"):
            raise KeyError(f"QiskitBackendNotFoundError: No backend matches '{name}'")
        return VerdantAqmBackend(**merged)
