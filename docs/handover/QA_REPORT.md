# QA report — Voice Suite v0.6.0 (2026-11-26)

Environment: Linux x86-64 VM, 2 vCPU (Intel Xeon @ 2.30 GHz), 7.8 GiB RAM, no GPU,
Python 3.11.18 (`uv sync --frozen --no-default-groups --group cpu --group dev`),
Bun 1.2.14, Node 22, ffmpeg 6.1.1.

## 1. Automated suites

| Suite | Command | Result |
|---|---|---|
| Production guards, memory & audio QC | `.venv/bin/pytest tests/test_voice_suite_production_guards.py tests/test_audio_quality.py tests/backend/services/test_audio_quality.py tests/test_model_acceptance.py tests/test_tts_model_licence_gate.py` | **75 passed**, 0 failed |
| Backend lifecycle, loopback security, branding, release & distribution | `.venv/bin/pytest tests/test_inference_backend_script.py tests/test_untrusted_loopback.py tests/test_voice_suite_release_validation.py tests/test_electron_release_assets.py tests/test_release_rehearsal.py tests/test_release_signing_notes.py tests/test_unified_release_workflow.py tests/test_docker_registry_owner.py tests/test_published_image_path_is_pinned.py tests/test_identity_paths_survive_the_rename.py tests/test_voicestudio_branding.py` | **198 passed**, 7 skipped, 0 failed |
| Version lockstep, changelog & OpenAPI contract | `.venv/bin/pytest tests/test_app_version.py tests/test_changelog_style.py tests/test_mobile_contract.py tests/test_release_script.py` | **147 passed**, 0 failed |
| Electron updater, hosted backend, model rights & license UI tests | `cd electron && bun x vp test --run ...` | **163 passed**, 0 failed |
| Store artifact manifest & distribution identity contracts | `node --test scripts/create_store_artifact_manifest.test.mjs electron/tests/store-artifact-manifest.test.mjs electron/tests/distribution-identity.test.mjs electron/tests/snap-store-packaging.test.mjs` | **14 passed**, 0 failed |
| Type check & locale parity (22 catalogs) | `bun run --cwd electron typecheck`, `locale-encoding.mjs`, `locale-source-keys.mjs`, `locale-coverage.mjs` | pass (0 errors, 0 missing keys across 4,022 keys × 22 locales) |
| Hosted production build | `VOICE_SUITE_HOSTED=1 bun run build:web` | pass (10.5 s) |
| SAST & compose validation | `uvx bandit -q -ll ...` + `docker compose config` | **BANDIT CLEAN**, compose valid |

## 2. Real model inference & CPU benchmarks (no mocks)

| Engine / Pipeline | Licence | Audio / Task | Timing & RTF | Peak RSS | Measured Output Quality |
|---|---|---|---|---|---|
| **KittenTTS** (`KittenML/kitten-tts-mini-0.8`) | Apache-2.0 | 8.26 s cold / 8.17 s warm (24 kHz mono) | 15.39 s cold · 13.70 s warm (**RTF 1.68**) | 1,158 MB | peak −1.91 dBFS, RMS −17.88 dBFS, **0 clipped**, 0 QC warnings |
| **MOSS-TTS-Nano** (`OpenMOSS-Team/MOSS-TTS-Nano`) | Apache-2.0 | Zero-shot voice clone, 48 kHz native (6.08 s cold / 6.80 s warm) | 27.74 s cold · 16.11 s warm (**RTF 2.37**) | 1,547 MB (+11.9 MB warm delta) | peak −4.93 dBFS, RMS −18.81 dBFS, **0 clipped**, 0 QC warnings, **0% WER** (`"Second take confirms warm 0 shot cloning performance at 48 kilohertz."`) |
| **faster-whisper base** (`Systran/faster-whisper-base`, int8) | MIT | Transcribe 8.26 s KittenTTS speech | 5.32 s (**RTF 0.64**) | 1,634 MB | **0% WER** (`"Welcome to Voice Suite by Bang on Entertainment. Local audio production is ready."`) |
| **WhisperX + wav2vec2** | MIT | Real MP4 Dub pipeline forced alignment | End-to-end pass | — | 2 timed segments → valid SRT & WebVTT + `/tools/incremental` |
| **Production Exports** | — | 24-bit/48 kHz WAV, FLAC, MP3 | End-to-end pass | — | Valid `PCM_24` 48 kHz (1.18 MB), lossless `fLaC` (214 KB), MP3 (77 KB) |
| **Audio Finishing** (`/tools/finish-audio`, `/tools/trim-audio`, `/tools/analyze-quality`) | — | High-pass 80 Hz, silence trim, −1 dBFS norm, 20 ms edge fades | 200 OK | — | Clean WAV output; QC reports exact peak/RMS/DC/clipping/silence ratio |
| **AudioSeal Watermark** (`POST /watermark/detect`) | MIT | Raw WAV, finished WAV, 24-bit/48 kHz WAV, FLAC, MP3, MOSS-TTS-Nano 48 kHz clone | 200 OK | — | `is_watermarked: true` on all 6 outputs; confidence **1.0** (WAV/FLAC/clone) and **0.992** (MP3) |
| **True Offline Operation** (`HF_HUB_OFFLINE=1`) | — | Restarted backend with `HF_HUB_OFFLINE=1` → KittenTTS + faster-whisper | 13.07 s TTS | 1,068 MB | **0% WER** (`"Offline verification succeeded with zero network calls."`) |

## 3. All 10 Workspaces (live backend via `backend.sh`)

1. **Voice Library:** Created consented voice profile `8c8e65b5`, restarted via `backend.sh restart`, verified persistence.
2. **Generate:** Real KittenTTS synthesis, `/tools/analyze-quality`, `/tools/finish-audio`, `/tools/trim-audio`, 24-bit/48 kHz WAV/FLAC/MP3 exports, AudioSeal verified.
3. **Clone:** Explicit consent attestation + real commercial 48 kHz zero-shot voice cloning via `moss-tts-nano` (Apache-2.0) on CPU.
4. **Design:** Verified honest HTTP 422 under commercial mode when active engine lacks voice design; zero silent fallback to CC-BY-NC OmniVoice.
5. **Dub:** Generated real MP4 video with `ffmpeg` + KittenTTS speech → `POST /dub/upload` (202) → `POST /dub/transcribe/{id}` (WhisperX alignment) → SRT & VTT export → `/tools/incremental`.
6. **Transcribe:** Real `faster-whisper-base` transcription with 0% WER and 0.64× RTF.
7. **Dictate:** Verified `/dictation/prefs`, `/dictation/readiness`, and capture backend `.unload()` cleanup on settings change.
8. **Audiobooks:** Planned 2-chapter script, synthesized Chapter 0 (3.99 s) with KittenTTS, verified instant cache hit (`cached: true`) on second preview.
9. **Batch:** Enqueued real MP4 job via multipart `/batch/enqueue`, verified status polling and `/batch/jobs/{id}/cancel` (HTTP 200, status `cancelled`).
10. **Settings:** Verified `backend.sh` lifecycle (`setup --commercial-only`, `start`, `status`, `restart`, `key`, `stop`), `/api/settings/commercial-mode` env-lock (409), analytics OFF by default, and `HF_HUB_OFFLINE=1`.

## 4. Security and privacy verification

| Check | Result |
|---|---|
| `https://voice-suite.vercel.app` live check | HTTP 302 → Vercel Authentication (`vercel.com/sso-api`), `x-frame-options: DENY`, HSTS preload |
| Loopback request without key (`OMNIVOICE_LOOPBACK_REQUIRES_KEY=1`) | **401 Unauthorized** |
| Wrong Bearer key | **401 Unauthorized** |
| Foreign CORS preflight (`https://evil.example`) | **400 Bad Request**, no `Access-Control-Allow-Origin` |
| Allowed CORS preflight (`https://voice-suite.vercel.app`) | **200 OK**, exact origin echo |
| API-key → scoped bearer session (`POST /api/auth/session`) | **201 Created**, distinct short-lived token accepted on admin routes |
| Commercial Production Guard (`OMNIVOICE_COMMERCIAL_ONLY=1`) | `PUT /api/settings/commercial-mode {"enabled":false}` → **409 Conflict**; `POST /generate` with `omnivoice` (CC-BY-NC) → **403 Forbidden** (`commercial_guard_blocked`) |
| Secrets scan & SAST | `bandit` clean; zero credentials in `frontend/dist/` or renderer source |

## 5. Screenshots

Preserved in [`screenshots/`](screenshots/) from the UI browser sweep (`home`,
`voice-library`, `generate`, `generate-real-kittentts-result`, `design`, `dub`,
`transcribe`, `dictate`, `audiobooks`, `batch`, `settings`, `settings-models`,
`settings-backend`, `settings-remote-backend-api-key-ok`,
`voice-library-remote-https-auth`, `stories`, `projects`, `hosted-disconnected`).
