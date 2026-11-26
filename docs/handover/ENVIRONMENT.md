# Environment and configuration

No secret is committed. Example files: [`deploy/inference-backend/.env.example`](../../deploy/inference-backend/.env.example)
(backend) and [`.env.example`](../../.env.example) (frontend build).

## Frontend build (Vercel or local)

| Variable | Where | Required | Meaning |
|---|---|---|---|
| `VOICE_SUITE_HOSTED` | build env (set in `vercel.json`) | yes for Vercel | `1` builds the static hosted bundle: remote backend, hosted CSP, connection indicator |
| `VITE_VOICE_SUITE_BACKEND_URL` | Vercel project env | no | Default backend URL. Public value; users can override in Settings |
| `VITE_PREVIEW_OFFLINE` | build env | no | `1` stops the GitHub star badge from calling api.github.com |
| `OMNIVOICE_PORT` / `OMNIVOICE_UI_PORT` | local dev only | no | Dev proxy target / dev server port (defaults 3900 / 3901 from `config/app.json`) |

Browser storage used by the hosted app: `voice-suite.backend-url` (chosen backend),
the scoped admin session (bearer token with expiry, bound to that backend), UI
preferences. The API key itself is never written to storage.

## Inference backend

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `OMNIVOICE_API_KEY` | yes when reachable from the network | unset | Master key for non-loopback clients; exchanged for scoped sessions |
| `OMNIVOICE_ALLOWED_ORIGINS` | yes for the Vercel site | loopback + desktop origins | Exact browser origins allowed by CORS/CSRF (replaces the default list) |
| `OMNIVOICE_SERVER_MODE` | Docker | `1` in the image | Headless server behaviour (admin via API key instead of loopback) |
| `OMNIVOICE_DATA_DIR` | no | OS app-data dir; `/app/omnivoice_data` in Docker | Voices, projects, outputs, database |
| `HF_HOME` | no | `~/.cache/huggingface` | Model cache |
| `HF_TOKEN` | no | unset | Only for gated Hugging Face models you have accepted |
| `OMNIVOICE_BIND_HOST` | no | `127.0.0.1` (`0.0.0.0` in Docker) | Listen address |
| `OMNIVOICE_TRUSTED_NETWORKS` | no | unset | CIDRs exempted from PIN/key on consumption routes — avoid for internet-facing backends |
| `OMNIVOICE_ALLOWED_HOSTS` | no | unset | Extra Host names accepted without a credential |
| `OMNIVOICE_ANALYTICS_DISABLED` | no | unset (`1` in our compose) | Hard-disables opt-in analytics and failure reports |
| `OMNIVOICE_LOOPBACK_REQUIRES_KEY` | native behind same-host proxy | `1` in `backend.sh` | Requires `OMNIVOICE_API_KEY` even from loopback peers (prevents proxy bypass) |
| `OMNIVOICE_COMMERCIAL_ONLY` | no | `0` (`--commercial-only` sets `1`) | Locks Commercial Production Guard on (blocks CC-BY-NC and unverified weights with HTTP 403) |
| `ASR_MODEL_FASTER` | no | prefs | faster-whisper checkpoint, e.g. `Systran/faster-whisper-base` |
| `OMNIVOICE_TORCH_INDEX` | no | per host | PyTorch wheel index for engine sidecar installs |
| `VOICE_SUITE_BACKEND_DOMAIN` | for `--profile https` | unset | DNS name Caddy obtains a certificate for |

Never set `OMNIVOICE_TRUST_HOST_LOOPBACK` or `FORWARDED_ALLOW_IPS=*` on an internet-facing
backend. The full authentication model is in `docs/api-auth.md`.

## Desktop app

The desktop app reads the same backend variables from `~/.config/omnivoice/env`
(macOS/Linux) or `%USERPROFILE%\.config\omnivoice\env` (Windows). Product identity
(name, app id, ports) is in `config/app.json`; the version's single source of truth is
the root `package.json` (mirrored in `pyproject.toml` and `backend/core/version.py`).

## Lockfiles

`bun.lock` (JavaScript, root workspace), `uv.lock` (Python), `flake.lock` (Nix). Install
with `bun install --frozen-lockfile` and `uv sync --frozen`.
