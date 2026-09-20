"""Environment configuration.

Deliberately a plain dataclass read from os.environ rather than pydantic-settings:
there are ~20 values, they are all strings or numbers, and a settings library
would be a dependency whose only job is `os.environ.get`.

THE ONE RULE THAT MATTERS HERE: SUPABASE_SERVICE_ROLE_KEY and
REPLICATE_API_TOKEN are server-side secrets. They are read here, they never
appear in a response body, and they must never be given a `VITE_` name — every
VITE_* variable is inlined into the public browser bundle (AGENTS.md §4), which
is the one mistake that cannot be walked back after a deploy.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _int(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = _env(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _csv(name: str, default: str) -> list[str]:
    raw = _env(name, default)
    return [p.strip() for p in raw.split(",") if p.strip()]


class ConfigError(RuntimeError):
    """Raised at startup for a configuration that cannot possibly work."""


@dataclass(frozen=True)
class Settings:
    # ── Supabase ────────────────────────────────────────────────────────────
    supabase_url: str = field(default_factory=lambda: _env("SUPABASE_URL").rstrip("/"))
    service_role_key: str = field(default_factory=lambda: _env("SUPABASE_SERVICE_ROLE_KEY"))
    # The /auth/v1/user call needs an apikey header. The ANON key is the right
    # one for it: it identifies the project, and unlike the service role it is
    # already public, so a logged request line cannot leak anything.
    anon_key: str = field(default_factory=lambda: _env("SUPABASE_ANON_KEY"))
    bucket: str = field(default_factory=lambda: _env("BUCKET", "product-images"))

    # ── Backend selection ───────────────────────────────────────────────────
    backend: str = field(default_factory=lambda: _env("MATTING_BACKEND", "replicate").lower())
    replicate_token: str = field(default_factory=lambda: _env("REPLICATE_API_TOKEN"))
    replicate_model: str = field(default_factory=lambda: _env("REPLICATE_MODEL", "men1scus/birefnet"))
    # The model's OpenAPI input schema calls the image field `image` and takes an
    # optional `resolution` string in "WxH" form. Verified against
    # replicate.com/men1scus/birefnet/api/schema — see CONTRACT.md §7. Kept
    # configurable because a different BiRefNet packaging may name it otherwise.
    replicate_input_key: str = field(default_factory=lambda: _env("REPLICATE_INPUT_KEY", "image"))
    replicate_resolution_key: str = field(
        default_factory=lambda: _env("REPLICATE_RESOLUTION_KEY", "resolution")
    )
    replicate_version: str = field(default_factory=lambda: _env("REPLICATE_VERSION"))
    replicate_poll_seconds: float = field(default_factory=lambda: _float("REPLICATE_POLL_SECONDS", 1.0))
    replicate_timeout_seconds: float = field(
        default_factory=lambda: _float("REPLICATE_TIMEOUT_SECONDS", 180.0)
    )
    # How many times a RETRYABLE Replicate response (429, 5xx, a transport error)
    # is tried again, and the first backoff. Five retries at a base of 2 s is the
    # documented ladder 2, 4, 8, 16, 32 (±20% jitter) — 62 s of waiting at worst.
    # A 402 is NOT retryable at any count: insufficient credit does not appear
    # within a minute, and retrying it just turns one legible failure into six.
    replicate_retry_attempts: int = field(
        default_factory=lambda: max(0, _int("REPLICATE_RETRY_ATTEMPTS", 5))
    )
    replicate_retry_base_seconds: float = field(
        default_factory=lambda: max(0.0, _float("REPLICATE_RETRY_BASE_SECONDS", 2.0))
    )
    local_model: str = field(default_factory=lambda: _env("LOCAL_MODEL", "ZhengPeng7/BiRefNet"))
    local_hr_model: str = field(default_factory=lambda: _env("LOCAL_HR_MODEL", "ZhengPeng7/BiRefNet_HR"))

    # ── Service behaviour ───────────────────────────────────────────────────
    env: str = field(default_factory=lambda: _env("MATTING_ENV", "production").lower())
    allowed_origins: list[str] = field(
        default_factory=lambda: _csv("ALLOWED_ORIGINS", "https://arcadian.ltd,http://localhost:5173")
    )
    concurrency: int = field(default_factory=lambda: max(1, _int("CONCURRENCY", 4)))
    max_ids_per_job: int = field(default_factory=lambda: max(1, _int("MAX_IDS_PER_JOB", 2000)))
    max_body_bytes: int = field(default_factory=lambda: _int("MAX_BODY_BYTES", 256 * 1024))
    http_timeout_seconds: float = field(default_factory=lambda: _float("HTTP_TIMEOUT_SECONDS", 60.0))
    # The OUTER bound on one photo: download + matting (including its retries) +
    # two uploads + the row PATCH. It exists because every inner deadline is a
    # deadline on ONE call, and a photo can die between them — a row left 'queued'
    # with a worker slot held is indistinguishable from "the feature stopped
    # working". Whichever deadline fires first names itself in the flag.
    image_timeout_seconds: float = field(default_factory=lambda: _float("IMAGE_TIMEOUT_S", 180.0))

    # ── Review thresholds (see score.py and README "Scoring") ───────────────
    coverage_min: float = field(default_factory=lambda: _float("SCORE_COVERAGE_MIN", 0.12))
    coverage_max: float = field(default_factory=lambda: _float("SCORE_COVERAGE_MAX", 0.90))
    edge_fraction: float = field(default_factory=lambda: _float("SCORE_EDGE_FRACTION", 0.015))
    fragments_max: int = field(default_factory=lambda: _int("SCORE_FRAGMENTS_MAX", 3))
    fragment_min_area: float = field(default_factory=lambda: _float("SCORE_FRAGMENT_MIN_AREA", 0.005))
    soft_band_max: float = field(default_factory=lambda: _float("SCORE_SOFT_BAND_MAX", 0.25))
    contrast_min_lab: float = field(default_factory=lambda: _float("SCORE_CONTRAST_MIN_LAB", 12.0))
    # Which flags send a photo to a human. `contrast` is advisory by default: it
    # describes a DIFFICULT SOURCE (the garment was shot against something close
    # to its own edge colour), not evidence that the cut came out wrong, and
    # BiRefNet frequently handles those fine. The other four are all "the mask
    # is probably wrong".
    advisory_flags: list[str] = field(default_factory=lambda: _csv("MATTING_ADVISORY_FLAGS", "contrast"))

    @property
    def model_owner_name(self) -> tuple[str, str]:
        parts = self.replicate_model.split("/", 1)
        return (parts[0], parts[1]) if len(parts) == 2 else ("", self.replicate_model)

    def storage_public_url(self, path: str) -> str:
        return f"{self.supabase_url}/storage/v1/object/public/{self.bucket}/{path.lstrip('/')}"

    def storage_object_url(self, path: str) -> str:
        return f"{self.supabase_url}/storage/v1/object/{self.bucket}/{path.lstrip('/')}"

    @property
    def rest_url(self) -> str:
        return f"{self.supabase_url}/rest/v1"

    def service_headers(self) -> dict[str, str]:
        return {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
        }

    def validate(self) -> None:
        """Fail at startup rather than on the first request.

        The REPLICATE_VERSION rule is the one worth arguing for. An unpinned
        Replicate model silently changes weights under you; two photos of the
        same jacket matted a week apart would then be cut by different models,
        and a catalog whose cutouts are inconsistent is worse than one with no
        cutouts — you cannot tell by looking which half needs redoing.
        mask_model records the pin, so pinning is also what makes "re-run
        everything the old model touched" a query rather than a guess.
        """
        missing = [
            n
            for n, v in (
                ("SUPABASE_URL", self.supabase_url),
                ("SUPABASE_SERVICE_ROLE_KEY", self.service_role_key),
                ("SUPABASE_ANON_KEY", self.anon_key),
            )
            if not v
        ]
        if missing:
            raise ConfigError(f"missing required environment: {', '.join(missing)}")

        if self.backend not in ("replicate", "local"):
            raise ConfigError(f"MATTING_BACKEND must be 'replicate' or 'local', got {self.backend!r}")

        if self.backend == "replicate":
            if not self.replicate_token:
                raise ConfigError("MATTING_BACKEND=replicate requires REPLICATE_API_TOKEN")
            if not self.replicate_version and self.env != "dev":
                raise ConfigError(
                    "REPLICATE_VERSION is not set. An unpinned model changes weights without "
                    "notice and makes the catalog's cutouts inconsistent. Set it to the version "
                    "id logged at startup, or set MATTING_ENV=dev to run unpinned locally."
                )


_settings: Settings | None = None


def get_settings(refresh: bool = False) -> Settings:
    """Process-wide settings. `refresh=True` re-reads os.environ (tests use it)."""
    global _settings
    if _settings is None or refresh:
        _settings = Settings()
    return _settings
