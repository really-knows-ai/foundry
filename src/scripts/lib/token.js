import { createHmac, timingSafeEqual } from 'node:crypto';

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
  const [body, mac] = token.split('.');
  if (!body || !mac) return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', secret).update(body).digest();
  let given;
  try { given = Buffer.from(mac, 'base64url'); } catch { return { ok: false, reason: 'malformed' }; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch { return { ok: false, reason: 'malformed' }; }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}
