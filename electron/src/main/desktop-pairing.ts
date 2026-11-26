import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { DESKTOP_PAIR_PORT, HOSTED_STUDIO_ORIGIN } from '../shared/desktop-pairing';

interface PairingOptions {
  readyUrl: () => string | null;
  approve: (signal: AbortSignal) => Promise<boolean>;
  port?: number;
}

/** Only the local, running desktop can approve the hosted studio's request. */
export function startDesktopPairing({
  readyUrl,
  approve,
  port = DESKTOP_PAIR_PORT,
}: PairingOptions) {
  const key = randomBytes(32).toString('base64url');
  let pending = false;
  let activeApproval: AbortController | null = null;
  const server = createServer(async (request, response) => {
    if (
      request.headers.host !== `127.0.0.1:${port}` ||
      request.headers.origin !== HOSTED_STUDIO_ORIGIN ||
      request.url !== '/pair'
    ) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', HOSTED_STUDIO_ORIGIN);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'POST');
      response.setHeader('Access-Control-Allow-Headers', 'X-Voice-Suite-Pairing');
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
      response.writeHead(204).end();
      return;
    }
    // A cross-site form or image cannot send this header.
    if (request.method !== 'POST' || request.headers['x-voice-suite-pairing'] !== '1') {
      response.writeHead(405).end();
      return;
    }
    if (pending) {
      response.writeHead(409).end();
      return;
    }
    const base = readyUrl();
    if (!base) {
      response.writeHead(503).end();
      return;
    }
    pending = true;
    const approval = new AbortController();
    activeApproval = approval;
    const timeout = setTimeout(() => approval.abort(), 55_000);
    const abandon = () => approval.abort();
    response.once('close', abandon);
    try {
      const accepted = await approve(approval.signal);
      if (!accepted || approval.signal.aborted) {
        response.writeHead(403).end();
        return;
      }
      if (base !== readyUrl()) {
        response.writeHead(503).end();
        return;
      }
      const issued = await fetch(`${base}/api/auth/studio/desktop`, {
        method: 'POST',
        headers: { 'X-Voice-Suite-Pair': key },
        signal: AbortSignal.any([approval.signal, AbortSignal.timeout(5000)]),
        redirect: 'error',
      });
      if (issued.status !== 201 || base !== readyUrl()) {
        response.writeHead(503).end();
        return;
      }
      const { token, expires_in } = (await issued.json()) as { token: string; expires_in: number };
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ token, expires_in, base_url: base }));
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    } finally {
      clearTimeout(timeout);
      response.removeListener('close', abandon);
      activeApproval = null;
      pending = false;
    }
  });
  // Backend startup proceeds independently if another app reserved the discovery port.
  server.on('error', (error: NodeJS.ErrnoException) =>
    console.warn('[desktop pairing] Listener unavailable:', error.code),
  );
  server.listen(port, '127.0.0.1');
  return {
    key,
    close() {
      activeApproval?.abort();
      server.close();
      server.closeAllConnections();
    },
  };
}
