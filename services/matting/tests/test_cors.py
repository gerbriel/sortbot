"""CORS allowlist (CONTRACT.md §3): the web app, the dev server, and the native shell.

The Capacitor shell serves the same web build from its own webview origins:
capacitor://localhost on iOS and https://localhost on Android (the Capacitor 8
default androidScheme). The bare http://localhost origin is deliberately NOT allowed.
A deployment that overrides ALLOWED_ORIGINS must list the native origins too, or
the native apps fail CORS while the web keeps working, which is exactly the kind
of failure nobody notices.

Preflights are answered by CORSMiddleware before any route runs, so these drive
the real app through httpx.ASGITransport without its lifespan (no network).
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.config import Settings
from app.main import app

WEB_ORIGINS = ["https://arcadian.ltd", "http://localhost:5173"]
NATIVE_ORIGINS = ["capacitor://localhost", "https://localhost"]


def test_default_allowlist_is_web_plus_native(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert Settings().allowed_origins == WEB_ORIGINS + NATIVE_ORIGINS
    assert "*" not in Settings().allowed_origins


def test_env_override_still_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://arcadian.ltd, capacitor://localhost")
    assert Settings().allowed_origins == ["https://arcadian.ltd", "capacitor://localhost"]


async def _preflight(origin: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.options(
            "/v1/jobs",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )


@pytest.mark.parametrize("origin", WEB_ORIGINS + NATIVE_ORIGINS)
def test_preflight_allows_app_origins(origin: str) -> None:
    res = asyncio.run(_preflight(origin))
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize(
    "origin", ["https://evil.example", "capacitor://evil", "https://localhost:8443", "http://localhost"]
)
def test_preflight_refuses_other_origins(origin: str) -> None:
    res = asyncio.run(_preflight(origin))
    assert res.status_code == 400
    assert "access-control-allow-origin" not in res.headers
