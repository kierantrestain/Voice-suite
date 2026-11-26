# Deployment

Voice Suite deploys as two independent pieces:

1. a **static frontend** on Vercel (no AI runs there), and
2. an **inference backend** (Python/PyTorch, FastAPI) on hardware you control.

Heavy inference is deliberately not put in Vercel Functions: models are gigabytes,
need GPUs or long CPU time, and keep state on disk.

## 1. Vercel frontend

Configuration is committed in [`vercel.json`](../../vercel.json):

| Setting | Value |
|---|---|
| Framework | none (static) |
| Root directory | repository root |
| Install | `bun install --frozen-lockfile --ignore-scripts` |
| Build | `cd electron && VOICE_SUITE_HOSTED=1 bun run build:web` |
| Output | `frontend/dist` |
| Headers | `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, COOP, `Permissions-Policy` (microphone allowed for dictation/recording) |
| Caching | `/assets/*` immutable for a year; `index.html` no-cache |
| Routing | hash routes; non-asset paths rewrite to `index.html` |

### First-time setup (dashboard, about 3 minutes)

1. vercel.com → **Add New… → Project → Import Git Repository** → `kierantrestain/Voice-suite`.
2. Leave **Root Directory** as `./`. Vercel reads `vercel.json`; no overrides needed.
3. Optional environment variable (Production and Preview):
   `VITE_VOICE_SUITE_BACKEND_URL=https://your-backend.example.com` to pre-fill the backend.
   Users can still change it in Settings. It is public (baked into the bundle), so never
   put a key in it.
4. **Deploy.** Production deploys follow `main`; every PR gets a preview URL.
5. **Protect the deployment:** Project → Settings → **Deployment Protection** →
   *Vercel Authentication* → **All Deployments** (`all_except_custom_domains` keeps any
   custom domain public). You stay able to open it while signed in to Vercel; others
   need a share link (Deployment → *Share*) or team access.

### CLI alternative

```bash
npm i -g vercel
vercel link                 # pick/create the project
vercel deploy --prod        # uses vercel.json
```

### Verify a deployment

- Open the URL: the home dashboard renders and a bottom bar says *No inference backend
  connected*. Refreshing a deep link such as `/#/dub` still works.
- Browser console has no CSP errors.

## 2. Inference backend

Directory: [`deploy/inference-backend/`](../../deploy/inference-backend/). Supports both a
**native from-source** backend (macOS / Linux) and **Docker Compose** (building
`deploy/Dockerfile`, CPU or NVIDIA GPU).

### Option A — Native lifecycle script (macOS / Linux)

```bash
deploy/inference-backend/backend.sh install \
  --origin https://voice-suite.vercel.app --commercial-only
deploy/inference-backend/backend.sh status
deploy/inference-backend/backend.sh key
deploy/inference-backend/backend.sh restart
deploy/inference-backend/backend.sh logs -f
deploy/inference-backend/backend.sh stop
```

Settings and the generated 256-bit API key live in `~/.voice-suite-backend/backend.env`
(`0600`). By default `backend.sh` enables `OMNIVOICE_SERVER_MODE=1`,
`OMNIVOICE_LOOPBACK_REQUIRES_KEY=1`, and `OMNIVOICE_ANALYTICS_DISABLED=1`; pass
`--commercial-only` to also lock `OMNIVOICE_COMMERCIAL_ONLY=1` (blocks CC-BY-NC and
unverified weights with HTTP 403).

### Option B — Docker Compose

```bash
cp deploy/inference-backend/.env.example deploy/inference-backend/.env
# edit .env: OMNIVOICE_API_KEY=$(openssl rand -base64 48)
#            OMNIVOICE_ALLOWED_ORIGINS=https://voice-suite.vercel.app
#            OMNIVOICE_COMMERCIAL_ONLY=1   # recommended for commercial studio use
docker compose --env-file deploy/inference-backend/.env \
  -f deploy/inference-backend/docker-compose.yml up -d --build
# NVIDIA GPU: add  -f deploy/inference-backend/docker-compose.gpu.yml
curl -s http://127.0.0.1:3900/health
```

### HTTPS (required for the Vercel site)

Browsers block `http://` requests from an `https://` page unless they go to localhost.
Pick one:

| Option | How |
|---|---|
| Built-in Caddy | Point a DNS name at the host, open ports 80/443, set `VOICE_SUITE_BACKEND_DOMAIN`, add `--profile https`. Caddy gets a Let's Encrypt certificate (or set `VOICE_SUITE_CADDY_TLS="tls internal"` for a local CA). |
| Tunnel | Cloudflare Tunnel, Tailscale Funnel or ngrok to `http://127.0.0.1:3900` (free tiers exist; no inbound ports). |
| Same computer | A backend on the viewer's own machine at `http://localhost:3900` works from the HTTPS site in Chromium and Firefox. |

### Security checklist

- `OMNIVOICE_API_KEY` is required by both `backend.sh` and the compose file. The browser
  exchanges it via `POST /api/auth/session` for a short-lived scoped session; the raw key
  is never stored by the site.
- `OMNIVOICE_LOOPBACK_REQUIRES_KEY=1` (default in `backend.sh`) prevents same-host
  reverse proxies or tunnels (`nginx proxy_pass`, `ssh -R`) from bypassing API-key
  authentication by arriving as `127.0.0.1`.
- `OMNIVOICE_ALLOWED_ORIGINS` must list the exact Vercel origin(s) (no trailing slash).
  Preview deployments have their own origins; add one if you want to test a preview.
- `OMNIVOICE_COMMERCIAL_ONLY=1` locks Commercial Production Guard on at the backend
  chokepoint (`model_acceptance.ensure_accepted`), refusing CC-BY-NC and unverified models
  with HTTP 403 (`commercial_guard_blocked`) even if previously accepted.
- Do **not** set `OMNIVOICE_TRUST_HOST_LOOPBACK` or `FORWARDED_ALLOW_IPS=*` when a proxy
  runs on the same host — that would let proxied internet traffic look local.
- Keep the backend port bound to loopback (`127.0.0.1:3900:3900`) and publish only
  through TLS.

### Hardware

| Host | Notes |
|---|---|
| CPU only (2–4 vCPU, 8–16 GB RAM) | Verified: KittenTTS (Apache-2.0, TTS), MOSS-TTS-Nano (Apache-2.0, 48 kHz zero-shot cloning), faster-whisper base (MIT, ASR), WhisperX alignment, AudioSeal watermarking. |
| NVIDIA (≥ 8 GB VRAM recommended) | Use the GPU override. Most engines are GPU-accelerated. |
| AMD ROCm / Apple Silicon | Supported by upstream builds (`docs/install/`); the Docker image targets CUDA/CPU. Apple Silicon runs the backend natively from source with Metal/MPS or MLX. |

No paid service is required. A free-tier VM or a home GPU box plus a free tunnel is enough.

## 3. Independent desktop packaging & GitHub Releases

Voice Suite builds and publishes independently branded installers from
`kierantrestain/Voice-suite` via `.github/workflows/electron-release.yml`
(`appId: io.github.kierantrestain.voicesuite`, `productName: Voice Suite`,
`releaseRepository: kierantrestain/Voice-suite`):

```bash
bun run dist            # current platform: Voice-Suite-<version>-<os>-<arch>
```

- Targets: macOS arm64 (`.dmg`/`.zip`), macOS x64 (`.dmg`/`.zip`), Windows x64 (`.exe`),
  Windows ARM64 (experimental `.exe`), Linux x64 (`.AppImage`/`.deb`).
- Updater checks `kierantrestain/Voice-suite` GitHub Releases only; upstream VoiceStudio
  feeds are never contacted. Unsigned (ad-hoc) macOS builds check for updates and direct
  users to the GitHub Releases page instead of triggering a failing Squirrel.Mac install.
- Signing/notarisation: configure `ELECTRON_MACOS_CSC_LINK`, `APPLE_API_KEY*`, and
  `ELECTRON_WINDOWS_CSC_LINK` (or SignPath) in GitHub Actions Secrets for signed releases;
  when absent, releases are clearly labelled unsigned/ad-hoc in the generated download table.
