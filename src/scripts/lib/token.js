import { createHmac, timingSafeEqual } from 'node:crypto';

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function splitToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  return { body, mac };
}

function decodeMac(mac) {
  try { return Buffer.from(mac, 'base64url'); }
  catch { return null; }
}

function decodePayload(body) {
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch { return null; }
}

function checkSignature(body, mac, secret) {
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = decodeMac(mac);
  if (!given) return { ok: false, reason: 'malformed' };
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

function checkExpiry(payload) {
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

export function verifyToken(token, secret) {
  const parts = splitToken(token);
  if (!parts) return { ok: false, reason: 'malformed' };

  const sigCheck = checkSignature(parts.body, parts.mac, secret);
  if (!sigCheck.ok) return sigCheck;

  const payload = decodePayload(parts.body);
  if (!payload) return { ok: false, reason: 'malformed' };

  const expiryCheck = checkExpiry(payload);
  if (!expiryCheck.ok) return expiryCheck;

  return { ok: true, payload };
}
