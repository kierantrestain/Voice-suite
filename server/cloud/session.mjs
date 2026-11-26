import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = '__Host-voice-suite-cloud';
const SESSION_SECONDS = 8 * 60 * 60;
const ACTOR = /^[a-z0-9][a-z0-9-]{1,47}$/;
const NONCE = /^[a-zA-Z0-9_-]{22}$/;
const epoch = () => Math.floor(Date.now() / 1000);

function sign(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function issue(secret, kind, subject, expiresIn) {
  if (!ACTOR.test(subject))
    throw new Error('Account ID must be 2–48 lowercase letters, numbers or hyphens.');
  const data = Buffer.from(
    JSON.stringify({
      kind,
      sub: subject,
      exp: epoch() + expiresIn,
      nonce: randomBytes(16).toString('base64url'),
    }),
  ).toString('base64url');
  return `${data}.${sign(secret, data)}`;
}

function read(secret, token, kind, maxAge) {
  if (typeof token !== 'string' || token.length > 512 || !/^[\w-]+\.[\w-]{43}$/.test(token))
    return null;
  const [body, mac] = token.split('.');
  if (!timingSafeEqual(Buffer.from(sign(secret, body)), Buffer.from(mac))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const now = epoch();
    if (
      claims.kind !== kind ||
      !ACTOR.test(claims.sub) ||
      !NONCE.test(claims.nonce) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= now ||
      claims.exp > now + maxAge
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}

export const INVITE_SECONDS = 10 * 60;
export const createInvite = (secret, subject) => issue(secret, 'invite', subject, INVITE_SECONDS);
export const readInvite = (secret, token) => read(secret, token, 'invite', INVITE_SECONDS);

export function sessionActor(request, secret) {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1);
  return read(secret, token, 'session', SESSION_SECONDS)?.sub ?? null;
}

export function sessionCookie(secret, actor) {
  const token = actor ? issue(secret, 'session', actor, SESSION_SECONDS) : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${actor ? SESSION_SECONDS : 0}`;
}
