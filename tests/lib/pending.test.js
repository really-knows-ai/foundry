import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingStore } from '../../scripts/lib/pending.js';

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
});
