"""Regression tests for Voice Suite v0.6.0 commercial guardrails, memory
efficiency (single residency, idle unloading, low-RAM ASR offload, dictation
cleanup), and audio quality inspection.
"""
from __future__ import annotations

import io
import math
import os
import subprocess
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    data_dir = tmp_path / "omnivoice_data"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "omnivoice.db"
    monkeypatch.setenv("OMNIVOICE_DATA_DIR", str(data_dir))
    monkeypatch.delenv("OMNIVOICE_COMMERCIAL_ONLY", raising=False)

    import core.config as config
    import core.db as db

    monkeypatch.setattr(config, "DATA_DIR", str(data_dir))
    monkeypatch.setattr(config, "DB_PATH", str(db_path))
    monkeypatch.setattr(db, "DB_PATH", str(db_path))
    db.init_db()
    return db_path


@pytest.mark.model_licence_gate
def test_commercial_production_guard_blocks_noncommercial_even_after_acceptance(isolated_db):
    from services import model_acceptance

    # Accept OmniVoice for personal use first.
    fp = model_acceptance.status("k2-fsa/OmniVoice")["fingerprint"]
    model_acceptance.accept("k2-fsa/OmniVoice", fp)
    assert model_acceptance.status("k2-fsa/OmniVoice")["accepted"] is True

    # With Commercial Production Guard OFF, accepted OmniVoice passes.
    assert model_acceptance.is_commercial_mode() is False
    model_acceptance.ensure_accepted(["k2-fsa/OmniVoice"])

    # Enable Commercial Production Guard: non-commercial and unknown models MUST be blocked.
    state = model_acceptance.set_commercial_mode(True)
    assert state == {"enabled": True, "locked_by_env": False}

    for restricted in (
        "k2-fsa/OmniVoice",
        "facebook/nllb-200-distilled-600M",
        "Serveurperso/OmniVoice-GGUF",
        "IndexTeam/IndexTTS-2.5",
    ):
        with pytest.raises(model_acceptance.ModelLicenceNotAccepted) as exc_info:
            model_acceptance.ensure_accepted([restricted])
        detail = exc_info.value.detail()
        assert detail["code"] == model_acceptance.COMMERCIAL_GUARD_ERROR_CODE
        assert detail["reason"] == "commercial_production_guard"

    # Commercial Apache-2.0 / MIT / CC-BY-4.0 models stay permitted.
    model_acceptance.ensure_accepted([
        "KittenML/kitten-tts-mini-0.8",
        "OpenMOSS-Team/MOSS-TTS-Nano",
        "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
        "openbmb/VoxCPM2",
        "Systran/faster-whisper-base",
    ])


def test_commercial_mode_api_persistence_and_env_lock(isolated_db, monkeypatch):
    from api.routers import settings as settings_router
    from api.dependencies import require_admin

    app = FastAPI()
    app.include_router(settings_router.router)
    app.dependency_overrides[require_admin] = lambda: None
    client = TestClient(app)

    r = client.get("/api/settings/commercial-mode")
    assert r.status_code == 200
    assert r.json() == {"enabled": False, "locked_by_env": False}

    r = client.put("/api/settings/commercial-mode", json={"enabled": True})
    assert r.status_code == 200
    assert r.json() == {"enabled": True, "locked_by_env": False}

    r = client.get("/api/settings/commercial-mode")
    assert r.json() == {"enabled": True, "locked_by_env": False}

    # Operator env lock refuses disabling via API (409).
    monkeypatch.setenv("OMNIVOICE_COMMERCIAL_ONLY", "1")
    r = client.get("/api/settings/commercial-mode")
    assert r.json() == {"enabled": True, "locked_by_env": True}
    r = client.put("/api/settings/commercial-mode", json={"enabled": False})
    assert r.status_code == 409


def test_performance_profiles_skip_noncommercial_nllb_when_commercial_mode_on(isolated_db, monkeypatch):
    from services import model_acceptance, performance_profiles
    from core import prefs

    saved: dict[str, object] = {"translation_backend": "argos"}
    monkeypatch.setattr(prefs, "get", lambda k, default=None: saved.get(k, default))
    monkeypatch.setattr(prefs, "set_", lambda k, v: saved.__setitem__(k, v))
    monkeypatch.setattr(performance_profiles, "selection_ready", lambda fam, eng: True)
    monkeypatch.setattr(performance_profiles, "selection_snapshot", lambda fam: ("argos",))

    from contextlib import contextmanager

    @contextmanager
    def _unchanged(_snap):
        yield True

    monkeypatch.setattr(performance_profiles, "unchanged_selection", _unchanged)

    model_acceptance.set_commercial_mode(True)
    result = performance_profiles._activate_translation_model("quality")
    assert result is not None
    assert result["engine"] == "argos"
    assert saved["translation_backend"] == "argos"


def test_backend_sh_supports_commercial_only_flag(tmp_path: Path):
    env = {**os.environ, "VOICE_SUITE_BACKEND_HOME": str(tmp_path)}
    script = ROOT / "deploy/inference-backend/backend.sh"
    res = subprocess.run(
        ["sh", str(script), "setup", "--origin", "https://voice-suite.vercel.app", "--commercial-only"],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Commercial only: enabled" in res.stdout
    conf = (tmp_path / "backend.env").read_text(encoding="utf-8")
    assert "OMNIVOICE_COMMERCIAL_ONLY=1" in conf


def test_evict_other_tts_engines_sync_and_unified_asr_offload(monkeypatch):
    from api.routers import engines as engines_router
    from services import engine_memory, model_manager, tts_backend

    unloaded: list[str] = []

    class FakeEngineA:
        id = "fake-a"

        def unload(self):
            unloaded.append("fake-a")

    class FakeEngineB:
        id = "fake-b"

        def unload(self):
            unloaded.append("fake-b")

    monkeypatch.setitem(engines_router._ENGINE_INSTANCES, FakeEngineA, FakeEngineA())
    monkeypatch.setitem(engines_router._ENGINE_INSTANCES, FakeEngineB, FakeEngineB())
    monkeypatch.setattr(tts_backend, "get_backend_class", lambda eid: FakeEngineB if eid == "fake-b" else FakeEngineA)
    monkeypatch.setattr(model_manager, "model", None)

    evicted = engine_memory.evict_other_tts_engines_sync("fake-b")
    assert "fake-a" in evicted
    assert unloaded == ["fake-a"]
    assert FakeEngineB in engines_router._ENGINE_INSTANCES

    # Unified-memory ASR offload evicts remaining non-OmniVoice TTS engine when RAM is tight.
    monkeypatch.setattr(model_manager, "_has_dedicated_vram", lambda: False)
    monkeypatch.setattr(
        "services.memory_budget.available_memory",
        lambda: {"ram_available_gb": 2.0},
    )
    model_manager.offload_tts_for_asr()
    assert "fake-b" in unloaded
    assert FakeEngineB not in engines_router._ENGINE_INSTANCES


def test_release_idle_side_models_reaps_in_process_tts_engines(monkeypatch):
    from services import model_manager, tts_backend

    called: list[float] = []
    monkeypatch.setattr(tts_backend, "release_idle_engines", lambda t: called.append(t) or [])
    monkeypatch.setattr(tts_backend, "release_idle_resident_servers", lambda t: [])
    monkeypatch.setattr("services.watermark.release_idle_models", lambda t: [])
    monkeypatch.setattr("services.asr_backend.release_idle_capture_backend", lambda t: False)
    monkeypatch.setattr("services.asr_backend.release_transcription_backend", lambda t: False)

    model_manager._release_idle_side_models(123.0)
    assert called == [123.0]


def test_dictation_reset_unloads_previous_capture_backend(monkeypatch):
    from api.routers import dictation as dictation_router
    from services import asr_backend
    from core import prefs

    fake_capture = MagicMock()
    monkeypatch.setattr(asr_backend, "_capture_backend", fake_capture)
    monkeypatch.setattr(asr_backend, "_capture_backend_key", ("sherpa-onnx", "m"))
    monkeypatch.setattr(prefs, "set_", lambda k, v: None)
    monkeypatch.setattr(dictation_router, "_read_prefs", lambda: {"enabled": True})

    res = dictation_router.set_dictation_prefs(dictation_router.DictationPrefsUpdate(enabled=True))
    assert res == {"enabled": True}
    fake_capture.unload.assert_called_once()
    assert asr_backend._capture_backend is None


def test_audio_quality_summary_metrics_and_tools_endpoint(tmp_path: Path):
    from api.routers import tools as tools_router
    from api.dependencies import require_admin
    from services.audio_quality import analyze_audio

    sr = 24000
    t = np.linspace(0.0, 1.5, int(sr * 1.5), endpoint=False, dtype=np.float32)
    clean = (0.3 * np.sin(2.0 * math.pi * 440.0 * t)).astype(np.float32)
    clean_path = tmp_path / "clean.wav"
    sf.write(clean_path, clean, sr, subtype="PCM_16")

    report = analyze_audio(clean_path)
    assert report.sample_rate == sr
    assert report.channels == 1
    assert report.clipped_samples == 0
    assert -12.0 < report.peak_dbfs < -9.0
    assert abs(report.dc_offset) < 1e-3
    assert report.silence_ratio == 0.0
    assert report.warnings == []

    # Test POST /tools/analyze-quality with a clipped WAV upload.
    clipped = np.clip(2.0 * np.sin(2.0 * math.pi * 440.0 * t), -1.0, 1.0).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, clipped, sr, format="WAV", subtype="PCM_16")

    app = FastAPI()
    app.include_router(tools_router.router)
    app.dependency_overrides[require_admin] = lambda: None
    client = TestClient(app)

    r = client.post(
        "/tools/analyze-quality",
        files={"audio": ("clipped.wav", buf.getvalue(), "audio/wav")},
    )
    assert r.status_code == 200
    payload = r.json()
    assert payload["clipped_samples"] > 0
    assert any(w["kind"] == "clipping" for w in payload["warnings"])
    assert payload["sample_rate"] == sr
