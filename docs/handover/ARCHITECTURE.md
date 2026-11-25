# Architecture

```
                 ┌─────────────────────────── one React renderer ───────────────────────────┐
                 │ electron/src/renderer  (React 19, TanStack Router [hash], React Query,    │
                 │ Tailwind, i18next with 22 catalogs)                                      │
                 └──────┬──────────────────────────┬──────────────────────────┬────────────┘
                        │                          │                          │
        Desktop (Electron)               Docker / self-served web       Hosted (Vercel, static)
   electron/src/main supervises      FastAPI serves frontend/dist     VOICE_SUITE_HOSTED=1 build,
   a local Python runtime; renderer  and the API on one origin        backend is another origin,
   calls /api via app:// protocol                                     chosen in Settings
                        │                          │                          │ HTTPS + CORS +
                        ▼                          ▼                          ▼ API-key session
                 ┌──────────────────────── backend/ (FastAPI, Python 3.11) ─────────────────┐
                 │ main.py · api/routers/* (generation, profiles, dub_*, capture, batch,    │
                 │ audiobook, longform_jobs, tools, exports, watermark, engines, settings…) │
                 │ services/ (tts_backend, asr_backend, translation, audio_io, watermark,   │
                 │ model_licenses, sidecar_install, …) · core/ (auth, csrf, browser_guard)  │
                 └──────┬───────────────────────────────┬──────────────────────────────────┘
                        │                               │
         Engines: in-process (OmniVoice, KittenTTS,     Storage: OMNIVOICE_DATA_DIR
         faster-whisper, WhisperX …) or isolated         (omnivoice_data/: SQLite via
         sidecars/subprocesses (CosyVoice, IndexTTS,     alembic migrations, voices,
         VoxCPM2, MOSS, GGUF/audio.cpp runtimes)         projects, outputs, exports) +
         on CPU / CUDA / ROCm / MPS / XPU                Hugging Face cache (HF_HOME)
```

## Frontend

- Single source: `electron/src/renderer`. The desktop app, the Docker-served web UI and
  the hosted Vercel site are the same bundle with build-time flags:
  `__WEB_DEPLOYMENT__` (browser bundle) and `__HOSTED_FRONTEND__` (static host, remote
  backend). Configs: `electron/electron.vite.config.ts` (desktop),
  `electron/vite.web.config.ts` (browser/hosted), `electron/vite.config.ts` (tests).
- Routing is hash based (`/#/clone`), so refreshes and deep links work on any static
  host; `vercel.json` also rewrites non-asset paths to `index.html`.
- Desktop-only capabilities go through `window.voicestudio` (the Electron preload
  bridge, typed in `electron/src/preload/index.d.ts`). Every caller tolerates its absence;
  browser builds use standard web APIs (downloads, `<input type=file>`,
  `getUserMedia`).
- **Hosted connection layer** (Voice Suite):
  - `lib/hosted-backend.ts` — URL normalisation, mixed-content detection, `/health`
    probe, API-key → scoped session exchange (`@shared/api/authSession`), and a browser
    stand-in for the desktop bridge's `backend.testRemote/useRemote/useLocal`.
  - `hooks/use-backend-status.ts` — in hosted mode polls `/health` (15 s when up, 5 s
    when down, slower when the tab is hidden) and publishes `ready` / `starting` /
    `failed` / `idle` (not configured).
  - `lib/api/client.ts` — `API_BASE` is the saved backend URL; with none, or a backend
    confirmed down, requests fail fast with a clear message instead of hitting the
    static host.
  - `components/hosted-backend-bar.tsx` + `components/backend-gate.tsx` — the
    disconnected indicator; the first-run setup check runs only once `/health` is ok.
  - The hosted CSP (in `vite.web.config.ts`) allows `https:`/`wss:` plus loopback only.

## Backend

- FastAPI app `backend/main.py`, started by `uvicorn main:app --app-dir backend`
  (desktop: supervised by Electron main; Docker: `backend/docker_entrypoint.py`).
- Security layers (inherited, unchanged): loopback is trusted; non-loopback needs the
  share PIN or `OMNIVOICE_API_KEY` (admin routes need the key); CORS + CSRF exact-origin
  allow-list `OMNIVOICE_ALLOWED_ORIGINS`; DNS-rebinding host checks; WebSocket tickets.
  Details: `docs/api-auth.md`.
- Engines are registered in `services/tts_backend.py` / `services/asr_backend.py`
  with availability, hardware routing (`routing_status`), licences and install hints.
  Optional engines install on demand into isolated environments
  (`services/sidecar_install.py`).
- Every synthetic output passes the provenance chokepoint (`services/watermark.py`,
  AudioSeal invisible watermark; optional audible/visible marks).
- Licence gate: models with restrictive licences (e.g. OmniVoice CC-BY-NC) are not
  loaded until the licence is accepted (`services/model_licenses.py`,
  `docs/licensing/model-license-data.json`).

## Storage and persistence

| Data | Location |
|---|---|
| Voices, projects, history, exports, settings DB | `OMNIVOICE_DATA_DIR` (default per-OS app data dir; Docker `/app/omnivoice_data`) |
| Model weights | `HF_HOME` (Hugging Face cache) and per-engine folders |
| Schema | SQLite with alembic migrations (`backend/migrations`, `alembic.ini`) |
| Browser-only state (hosted) | `localStorage`: backend URL (`voice-suite.backend-url`), scoped admin session (never the raw API key), UI preferences; `sessionStorage`: share PIN |

## APIs

- REST + WebSocket API documented live at `/docs` (OpenAPI) and in-app under
  **Settings → Voice Suite API**; schema export: `uv run python scripts/export_openapi.py`.
- OpenAI-compatible TTS/ASR routes (`api/routers/openai_compat.py`) and an MCP server
  (`/mcp`, `backend/mcp_server.py`) for agents and automation.

## Deployment relationships

| Target | Builds from | Serves |
|---|---|---|
| Vercel | `vercel.json` → `electron` `build:web` with `VOICE_SUITE_HOSTED=1` | Static UI only |
| Inference backend | `deploy/inference-backend/docker-compose.yml` → `deploy/Dockerfile` | API (+ its own copy of the UI on `/`) |
| Desktop | `bun run dist` (electron-builder) | App + managed local backend |

Mobile (`mobile/`) is preserved from upstream but is not a Voice Suite release target.
