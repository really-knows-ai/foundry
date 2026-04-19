import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../../scripts/lib/token.js';

const SECRET = Buffer.alloc(32, 7);

describe('token.js', () => {
  it('signs and verifies a fresh token', () => {
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() + 60_000 };
    const t = signToken(payload, SECRET);
    const r = verifyToken(t, SECRET);
    assert.equal(r.ok, true);
    assert.deepEqual(r.payload, payload);
  });

  it('rejects tampered payload', () => {
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() + 60_000 };
    const t = signToken(payload, SECRET);
    const [p, s] = t.split('.');
    const tampered = Buffer.from(JSON.stringify({ ...payload, route: 'forge:other' })).toString('base64url') + '.' + s;
    assert.equal(verifyToken(tampered, SECRET).ok, false);
    assert.equal(verifyToken(tampered, SECRET).reason, 'bad_signature');
  });

  it('rejects expired token', () => {
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() - 1 };
    const r = verifyToken(signToken(payload, SECRET), SECRET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'expired');
  });

  it('rejects malformed token', () => {
    assert.equal(verifyToken('not-a-token', SECRET).reason, 'malformed');
    assert.equal(verifyToken('onlyonesegment', SECRET).reason, 'malformed');
  });

  it('rejects with wrong secret', () => {
    const payload = { route: 'r', cycle: 'c', nonce: 'n', exp: Date.now() + 60_000 };
    const t = signToken(payload, SECRET);
    assert.equal(verifyToken(t, Buffer.alloc(32, 9)).reason, 'bad_signature');
  });
});
