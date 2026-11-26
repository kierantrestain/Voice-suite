#!/bin/sh
# Voice Suite inference backend: install, configure and run it on this computer
# (natively from source, or in Docker) for the hosted Voice Suite frontend.
# Run `deploy/inference-backend/backend.sh help` for the commands.
set -eu

die() { printf 'backend.sh: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
HOME_DIR=${VOICE_SUITE_BACKEND_HOME:-"$HOME/.voice-suite-backend"}
CONF="$HOME_DIR/backend.env"
PIDFILE="$HOME_DIR/backend.pid"
LOG="$HOME_DIR/backend.log"

usage() {
    cat <<'HELP'
Voice Suite inference backend (macOS / Linux)

  backend.sh install --origin https://<your-app>.vercel.app [--docker]
        One-time: install dependencies, create the API key and settings,
        then start the backend. Native from source by default (uv needed);
        --docker builds and runs the Docker image instead.
  backend.sh start | stop | restart | status
  backend.sh logs [-f] [-n LINES]
  backend.sh key          Print the API key to paste into the website.
  backend.sh setup [options]   Change settings without reinstalling:
        --origin URL        Website allowed to use this backend (repeatable).
        --port N            Local port (default 3900).
        --https DOMAIN      Docker only: Caddy HTTPS front for DOMAIN.
        --tls-internal      Docker only: Caddy's local CA, not Let's Encrypt.
        --rotate-key        Replace the API key (signs every browser out).
        --docker | --native Choose how the backend runs.
        (Run `backend.sh restart` afterwards.)

Settings, data and logs live in ~/.voice-suite-backend (override with
VOICE_SUITE_BACKEND_HOME). The settings file holds the API key and is
readable only by you. VOICE_SUITE_PYTHON selects an existing interpreter.
HELP
}

# ── settings file ───────────────────────────────────────────────────────────
conf_get() {
    [ -f "$CONF" ] || return 0
    sed -n "s/^$1=//p" "$CONF" | tail -n 1 | sed "s/^'\(.*\)'\$/\1/"
}

encode_value() {
    # The same quoting backend/core/user_env.py reads back: plain when safe,
    # otherwise single-quoted. Quotes and backslashes are never needed here.
    case $1 in *\'* | *\\* | *"
"*) die "unsupported character in value: $1" ;; esac
    if [ -z "$1" ] || printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_./:@%+=,~-]*$'; then
        printf '%s' "$1"
    else
        printf "'%s'" "$1"
    fi
}

conf_write() {
    # $@: KEY=VALUE pairs replacing those keys; other lines are preserved.
    mkdir -p "$HOME_DIR"
    chmod 700 "$HOME_DIR"
    tmp="$HOME_DIR/.backend.env.tmp.$$"
    (
        umask 077
        if [ -f "$CONF" ]; then cat "$CONF"; else
            say '# Voice Suite inference backend settings (written by backend.sh).'
            say '# Private: holds the API key. Change with: backend.sh setup'
        fi
    ) >"$tmp"
    for pair in "$@"; do
        k=${pair%%=*}
        v=$(encode_value "${pair#*=}")
        grep -v "^$k=" "$tmp" >"$tmp.next" || true
        printf '%s=%s\n' "$k" "$v" >>"$tmp.next"
        mv "$tmp.next" "$tmp"
    done
    chmod 600 "$tmp"
    mv "$tmp" "$CONF"
}

new_key() {
    # 256 random bits as 64 hex characters, from the kernel CSPRNG.
    od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
}

normalize_origin() {
    o=${1%/}
    printf '%s\n' "$o" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' \
        || die "origin must look like https://name.example (no path): $1"
    case $o in
        http://localhost* | http://127.0.0.1*) ;;
        http://*) say "warning: $o is plain http; browsers only allow https sites to reach this backend" >&2 ;;
    esac
    printf '%s' "$o"
}

setup() {
    origins='' port='' runtime='' rotate=0 domain='' tls_internal=''
    while [ "$#" -gt 0 ]; do
        case $1 in
            --origin) [ "$#" -ge 2 ] || die '--origin needs a URL'
                o=$(normalize_origin "$2"); origins=${origins:+$origins,}$o; shift ;;
            --origin=*) o=$(normalize_origin "${1#*=}"); origins=${origins:+$origins,}$o ;;
            --port) [ "$#" -ge 2 ] || die '--port needs a number'; port=$2; shift ;;
            --docker) runtime=docker ;;
            --native) runtime=native ;;
            --https) [ "$#" -ge 2 ] || die '--https needs a domain'; domain=$2; shift ;;
            --tls-internal) tls_internal='tls internal' ;;
            --rotate-key) rotate=1 ;;
            *) die "unknown setup option: $1 (see help)" ;;
        esac
        shift
    done
    [ -z "$port" ] || { printf '%s' "$port" | grep -Eq '^[0-9]{2,5}$' && [ "$port" -le 65535 ]; } \
        || die "invalid port: $port"
    [ -n "$origins" ] || origins=$(conf_get OMNIVOICE_ALLOWED_ORIGINS)
    [ -n "$origins" ] || die 'pass --origin https://<your-app>.vercel.app (the website address)'
    key=$(conf_get OMNIVOICE_API_KEY)
    if [ -z "$key" ] || [ "$rotate" = 1 ]; then key=$(new_key); fi
    [ -n "$port" ] || port=$(conf_get OMNIVOICE_PORT)
    [ -n "$port" ] || port=3900
    [ -n "$runtime" ] || runtime=$(conf_get VOICE_SUITE_RUNTIME)
    [ -n "$runtime" ] || runtime=native
    [ -n "$domain" ] || domain=$(conf_get VOICE_SUITE_BACKEND_DOMAIN)
    [ -n "$tls_internal" ] || tls_internal=$(conf_get VOICE_SUITE_CADDY_TLS)
    conf_write \
        "VOICE_SUITE_RUNTIME=$runtime" \
        "OMNIVOICE_API_KEY=$key" \
        "OMNIVOICE_ALLOWED_ORIGINS=$origins" \
        "OMNIVOICE_PORT=$port" \
        "VOICE_SUITE_BACKEND_PORT=$port" \
        "OMNIVOICE_BIND_HOST=127.0.0.1" \
        "OMNIVOICE_DATA_DIR=$HOME_DIR/data" \
        "OMNIVOICE_SERVER_MODE=1" \
        "OMNIVOICE_LOOPBACK_REQUIRES_KEY=1" \
        "OMNIVOICE_ANALYTICS_DISABLED=1" \
        "VOICE_SUITE_BACKEND_DOMAIN=$domain" \
        "VOICE_SUITE_CADDY_TLS=$tls_internal"
    say "Settings saved to $CONF (readable only by you)."
    say "  Website allowed: $origins"
    say "  Runs:            $runtime, http://127.0.0.1:$port"
    [ -z "$domain" ] || say "  HTTPS front:     https://$domain${tls_internal:+ (local CA)}"
}

need_conf() {
    [ -f "$CONF" ] || die "not set up yet: run  $0 install --origin https://<your-app>.vercel.app"
}

runtime() { r=$(conf_get VOICE_SUITE_RUNTIME); printf '%s' "${r:-native}"; }
port() { p=$(conf_get OMNIVOICE_PORT); printf '%s' "${p:-3900}"; }

# ── native (from source) ────────────────────────────────────────────────────
python_bin() {
    if [ -n "${VOICE_SUITE_PYTHON:-}" ]; then printf '%s' "$VOICE_SUITE_PYTHON"; return; fi
    [ -x "$REPO/.venv/bin/python" ] || die "Python environment missing: run  $0 install"
    printf '%s' "$REPO/.venv/bin/python"
}

# GET /health on the local port. Prints "<status code> <body>"; "000" = no answer.
health() {
    "$(python_bin)" - "$(port)" <<'PY' 2>/dev/null || printf '000 \n'
import sys, urllib.request, urllib.error
url = f"http://127.0.0.1:{sys.argv[1]}/health"
try:
    with urllib.request.urlopen(url, timeout=3) as r:
        print(r.status, r.read(400).decode("utf-8", "replace"))
except urllib.error.HTTPError as e:
    print(e.code, e.read(400).decode("utf-8", "replace"))
except Exception:
    print("000 ")
PY
}

health_code() { health | cut -d' ' -f1; }

# PID of the backend this script started, or nothing (stale file removed).
running_pid() {
    [ -f "$PIDFILE" ] || return 0
    pid=$(tr -cd '0-9' <"$PIDFILE")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null \
        && ps -p "$pid" -o args= 2>/dev/null | grep -q "uvicorn main:app"; then
        printf '%s' "$pid"
        return 0
    fi
    rm -f "$PIDFILE"
    say "(removed a stale PID file; the previous backend is not running)" >&2
}

native_start() {
    pid=$(running_pid)
    if [ -n "$pid" ]; then say "Already running (PID $pid) on http://127.0.0.1:$(port)"; return 0; fi
    py=$(python_bin)
    [ "$(health_code)" = 000 ] || die "port $(port) is already answering (another backend or app?). Stop it, or: $0 setup --port <N>"
    mkdir -p "$HOME_DIR/data"
    say "Starting the backend on http://127.0.0.1:$(port) (log: $LOG)"
    launcher=''
    have setsid && launcher=setsid
    (
        cd "$REPO"
        OMNIVOICE_ENV_FILE=$CONF
        export OMNIVOICE_ENV_FILE
        exec $launcher nohup "$py" -m uvicorn main:app --app-dir backend \
            --host "$(conf_get OMNIVOICE_BIND_HOST)" --port "$(port)"
    ) >>"$LOG" 2>&1 </dev/null &
    printf '%s\n' "$!" >"$PIDFILE"
    wait_ready "$!" "${VOICE_SUITE_START_TIMEOUT:-300}"
}

wait_ready() {
    # $1: launched PID (checked with kill -0: it may not have exec'd uvicorn
    # yet, so the command-line check in running_pid would misfire); $2: seconds.
    waited=0
    while [ "$waited" -lt "$2" ]; do
        if ! kill -0 "$1" 2>/dev/null; then
            rm -f "$PIDFILE"
            say 'The backend stopped during startup. Last log lines:' >&2
            tail -n 30 "$LOG" >&2
            exit 1
        fi
        if [ "$(health_code)" = 200 ]; then say "Ready. $(summary)"; https_front up; return 0; fi
        sleep 2
        waited=$((waited + 2))
    done
    say "Still starting after ${2}s; check with: $0 status / $0 logs" >&2
    return 1
}

native_stop() {
    https_front stop
    pid=$(running_pid)
    if [ -z "$pid" ]; then say 'Not running.'; return 0; fi
    # setsid made the backend a process-group leader: stop its engines too.
    target=$pid
    [ "$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" = "$pid" ] && target=-$pid
    # No "--": dash's kill builtin rejects it; a negative PID names the group.
    kill -TERM "$target" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 30 ]; do sleep 1; waited=$((waited + 1)); done
    if kill -0 "$pid" 2>/dev/null; then
        say 'Did not stop within 30 s; forcing it.' >&2
        kill -KILL "$target" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
        sleep 1
        ! kill -0 "$pid" 2>/dev/null || die "could not stop PID $pid"
    fi
    rm -f "$PIDFILE"
    say "Stopped (PID $pid)."
}

summary() {
    "$(python_bin)" -c 'import json,sys
try: h=json.loads(sys.argv[1])
except ValueError: h={}
print("version", h.get("version","?"), "| device", h.get("device","?"))' "$(health | cut -d' ' -f2-)"
}

native_status() {
    pid=$(running_pid)
    code=$(health_code)
    if [ -z "$pid" ]; then
        if [ "$code" != 000 ]; then say "Stopped (but something else answers on port $(port))."; else say 'Stopped.'; fi
        return 3
    fi
    case $code in
        200) say "Running (PID $pid), ready: $(summary)" ;;
        503) say "Running (PID $pid), still starting up." ;;
        *) say "Running (PID $pid) but not answering on port $(port) (HTTP $code)." ;;
    esac
    say "  Backend URL (local): http://127.0.0.1:$(port)"
    say "  Website allowed:     $(conf_get OMNIVOICE_ALLOWED_ORIGINS)"
    say "  Settings: $CONF   Log: $LOG"
    [ "$code" = 200 ]
}

# ── Docker ──────────────────────────────────────────────────────────────────
compose() {
    have docker || die 'Docker is not installed (https://docs.docker.com/get-docker/)'
    set -- --env-file "$CONF" -f "$COMPOSE_FILE" "$@"
    [ -z "$(conf_get VOICE_SUITE_BACKEND_DOMAIN)" ] || set -- --profile https "$@"
    docker compose "$@"
}

docker_status() {
    state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' voice-suite-backend 2>/dev/null || true)
    if [ -z "$state" ] || [ "${state%% *}" != running ]; then say "Stopped.${state:+ ($state)}"; return 3; fi
    say "Running in Docker: $state"
    say "  Backend URL (local): http://127.0.0.1:$(port)"
    say "  Website allowed:     $(conf_get OMNIVOICE_ALLOWED_ORIGINS)"
    case $state in *" healthy") return 0 ;; *) return 1 ;; esac
}

# A native backend can use the same Caddy HTTPS front (host network) when a
# domain is configured; Docker mode starts it through the compose profile.
https_front() {
    [ -n "$(conf_get VOICE_SUITE_BACKEND_DOMAIN)" ] || return 0
    have docker || { say 'HTTPS front skipped: Docker is not installed.' >&2; return 0; }
    case $1 in
        up) compose up -d --no-deps https && say "HTTPS front: https://$(conf_get VOICE_SUITE_BACKEND_DOMAIN)" ;;
        stop) compose stop https >/dev/null 2>&1 || true ;;
    esac
}

# ── install ─────────────────────────────────────────────────────────────────
install_native_deps() {
    if [ -n "${VOICE_SUITE_PYTHON:-}" ]; then
        say "Using VOICE_SUITE_PYTHON=$VOICE_SUITE_PYTHON; skipping the dependency install."
        return 0
    fi
    have uv || die 'uv is required: install it with  curl -LsSf https://astral.sh/uv/install.sh | sh  then open a new terminal and run this again'
    cd "$REPO"
    if have bun; then bun scripts/setup-api.mjs; return; fi
    if have node && node electron/scripts/node-version.mjs 2>/dev/null; then node scripts/setup-api.mjs; return; fi
    # Same steps as scripts/setup-api.mjs: the locked environment, CPU PyTorch
    # on Linux x64 without an NVIDIA GPU, then the platform fix-ups.
    set --
    if [ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] && ! have nvidia-smi; then
        set -- --no-group cuda --group cpu
    fi
    uv sync --locked "$@"
    uv run --no-sync python scripts/setup.py
}

install() {
    setup "$@"
    if [ "$(runtime)" = docker ]; then
        say 'Building the Docker image (first build downloads several GB)...'
        compose build backend
    else
        install_native_deps
    fi
    start
    say ''
    say 'In the website: Settings -> Sharing & Remote Access -> Remote backend.'
    say 'Enter your HTTPS backend address and this API key, then Test and Save:'
    say "  $(conf_get OMNIVOICE_API_KEY)"
    say "(Print it again any time with: $0 key)"
}

# ── dispatch ────────────────────────────────────────────────────────────────
start() {
    need_conf
    if [ "$(runtime)" = docker ]; then
        compose up -d
        say "Started in Docker on http://127.0.0.1:$(port) (first start downloads models; see: $0 logs -f)"
    else
        native_start
    fi
}

stop() {
    need_conf
    if [ "$(runtime)" = docker ]; then compose stop; else native_stop; fi
}

cmd=${1:-help}
[ "$#" -eq 0 ] || shift
case $cmd in
    install) install "$@" ;;
    setup) setup "$@" ;;
    start) start ;;
    stop) stop ;;
    restart)
        need_conf
        if [ "$(runtime)" = docker ]; then compose up -d --force-recreate; else native_stop; native_start; fi ;;
    status)
        need_conf
        if [ "$(runtime)" = docker ]; then docker_status; else native_status; fi ;;
    logs)
        need_conf
        follow='' lines=100
        while [ "$#" -gt 0 ]; do
            case $1 in -f|--follow) follow=1 ;; -n) lines=${2:?}; shift ;; *) die "unknown logs option: $1" ;; esac
            shift
        done
        if [ "$(runtime)" = docker ]; then
            compose logs --tail "$lines" ${follow:+-f} backend
        else
            [ -f "$LOG" ] || die "no log yet ($LOG)"
            if [ -n "$follow" ]; then tail -n "$lines" -f "$LOG"; else tail -n "$lines" "$LOG"; fi
        fi ;;
    key) need_conf; conf_get OMNIVOICE_API_KEY ;;
    help|-h|--help) usage ;;
    *) die "unknown command: $cmd (see: $0 help)" ;;
esac
