# Voice Suite — Handover

Voice Suite is a local-first AI audio production application (text-to-speech, voice
cloning, voice design, dubbing, transcription, dictation, audiobooks and batch
processing). It is a derived work of [VoiceStudio](https://github.com/debpalash/VoiceStudio)
(AGPL-3.0) by Palash Debnath, forked at upstream `v0.5.9-beta.8` (commit `520343bd6`,
the current `origin/main` sync point of this repository).

This folder is the complete maintainer handover. Read in this order:

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the frontend, backend, engines, storage and deployments fit together |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel frontend, inference backend (Docker), desktop packaging |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Every configuration variable (no secrets) |
| [FEATURE_MATRIX.md](FEATURE_MATRIX.md) | Parity with upstream and the improvements Voice Suite adds |
| [MODEL_CATALOG.md](MODEL_CATALOG.md) | Engines, licences (commercial / non-commercial / unknown), hardware |
| [QA_REPORT.md](QA_REPORT.md) | What was tested, how, results, screenshots, real output evidence |
| [MAINTENANCE.md](MAINTENANCE.md) | Dependency updates, troubleshooting, backups, upstream merges |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | Everything Voice Suite changed relative to upstream |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | What is not done, not verified, or depends on external services |

## Current state (2026-11-24)

- **Branch / PR:** work lives on `feat/voice-suite-integration`
  ([PR #6](https://github.com/kierantrestain/Voice-suite/pull/6)) and is merged to `main`
  once its checks are green; `main` is the production branch for Vercel.
- **CI:** backend + frontend tests, Python tests, Electron tests, renderer smokes, UI
  crawlers, desktop install/smoke on macOS/Windows/Linux, CodeQL, gitleaks and bandit
  passed on the PR head before this session; the only failing check was the Android
  job, which is out of scope (mobile is not a release gate for Voice Suite).
- **Hosted frontend:** the same React renderer as the desktop app, built as a static
  site with `VOICE_SUITE_HOSTED=1`. It connects to an inference backend you run and
  shows a labelled disconnected state when none is connected. It never fakes results.
- **Real inference verified in this session (CPU):** KittenTTS generation, faster-whisper
  transcription, AudioSeal watermark detection, WAV 24-bit/48 kHz, FLAC and MP3 export,
  high-pass/trim/normalise finishing. See [QA_REPORT.md](QA_REPORT.md).

## Operating it

**Use the hosted app**

1. Open the Vercel URL (protected by Vercel Authentication — sign in with the owning
   Vercel account).
2. Without a backend you can browse every workspace; a bar at the bottom says
   *No inference backend connected*.
3. Start a backend (see [DEPLOYMENT.md](DEPLOYMENT.md#2-inference-backend)), then in the
   app go to **Settings → Sharing & Remote Access → Remote backend**, enter its HTTPS URL
   and API key, press **Test connection**, then **Save & reload**.
4. The first connection runs the first-run setup (system check, model packs, privacy).
   Pick a commercially usable engine (for example KittenTTS) if outputs will be used
   commercially — see [MODEL_CATALOG.md](MODEL_CATALOG.md).

**Run everything locally from source (developer)**

```bash
git clone https://github.com/kierantrestain/Voice-suite.git
cd Voice-suite
bun install --frozen-lockfile
uv sync --frozen --no-default-groups --group cpu --group dev   # or --group cuda
bun run dev:web        # backend on :3900 + browser UI on :3901
# or: bun run desktop  # Electron app
```

**Build exactly what Vercel builds**

```bash
bun install --frozen-lockfile --ignore-scripts
cd electron && VOICE_SUITE_HOSTED=1 bun run build:web   # output: frontend/dist
```

## Key files touched by Voice Suite

| Area | Files |
|---|---|
| Hosted connection | `electron/src/renderer/src/lib/hosted-backend.ts`, `components/hosted-backend-bar.tsx`, `hooks/use-backend-status.ts`, `lib/api/client.ts`, `features/settings/remote-backend-settings.tsx`, `electron/vite.web.config.ts` |
| Vercel | `vercel.json` |
| Inference backend deploy | `deploy/inference-backend/` |
| Brand / identity | `config/app.json`, `electron/src/shared/utils/contactLinks.js`, locale catalogs, `docs/logo*` |
| Production audio | `backend/services/audio_io.py`, `backend/api/routers/tools.py`, `electron/src/renderer/src/features/tools/tools-page.tsx` |
| Model rights / consent | `features/settings/model-rights-indicator.tsx`, `features/clone/reference-panel.tsx`, `backend/api/routers/generation.py` |
| Release validation tests | `tests/test_voice_suite_release_validation.py`, `electron/src/renderer/src/lib/hosted-backend.test.ts` |

## Rules this repository enforces

`CLAUDE.md` and `AGENTS.md` hold the inherited engineering rules (version lockstep,
docs-sync, changelog fragments in `changelog.d/`, localisation parity across 22
catalogs, keep-main-green). They still apply. Commits carry only the human
committer's identity (`scripts/check_commit_identities.py`).
