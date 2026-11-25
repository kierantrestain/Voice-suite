# Feature parity and improvement matrix

Baseline: upstream VoiceStudio `v0.5.9-beta.8` (`origin/main` @ `520343bd6`). Voice Suite =
`main` after PR #6. "Parity" means the upstream capability is present and reachable in
Voice Suite; no upstream workspace, route, engine, API or integration was removed (the
route inventory and UI crawler CI jobs check every route; all passed on PR #6).

Legend: ✅ present and verified in this handover · ☑ present, covered by automated
tests/CI but not exercised with real models here · ➕ Voice Suite improvement.

## Workspaces

| Workspace | Upstream | Voice Suite | Evidence |
|---|---|---|---|
| Voice Library (saved voices, search, filters, previews, profiles) | ✓ | ✅ + ➕ favourites filter, consent status on profiles | `screenshots/voice-library.webp`, `voice-library-remote-https-auth.webp` |
| Generate (TTS, engine/preset voice, settings, playback, export) | ✓ | ✅ real KittenTTS generation from the hosted UI | `screenshots/generate-real-kittentts-result.webp` |
| Clone (reference audio, consent, profiles) | ✓ | ☑ + ➕ explicit authorisation attestation before saving a cloned voice | `tests/test_voice_suite_release_validation.py::test_voice_cloning_profile_lifecycle_and_consent_attestation` |
| Design (voice from description, reusable profiles) | ✓ | ☑ | `screenshots/design.webp` |
| Dub (import, transcribe, translate, timed segments, render) | ✓ | ☑ (UI verified; pipeline in upstream tests) | `screenshots/dub.webp` |
| Transcribe (audio/video, edit, export) | ✓ | ✅ backend transcription with faster-whisper | `QA_REPORT.md` §3 |
| Dictate (record, transcribe, text handling) | ✓ | ☑ (needs a microphone; UI verified) | `screenshots/dictate.webp` |
| Audiobooks (chapters, voices, export) | ✓ | ☑ | `screenshots/audiobooks.webp` |
| Batch (queue, progress, cancel, retry, outputs) | ✓ | ☑ | `screenshots/batch.webp` |
| Settings (backend, models, hardware, storage, preferences) | ✓ | ✅ + ➕ hosted backend connection, model rights badges | `screenshots/settings*.webp` |
| Stories, Projects, Tools, Integrations, Calls, Workflows, API reference | ✓ | ☑ unchanged | route inventory CI |

## Cross-cutting capabilities

| Area | Upstream | Voice Suite |
|---|---|---|
| Deployment targets | Desktop (Electron), Docker (UI served by backend), mobile apps | Same, ➕ **hosted static frontend (Vercel) + separately hosted backend**, with connection probe, API-key session exchange, health polling and disconnected state |
| Backend connectivity UI in the browser | Always assumed "ready" (no status in a browser tab) | ➕ real `/health` status: not configured / checking / starting / unreachable / ready, retry and settings shortcut |
| Audio export | WAV (engine rate), MP3 via save dialog | ➕ 24-bit/48 kHz production WAV and lossless FLAC alongside WAV/MP3 (verified on real output) |
| Audio finishing | Speech normalisation, trim in dub editor, A/B voice comparison (Tools → Compare) | ➕ Tools: waveform trim with edge fades, silence removal, high-pass filter, peak normalisation, one-click "finish" chain (`tools-page.tsx`, `/tools/finish-audio`, `/tools/trim-audio`); A/B comparison retained |
| Provenance | AudioSeal watermark chokepoint | Same; ➕ provenance notices in the UI; verified surviving FLAC/MP3 |
| Model licensing | Licence acceptance gate, catalogue data | ➕ per-engine rights indicator distinguishing commercial / conditions / unknown / non-commercial, and app licence vs model licence |
| Consent | Voice-ownership flag | ➕ explicit attestation step for cloned voices |
| Hardware | CUDA / ROCm / MPS / XPU / CPU routing | Same; ➕ Apple Silicon Metal/MPS diagnostics and CPU-fallback explanations (`core/device_caps.py`) |
| Branding & links | VoiceStudio | ➕ Voice Suite identity, theme, icons; in-app repo/docs/issue/security links point to this repository; upstream credit kept (Support, LICENSE-NOTICE, README) |
| Commercial upsell | "VoiceStudio Pro" paid tier and account prompts | Pro page explains everything is free; accounts and cloud sync remain opt-in and off by default |
| Localisation | 22 UI catalogs | Same, all new strings translated in all 22 |

## Interface quality

| Aspect | Upstream | Voice Suite |
|---|---|---|
| Home | Feature grid | ➕ 10-workspace studio dashboard |
| Theme | Light/dark palettes | ➕ dark-first studio theme as default |
| Connection state on the web | None | ➕ non-blocking floating status card with one primary action |

## Reliability and performance

| Aspect | Voice Suite result |
|---|---|
| Renderer unit tests | 4,260 passed (489 files) |
| Python tests touched by this work | 573 passed (locale parity, branding, CORS headers, release validation, mobile contract …) |
| Hosted build | `bun install` + `build:web` in ~8 s from a clean checkout |
| Real generation, CPU | ~1× real time (KittenTTS); transcription ~3× real time (Whisper base) |
