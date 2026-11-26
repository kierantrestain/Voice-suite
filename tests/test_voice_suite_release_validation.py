"""End-to-end Voice Suite release validation: branding, AGPL-3.0 compliance,
model licensing disclosures, voice cloning consent & provenance watermarking,
real audio synthesis/finishing/multi-format export (WAV, 24-bit WAV, FLAC, MP3),
project persistence, Apple Silicon MPS diagnostics, and local-first privacy.
"""

from __future__ import annotations

import asyncio
import io
import json
import math
import os
import sys
import types
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _synthesize_test_speech_wav(
    sample_rate: int = 24000,
    duration_s: float = 1.2,
    amplitude: float = 0.25,
    leading_silence_s: float = 0.0,
    trailing_silence_s: float = 0.0,
    rumble_hz: float = 0.0,
) -> bytes:
    """Generate a real harmonic speech-like mono WAV in memory."""
    voiced_samples = max(1, int(round(duration_s * sample_rate)))
    t = np.linspace(0.0, duration_s, voiced_samples, endpoint=False, dtype=np.float32)
    # Fundamental + harmonics with a syllabic amplitude envelope
    envelope = (0.65 + 0.35 * np.sin(2.0 * math.pi * 3.5 * t)).astype(np.float32)
    carrier = (
        0.60 * np.sin(2.0 * math.pi * 180.0 * t)
        + 0.25 * np.sin(2.0 * math.pi * 360.0 * t)
        + 0.15 * np.sin(2.0 * math.pi * 720.0 * t)
    ).astype(np.float32)
    voiced = amplitude * envelope * carrier
    if rumble_hz > 0.0:
        voiced = voiced + (0.08 * np.sin(2.0 * math.pi * rumble_hz * t)).astype(np.float32)

    parts = []
    if leading_silence_s > 0.0:
        parts.append(np.zeros(int(round(leading_silence_s * sample_rate)), dtype=np.float32))
    parts.append(voiced)
    if trailing_silence_s > 0.0:
        parts.append(np.zeros(int(round(trailing_silence_s * sample_rate)), dtype=np.float32))
    samples = np.concatenate(parts) if len(parts) > 1 else voiced

    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture
def hermetic_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Configure a hermetic OMNIVOICE_DATA_DIR and SQLite database for API tests."""
    data_dir = tmp_path / "omnivoice_data"
    voices_dir = data_dir / "voices"
    outputs_dir = data_dir / "outputs"
    dub_dir = data_dir / "dub_jobs"
    preview_dir = data_dir / "preview"
    for folder in (data_dir, voices_dir, outputs_dir, dub_dir, preview_dir):
        folder.mkdir(parents=True, exist_ok=True)

    db_path = data_dir / "omnivoice.db"
    monkeypatch.setenv("OMNIVOICE_DATA_DIR", str(data_dir))
    monkeypatch.setenv("OMNIVOICE_DISABLE_FILE_LOG", "1")

    import core.config as config
    import core.db as db

    monkeypatch.setattr(config, "DATA_DIR", str(data_dir))
    monkeypatch.setattr(config, "VOICES_DIR", str(voices_dir))
    monkeypatch.setattr(config, "OUTPUTS_DIR", str(outputs_dir))
    monkeypatch.setattr(config, "DUB_DIR", str(dub_dir))
    monkeypatch.setattr(config, "PREVIEW_DIR", str(preview_dir))
    monkeypatch.setattr(config, "DB_PATH", str(db_path))
    monkeypatch.setattr(db, "DB_PATH", str(db_path))
    db.init_db()

    return {
        "data_dir": data_dir,
        "voices_dir": voices_dir,
        "outputs_dir": outputs_dir,
        "db_path": db_path,
    }


# ── 1. Rebranding & AGPL-3.0 Compliance ──────────────────────────────────────


def test_rebranding_app_and_store_metadata_declare_voice_suite() -> None:
    app_cfg = json.loads((ROOT / "config/app.json").read_text(encoding="utf-8"))
    assert app_cfg["productName"] == "Voice Suite"
    # Its own bundle id: sharing upstream's com.voicestudio.desktop made the
    # Windows installer treat VoiceStudio as an older Voice Suite to uninstall.
    assert app_cfg["appId"] == "io.github.kierantrestain.voicesuite"
    assert app_cfg["releaseRepository"] == "kierantrestain/Voice-suite"

    store_meta = json.loads((ROOT / "store/metadata.json").read_text(encoding="utf-8"))
    assert store_meta["identity"]["productName"] == "Voice Suite"
    assert store_meta["identity"]["license"] == "AGPL-3.0-only"
    assert store_meta["listing"]["title"] == "Voice Suite"
    assert "Voice Suite" in store_meta["listing"]["description"]
    declarations = store_meta["contentDeclarations"]
    assert declarations["generativeAi"] is True
    assert declarations["voiceCloning"] is True
    assert declarations["syntheticAudioWatermarking"] is True


def test_agpl3_license_and_notice_preserve_upstream_attribution() -> None:
    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert "GNU AFFERO GENERAL PUBLIC LICENSE" in license_text
    assert "Version 3, 19 November 2007" in license_text
    assert "END OF TERMS AND CONDITIONS" in license_text

    notice_text = (ROOT / "LICENSE-NOTICE.md").read_text(encoding="utf-8")
    assert "AGPL-3.0-only" in notice_text
    assert "Palash Debnath and VoiceStudio contributors" in notice_text
    assert "Voice Suite" in notice_text
    assert "k2-fsa/OmniVoice" in notice_text
    assert "Apache-2.0" in notice_text
    assert "CC-BY-NC" in notice_text
    assert "backend/config/model_licenses.json" in notice_text


# ── 2. Model Licensing & Commercial Rights ───────────────────────────────────


def test_model_licenses_json_identifies_omnivoice_as_noncommercial() -> None:
    registry = json.loads(
        (ROOT / "backend/config/model_licenses.json").read_text(encoding="utf-8")
    )
    assert registry["schema_version"] == 2
    models_by_id = {entry["id"]: entry for entry in registry["models"]}
    assert "k2-fsa/OmniVoice" in models_by_id

    omnivoice_entry = models_by_id["k2-fsa/OmniVoice"]
    assert omnivoice_entry["commercial_use"] is False
    assert omnivoice_entry["review_status"] == "noncommercial"
    assert omnivoice_entry["commercial_inference"] == "restricted"
    assert "CC-BY-NC" in omnivoice_entry["license"]


def test_model_license_api_distinguishes_commercial_vs_noncommercial(
    hermetic_env,
) -> None:
    from api.routers import model_licenses as model_licenses_router

    app = FastAPI()
    app.include_router(model_licenses_router.router)
    client = TestClient(app, client=("127.0.0.1", 50000))

    # Non-commercial default TTS model (k2-fsa/OmniVoice)
    omni_details = client.get("/models/licenses/details/k2-fsa/OmniVoice")
    assert omni_details.status_code == 200
    omni_payload = omni_details.json()
    assert omni_payload["repo_id"] == "k2-fsa/OmniVoice"
    assert omni_payload["info"]["license_category"] == "noncommercial"
    assert omni_payload["info"]["commercial_inference"] == "restricted"
    assert omni_payload["acceptance"]["category"] == "noncommercial"
    assert omni_payload["acceptance"]["required"] is True
    assert omni_payload["acceptance"]["accepted"] is False

    # Commercial-category MIT ASR model (Systran/faster-whisper-large-v3)
    whisper_details = client.get(
        "/models/licenses/details/Systran/faster-whisper-large-v3"
    )
    assert whisper_details.status_code == 200
    whisper_payload = whisper_details.json()
    assert whisper_payload["info"]["license_category"] == "commercial"
    assert whisper_payload["acceptance"]["category"] == "commercial"
    assert whisper_payload["acceptance"]["required"] is False
    assert whisper_payload["acceptance"]["accepted"] is True

    # Accept & revoke local acknowledgement for k2-fsa/OmniVoice
    fingerprint = omni_payload["acceptance"]["fingerprint"]
    accept_res = client.post(
        "/models/licenses/accept",
        json={
            "repo_id": "k2-fsa/OmniVoice",
            "fingerprint": fingerprint,
            "accepted": True,
        },
    )
    assert accept_res.status_code == 200
    assert accept_res.json()["accepted"] is True
    assert accept_res.json()["state"] == "accepted"

    revoke_res = client.post(
        "/models/licenses/revoke",
        json={"repo_id": "k2-fsa/OmniVoice"},
    )
    assert revoke_res.status_code == 200
    assert revoke_res.json()["accepted"] is False
    assert revoke_res.json()["state"] == "withdrawn"


def test_model_rights_indicator_component_distinguishes_app_vs_model_licensing() -> None:
    indicator_path = (
        ROOT
        / "electron/src/renderer/src/features/settings/model-rights-indicator.tsx"
    )
    assert indicator_path.is_file()
    source = indicator_path.read_text(encoding="utf-8")

    assert "export function ModelRightsIndicator" in source
    assert "export function AppVsModelLicenseNotice" in source
    assert "export function classifyModelRights" in source
    assert "AGPL-3.0" in source
    assert "App License vs. Model Weights License" in source
    assert "Non-Commercial Weights (CC-BY-NC)" in source
    assert "Commercial Output Permitted (Apache-2.0 / MIT)" in source
    assert "AudioSeal" in source
    assert "mark_synthetic" in source


# ── 3. Voice Cloning Consent & Synthetic Audio Provenance ────────────────────


def test_voice_cloning_profile_lifecycle_and_consent_attestation(
    hermetic_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    import api.routers.profiles as profiles_router
    import services.ffmpeg_utils as ffmpeg_utils

    monkeypatch.setattr(
        profiles_router, "VOICES_DIR", str(hermetic_env["voices_dir"])
    )
    monkeypatch.setattr(
        profiles_router, "OUTPUTS_DIR", str(hermetic_env["outputs_dir"])
    )
    monkeypatch.setattr(profiles_router.event_bus, "emit", lambda *_a, **_kw: None)

    async def _fast_transcribe(_path: str) -> str:
        return "Synthesized reference voice sample for testing."

    monkeypatch.setattr(profiles_router, "_auto_transcribe_reference", _fast_transcribe)
    monkeypatch.setattr(ffmpeg_utils, "require_audio_stream", lambda _path: None)

    app = FastAPI()
    app.include_router(profiles_router.router)
    client = TestClient(app, client=("127.0.0.1", 50000))

    wav_bytes = _synthesize_test_speech_wav(sample_rate=24000, duration_s=1.0)

    # 1. Create clone profile with real synthesized WAV
    create_res = client.post(
        "/profiles",
        data={
            "name": "QA Test Speaker",
            "ref_text": "Hello from the QA test speaker.",
            "language": "English",
            "kind": "clone",
        },
        files={"ref_audio": ("speaker.wav", wav_bytes, "audio/wav")},
    )
    assert create_res.status_code == 200
    profile = create_res.json()
    profile_id = profile["id"]
    assert profile["name"] == "QA Test Speaker"
    assert profile["kind"] == "clone"
    assert profile["audio_url"].startswith(f"/profiles/{profile_id}/audio")

    # 2. Attest speaker consent (speaker_permission -> own_voice)
    attest_perm = client.post(
        f"/profiles/{profile_id}/attestation",
        json={"basis": "speaker_permission"},
    )
    assert attest_perm.status_code == 200
    assert attest_perm.json()["consent_basis"] == "speaker_permission"
    assert attest_perm.json()["consent_attested_at"]

    attest_own = client.post(
        f"/profiles/{profile_id}/attestation",
        json={"basis": "own_voice"},
    )
    assert attest_own.status_code == 200
    assert attest_own.json()["consent_basis"] == "own_voice"

    # Verify persisted attestation via GET /profiles/{id}
    fetched = client.get(f"/profiles/{profile_id}")
    assert fetched.status_code == 200
    assert fetched.json()["consent_basis"] == "own_voice"
    assert fetched.json()["consent_attested_at"]

    # 3. Record spoken consent audio
    consent_res = client.post(
        f"/profiles/{profile_id}/consent",
        data={"consent_text": "I authorize my voice to be cloned locally in Voice Suite."},
        files={"consent_audio": ("consent.wav", wav_bytes, "audio/wav")},
    )
    assert consent_res.status_code == 200
    assert consent_res.json()["verified_own_voice"] is True

    # 4. Preview /profiles/{id}/audio
    audio_res = client.get(f"/profiles/{profile_id}/audio")
    assert audio_res.status_code == 200
    assert audio_res.content[:4] == b"RIFF"
    assert audio_res.content[8:12] == b"WAVE"

    # 5. Update profile metadata
    update_res = client.put(
        f"/profiles/{profile_id}",
        json={
            "name": "QA Test Speaker Updated",
            "ref_text": "Updated reference transcript.",
            "language": "English",
        },
    )
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "QA Test Speaker Updated"
    assert update_res.json()["ref_text"] == "Updated reference transcript."

    # 6. Clear attestation & revoke consent, then delete profile
    clear_att = client.delete(f"/profiles/{profile_id}/attestation")
    assert clear_att.status_code == 200
    assert clear_att.json()["consent_basis"] == ""

    revoke_con = client.delete(f"/profiles/{profile_id}/consent")
    assert revoke_con.status_code == 200
    assert revoke_con.json()["verified_own_voice"] is False

    delete_res = client.delete(f"/profiles/{profile_id}")
    assert delete_res.status_code == 200
    assert delete_res.json()["deleted"] == profile_id

    missing_res = client.get(f"/profiles/{profile_id}")
    assert missing_res.status_code == 404


def test_synthetic_audio_provenance_watermark_chokepoint_and_router(
    hermetic_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    import api.routers.watermark as watermark_router
    import services.watermark as wm

    # Verify the 16-bit "OM" signature (0x4F 0x4D)
    assert wm.OMNI_MESSAGE == [0, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1]
    assert isinstance(wm._check_available(), bool)

    # Verify visible brand tone generation produces valid finite audio
    brand_tone = wm.generate_brand_tone(sample_rate=24000, duration_s=0.4)
    assert brand_tone.shape[0] == 1
    assert brand_tone.shape[1] > 0
    assert torch.isfinite(brand_tone).all()

    # Verify mark_synthetic chokepoint preserves shape/finiteness and embeds when generator is active
    sample_rate = 24000
    t = torch.linspace(0.0, 1.0, sample_rate, dtype=torch.float32)
    waveform = (0.25 * torch.sin(2.0 * math.pi * 220.0 * t)).unsqueeze(0)

    def _dummy_generator(model_audio: torch.Tensor, sample_rate: int = 16000, message=None):
        # Deterministic low-amplitude watermark delta at 1.5 kHz
        n = model_audio.shape[-1]
        grid = torch.linspace(0.0, 1.0, n, dtype=model_audio.dtype, device=model_audio.device)
        delta = 0.002 * torch.sin(2.0 * math.pi * 1500.0 * grid)
        return model_audio + delta

    monkeypatch.setattr(wm, "_check_available", lambda: True)
    monkeypatch.setattr(wm, "_get_generator", lambda mark_prefetched=False: _dummy_generator)

    marked = wm.mark_synthetic(waveform, sample_rate, context="test.release_validation", force=True)
    assert marked.shape == waveform.shape
    assert torch.isfinite(marked).all()
    assert not torch.allclose(marked, waveform)

    # Verify watermark router status endpoint
    app = FastAPI()
    app.include_router(watermark_router.router)
    client = TestClient(app, client=("127.0.0.1", 50000))

    status_res = client.get("/watermark/status")
    assert status_res.status_code == 200
    status_body = status_res.json()
    assert "invisible_enabled" in status_body
    assert "audioseal_available" in status_body


# ── 4. Real Audio Generation, Finishing & Multi-Format Export ────────────────


def test_real_audio_multi_format_encoders_wav24_flac_mp3() -> None:
    from services.audio_io import (
        audio_info,
        encode_flac,
        encode_mp3,
        encode_wav_production,
        load_audio,
    )
    from services.ffmpeg_utils import find_ffmpeg

    wav_16_bytes = _synthesize_test_speech_wav(
        sample_rate=24000, duration_s=1.0, amplitude=0.35
    )

    # 1. 24-bit / 48 kHz production WAV
    wav_24_bytes = asyncio.run(encode_wav_production(wav_16_bytes, target_rate=48000))
    assert wav_24_bytes[:4] == b"RIFF"
    info_24 = audio_info(io.BytesIO(wav_24_bytes))
    assert info_24.sample_rate == 48000
    assert info_24.bits_per_sample == 24
    assert info_24.num_channels == 1
    assert info_24.num_frames == 48000
    tensor_24, sr_24 = load_audio(io.BytesIO(wav_24_bytes))
    assert sr_24 == 48000
    assert torch.isfinite(tensor_24).all()

    # 2. Lossless FLAC
    flac_bytes = asyncio.run(encode_flac(wav_16_bytes))
    assert flac_bytes[:4] == b"fLaC"
    flac_tensor, flac_sr = load_audio(io.BytesIO(flac_bytes))
    assert flac_sr == 24000
    assert flac_tensor.shape[-1] == 24000
    assert torch.isfinite(flac_tensor).all()

    # 3. MP3 encoding
    if find_ffmpeg():
        mp3_bytes = asyncio.run(encode_mp3(wav_16_bytes))
        assert len(mp3_bytes) > 512
        # MP3 frames start with ID3 tag or 0xFF sync word
        assert mp3_bytes[:3] == b"ID3" or (mp3_bytes[0] == 0xFF and (mp3_bytes[1] & 0xE0) == 0xE0)


def test_workflow_audio_tools_normalize_trim_and_finish_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import api.routers.tools as tools_router
    import services.watermark as wm
    from services.audio_io import load_audio

    marked_contexts: list[str] = []

    async def _spy_mark_synthetic_async(
        waveform: torch.Tensor,
        sample_rate: int,
        *,
        context: str,
        force: bool = False,
        timeout: float | None = None,
    ) -> torch.Tensor:
        marked_contexts.append(context)
        return waveform

    monkeypatch.setattr(wm, "mark_synthetic_async", _spy_mark_synthetic_async)

    app = FastAPI()
    app.include_router(tools_router.router)
    client = TestClient(app, client=("127.0.0.1", 50000))

    raw_wav = _synthesize_test_speech_wav(
        sample_rate=24000,
        duration_s=1.0,
        amplitude=0.12,
        leading_silence_s=0.3,
        trailing_silence_s=0.3,
        rumble_hz=35.0,
    )

    # 1. /tools/normalize-speech
    norm_res = client.post(
        "/tools/normalize-speech",
        data={"target_dbfs": "-3.0"},
        files={"audio": ("speech.wav", raw_wav, "audio/wav")},
    )
    assert norm_res.status_code == 200
    assert norm_res.headers["content-type"].startswith("audio/wav")
    norm_tensor, norm_sr = load_audio(io.BytesIO(norm_res.content))
    assert norm_sr == 24000
    assert torch.isfinite(norm_tensor).all()
    expected_peak = 10.0 ** (-3.0 / 20.0)
    assert abs(float(norm_tensor.abs().max()) - expected_peak) < 0.02

    # 2. /tools/trim-audio
    trim_res = client.post(
        "/tools/trim-audio",
        data={"start_seconds": "0.3", "end_seconds": "1.1", "fade_ms": "20.0"},
        files={"audio": ("speech.wav", raw_wav, "audio/wav")},
    )
    assert trim_res.status_code == 200
    trim_tensor, trim_sr = load_audio(io.BytesIO(trim_res.content))
    assert trim_sr == 24000
    assert torch.isfinite(trim_tensor).all()
    assert abs(trim_tensor.shape[-1] - int(0.8 * 24000)) <= 2

    # 3. /tools/finish-audio
    finish_res = client.post(
        "/tools/finish-audio",
        data={
            "target_dbfs": "-2.0",
            "trim_silence": "true",
            "silence_threshold_db": "-35.0",
            "denoise_highpass_hz": "80.0",
        },
        files={"audio": ("speech.wav", raw_wav, "audio/wav")},
    )
    assert finish_res.status_code == 200
    finish_tensor, finish_sr = load_audio(io.BytesIO(finish_res.content))
    assert finish_sr == 24000
    assert torch.isfinite(finish_tensor).all()
    # Silence trimming removes leading/trailing silence so finished clip is shorter than 1.6s
    assert finish_tensor.shape[-1] < int(1.4 * 24000)
    finish_peak = 10.0 ** (-2.0 / 20.0)
    assert abs(float(finish_tensor.abs().max()) - finish_peak) < 0.03

    assert marked_contexts == [
        "workflow.normalize",
        "workflow.trim",
        "workflow.finish",
    ]


# ── 5. Project Persistence & Local-First Privacy ─────────────────────────────


def test_project_persistence_and_export_history_lifecycle(
    hermetic_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    import api.routers.exports as exports_router
    import api.routers.projects as projects_router

    monkeypatch.setattr(projects_router.event_bus, "emit", lambda *_a, **_kw: None)
    monkeypatch.setattr(exports_router.event_bus, "emit", lambda *_a, **_kw: None)

    app = FastAPI()
    app.include_router(projects_router.router)
    app.include_router(exports_router.router)
    client = TestClient(app, client=("127.0.0.1", 50000))

    # 1. Create and persist a dubbing project
    project_state = {
        "targetLang": "es",
        "dubSegments": [
            {
                "id": "seg_0",
                "start": 0.0,
                "end": 2.4,
                "text": "Hola mundo, bienvenidos a Voice Suite.",
                "profile_id": "voice_es_1",
            },
            {
                "id": "seg_1",
                "start": 2.5,
                "end": 5.0,
                "text": "Todo el procesamiento ocurre localmente.",
                "profile_id": "voice_es_1",
            },
        ],
    }
    create_res = client.post(
        "/projects",
        json={
            "name": "Spanish Product Dub",
            "video_path": "/local/media/demo.mp4",
            "audio_path": "/local/media/demo.wav",
            "duration": 5.0,
            "state": project_state,
        },
    )
    assert create_res.status_code == 200
    project_id = create_res.json()["id"]

    # 2. List & reopen project
    list_res = client.get("/projects")
    assert list_res.status_code == 200
    assert any(p["id"] == project_id and p["name"] == "Spanish Product Dub" for p in list_res.json())

    reopen_res = client.get(f"/projects/{project_id}")
    assert reopen_res.status_code == 200
    reopened = reopen_res.json()
    assert reopened["name"] == "Spanish Product Dub"
    assert reopened["state"]["targetLang"] == "es"
    assert len(reopened["state"]["dubSegments"]) == 2

    # 3. Rename & delete project
    rename_res = client.patch(
        f"/projects/{project_id}",
        json={"name": "Spanish Product Dub Final"},
    )
    assert rename_res.status_code == 200
    assert rename_res.json()["name"] == "Spanish Product Dub Final"

    del_res = client.delete(f"/projects/{project_id}")
    assert del_res.status_code == 200
    assert client.get(f"/projects/{project_id}").status_code == 404

    # 4. Export history record & listing
    for filename, dest in (
        ("take_01.wav", str(hermetic_env["outputs_dir"] / "take_01.wav")),
        ("take_01.flac", str(hermetic_env["outputs_dir"] / "take_01.flac")),
        ("take_01.mp3", str(hermetic_env["outputs_dir"] / "take_01.mp3")),
    ):
        rec_res = client.post(
            "/export/record",
            json={
                "filename": filename,
                "destination_path": dest,
                "mode": "audio",
            },
        )
        assert rec_res.status_code == 200
        assert rec_res.json()["success"] is True

    # Reject upward traversal in recorded destination path
    traversal_res = client.post(
        "/export/record",
        json={
            "filename": "take_01.wav",
            "destination_path": "/tmp/../etc/passwd",
            "mode": "audio",
        },
    )
    assert traversal_res.status_code == 400

    history_res = client.get("/export/history")
    assert history_res.status_code == 200
    history_filenames = [item["filename"] for item in history_res.json()]
    assert {"take_01.wav", "take_01.flac", "take_01.mp3"}.issubset(set(history_filenames))


def test_apple_silicon_mps_status_and_cpu_fallback_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import core.device_caps as device_caps

    # 1. Host status call never raises and returns required keys
    host_status = device_caps.apple_silicon_mps_status()
    for key in (
        "platform",
        "arch",
        "is_darwin",
        "is_apple_silicon",
        "mps_built",
        "mps_available",
        "mps_active",
        "unified_memory_gb",
        "acceleration_explanation",
    ):
        assert key in host_status

    # 2. Simulate Apple Silicon with MPS available
    monkeypatch.setattr(device_caps.sys, "platform", "darwin")
    monkeypatch.setattr(device_caps._platform, "machine", lambda: "arm64")
    monkeypatch.setattr(device_caps, "requested_device_override", lambda: "auto")

    fake_mps_called = {"emptied": False}
    fake_torch_active = types.SimpleNamespace(
        backends=types.SimpleNamespace(
            mps=types.SimpleNamespace(
                is_available=lambda: True,
                is_built=lambda: True,
            )
        ),
        mps=types.SimpleNamespace(
            empty_cache=lambda: fake_mps_called.__setitem__("emptied", True)
        ),
    )
    active_status = device_caps.apple_silicon_mps_status(fake_torch_active)
    assert active_status["is_apple_silicon"] is True
    assert active_status["mps_active"] is True
    assert "Apple Silicon Metal (MPS) acceleration active" in active_status["acceleration_explanation"]
    assert device_caps.release_mps_cache(fake_torch_active) is True
    assert fake_mps_called["emptied"] is True

    # 3. Simulate Apple Silicon with MPS unavailable (explicit CPU fallback explanation)
    fake_torch_fallback = types.SimpleNamespace(
        backends=types.SimpleNamespace(
            mps=types.SimpleNamespace(
                is_available=lambda: False,
                is_built=lambda: True,
            )
        )
    )
    fallback_status = device_caps.apple_silicon_mps_status(fake_torch_fallback)
    assert fallback_status["is_apple_silicon"] is True
    assert fallback_status["mps_active"] is False
    assert "CPU fallback on Apple Silicon" in fallback_status["acceleration_explanation"]


def test_default_privacy_configuration_is_local_first() -> None:
    privacy = json.loads((ROOT / "store/privacy.json").read_text(encoding="utf-8"))
    defaults = privacy["defaultBehavior"]
    assert defaults["accountRequired"] is False
    assert defaults["analyticsEnabled"] is False
    assert defaults["audioUploaded"] is False
    assert defaults["projectsUploaded"] is False

    for channel in privacy["transmittedData"]:
        excluded = " ".join(channel.get("excluded", [])).lower()
        assert "audio" in excluded or "user content" in excluded
