import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingStore } from '../../src/scripts/lib/pending.js';

describe('pending store', () => {
  it('add then consume returns meta', () => {
    const s = createPendingStore();
    s.add('n1', { route: 'r', cycle: 'c', exp: Date.now() + 1000 });
    assert.deepEqual(s.consume('n1').route, 'r');
  });

  it('second consume returns null', () => {
    const s = createPendingStore();
    s.add('n1', { route: 'r', cycle: 'c', exp: Date.now() + 1000 });
    s.consume('n1');
    assert.equal(s.consume('n1'), null);
  });

  it('unknown nonce returns null', () => {
    assert.equal(createPendingStore().consume('x'), null);
  });

  it('expired nonce returns null and is evicted', () => {
    const s = createPendingStore();
    s.add('old', { route: 'r', cycle: 'c', exp: Date.now() - 1 });
    assert.equal(s.consume('old'), null);
    assert.equal(s.size(), 0);
  });

  it('consumes valid nonce and evicts expired nonce correctly', () => {
    const s = createPendingStore();
    const now = Date.now();
    
    // Add expired and valid nonces
    s.add('expired', { route: 'r1', cycle: 'c1', exp: now - 1000 });
    s.add('valid', { route: 'r2', cycle: 'c2', exp: now + 10000 });
    
    // Consuming expired nonce should return null and delete it
    assert.equal(s.consume('expired'), null);
    assert.equal(s.size(), 1, 'Only valid nonce remains');
    
    // Consuming valid nonce should return meta and delete it
    const validMeta = s.consume('valid');
    assert.equal(validMeta.route, 'r2');
    assert.equal(s.size(), 0, 'All nonces consumed');
  });
});
