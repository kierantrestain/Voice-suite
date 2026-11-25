# QA report — 2026-11-24

Environment: Linux x86-64 container, 4 vCPU, 15.7 GB RAM, no GPU, Python 3.11.18
(`uv sync --frozen --group cpu`), Bun 1.4.4, Node 22, Chromium (Playwright) at
1440×900.

## 1. Automated suites

| Suite | Command | Result |
|---|---|---|
| Electron/renderer unit tests | `cd electron && bun x vp test --run` | **4,260 passed**, 17 skipped, 0 failed |
| Type check (main + renderer) | `bun run --cwd electron typecheck` | pass |
| Lint / format (changed files) | `bun x vp lint …`, `bun x vp fmt …` | pass |
| Locale checks | `node tests/locale-encoding.mjs`, `locale-source-keys.mjs`, `locale-coverage.mjs` | pass (0 missing keys in 22 catalogs) |
| Python: locale parity, CJK guard, branding, release validation, CORS headers, mobile contract and every test reading README/en.json | `uv run pytest …` | **573 passed** |
| Hosted-backend module | `hosted-backend.test.ts` | 11 passed; the session regression test fails on the pre-fix code and passes after |
| Hosted production build | `VOICE_SUITE_HOSTED=1 bun run build:web` | pass (clean checkout, ~8 s incl. install) |
| PR #6 CI before this session | GitHub Actions on `10bdaac` | all desktop, Python, Electron, crawler, install, CodeQL, gitleaks, bandit checks green; only `android` failed (out of scope) |
| CI run `45505984177` (on `55155c1`) | GitHub Actions | 4 real failures fixed: support smoke expected the old repo link (the upstream attribution link had been redirected by mistake — restored; private security reports now go to this repository), and the desktop harness's local-first guard only allowed the upstream star-count request (now allows only this repository's) |
| Final PR #6 CI (on `f7a1b6d`) | GitHub Actions | renderer smokes, desktop UI (Linux/macOS/Windows), Python, Electron, crawlers, install, CodeQL, gitleaks, bandit green; one Windows `Install Electron deps` network flake re-run; mobile jobs excluded |

## 2. Browser end-to-end (hosted build against a real backend)

| Scenario | Result | Evidence |
|---|---|---|
| No backend configured | All workspaces browsable; bottom card "No inference backend connected" with **Connect backend**; API calls fail fast; no console errors | `screenshots/hosted-disconnected.webp` |
| Connect to local backend (`http://localhost:3900`) | 14 routes render with live data, zero page errors | `screenshots/*.webp` |
| First connection | Real first-run setup wizard loads from the backend | — |
| Generate in the UI (KittenTTS preset voice) | `POST /generate` 200, waveform and player shown, "5.6 s · rendered in 6.4 s · 24 kHz" | `screenshots/generate-real-kittentts-result.webp` |
| Remote backend over HTTPS with `OMNIVOICE_API_KEY`, non-loopback address | Wrong key → "HTTP 401"; right key → "OK — cpu · omnivoice · v0.5.9-beta.8"; Save & reload → Voice Library loads through the scoped session; raw key absent from `localStorage` | `screenshots/settings-remote-backend-api-key-ok.webp`, `voice-library-remote-https-auth.webp` |
| Bug found and fixed | Saving a new backend discarded the just-exchanged session, so the app asked for the key again after reload. Fixed in `hostedBackendApi.useRemote`, with a regression test | commit `55155c181` |

## 3. Real model output (no mocks)

| Check | Result |
|---|---|
| KittenTTS `POST /generate` | 200, `audio/wav`, 16-bit mono 24 kHz, 8.82 s; peak −2.0 dBFS, RMS −17.2 dBFS, 0 clipped samples |
| 24-bit / 48 kHz production WAV (`encode_wav_production`) | 48 000 Hz, 24-bit, duration preserved, peak 0.793, 0 clipped |
| FLAC (`encode_flac`) | valid `fLaC`; decoded samples bit-identical to the source (max diff 0.0) |
| MP3 (`encode_mp3`, ffmpeg) | valid; 8.88 s (encoder padding), peak 0.789, 0 clipped |
| Finishing `POST /tools/finish-audio` (high-pass 80 Hz, silence trim, −1 dBFS) | peak −0.95 dBFS (target −1.0), leading silence 61 → 48 ms, DC offset ≈ 0 |
| Watermark `POST /watermark/detect` | raw WAV, FLAC and MP3: `is_watermarked: true`, confidence 1.0 |
| Transcription `POST /transcribe` (faster-whisper base) | "Welcome to Voice Suite. This sentence was generated on a CPU with the Kitense model." — correct apart from the engine name; 2.83 s for 8.54 s |
| Licence gate | OmniVoice (CC-BY-NC) preload skipped until its licence is accepted |

## 4. Security and privacy

| Check | Result |
|---|---|
| Non-loopback request without key | 401 |
| CORS preflight from a foreign origin | rejected (400), no `Access-Control-Allow-Origin` |
| CORS from the configured origin | allowed with exact origin echo |
| API key storage in browser | never stored; only a scoped, expiring session bound to the backend URL |
| Hosted CSP | `script-src 'self'`; connections only to `https:`/`wss:` and loopback; `object-src 'none'`; `frame-ancestors 'none'` via header |
| Mixed content | `http://` non-loopback backends rejected up front with an explanation |
| Stored URL tampering | non-http(s), credential-bearing, query or fragment URLs ignored |
| Secrets in repo | none added; `.env` files git-ignored; examples only (`.env.example`, `deploy/inference-backend/.env.example`) |
| Same-host proxy bypass | documented; the compose setup reaches the container via the Docker gateway, so the key stays required |
| Analytics | still opt-in; the backend compose hard-disables it by default |

## 5. Accessibility and layout

- Connection card uses `role="status"` + `aria-live="polite"`, keyboard-reachable buttons
  and links, and does not cover the top-right notifications or account controls.
- Remote-backend form fields have accessible names (`Backend URL`, `API key`);
  probe results use `role="status"`/`role="alert"`.
- All 14 captured routes rendered at 1440×900 without horizontal overflow.

## 6. Screenshots

All in [`screenshots/`](screenshots/): `home`, `voice-library`, `generate`,
`generate-real-kittentts-result`, `design`, `dub`, `transcribe`, `dictate`, `audiobooks`,
`batch`, `settings`, `settings-models`, `settings-backend`,
`settings-remote-backend-api-key-ok`, `voice-library-remote-https-auth`, `stories`,
`projects`, `hosted-disconnected`.

## 7. Not verified here

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md): GPU/MPS inference, cloning-capable and
large engines, full dubbing/batch/audiobook runs with real models, the Docker image build
(no Docker daemon in this environment), and the live Vercel deployment if it was not
completed in this session.
