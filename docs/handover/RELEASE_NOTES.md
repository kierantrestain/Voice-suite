# Release notes — Voice Suite (based on VoiceStudio 0.5.9-beta.8)

Version string: `0.5.9-beta.8` (unchanged from the upstream base; bump only in the three
lockstep places — root `package.json`, `pyproject.toml`, `backend/core/version.py`).

**Highlights**

- Hosted web app: the full studio interface on Vercel, connected to an inference backend you run
- Production audio: 24-bit/48 kHz WAV and lossless FLAC, trim with fades, silence removal, high-pass and normalisation
- Clear model rights: every engine shows whether its weights allow commercial use
- Explicit consent before saving a cloned voice
- Voice Suite identity, dark studio theme and a 10-workspace dashboard

### Added

- Hosted frontend build (`VOICE_SUITE_HOSTED=1`, `vercel.json`) with configurable backend URL, `/health` status polling, API-key → scoped-session sign-in and a labelled disconnected state.
- Inference backend deployment (`deploy/inference-backend/`): Docker Compose from source, required API key and origin allow-list, NVIDIA override, optional Caddy HTTPS.
- Production exports: 24-bit/48 kHz WAV and FLAC alongside WAV and MP3.
- Audio tools: waveform trim with edge fades, silence trimming, high-pass filter, peak normalisation and a one-step finish chain.
- Model rights indicators (commercial / conditions / unknown / non-commercial) separating app licence from model licence.
- Cloning consent attestation and provenance notices.
- Voice favourites in the voice library.
- Apple Silicon Metal/MPS diagnostics and CPU-fallback explanations.
- Release validation test suite (`tests/test_voice_suite_release_validation.py`) and hosted-backend tests.
- Maintainer handover documentation (`docs/handover/`), `.env.example` files.

### Changed

- Product identity, icons, logo, theme and home dashboard rebranded to Voice Suite.
- User-facing text says "Voice Suite" in all 22 languages; upstream service names (VoiceStudio Pro, Cloud, account) are kept where they refer to upstream services.
- In-app repository, documentation, issue and security links point to this repository; the GitHub star badge counts this repository and shows no bundled upstream figure.
- README: *Get Voice Suite* section (hosted app, backend, source), upstream installers labelled as upstream; same in the 19 translated READMEs.
- Pro/Support pages: no paid upsell; everything is free.

### Fixed

- Saving a hosted backend no longer discards the session just created from the API key.
- macOS/Windows installer packaging contract checks and Electron renderer smoke selectors after the rebrand.

### License

- AGPL-3.0 retained; `LICENSE-NOTICE.md` and README credit VoiceStudio (Palash Debnath) and OmniVoice (k2-fsa). OmniVoice weights are labelled non-commercial.

### CI

- Mobile (Android/iOS) checks are not Voice Suite release gates; desktop, Python, Electron, crawler, install, CodeQL, gitleaks and bandit checks remain required.
