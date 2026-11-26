"""Desktop browser sessions and shared-server invitations never confer admin rights."""
from fastapi.testclient import TestClient

ORIGIN = "https://voice-suite.vercel.app"
DESKTOP_SECRET = "desktop-test-secret"
MASTER = "server-test-secret"


def test_desktop_pairing_is_required_even_on_a_loopback_socket(monkeypatch):
    from main import app

    monkeypatch.setenv("VOICE_SUITE_DESKTOP_PAIR_KEY", DESKTOP_SECRET)
    monkeypatch.delenv("OMNIVOICE_API_KEY", raising=False)
    monkeypatch.delenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", raising=False)
    client = TestClient(app, base_url="http://127.0.0.1:8765", client=("127.0.0.1", 1))
    origin = {"Origin": ORIGIN}
    assert client.get("/api/auth/studio/session", headers=origin).status_code == 401
    assert client.post("/api/auth/studio/desktop", headers=origin).status_code == 401
    assert client.post("/api/auth/studio/desktop").status_code == 403
    grant = client.post("/api/auth/studio/desktop", headers={"X-Voice-Suite-Pair": DESKTOP_SECRET})
    assert grant.status_code == 201
    assert DESKTOP_SECRET not in grant.text
    assert grant.json()["expires_in"] == 3600
    credential = {"Authorization": f"Bearer {grant.json()['token']}"}
    paired = {**origin, **credential}
    assert client.get("/api/auth/studio/session", headers=paired).status_code == 204
    assert client.get("/system/info", headers=paired).status_code == 403
    assert client.get("/system/info", headers=credential).status_code == 401
    ticket = client.post("/api/auth/ws-ticket", json={"path": "/ws/events"}, headers=paired)
    assert ticket.status_code == 201
    assert ticket.json()["expires_in"] <= 30
    assert client.delete("/api/auth/session", headers=paired).status_code == 204
    assert client.get("/api/auth/studio/session", headers=paired).status_code == 401


def test_shared_invite_is_single_use_and_keeps_master_key_server_side(monkeypatch):
    from main import app

    monkeypatch.setenv("OMNIVOICE_API_KEY", MASTER)
    monkeypatch.setenv("OMNIVOICE_SERVER_MODE", "1")
    monkeypatch.setenv("OMNIVOICE_LOOPBACK_REQUIRES_KEY", "1")
    monkeypatch.setenv("OMNIVOICE_ALLOWED_ORIGINS", ORIGIN)
    client = TestClient(app, base_url="https://shared.example", client=("127.0.0.1", 1))
    assert client.post("/api/auth/studio/invite").status_code == 401
    invite = client.post("/api/auth/studio/invite", headers={"Authorization": f"Bearer {MASTER}"})
    assert invite.status_code == 201
    assert MASTER not in invite.text
    body = {"code": invite.json()["code"]}
    redeem = client.post("/api/auth/studio/redeem", headers={"Origin": ORIGIN}, json=body)
    assert redeem.status_code == 201
    assert client.post("/api/auth/studio/redeem", headers={"Origin": ORIGIN}, json=body).status_code == 401
    studio = {"Authorization": f"Bearer {redeem.json()['token']}", "Origin": ORIGIN}
    assert client.get("/api/auth/studio/session", headers=studio).status_code == 204
    assert client.put("/api/settings/commercial-mode", headers=studio, json={"enabled": False}).status_code == 403
