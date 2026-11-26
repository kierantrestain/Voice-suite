"""deploy/inference-backend/backend.sh: one-time setup and lifecycle edge cases.

The script is what a non-engineer runs to host the backend for the Vercel
frontend, so its defaults are the security boundary: a private settings file,
a strong key, and loopback that is not trusted (a same-host proxy or tunnel).
"""
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "deploy" / "inference-backend" / "backend.sh"
COMPOSE = ROOT / "deploy" / "inference-backend" / "docker-compose.yml"

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("sh") is None, reason="POSIX shell script"
)


def _run(home, *args, check=True):
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(home),
        "VOICE_SUITE_BACKEND_HOME": str(home / "vsb"),
        "VOICE_SUITE_PYTHON": sys.executable,
    }
    result = subprocess.run(
        ["sh", str(SCRIPT), *args], env=env, capture_output=True, text=True, timeout=60
    )
    if check:
        assert result.returncode == 0, result.stdout + result.stderr
    return result


def _settings(home):
    text = (home / "vsb" / "backend.env").read_text()
    return dict(line.split("=", 1) for line in text.splitlines() if line and not line.startswith("#"))


def test_setup_writes_a_private_file_with_a_strong_key_and_safe_defaults(tmp_path):
    _run(tmp_path, "setup", "--origin", "https://voice-suite.vercel.app/", "--port", "3911")
    settings_file = tmp_path / "vsb" / "backend.env"
    assert stat.S_IMODE(settings_file.stat().st_mode) == 0o600
    assert stat.S_IMODE(settings_file.parent.stat().st_mode) == 0o700
    values = _settings(tmp_path)
    assert re.fullmatch(r"[0-9a-f]{64}", values["OMNIVOICE_API_KEY"])
    assert values["OMNIVOICE_ALLOWED_ORIGINS"] == "https://voice-suite.vercel.app"
    assert values["OMNIVOICE_PORT"] == "3911"
    assert values["OMNIVOICE_BIND_HOST"] == "127.0.0.1"
    assert values["OMNIVOICE_SERVER_MODE"] == "1"
    assert values["OMNIVOICE_LOOPBACK_REQUIRES_KEY"] == "1"
    assert values["OMNIVOICE_ANALYTICS_DISABLED"] == "1"
    key = _run(tmp_path, "key").stdout.strip()
    assert key == values["OMNIVOICE_API_KEY"]


def test_rerunning_setup_keeps_the_key_and_rotation_replaces_it(tmp_path):
    _run(tmp_path, "setup", "--origin", "https://a.vercel.app")
    first = _settings(tmp_path)["OMNIVOICE_API_KEY"]
    _run(tmp_path, "setup", "--origin", "https://b.vercel.app", "--origin", "https://c.example")
    again = _settings(tmp_path)
    assert again["OMNIVOICE_API_KEY"] == first
    assert again["OMNIVOICE_ALLOWED_ORIGINS"] == "https://b.vercel.app,https://c.example"
    _run(tmp_path, "setup", "--rotate-key")
    assert _settings(tmp_path)["OMNIVOICE_API_KEY"] != first


@pytest.mark.parametrize("origin", ["https://a.vercel.app/path", "a.vercel.app", "https://a b.app"])
def test_setup_rejects_an_origin_that_could_never_match(tmp_path, origin):
    result = _run(tmp_path, "setup", "--origin", origin, check=False)
    assert result.returncode != 0
    assert "origin must look like" in result.stderr
    assert not (tmp_path / "vsb" / "backend.env").exists()


def test_commands_before_setup_point_to_install(tmp_path):
    result = _run(tmp_path, "status", check=False)
    assert result.returncode == 1
    assert "install --origin" in result.stderr


def test_a_stale_pid_file_is_removed_and_reported_stopped(tmp_path):
    _run(tmp_path, "setup", "--origin", "https://a.vercel.app", "--port", "19")
    pidfile = tmp_path / "vsb" / "backend.pid"
    pidfile.write_text("1\n")  # a live process that is not this backend
    result = _run(tmp_path, "status", check=False)
    assert result.returncode == 3
    assert "Stopped." in result.stdout
    assert not pidfile.exists()
    assert _run(tmp_path, "stop").stdout.strip() == "Not running."


def test_compose_needs_no_domain_unless_the_https_profile_runs():
    """`${VAR:?}` is interpolated for every profile, so it broke plain `up`."""
    text = COMPOSE.read_text()
    assert "VOICE_SUITE_BACKEND_DOMAIN:?" not in text
    assert '"127.0.0.1:${VOICE_SUITE_BACKEND_PORT:-3900}:3900"' in text
