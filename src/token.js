// Signed tokens. HMAC-SHA256 over a JSON claim set, no dependencies.
// A module never mints a token. Only the issuer does, with its secret.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(str, 'base64url');

export function sign(claims, secret, ttlSeconds = 900) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + ttlSeconds, ...claims };
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'APIX' }));
  const payload = b64u(JSON.stringify(body));
  const mac = crypto.createHmac('sha256', secret).update(`${head}.${payload}`).digest();
  return `${head}.${payload}.${b64u(mac)}`;
}

export function verify(token, secret) {
  if (typeof token !== 'string') return { ok: false, code: 'token_malformed' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, code: 'token_malformed' };
  const [head, payload, mac] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${head}.${payload}`).digest();
  const given = unb64u(mac);
  if (given.length !== expected.length) return { ok: false, code: 'token_bad_signature' };
  if (!crypto.timingSafeEqual(given, expected)) return { ok: false, code: 'token_bad_signature' };

  let header, claims;
  try {
    header = JSON.parse(unb64u(head).toString('utf8'));
    claims = JSON.parse(unb64u(payload).toString('utf8'));
  } catch {
    return { ok: false, code: 'token_malformed' };
  }
  if (header.alg !== 'HS256') return { ok: false, code: 'token_bad_alg' };
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, code: 'token_expired' };
  }
  if (typeof claims.tenant !== 'string' || claims.tenant.length === 0) {
    return { ok: false, code: 'token_no_tenant' };
  }
  return { ok: true, claims };
}

export function bearer(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1] : null;
}
