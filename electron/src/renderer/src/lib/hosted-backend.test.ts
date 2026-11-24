import { describe, expect, it, vi } from 'vitest';
import {
  HOSTED_BACKEND_STORAGE_KEY,
  blockedAsMixedContent,
  clearHostedBackendUrl,
  hostedBackendUrl,
  normalizeBackendUrl,
  probeHostedBackend,
  saveHostedBackendUrl,
} from './hosted-backend';

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('normalizeBackendUrl', () => {
  it('keeps origin and path prefix, drops trailing slashes', () => {
    expect(normalizeBackendUrl(' https://gpu.example.com/studio/ ')).toBe(
      'https://gpu.example.com/studio',
    );
    expect(normalizeBackendUrl('http://localhost:3900')).toBe('http://localhost:3900');
  });

  it('refuses non-http schemes, credentials, queries and fragments', () => {
    for (const value of [
      '',
      'gpu-box:3900',
      'javascript:alert(1)',
      'ftp://host',
      'https://user:pw@host',
      'https://host/?x=1',
      'https://host/#a',
    ])
      expect(normalizeBackendUrl(value)).toBeNull();
  });
});

describe('blockedAsMixedContent', () => {
  it('flags http backends from an https page except loopback', () => {
    expect(blockedAsMixedContent('http://gpu.example.com', 'https:')).toBe(true);
    expect(blockedAsMixedContent('http://localhost:3900', 'https:')).toBe(false);
    expect(blockedAsMixedContent('http://127.0.0.1:3900', 'https:')).toBe(false);
    expect(blockedAsMixedContent('https://gpu.example.com', 'https:')).toBe(false);
    expect(blockedAsMixedContent('http://gpu.example.com', 'http:')).toBe(false);
  });
});

describe('saved backend URL', () => {
  it('round-trips through storage in canonical form and clears', () => {
    const store = memoryStorage();
    expect(hostedBackendUrl(store)).toBe('');
    saveHostedBackendUrl('https://gpu.example.com/', store);
    expect(store.getItem(HOSTED_BACKEND_STORAGE_KEY)).toBe('https://gpu.example.com');
    expect(hostedBackendUrl(store)).toBe('https://gpu.example.com');
    clearHostedBackendUrl(store);
    expect(hostedBackendUrl(store)).toBe('');
  });

  it('ignores a tampered stored value', () => {
    expect(hostedBackendUrl(memoryStorage({ [HOSTED_BACKEND_STORAGE_KEY]: 'javascript:x' }))).toBe(
      '',
    );
  });

  it('refuses to save an invalid URL', () => {
    expect(() => saveHostedBackendUrl('not a url', memoryStorage())).toThrow();
  });
});

describe('probeHostedBackend', () => {
  it('reports a healthy backend with its device, engine and version', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: 'ok', device: 'cpu', engine: 'kittentts', version: '0.5.9' }),
    );
    const probe = await probeHostedBackend('https://gpu.example.com/', '', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pageProtocol: 'https:',
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://gpu.example.com/health', expect.anything());
    expect(probe).toMatchObject({
      ok: true,
      detail: 'cpu · kittentts · v0.5.9',
      target: 'https://gpu.example.com',
      authenticated: false,
    });
  });

  it('distinguishes a starting backend (503) from a wrong server', async () => {
    const starting = await probeHostedBackend('https://a.example', '', {
      fetchImpl: (async () =>
        jsonResponse({ status: 'starting' }, 503)) as unknown as typeof fetch,
      pageProtocol: 'https:',
    });
    expect(starting).toMatchObject({ ok: false, kind: 'http', status: 503 });

    const html = await probeHostedBackend('https://a.example', '', {
      fetchImpl: (async () => new Response('<!doctype html>', { status: 200 })) as unknown as typeof fetch,
      pageProtocol: 'https:',
    });
    expect(html).toMatchObject({ ok: false, kind: 'wrong_port' });
  });

  it('maps network failures, timeouts, invalid and mixed-content URLs', async () => {
    const network = await probeHostedBackend('https://a.example', '', {
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      pageProtocol: 'https:',
    });
    expect(network).toMatchObject({ ok: false, kind: 'network' });

    const timeout = await probeHostedBackend('https://a.example', '', {
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        )) as unknown as typeof fetch,
      pageProtocol: 'https:',
      timeoutMs: 5,
    });
    expect(timeout).toMatchObject({ ok: false, kind: 'timeout' });

    expect(await probeHostedBackend('nope', '')).toMatchObject({ ok: false, kind: 'invalid' });
    expect(
      await probeHostedBackend('http://gpu.example.com', '', { pageProtocol: 'https:' }),
    ).toMatchObject({ ok: false, kind: 'mixed_content' });
  });

  it('reports a rejected API key as an auth failure', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/health')
        ? jsonResponse({ status: 'ok', version: '1' })
        : jsonResponse({ detail: 'Invalid API key' }, 401),
    );
    const probe = await probeHostedBackend('https://a.example', 'wrong-key', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pageProtocol: 'https:',
    });
    expect(probe).toMatchObject({ ok: false, kind: 'auth', status: 401 });
  });
});
