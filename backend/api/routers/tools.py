"""
Tools router — Phase 4.6 (ROADMAP.md).

Standalone utilities exposed as first-class endpoints, independent of the
dub pipeline. The Tools page UI consumes these. Headless CLI consumers
(omnivoice-dub) will share the same service layer.

Shipped today:

    POST /tools/probe       → ffprobe-style metadata for a file path.
    POST /tools/incremental → plan what segments need regenerating.
    POST /tools/direction   → parse a natural-language direction into tokens.
    POST /tools/rate-fit    → LLM-assisted slot-fit for translated text.

More utilities (vocal separation, alignment, merge) are wired through
existing dub helpers and land in follow-up passes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from services import director, speech_rate, incremental
from services.ffmpeg_utils import find_ffprobe, spawn_subprocess
from api.dependencies import require_admin, require_native_access
from core.path_security import UnsafePath, resolve_within

logger = logging.getLogger("omnivoice.tools")
router = APIRouter()


# ── Probe (ffprobe wrapper) ────────────────────────────────────────────────


class ProbeReq(BaseModel):
    path: str


@router.post("/tools/probe", dependencies=[Depends(require_native_access)])
async def probe(req: ProbeReq):
    target = os.path.realpath(os.path.expanduser(req.path))
    if not os.path.exists(target):
        raise HTTPException(
            status_code=404,
            detail="File not found. Provide an absolute path to an existing file.",
        )
    ffprobe = find_ffprobe()
    if not ffprobe:
        raise HTTPException(
            status_code=501,
            detail="ffprobe binary not available. Install system ffmpeg or re-run the setup.",
        )
    proc = await spawn_subprocess(
        ffprobe, "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", target,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffprobe failed: {stderr.decode(errors='replace')[:400]}",
        )
    try:
        return json.loads(stdout.decode("utf-8"))
    except json.JSONDecodeError:
        return {"raw": stdout.decode("utf-8", errors="replace")}


# ── Incremental plan (what needs regenerating) ─────────────────────────────


class IncrementalReq(BaseModel):
    segments: list[dict]
    stored_hashes: Optional[dict[str, str]] = None
    # P1.3 — the ACTIVE track's language code. When set, fingerprints are
    # scoped to that language (pass that language's stored hashes alongside);
    # omitted → legacy language-agnostic hashing, kept for old callers.
    lang: Optional[str] = None
    # Match DubRequest.language when speech language differs from the track
    # code (for example Auto speech stored in an en track).
    language: Optional[str] = None
    # Voice-identity mode the client will generate with (DubRequest.voice_match).
    # Only "consistent" changes the hash (per_line/omitted == legacy), so
    # flipping the Voice-match toggle marks every segment stale — the audio
    # really would come out with a different reference (#281 class).
    voice_match: Optional[str] = None


@router.post("/tools/incremental")
def plan_incremental(req: IncrementalReq):
    from services.pronunciation import speech_text_preparer

    prepare_text = speech_text_preparer()
    segments = [
        {**seg, "text": prepare_text(
            seg.get("text") or "", seg.get("target_lang") or req.language or req.lang,
            profile_id=seg.get("profile_id"),
        )}
        for seg in req.segments
    ]
    return incremental.plan_incremental(
        segments,
        stored_hashes=req.stored_hashes or {},
        track_lang=req.lang,
        voice_match=req.voice_match,
    )


# ── Directorial AI parse ───────────────────────────────────────────────────


class DirectionReq(BaseModel):
    text: str = Field(..., description="Natural-language direction, e.g. 'urgent and surprised'")


@router.post("/tools/direction", dependencies=[Depends(require_admin)])
def parse_direction(req: DirectionReq):
    d = director.parse(req.text)
    return {
        "tokens":          d.tokens,
        "instruct_prompt": d.instruct_prompt(),
        "translate_hint":  d.translate_hint(),
        "rate_bias":       d.rate_bias(),
        "method":          d.method,
        "error":           d.error,
        "taxonomy":        director.TAXONOMY,
    }


# ── Speech-rate fit ────────────────────────────────────────────────────────


class RateFitReq(BaseModel):
    text: str
    slot_seconds: float
    target_lang: str
    source_text: Optional[str] = None


@router.post("/tools/rate-fit", dependencies=[Depends(require_admin)])
def rate_fit(req: RateFitReq):
    return speech_rate.adjust_for_slot(
        req.text,
        slot_seconds=req.slot_seconds,
        target_lang=req.target_lang,
        source_text=req.source_text,
    )


# ── Audio effects presets ──────────────────────────────────────────────────


@router.get("/tools/effects")
def list_effects():
    """Return available audio effect presets (Broadcast, Cinematic, etc.)."""
    from services.audio_dsp import list_effect_presets
    return list_effect_presets()


# ── TTS Plugin SDK ─────────────────────────────────────────────────────────


@router.get("/tools/plugins")
def list_tts_plugins():
    """Return all registered TTS engine plugins and their availability."""
    from services.plugin_sdk import list_plugins
    return list_plugins()


# ── Video context analysis ─────────────────────────────────────────────────


@router.post("/tools/video-context/{job_id}", dependencies=[Depends(require_admin)])
async def analyse_video_context(job_id: str):
    """Analyse the source video's visual context for dubbing decisions.

    Returns per-segment mood, brightness, and complexity cues that
    can be used as TTS instruct hints.
    """
    import os
    from api.routers.dub_core import _get_job
    from core.config import DUB_DIR
    from services.video_context import analyse_video

    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", job_id or ""):
        raise HTTPException(status_code=400, detail="Invalid job id")
    try:
        job_dir = resolve_within(DUB_DIR, job_id)
    except UnsafePath as exc:
        raise HTTPException(status_code=400, detail="Invalid job id") from exc
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    video_path = resolve_within(DUB_DIR, job_dir / "source.mp4")
    if not video_path.is_file():
        try:
            video_path = resolve_within(DUB_DIR, job.get("video_path", ""))
        except UnsafePath:
            return {"error": "Source video not found", "segments": {}}

    if not video_path.is_file():
        return {"error": "Source video not found", "segments": {}}

    segments = job.get("segments") or []
    ctx = await analyse_video(str(video_path), segments)
    return ctx.to_dict()


# Workflow audio is already synthetic. Re-mark after processing through the
# existing chokepoint rather than routing it through human mic cleanup.
def _decode_workflow_audio(data: bytes):
    import io
    import numpy as np
    import soundfile as sf
    import torch

    try:
        with sf.SoundFile(io.BytesIO(data)) as source:
            if source.format != "WAV" or source.channels not in (1, 2):
                raise ValueError("Expected mono or stereo WAV")
            if source.frames < 1 or source.frames * source.channels > 16_000_000:
                raise ValueError("Audio exceeds the processing limit")
            audio = source.read(dtype="float32", always_2d=True)
            rate = source.samplerate
        if not np.isfinite(audio).all():
            raise ValueError("Invalid audio samples")
        return torch.from_numpy(audio.T.copy()), rate
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail="Provide a valid WAV within the audio size limit.") from exc


def _encode_workflow_audio(audio, rate: int) -> bytes:
    import io
    from services.audio_io import _safe_soundfile_write

    output = io.BytesIO()
    _safe_soundfile_write(output, audio.detach().cpu().numpy().T, rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


@router.post("/tools/normalize-speech", dependencies=[Depends(require_admin)])
async def normalize_workflow_speech(
    audio: UploadFile = File(...),
    target_dbfs: float = Form(-2.0, ge=-24.0, le=-1.0),
):
    """Peak-normalize synthetic speech; bounded and entirely local."""
    from services.audio_dsp import normalize_audio
    from services.watermark import mark_synthetic_async

    data = await audio.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio exceeds 64 MiB.")
    waveform, rate = await run_in_threadpool(_decode_workflow_audio, data)
    waveform = await run_in_threadpool(normalize_audio, waveform, target_dBFS=target_dbfs)
    waveform = await mark_synthetic_async(waveform, rate, context="workflow.normalize")
    encoded = await run_in_threadpool(_encode_workflow_audio, waveform, rate)
    return Response(encoded, media_type="audio/wav")


def _trim_workflow_audio(
    waveform,
    rate: int,
    start_seconds: float,
    end_seconds: Optional[float],
    fade_ms: float,
):
    import torch

    total_frames = int(waveform.shape[-1])
    start_sec = max(0.0, float(start_seconds or 0.0))
    start_idx = min(max(0, int(round(start_sec * rate))), max(0, total_frames - 1))
    if end_seconds is not None and float(end_seconds) > 0:
        end_sec = float(end_seconds)
        if end_sec <= start_sec:
            raise HTTPException(
                status_code=422,
                detail="end_seconds must be greater than start_seconds.",
            )
        end_idx = min(total_frames, max(start_idx + 1, int(round(end_sec * rate))))
    else:
        end_idx = total_frames

    trimmed = waveform[..., start_idx:end_idx].clone()
    if fade_ms > 0 and trimmed.shape[-1] > 1:
        fade_samples = min(
            int(round((float(fade_ms) / 1000.0) * rate)),
            int(trimmed.shape[-1]) // 2,
        )
        if fade_samples > 1:
            ramp = torch.linspace(
                0.0, 1.0, fade_samples, dtype=trimmed.dtype, device=trimmed.device
            )
            trimmed[..., :fade_samples] = trimmed[..., :fade_samples] * ramp
            trimmed[..., -fade_samples:] = trimmed[..., -fade_samples:] * ramp.flip(0)
    return trimmed


@router.post("/tools/trim-audio", dependencies=[Depends(require_admin)])
async def trim_workflow_audio(
    audio: UploadFile = File(...),
    start_seconds: float = Form(0.0, ge=0.0),
    end_seconds: Optional[float] = Form(None),
    fade_ms: float = Form(15.0, ge=0.0, le=2000.0),
):
    """Trim synthetic/workflow WAV audio to [start_seconds, end_seconds] with optional edge fade."""
    from services.watermark import mark_synthetic_async

    data = await audio.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio exceeds 64 MiB.")
    waveform, rate = await run_in_threadpool(_decode_workflow_audio, data)
    trimmed = await run_in_threadpool(
        _trim_workflow_audio, waveform, rate, start_seconds, end_seconds, fade_ms
    )
    trimmed = await mark_synthetic_async(trimmed, rate, context="workflow.trim")
    encoded = await run_in_threadpool(_encode_workflow_audio, trimmed, rate)
    return Response(encoded, media_type="audio/wav")


def _finish_workflow_audio(
    waveform,
    rate: int,
    target_dbfs: float,
    trim_silence: bool,
    silence_threshold_db: float,
    denoise_highpass_hz: float,
):
    import torch
    import torch.nn.functional as F
    from services.audio_dsp import normalize_audio

    out = waveform.clone().float()
    if denoise_highpass_hz and float(denoise_highpass_hz) > 0 and rate > 0:
        out = out - out.mean(dim=-1, keepdim=True)
        cutoff = max(20.0, min(float(denoise_highpass_hz), float(rate) * 0.25))
        win = max(3, int(round(float(rate) / cutoff)))
        if win % 2 == 0:
            win += 1
        if int(out.shape[-1]) > win:
            padded = F.pad(out.unsqueeze(0), (win // 2, win // 2), mode="reflect")
            low = F.avg_pool1d(padded, kernel_size=win, stride=1).squeeze(0)
            out = out - low[..., : out.shape[-1]]

    if trim_silence and rate > 0 and out.numel() > 0:
        thresh_db = max(-80.0, min(-10.0, float(silence_threshold_db)))
        floor = 10.0 ** (thresh_db / 20.0)
        envelope = out.abs()
        if envelope.ndim > 1:
            envelope = envelope.amax(dim=tuple(range(envelope.ndim - 1)))
        voiced = torch.nonzero(envelope > floor)
        if voiced.numel() > 0:
            pad = int(round(rate * 0.05))
            start = max(0, int(voiced[0].item()) - pad)
            end = min(int(out.shape[-1]), int(voiced[-1].item()) + 1 + pad)
            if end > start:
                out = out[..., start:end]

    clamped_dbfs = max(-40.0, min(-0.1, float(target_dbfs)))
    out = normalize_audio(out, target_dBFS=clamped_dbfs)
    return out


@router.post("/tools/finish-audio", dependencies=[Depends(require_admin)])
async def finish_workflow_audio(
    audio: UploadFile = File(...),
    target_dbfs: float = Form(-2.0, ge=-40.0, le=-0.1),
    trim_silence: bool = Form(True),
    silence_threshold_db: float = Form(-42.0, ge=-80.0, le=-10.0),
    denoise_highpass_hz: float = Form(80.0, ge=0.0, le=1000.0),
):
    """Apply production finishing (high-pass rumble removal, silence trim, peak normalization)."""
    from services.watermark import mark_synthetic_async

    data = await audio.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio exceeds 64 MiB.")
    waveform, rate = await run_in_threadpool(_decode_workflow_audio, data)
    finished = await run_in_threadpool(
        _finish_workflow_audio,
        waveform,
        rate,
        target_dbfs,
        trim_silence,
        silence_threshold_db,
        denoise_highpass_hz,
    )
    finished = await mark_synthetic_async(finished, rate, context="workflow.finish")
    encoded = await run_in_threadpool(_encode_workflow_audio, finished, rate)
    return Response(encoded, media_type="audio/wav")

