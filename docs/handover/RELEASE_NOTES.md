# Release notes — Voice Suite v0.6.0

Version string: `0.6.0` (in lockstep across root `package.json`, `pyproject.toml`,
`backend/core/version.py`, and `uv.lock`). Derived from upstream VoiceStudio
`v0.5.9-beta.8` (AGPL-3.0).

**Highlights**

- **Independent Voice Suite v0.6.0 distribution:** dedicated `io.github.kierantrestain.voicesuite`
  application identity, independent GitHub Releases & auto-updater on
  `kierantrestain/Voice-suite` (no upstream update prompts), and GHCR container publishing
- **Backend-enforced Commercial Production Guard:** `OMNIVOICE_COMMERCIAL_ONLY=1` and
  `/api/settings/commercial-mode` block CC-BY-NC and unverified weights with HTTP 403
  (`commercial_guard_blocked`), preventing accidental commercial use even after personal acceptance
- **Verified commercial CPU voice cloning:** MOSS-TTS-Nano (Apache-2.0, 100M, 20 languages,
  48 kHz native) verified end-to-end alongside KittenTTS (Apache-2.0), faster-whisper (MIT),
  WhisperX forced alignment, AudioSeal provenance, and `HF_HUB_OFFLINE=1` offline operation
- **Production backend operations & proxy security:** `deploy/inference-backend/backend.sh`
  (`install/setup/start/stop/restart/status/logs/key`, `--commercial-only`) with
  `OMNIVOICE_LOOPBACK_REQUIRES_KEY=1` preventing same-host reverse-proxy auth bypass
- **Memory & audio quality hardening:** single-residency TTS eviction across generate/dub/batch/audiobook,
  idle in-process TTS engine unloading, low-RAM unified-memory ASR offloading, dictation cleanup,
  and `POST /tools/analyze-quality` audio QC metrics

### Added

- Backend-enforced Commercial Production Guard (`GET/PUT /api/settings/commercial-mode`, `OMNIVOICE_COMMERCIAL_ONLY=1`, `--commercial-only` flag in `backend.sh`).
- Native inference backend lifecycle manager (`deploy/inference-backend/backend.sh`) and `OMNIVOICE_LOOPBACK_REQUIRES_KEY=1` outermost ASGI middleware (`UntrustedLoopbackMiddleware`).
- Audio quality summary metrics (`peak_dbfs`, `rms_dbfs`, `dc_offset`, `clipped_samples`, `silence_ratio`) and `POST /tools/analyze-quality` endpoint.
- Hosted Vercel frontend (`https://voice-suite.vercel.app`) with Vercel Authentication, scoped session exchange, live `/health` status, and labelled disconnected state.
- 24-bit/48 kHz WAV & FLAC exports, waveform trim/fades, finishing chain, explicit cloning consent attestation, and voice favourites.

### Changed

- Desktop installers (`Voice-Suite-0.6.0-*`), auto-updater feeds, application ID (`io.github.kierantrestain.voicesuite`), and Docker GHCR publishing target `kierantrestain/Voice-suite`.
- Performance profiles skip non-commercial NLLB-200 translation in favour of commercial-friendly Argos when Commercial Production Guard is enabled.

### Fixed

- Same-host reverse proxy / tunnel requests arriving from `127.0.0.1` can no longer bypass API-key authentication when `OMNIVOICE_LOOPBACK_REQUIRES_KEY=1` is set.
- `classifyModelRights` now trusts authoritative `model_licenses.json` categories, fixing false non-commercial badges on Apache-2.0 engines (CosyVoice, MOSS-TTS-Nano, VoxCPM2).
- Wired dead `tts_backend.release_idle_engines()` into `model_manager.idle_worker()`, enforced single-residency eviction in `resolve_generation_backend()` and `audiobook.py`, extended unified-memory ASR offload to non-OmniVoice engines, and added `.unload()` to dictation reset.
- Fixed `scripts/create_store_artifact_manifest.mjs` and `scripts/release.py` to match the `Voice-Suite-` artifact prefix across all desktop platforms.

### License & Attribution

- Application code: GNU AGPL-3.0-only (`LICENSE`, `LICENSE-NOTICE.md`), crediting
  VoiceStudio (Palash Debnath) and OmniVoice (k2-fsa). Model weights remain governed by
  their own upstream licences.
