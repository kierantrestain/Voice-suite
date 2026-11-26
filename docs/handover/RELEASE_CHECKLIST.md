# Release checklist — Voice Suite v0.6.0

Single list of release gates and outstanding issues. Status: ✅ verified (real run, evidence
linked) · ⏳ in progress · ❌ blocked (reason) · ➖ not applicable / out of scope.
"Inherited" means upstream code covered by upstream CI but not exercised with real models
for Voice Suite.

Baseline: `main` @ `ea39ce6` (PR #6), release branch `release/v0.6.0`, verified 2026-11-26.

## 1. Baseline (before any change)

| Gate | Status | Evidence |
|---|---|---|
| Renderer/main unit tests | ✅ 4,260 passed, 17 skipped | `cd electron && bun x vp test --run` (87 s) |
| Hosted production build | ✅ | `VOICE_SUITE_HOSTED=1 bun run build:web`, 6 s |
| Backend boots from source, `/health` | ✅ `{"status":"ok"}` | uvicorn on :3900 |
| Python suite (17,100 tests) | ✅ CI on `main` | GitHub Actions run on `ea39ce6` |

## 2. Deployment

| Gate | Status | Notes |
|---|---|---|
| Vercel project imported from `main` with committed `vercel.json` | ⏳ | waiting for the owner to approve Vercel team access for the connector |
| Deployment protection enabled | ⏳ | |
| Live URL: every route, desktop + mobile viewport, console clean | ⏳ | |
| Inference backend: native start/stop/restart/status scripts | ⏳ | Specialist A |
| Docker image builds and generates on CPU | ⏳ | Specialist A |
| Authenticated HTTPS hosted frontend ↔ backend | ⏳ | Specialist A + lead |
| Offline operation after model download | ⏳ | Specialist A |

## 3. Models and hardware

| Gate | Status | Notes |
|---|---|---|
| Licence register: code vs weights, evidence | ⏳ | Specialist B |
| Restricted models blocked in commercial production | ⏳ | Specialist B |
| Commercial cloning engine runs on CPU | ⏳ | Specialist B |
| Benchmarks: CPU host, GitHub ubuntu, GitHub macOS arm64 (MPS/MLX) | ⏳ | Specialist B |
| Memory: single residency, long-form plateau, no repeated downloads | ⏳ | Specialist B |

## 4. Workspaces (real inputs, real models)

| Workspace | Status | Notes |
|---|---|---|
| Voice Library | ⏳ | lead |
| Generate | ✅ inherited from PR #6 (KittenTTS), re-run before release | |
| Clone | ⏳ | needs a commercial cloning engine (B) |
| Design | ⏳ | |
| Dub (audio + video) | ⏳ | Specialist C |
| Transcribe (timestamps, subtitles, speakers) | ⏳ | Specialist C |
| Dictate | ⏳ | Specialist C |
| Audiobooks | ⏳ | Specialist C |
| Batch (cancel, retry, recovery) | ⏳ | Specialist C |
| Settings (persistence) | ⏳ | lead |

## 5. Distribution

| Gate | Status | Notes |
|---|---|---|
| Updater points at Voice Suite releases; no upstream prompts | ⏳ | Specialist C |
| Release workflow works in this repository | ⏳ | Specialist C |
| macOS arm64 + x64, Windows x64, Linux x64 packages | ⏳ | unsigned unless signing secrets exist |
| AGPL notices and upstream credit preserved | ⏳ | |

## 6. Security and privacy

| Gate | Status | Notes |
|---|---|---|
| Auth, CORS/CSRF, uploads, credential storage | ⏳ | Specialist A |
| Runtime outbound-request audit | ⏳ | Specialist A |
| Secrets + dependency scan | ⏳ | Specialist A |
| Telemetry/accounts default off | ⏳ | Specialist A |

## 7. Release

| Gate | Status |
|---|---|
| Version bumped in lockstep (0.6.0) + CHANGELOG section | ⏳ |
| Full CI green on the release PR | ⏳ |
| Screenshots of all ten workspaces | ⏳ |
| Handover docs updated | ⏳ |
| PR merged, `v0.6.0` tagged, GitHub release published | ⏳ |

## Outstanding issues carried from PR #6

- Backend-provided engine names and some docs still say "VoiceStudio".
- Watermark detector label reports `source: "VoiceStudio"` (shared payload family).
- Upstream update feeds, Homebrew, Docker and phone links (being replaced, Specialist C).
- Opt-in VoiceStudio Cloud account features point at upstream services (off by default).
- Mobile apps not built or branded (excluded from Voice Suite release gates).
