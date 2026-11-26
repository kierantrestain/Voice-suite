/**
 * Hosted frontend (Vercel or any static host) → a separately deployed backend.
 *
 * The desktop app reaches its backend through Electron's `/api` protocol and the
 * Docker image serves the UI from FastAPI itself. A hosted frontend has neither:
 * the Python/PyTorch backend runs on a machine the user controls (a GPU box,
 * a Docker host, a tunnel) and the browser talks to it cross-origin. This module
 * owns that connection: which URL to use, a real `/health` probe, and the
 * browser stand-in for the desktop bridge's remote-backend calls, so the shared
 * Settings form works unchanged.
 *
 * Nothing here fakes a backend. With no URL configured, or a backend that does
 * not answer, the app shows a disconnected state and API calls fail fast.
 */
import {
  acceptStudioSession,
  AuthSessionError,
  clearAdminSession,
  exchangeApiKey,
  getAdminSession,
  revokeAdminSession,
} from '@shared/api/authSession';
import { DESKTOP_PAIR_URL } from '@shared/desktop-pairing';

/** True only for the static hosted bundle (`VOICE_SUITE_HOSTED=1 bun run build:web`). */
export const HOSTED_FRONTEND: boolean =
  typeof __HOSTED_FRONTEND__ !== 'undefined' && __HOSTED_FRONTEND__;

export const HOSTED_BACKEND_STORAGE_KEY = 'voice-suite.backend-url';

const HEALTH_TIMEOUT_MS = 8_000;

export type HostedProbe =
  | { ok: true; detail: string; target: string; authenticated: boolean; version?: string }
  | {
      ok: false;
      kind: 'invalid' | 'mixed_content' | 'network' | 'timeout' | 'http' | 'wrong_port' | 'auth';
      status?: number;
      target: string;
    };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function sharedServerUrl(): string {
  const value = (import.meta.env?.VITE_VOICE_SUITE_BACKEND_URL as string | undefined) ?? '';
  const url = normalizeBackendUrl(value);
  return url?.startsWith('https://') ? url : '';
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * A backend base URL in canonical form (`https://host[:port][/prefix]`, no
 * trailing slash), or null when the input is not an http(s) URL. Credentials,
 * queries and fragments are refused rather than silently dropped.
 */
export function normalizeBackendUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Browsers block `http:` requests from an `https:` page (mixed content), except
 * to loopback. Report that up front instead of as an unexplained network error.
 */
export function blockedAsMixedContent(url: string, pageProtocol: string): boolean {
  if (pageProtocol !== 'https:') return false;
  const parsed = new URL(url);
  return parsed.protocol === 'http:' && !LOOPBACK.has(parsed.hostname);
}

/** The last explicitly connected backend, or an empty string. */
export function hostedBackendUrl(store: StorageLike | null = storage()): string {
  try {
    const saved = normalizeBackendUrl(store?.getItem(HOSTED_BACKEND_STORAGE_KEY) ?? '');
    if (saved) return saved;
  } catch {
    // Blocked storage leaves the connection unset.
  }
  return '';
}

export function saveHostedBackendUrl(url: string, store: StorageLike | null = storage()): void {
  const normalized = normalizeBackendUrl(url);
  if (!normalized) throw new Error('invalid backend URL');
  store?.setItem(HOSTED_BACKEND_STORAGE_KEY, normalized);
}

export function clearHostedBackendUrl(store: StorageLike | null = storage()): void {
  store?.removeItem(HOSTED_BACKEND_STORAGE_KEY);
}

export function hostedRequestInit(url: string): RequestInit {
  const localNetwork = url.startsWith('http://127.0.0.1:');
  const privateNetwork: RequestInit & { targetAddressSpace?: 'loopback' } = localNetwork
    ? { targetAddressSpace: 'loopback' }
    : {};
  return { ...privateNetwork, credentials: 'omit', redirect: 'error', cache: 'no-store' };
}

function resolveInvite(value: string): { server: string; code: string } {
  const raw = value.trim();
  if (/^ovs_invite_[A-Za-z0-9_-]{43}$/.test(raw) && sharedServerUrl()) {
    return { server: sharedServerUrl(), code: raw };
  }
  let invite: URL;
  try {
    invite = new URL(raw);
  } catch {
    throw new AuthSessionError(401);
  }
  const code = invite.hash.slice(1);
  invite.hash = '';
  const server = normalizeBackendUrl(invite.href);
  if (!server?.startsWith('https://') || !/^ovs_invite_[A-Za-z0-9_-]{43}$/.test(code)) {
    throw new AuthSessionError(401);
  }
  return { server, code };
}

export async function connectHostedStudio(connection: 'desktop' | 'shared', code = '') {
  const shared = connection === 'shared' ? resolveInvite(code) : null;
  const endpoint = shared ? `${shared.server}/api/auth/studio/redeem` : DESKTOP_PAIR_URL;
  const response = await fetch(endpoint, {
    ...hostedRequestInit(endpoint),
    method: 'POST',
    headers: shared ? { 'Content-Type': 'application/json' } : { 'X-Voice-Suite-Pairing': '1' },
    body: shared ? JSON.stringify({ code: shared.code }) : undefined,
    signal: AbortSignal.timeout(shared ? 10_000 : 62_000),
  });
  const base = await acceptStudioSession(response, (body) => {
    if (shared) return shared.server;
    if (typeof body.base_url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(body.base_url))
      throw new AuthSessionError();
    return body.base_url;
  });
  saveHostedBackendUrl(base);
}

export async function verifiedHostedBackend(target: string): Promise<HostedProbe> {
  const session = getAdminSession(target);
  if (!session) return { ok: false, kind: 'auth', target };
  const health = await probeHostedBackend(target);
  if (!health.ok) return health;
  try {
    const response = await fetch(`${target}/api/auth/studio/session`, {
      ...hostedRequestInit(target),
      headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    // A manually connected older server still supports the existing admin exchange.
    if (response.status === 404 && session.token.startsWith('ovs_admin_session_')) {
      const probe = await fetch(`${target}/engines`, {
        ...hostedRequestInit(target),
        headers: { Authorization: `Bearer ${session.token}` },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (probe.ok) return { ...health, authenticated: true };
    }
    if (response.status !== 204) {
      return {
        ok: false,
        kind: response.status === 503 ? 'http' : 'auth',
        status: response.status,
        target,
      };
    }
    return { ...health, authenticated: true };
  } catch {
    return { ok: false, kind: 'network', target };
  }
}

interface HealthBody {
  status?: string;
  device?: string;
  engine?: string;
  version?: string;
}

/**
 * Probe `GET <url>/health` and, when an API key is given, exchange it for a
 * scoped session so the key itself is never stored in the browser.
 */
export async function probeHostedBackend(
  rawUrl: string,
  apiKey = '',
  {
    fetchImpl = fetch,
    pageProtocol = typeof location === 'undefined' ? 'https:' : location.protocol,
    timeoutMs = HEALTH_TIMEOUT_MS,
  }: { fetchImpl?: typeof fetch; pageProtocol?: string; timeoutMs?: number } = {},
): Promise<HostedProbe> {
  const target = normalizeBackendUrl(rawUrl);
  if (!target) return { ok: false, kind: 'invalid', target: rawUrl.trim() };
  if (blockedAsMixedContent(target, pageProtocol))
    return { ok: false, kind: 'mixed_content', target };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${target}/health`, {
      ...hostedRequestInit(target),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, kind: controller.signal.aborted ? 'timeout' : 'network', target };
  } finally {
    clearTimeout(timer);
  }

  let body: HealthBody | null = null;
  try {
    body = (await response.json()) as HealthBody;
  } catch {
    body = null;
  }
  // Something answered, but not a Voice Suite backend (a web server, the
  // hosted site itself, a proxy error page).
  if (!body || typeof body.status !== 'string')
    return { ok: false, kind: 'wrong_port', status: response.status, target };
  if (!response.ok) return { ok: false, kind: 'http', status: response.status, target };

  let authenticated = false;
  const key = apiKey.trim();
  if (key) {
    try {
      await exchangeApiKey(key, { apiBase: target, fetchImpl });
      authenticated = true;
    } catch (error) {
      const status = (error as { status?: number }).status;
      return { ok: false, kind: 'auth', status: status ?? 401, target };
    }
  }
  const detail = [body.device, body.engine, body.version ? `v${body.version}` : '']
    .filter(Boolean)
    .join(' · ');
  return { ok: true, detail: detail || body.status, target, authenticated, version: body.version };
}

/**
 * The browser stand-in for `window.voicestudio.backend`'s remote-backend
 * calls, used by the shared Settings form on a hosted frontend.
 */
export const hostedBackendApi = {
  async getConnection() {
    const url = hostedBackendUrl();
    return { remote: Boolean(url), url, authenticated: Boolean(getAdminSession(url)) };
  },
  testRemote(input: { url: string; apiKey: string }) {
    return probeHostedBackend(input.url, input.apiKey);
  },
  async useRemote(input: { url: string; apiKey: string }) {
    // A session belongs to one backend: drop the old one before the probe
    // exchanges the key for a new session, never after (that would discard it).
    const target = normalizeBackendUrl(input.url);
    if (target && target !== hostedBackendUrl()) clearAdminSession();
    const probe = await probeHostedBackend(input.url, input.apiKey);
    if (probe.ok) saveHostedBackendUrl(probe.target);
    return probe;
  },
  async useLocal() {
    await revokeAdminSession(hostedBackendUrl());
    clearAdminSession();
    clearHostedBackendUrl();
    const url = hostedBackendUrl();
    return { remote: Boolean(url), url, authenticated: false };
  },
};
