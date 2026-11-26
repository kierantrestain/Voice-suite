# Known limitations and unverified capabilities

Stated plainly so nothing is mistaken for verified.

## Hardware & Acceleration

- **Verified with real inference on Linux x86-64 CPU (2 vCPU, 7.8 GiB RAM, no GPU):**
  - KittenTTS (`KittenML/kitten-tts-mini-0.8`, Apache-2.0) — TTS
  - MOSS-TTS-Nano (`OpenMOSS-Team/MOSS-TTS-Nano`, Apache-2.0) — 48 kHz zero-shot voice cloning
  - faster-whisper (`Systran/faster-whisper-base`, MIT) — transcription
  - WhisperX + wav2vec2 forced alignment — Dubbing video/audio alignment
  - AudioSeal — 16-bit neural provenance watermarking (surviving 24-bit/48 kHz WAV, FLAC, MP3, and finishing)
- **Not benchmarked on physical GPU/Apple Silicon hardware in this environment:**
  - Apple Silicon Metal (MPS) and MLX (`mlx-audio`, `mlx-whisper`, `parakeet-mlx`)
  - NVIDIA CUDA and AMD ROCm acceleration
  - Large GPU-oriented engines (VoxCPM2, CosyVoice 3 PyTorch, Dots-TTS, MOSS-TTS-v1.5, pyannote speaker diarisation)
  - These paths are covered by automated tests and upstream CI; Apple Silicon `arm64` desktop installers are built and smoke-tested on GitHub Actions `macos-15`.

## Distribution & Signing

- **Unsigned desktop installers:** Apple Developer ID (`ELECTRON_MACOS_CSC_LINK`,
  `APPLE_API_KEY*`) and Windows Authenticode / SignPath (`ELECTRON_WINDOWS_CSC_LINK` /
  `SIGNPATH_*`) credentials are not yet configured in repository secrets. Release
  installers published from `kierantrestain/Voice-suite` are clearly labelled
  unsigned/ad-hoc development builds. Unsigned macOS builds check for updates and direct
  users to the GitHub Releases page instead of invoking Squirrel.Mac.
- **Docker daemon absent in devbox VM:** `deploy/inference-backend/docker-compose.yml`
  validates cleanly with `docker compose config`, and `.github/workflows/docker.yml`
  builds and publishes `ghcr.io/kierantrestain/voice-suite` on `main` and release tags.

## Deployment & Connectivity

- **No always-on paid inference server provisioned:** `https://voice-suite.vercel.app` is
  live and protected by Vercel Authentication; users run the inference backend on their
  own CPU/GPU hardware via `deploy/inference-backend/backend.sh` or Docker Compose and
  connect it in **Settings → Sharing & Remote Access → Remote backend**.
- **Vercel preview origins** change per deployment; list each origin in
  `OMNIVOICE_ALLOWED_ORIGINS` (production alias `https://voice-suite.vercel.app` recommended).
- **Safari** may block `http://localhost` from an HTTPS site; use an HTTPS backend URL
  (built-in Caddy profile or Cloudflare Tunnel / Tailscale Funnel).

## Product & Inherited Scope

- **Watermark detector family label:** AudioSeal detection reports `source: "VoiceStudio"`
  because the 16-bit `"OM"` watermark payload is shared with upstream builds.
- **Commercial voice design on CPU:** `MOSS-TTS-Nano` and `KittenTTS` cover commercial CPU
  TTS and zero-shot cloning; commercial Voice Design (`voxcpm2`, Apache-2.0) requires heavier
  compute (GPU recommended). When Commercial Production Guard is enabled and the active
  engine does not support voice design, requests fail cleanly (HTTP 422) rather than
  falling back to non-commercial OmniVoice (CC-BY-NC).
- **Opt-in VoiceStudio Cloud / mobile apps:** Cloud account/sync features stay off by
  default; mobile apps (`mobile/ios/`, `mobile/android/`) are preserved upstream code
  excluded from Voice Suite desktop release gates.

## External dependencies (all optional, none paid)

Hugging Face (model downloads), PyPI / `download.pytorch.org` (engine sidecar installs),
GitHub (releases, star count, demo assets), Let's Encrypt (optional Caddy profile), Vercel
(static frontend hosting). Offline operation after model download is verified with
`HF_HUB_OFFLINE=1`.
