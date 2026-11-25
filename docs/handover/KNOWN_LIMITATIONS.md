# Known limitations and unverified capabilities

Stated plainly so nothing is mistaken for verified.

## Deployment

- **Live Vercel deployment.** The Vercel connector used for this handover never got
  access to the owner's Vercel scope (the approval link was not completed), so the agent
  could not create the project or confirm a live URL. Everything needed is committed
  (`vercel.json`); the owner imports the repository in the Vercel dashboard
  ([DEPLOYMENT.md](DEPLOYMENT.md#1-vercel-frontend)). The identical build was verified
  locally from a clean checkout and exercised in Chromium.
- **No live inference server.** No always-on backend was provisioned (paid
  infrastructure needs approval). The hosted site shows a disconnected state until a
  backend is connected.
- **Docker image not built in this session.** The environment had no Docker daemon. The
  compose file validates (`docker compose config`) and uses the upstream `deploy/Dockerfile`,
  which upstream CI builds and smoke-tests; the image itself was not rebuilt here.
- **Vercel preview origins** change per deployment; the backend allow-list must list each
  origin that should work (production alias recommended).
- **Safari** may block `http://localhost` from the HTTPS site; use an HTTPS backend URL.

## Inference and hardware

- Verified on CPU only: KittenTTS (TTS), faster-whisper base (ASR), AudioSeal.
- **Not run here:** OmniVoice (default engine, non-commercial weights), any voice-cloning
  engine, large TTS engines, WhisperX alignment, diarisation, translation models, LLM
  features, NVIDIA CUDA, AMD ROCm and Apple Silicon MPS. These are inherited upstream code
  paths with upstream CI and acceptance tests, not re-verified for this handover.
- Full Dub, Batch, Audiobook and Dictation runs with real models were not executed; their
  UIs load against a real backend and their pipelines are covered by automated tests.
- KittenTTS is English-only with preset voices; it does not clone. A commercially
  licensed cloning engine (e.g. CosyVoice 3 or VoxCPM2, Apache-2.0) needs a GPU host.

## Product and branding

- Backend-provided engine display names, demo voice text and some docs pages still say
  "VoiceStudio" (they come from upstream backend data and docs).
- The watermark detector reports `source: "VoiceStudio"`: the watermark payload is
  shared with upstream builds, so the label describes the family, not this product.
- Desktop auto-update, Homebrew, Docker image and phone links still reference upstream
  feeds; Voice Suite has no signed releases of its own yet (needs code-signing
  certificates and a release process in this repository).
- Opt-in VoiceStudio Cloud account/sync features point at upstream services; they stay
  off by default.
- Mobile apps are preserved but not built, branded or tested for Voice Suite; the
  Android CI job fails and is excluded from release gates.

## External dependencies (all optional, none paid)

Hugging Face (model downloads), PyPI / download.pytorch.org (engine installs), GitHub
(star count, demo assets, update checks), Let's Encrypt (Caddy profile), Vercel (hosting).
