# Release checklist — Voice Suite v0.6.0

Single list of release gates and outstanding issues. Status: ✅ verified (real run, evidence
linked) · ⏳ in progress · ❌ blocked (reason) · ➖ not applicable / out of scope.

Release branch: `release/v0.6.0` (integrating `release/v0.6.0-backend` and `release/v0.6.0-dist`),
version `0.6.0` in lockstep (`package.json`, `pyproject.toml`, `backend/core/version.py`, `uv.lock`),
verified 2026-11-26.

## 1. Baseline & Automated Suites

| Gate | Status | Evidence |
|---|---|---|
| Renderer/main unit tests | ✅ | `cd electron && bun x vp test --run` + `model-rights-indicator.test.ts` + `model-license.test.tsx` + `updater.test.ts` |
| Type check + locale parity (22 catalogs) | ✅ | `bun run --cwd electron typecheck`, `locale-encoding.mjs`, `locale-source-keys.mjs`, `locale-coverage.mjs` (0 missing) |
| Hosted production build | ✅ | `VOICE_SUITE_HOSTED=1 bun run build:web` (10.5 s) |
| Backend boots from source & `backend.sh`, `/health` | ✅ `{"status":"ok"}` | `deploy/inference-backend/backend.sh start` (RSS 471 MB idle) |
| Production guard, memory, security, contract, version & changelog tests | ✅ | `test_voice_suite_production_guards.py`, `test_untrusted_loopback.py`, `test_inference_backend_script.py`, `test_voice_suite_release_validation.py`, `test_mobile_contract.py`, `test_app_version.py`, `test_changelog_style.py` |

## 2. Deployment

| Gate | Status | Notes |
|---|---|---|
| Vercel project live from `main` (`https://voice-suite.vercel.app`) | ✅ | HTTP 302 to `vercel.com/sso-api`, HSTS preload, `X-Frame-Options: DENY` |
| Deployment protection enabled | ✅ | Vercel Authentication active on live URL |
| Live URL: all 26 routes, desktop + mobile viewport, console clean | ✅ | Verified in handover milestone |
| Inference backend: native start/stop/restart/status/logs/key scripts | ✅ | `deploy/inference-backend/backend.sh` verified end-to-end (`--commercial-only` supported) |
| Docker Compose configuration & GHCR workflow | ✅ | `docker compose config` valid; `Docker (GHCR)` workflow green on `main` (devbox VM has no local Docker daemon) |
| Authenticated HTTPS hosted frontend ↔ backend | ✅ | `POST /api/auth/session` scoped bearer exchange, exact `https://voice-suite.vercel.app` CORS allow, foreign CORS blocked, `OMNIVOICE_LOOPBACK_REQUIRES_KEY=1` enforced (401 without key) |
| Offline operation after model download | ✅ | `HF_HUB_OFFLINE=1` real KittenTTS + faster-whisper transcription verified (`"Offline verification succeeded with zero network calls."`) |

## 3. Models and hardware

| Gate | Status | Notes |
|---|---|---|
| Licence register: code vs weights, evidence | ✅ | `backend/config/model_licenses.json` (70 models), UI badges trust authoritative categories |
| Restricted models blocked in commercial production | ✅ | Backend-enforced Commercial Production Guard (`OMNIVOICE_COMMERCIAL_ONLY=1` / `/api/settings/commercial-mode`) returns HTTP 403 `commercial_guard_blocked` for CC-BY-NC & unverified models even after personal acceptance |
| Commercial cloning engine runs on CPU | ✅ | **MOSS-TTS-Nano** (`Apache-2.0`, 100M, 20 langs, 48 kHz) installed via one-click sidecar, real zero-shot clone verified: warm RTF 2.37 on 2 vCPU, 0 clipped samples, AudioSeal confidence 1.0, 0% WER transcript |
| CPU benchmarks (KittenTTS, MOSS-TTS-Nano, faster-whisper, WhisperX, AudioSeal) | ✅ | Measured on 2 vCPU / 7.8 GiB RAM Linux x86-64 (see `QA_REPORT.md`) |
| Physical Apple Silicon MPS/MLX & NVIDIA CUDA benchmarks | ❌ | No physical Apple Silicon or NVIDIA GPU hardware available in this Linux CPU VM (MPS diagnostics & macOS arm64 desktop packaging verified on GitHub Actions `macos-15`) |
| Memory: single residency, idle unloading, low-RAM ASR offload | ✅ | Fixed dead `release_idle_engines()`, added `evict_other_tts_engines_sync()` to audiobook/unified ASR offload, added eviction to `resolve_generation_backend()`, fixed dictation backend `.unload()`; RSS plateaued at 1.54 GB on MOSS-TTS-Nano |

## 4. Workspaces (real inputs, real models)

| Workspace | Status | Evidence |
|---|---|---|
| Voice Library | ✅ | Created consented profile, persisted across `backend.sh restart` |
| Generate | ✅ | Real KittenTTS (Apache-2.0) 8.17 s in 13.7 s (2 vCPU), QC 0 clipped, 24-bit/48 kHz WAV + FLAC + MP3 + AudioSeal (0.992–1.0) |
| Clone | ✅ | Real MOSS-TTS-Nano (Apache-2.0) 48 kHz zero-shot clone + explicit consent attestation gate |
| Design | ✅ | Verified honest HTTP 422 when active commercial engine lacks voice design; zero silent fallback to CC-BY-NC OmniVoice |
| Dub (audio + video) | ✅ | Real ffmpeg MP4 upload → WhisperX + wav2vec2 forced alignment → 2 segments → SRT/VTT export → `/tools/incremental` |
| Transcribe (timestamps, subtitles) | ✅ | Real faster-whisper base (MIT): 8.26 s in 5.32 s (RTF 0.64), 0% WER |
| Dictate | ✅ | `/dictation/prefs` & `/dictation/readiness` live; capture backend `.unload()` cleanup verified |
| Audiobooks | ✅ | 2-chapter plan + real KittenTTS synthesis (3.99 s) + content-addressed cache reuse verified |
| Batch (cancel, retry, recovery) | ✅ | Real MP4 multipart enqueue → job status → cancel (HTTP 200, status `cancelled`) |
| Settings (persistence) | ✅ | Commercial mode API + env lock (409), analytics OFF by default, `HF_HUB_OFFLINE=1` verified |

## 5. Distribution

| Gate | Status | Notes |
|---|---|---|
| Updater points at `kierantrestain/Voice-suite` releases; no upstream prompts | ✅ | `config/app.json`, `updater.ts` (70 tests), unsigned macOS redirects to GitHub Releases |
| Release workflow & artifact manifest work in this repository | ✅ | Fixed `create_store_artifact_manifest.mjs` & `scripts/release.py` for `Voice-Suite-` prefix |
| macOS arm64 + x64, Windows x64, Linux x64 packages | ✅ | Rehearsal run `45853022562` passed 100% across all 5 desktop legs (`macos-15` arm64, `macos-15-intel` x64, `windows-2022` x64, `windows-11-arm` arm64, `ubuntu-22.04` x64) + packaged startup smoke tests + release feed/checksum validation (unsigned dev builds — signing secrets not configured) |
| AGPL notices and upstream credit preserved | ✅ | `LICENSE`, `LICENSE-NOTICE.md`, `test_voice_suite_release_validation.py` |

## 6. Security and privacy

| Gate | Status | Notes |
|---|---|---|
| Auth, CORS/CSRF, uploads, credential storage | ✅ | Loopback key enforcement (401), scoped bearer session exchange, CORS exact-origin, Fernet encrypted secrets |
| Offline outbound-request verification | ✅ | `HF_HUB_OFFLINE=1` full TTS + ASR cycle with zero network calls |
| Secrets + SAST scan | ✅ | `bandit` clean (`-ll`), zero secrets in `frontend/dist` or renderer source; CI `gitleaks` + `CodeQL` |
| Telemetry/accounts default off | ✅ | `store/privacy.json` verified + `OMNIVOICE_ANALYTICS_DISABLED=1` in `backend.sh` & Compose |

## 7. Release

| Gate | Status |
|---|---|
| Version bumped in lockstep (`0.6.0`) + `CHANGELOG.md` section | ✅ |
| Full CI green on the release PR | ⏳ |
| Screenshots of workspaces (`docs/handover/screenshots/`) | ✅ |
| Handover docs updated | ✅ |
| PR merged, `v0.6.0` tagged, GitHub release published | ⏳ |
