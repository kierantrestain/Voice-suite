"""Short-lived browser access to the studio, independent of admin sessions."""

import os

from services.admin_sessions import AdminSessionStore

SESSION_PREFIX = "ovs_studio_session_"
TICKET_PREFIX = "ovs_studio_ticket_"
SESSION_TTL = 60 * 60
INVITE_TTL = 5 * 60

studio_sessions = AdminSessionStore(
    session_ttl_seconds=SESSION_TTL,
    session_prefix=SESSION_PREFIX,
    ticket_prefix=TICKET_PREFIX,
    capabilities=frozenset({"consume"}),
)
studio_invites = AdminSessionStore(
    session_ttl_seconds=INVITE_TTL,
    max_sessions=64,
    session_prefix="ovs_invite_",
)


def desktop_pair_key() -> str | None:
    return os.environ.get("VOICE_SUITE_DESKTOP_PAIR_KEY") or None


def desktop_pair_origin() -> str:
    return "https://voice-suite.vercel.app" if desktop_pair_key() else ""


def studio_key() -> str | None:
    return desktop_pair_key() or (os.environ.get("OMNIVOICE_API_KEY", "").strip() or None)


# The hosted studio uses ordinary production routes. Installers, network and
# provider settings, host paths, agent/MCP access and destructive operations
# remain under the desktop or server administrator's control.
_READ_PATHS = frozenset({
    "/api/auth/studio/session", "/engines", "/engines/asr", "/engines/tts",
    "/generate/budget", "/history", "/models", "/personalities", "/profiles",
    "/export/history", "/projects",
})
_READ_TREES = ("/audio/", "/profiles/", "/projects/")
_WRITE_PATHS = frozenset({
    "/api/auth/ws-ticket", "/generate", "/transcribe", "/export/record",
})
_SOCKET_PATHS = frozenset({"/ws/events", "/ws/transcribe", "/ws/tts"})


def studio_access_allowed(method: str, path: str) -> bool:
    if method == "WEBSOCKET":
        return path in _SOCKET_PATHS
    if method in {"GET", "HEAD"}:
        return path in _READ_PATHS or path.startswith(_READ_TREES)
    if method == "POST":
        return path in _WRITE_PATHS
    return method == "DELETE" and path == "/api/auth/session"
