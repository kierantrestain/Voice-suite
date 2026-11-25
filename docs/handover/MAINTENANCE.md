# Maintenance

## Everyday commands

```bash
bun install --frozen-lockfile                          # JS deps (root workspace + electron)
uv sync --frozen --no-default-groups --group cpu --group dev   # Python (use --group cuda on NVIDIA)
bun run dev:web                                        # backend :3900 + web UI :3901
bun run --cwd electron typecheck
cd electron && bun x vp test --run                     # renderer/main unit tests
uv run pytest -q -n auto                               # Python tests
cd electron && VOICE_SUITE_HOSTED=1 bun run build:web  # the Vercel bundle
```

## Dependency updates

- JavaScript: `bun run deps:check` (taze, 7-day maturity). After any change run
  `bun install` and commit `bun.lock`; CI runs `bun install --frozen-lockfile`.
- Python: edit `pyproject.toml`, `uv lock`, check `uv tree` for conflicts, commit
  `uv.lock`. PyTorch comes from the `pytorch-cpu` / `pytorch-cuda` indexes declared in
  `pyproject.toml`.
- Docker base images: `deploy/Dockerfile` `BASE_IMAGE`; Bun version is pinned in step with
  `package.json` `packageManager` (`tests/test_bun_toolchain_pins.py`).
- Dependabot PRs exist for GitHub Actions; merge them after CI is green.

## Adding UI text

Every user-facing string goes through i18next: add the key to
`electron/src/renderer/src/i18n/locales/en.json` **and all 21 other catalogs** in the same
change (`tests/test_locale_parity.py`, `node electron/tests/locale-*.mjs`). Keep
`{{placeholders}}` identical.

## Regenerating the model catalog page

```bash
cd backend && uv run python - <<'EOF'
import json
from services.model_licenses import license_category
d = json.load(open('../docs/licensing/model-license-data.json'))
for m in d['models']:
    print(license_category(m), m['id'], m.get('license'))
EOF
```

Update the tables in `MODEL_CATALOG.md` from that output. Licence review workflow:
`docs/licensing/model-review-workflow.md`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Hosted site: "No inference backend connected" | No URL saved. Settings → Sharing → Remote backend |
| "Inference backend unreachable" | Backend down, wrong URL, or CORS: the backend must list the site origin in `OMNIVOICE_ALLOWED_ORIGINS` (the Settings message shows the exact value) |
| "This site is served over HTTPS…" | Backend is `http://` on a non-localhost host — put it behind HTTPS (Caddy profile or tunnel) |
| Test shows "HTTP 401" | Wrong API key, or the backend's `OMNIVOICE_API_KEY` changed |
| Asked for the API key after a backend restart | Sessions are short-lived and server-side; enter the key again |
| Generation 503 "could not load its model" | Weights download blocked or failed: check the host can reach `huggingface.co` and its CDN (`*.hf.co`), then retry; Settings → Models shows per-engine status |
| ASR "asr_model_missing" | Install a Whisper model in Settings → Models → ASR, or set `ASR_MODEL_FASTER` |
| Vercel build fails at install | Ensure `bun.lock` is committed and current (`bun install` locally, commit) |
| Backend logs | Desktop: Settings → Logs; Docker: `docker logs voice-suite-backend` |

## Backups

All user data lives in `OMNIVOICE_DATA_DIR` (Docker volume `voice-suite-data`):
database, voices and reference audio, projects, outputs, export history. Back it up
while the backend is stopped:

```bash
docker compose -f deploy/inference-backend/docker-compose.yml stop backend
docker run --rm -v voice-suite_voice-suite-data:/d -v "$PWD":/b alpine tar czf /b/voice-suite-data.tgz -C /d .
docker compose -f deploy/inference-backend/docker-compose.yml start backend
```

Model weights (`HF_HOME`, inside the same volume in Docker) can be re-downloaded and may
be excluded. Schema changes always go through alembic migrations, so restoring an older
backup into a newer version upgrades it on start.

## Integrating future upstream changes

`origin/main` tracks upstream VoiceStudio. To take a new upstream release:

```bash
git remote add upstream https://github.com/debpalash/VoiceStudio.git   # once
git fetch upstream --tags
git checkout -b sync/upstream-vX.Y.Z origin/main
git merge upstream/main          # or the release tag
```

Expected conflict areas: `electron/src/renderer/src/i18n/locales/*.json` (Voice Suite
renamed user-facing "VoiceStudio" to "Voice Suite" — keep ours, take their new keys),
`README.md` and `docs/readme/*` (keep the *Get Voice Suite* section),
`electron/src/shared/utils/contactLinks.js`, `components/app-shell/github-star.tsx`,
`config/app.json`, home/support/pro pages, and the files listed in
[HANDOVER.md](HANDOVER.md#key-files-touched-by-voice-suite). Run the full test suites and
a hosted build before merging. Keep upstream credit and AGPL notices intact.

## Licence obligations (AGPL-3.0)

- Keep `LICENSE` and `LICENSE-NOTICE.md` (upstream copyright and attribution).
- Anyone who interacts with a deployed Voice Suite over a network must be able to get the
  corresponding source: this public repository satisfies that; keep in-app links to it.
- Model weights carry their own licences ([MODEL_CATALOG.md](MODEL_CATALOG.md)).
