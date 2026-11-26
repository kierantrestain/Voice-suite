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

Directory: [`deploy/inference-backend/`](../../deploy/inference-backend/). It builds this
repository's `deploy/Dockerfile` (PyTorch CUDA base image; also runs on CPU-only hosts).

```bash
cp deploy/inference-backend/.env.example deploy/inference-backend/.env
# edit .env: OMNIVOICE_API_KEY=$(openssl rand -base64 48)
#            OMNIVOICE_ALLOWED_ORIGINS=https://<your-project>.vercel.app
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
| Built-in Caddy | Point a DNS name at the host, open ports 80/443, set `VOICE_SUITE_BACKEND_DOMAIN`, add `--profile https`. Caddy gets a Let's Encrypt certificate. |
| Tunnel | Cloudflare Tunnel, Tailscale Funnel or ngrok to `http://127.0.0.1:3900` (free tiers exist; no inbound ports). |
| Same computer | A backend on the viewer's own machine at `http://localhost:3900` works from the HTTPS site in Chromium and Firefox. |

### Security checklist

- `OMNIVOICE_API_KEY` is required by the compose file. The browser exchanges it for a
  short-lived scoped session; the raw key is never stored by the site.
- `OMNIVOICE_ALLOWED_ORIGINS` must list the exact Vercel origin(s) (no trailing slash).
  Preview deployments have their own origins; add one if you want to test a preview.
- Do **not** set `OMNIVOICE_TRUST_HOST_LOOPBACK` or `FORWARDED_ALLOW_IPS=*` when a proxy
  runs on the same host — that would let proxied internet traffic look local.
- For a bare-metal (non-Docker) backend behind a same-host reverse proxy, proxied
  requests arrive from loopback and skip the key check: use Docker, or a tunnel that
  connects from another network namespace.
- Keep the backend port bound to loopback (`127.0.0.1:3900:3900`) and publish only
  through TLS.

### Hardware

| Host | Notes |
|---|---|
| CPU only (4 vCPU, 16 GB RAM) | Verified: KittenTTS ~1× real time, faster-whisper base ~3× real time. OmniVoice and large engines are slow on CPU. |
| NVIDIA (≥ 8 GB VRAM recommended) | Use the GPU override. Most engines are GPU-accelerated. |
| AMD ROCm / Apple Silicon | Supported by upstream builds (`docs/install/`); the Docker image here targets CUDA/CPU. Apple Silicon runs the backend natively from source with MPS. |

No paid service is required. A free-tier VM or a home GPU box plus a free tunnel is enough.

## 3. Desktop packaging (future distribution)

The Electron app is unchanged in capability and still builds signed installers with
electron-builder:

```bash
bun run dist            # current platform: DMG / NSIS / AppImage+deb
```

CI workflows under `.github/workflows/` build and smoke-test macOS, Windows and Linux
packages. Publishing Voice Suite-branded releases needs its own code-signing
certificates (Apple Developer ID, Windows signing) and an update feed in this
repository's GitHub Releases; see `docs/DESKTOP_RELEASE.md` and `docs/RELEASING.md` for
the inherited procedure. Until then the auto-updater URLs still reference upstream
release feeds — see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
