"""Matting backends. See base.py for why this is an interface at all."""

from __future__ import annotations

import httpx

from ..config import Settings
from .base import BackendUnavailable, Matter, refine_alpha

__all__ = ["BackendUnavailable", "Matter", "build_matter", "refine_alpha"]


def build_matter(settings: Settings, client: httpx.AsyncClient) -> Matter:
    """Pick a backend from config. The ONLY place a backend name is switched on."""
    if settings.backend == "replicate":
        from .replicate import ReplicateMatter

        return ReplicateMatter(settings, client)
    if settings.backend == "local":
        from .local import LocalMatter

        return LocalMatter(settings)
    raise BackendUnavailable(f"unknown MATTING_BACKEND {settings.backend!r}")
