"""OMNIVOICE_LOOPBACK_REQUIRES_KEY: a same-host proxy must not inherit loopback trust.

A reverse proxy or tunnel on the backend's own machine that forwards no client
address (nginx's default proxy_pass, a raw TCP tunnel, ssh -R) presents every
internet request as 127.0.0.1. Without this setting that peer receives the full
loopback tier, admin and native included, with no credential. The native
headless scripts (deploy/inference-backend/backend.sh) turn it on by default.
"""
import os

os.environ.setdefault("OMNIVOICE_MODEL", "test")
os.environ.setdefault("OMNIVOICE_DISABLE_FILE_LOG", "1")

import asyncio

import pytest
from starlette.websockets import WebSocketDisconnect

KEY = "LOOPBACK_TEST_KEY_DO_NOT_LEAK_51f3"
LOOPBACK = ("127.0.0.1", 41000)


def _client(client=LOOPBACK):
    from fastapi.testclient import TestClient
    from main import app

    return TestClient(app, base_url="http://127.0.0.1:3900", client=client)


@pytest.fixture
def server(monkeypatch):
    monkeypatch.setenv("OMNIVOICE_SERVER_MODE", "1")
    monkeypatch.setenv("OMNIVOICE_API_KEY", KEY)
    monkeypatch.delenv("OMNIVOICE_TRUSTED_NETWORKS", raising=False)
    monkeypatch.delenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", raising=False)
    return monkeypatch


def test_default_keeps_loopback_trusted(server):
    """Unset, the desktop and source default is unchanged."""
    with _client() as client:
        assert client.get("/system/info").status_code == 200


def test_proxied_loopback_needs_the_key_for_consumption_and_admin(server):
    server.setenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", "1")
    with _client() as client:
        assert client.get("/health").status_code == 200
        assert client.get("/v1/audio/voices").status_code == 401
        assert client.get("/system/info").status_code == 401
        refused = client.post("/system/set-env", json={"key": "TRANSLATE_MODEL", "value": "x"})
        assert refused.status_code == 401
        assert KEY not in refused.text
        bearer = {"Authorization": f"Bearer {KEY}"}
        assert client.get("/system/info", headers=bearer).status_code == 200
        assert client.get("/v1/audio/voices", headers=bearer).status_code == 200


def test_proxied_loopback_never_reaches_native_host_paths(server):
    """The key grants remote admin, never the desktop's filesystem tier."""
    from api.dependencies import require_native_access
    from fastapi import HTTPException
    from starlette.requests import Request

    server.setenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", "1")
    from core.auth import UntrustedLoopbackMiddleware

    seen = {}

    async def inner(scope, receive, send):
        seen["scope"] = scope

    scope = {"type": "http", "client": LOOPBACK, "headers": [], "path": "/x", "method": "GET"}
    asyncio.run(UntrustedLoopbackMiddleware(inner)(scope, None, None))
    with pytest.raises(HTTPException) as refused:
        require_native_access(Request(seen["scope"]))
    assert refused.value.status_code == 403


def test_proxied_loopback_websocket_needs_a_credential(server):
    server.setenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", "1")
    with _client() as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/events"):
                pass


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.9", "::1", "::ffff:127.0.0.1", "localhost"])
def test_every_loopback_spelling_becomes_an_unknown_peer(monkeypatch, host):
    from core.auth import UntrustedLoopbackMiddleware

    monkeypatch.setenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", "1")
    seen = {}

    async def inner(scope, receive, send):
        seen["client"] = scope["client"]

    original = {"type": "http", "client": (host, 5)}
    asyncio.run(UntrustedLoopbackMiddleware(inner)(original, None, None))
    assert seen["client"] is None
    assert original["client"] == (host, 5), "the server's own scope (access log) is untouched"


@pytest.mark.parametrize("flag, host", [("", "127.0.0.1"), ("1", "203.0.113.7"), ("1", "10.0.0.4")])
def test_remote_peers_and_the_default_are_untouched(monkeypatch, flag, host):
    from core.auth import UntrustedLoopbackMiddleware

    monkeypatch.setenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", flag)
    seen = {}

    async def inner(scope, receive, send):
        seen["client"] = scope["client"]

    asyncio.run(UntrustedLoopbackMiddleware(inner)({"type": "http", "client": (host, 5)}, None, None))
    assert seen["client"] == (host, 5)


def test_startup_refuses_the_setting_without_a_key(monkeypatch):
    from core.auth import validate_loopback_policy

    monkeypatch.setenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", "1")
    monkeypatch.delenv("OMNIVOICE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="needs OMNIVOICE_API_KEY"):
        validate_loopback_policy()
    monkeypatch.setenv("OMNIVOICE_API_KEY", KEY)
    validate_loopback_policy()
    monkeypatch.setenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", "0")
    monkeypatch.delenv("OMNIVOICE_API_KEY")
    validate_loopback_policy()


def test_middleware_is_outermost():
    """Every gate, including CORS-wrapped refusals, must see the rewritten peer."""
    from core.auth import UntrustedLoopbackMiddleware
    from main import app

    assert app.user_middleware[0].cls is UntrustedLoopbackMiddleware
