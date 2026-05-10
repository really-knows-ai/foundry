// Tests in this file exercise the embeddings retry/timeout logic against the
// real OS clock — they wait on real `setTimeout` backoff and real `AbortSignal`
// timers. Treated as e2e under our tier rules: timers are an external system.
//
// If the retry/sleep schedule is later made injectable, these can move back
// to unit alongside the rest of `embeddings.test.js`.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { embed } from '../../../src/scripts/lib/memory/embeddings.js';

function installMockFetch(handler) {
  const orig = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = orig; };
}

const baseConfig = {
  enabled: true,
  baseURL: 'http://localhost:11434/v1',
  model: 'nomic-embed-text',
  dimensions: 3,
  apiKey: null,
  batchSize: 2,
  timeoutMs: 5000,
};

describe('embed retry/timeout (real timers)', () => {
  let restore;
  afterEach(() => restore && restore());

  it('times out after timeoutMs', async () => {
    restore = installMockFetch(async (_url, init) => {
      await new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    });
    await assert.rejects(
      () => embed({ config: { ...baseConfig, timeoutMs: 50 }, inputs: ['a'] }),
      /abort|timeout/i,
    );
  });

  it('retries on 503 and succeeds on second attempt', async () => {
    let attempt = 0;
    const start = Date.now();
    restore = installMockFetch(async () => {
      attempt++;
      if (attempt === 1) return new Response('Service Unavailable', { status: 503 });
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 });
    });
    const out = await embed({ config: baseConfig, inputs: ['a'] });
    assert.equal(attempt, 2);
    assert.equal(out.length, 1);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 1000, 'should wait at least 1000ms before retry');
  });

  it('retries on 429 rate limit and succeeds on third attempt', async () => {
    let attempt = 0;
    const start = Date.now();
    restore = installMockFetch(async () => {
      attempt++;
      if (attempt <= 2) return new Response('Rate limited', { status: 429 });
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 });
    });
    const out = await embed({ config: baseConfig, inputs: ['a'] });
    assert.equal(attempt, 3);
    assert.equal(out.length, 1);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 3000, 'should wait 1s + 2s = 3s total before third attempt');
  });

  it('retries on 500, 502, 504 server errors', async () => {
    for (const status of [500, 502, 504]) {
      let attempt = 0;
      restore = installMockFetch(async () => {
        attempt++;
        if (attempt === 1) return new Response('Server Error', { status });
        return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 });
      });
      const out = await embed({ config: baseConfig, inputs: ['a'] });
      assert.equal(attempt, 2, `should retry on ${status}`);
      assert.equal(out.length, 1);
      restore();
    }
  });

  it('retries on timeout/abort errors', async () => {
    let attempt = 0;
    restore = installMockFetch(async (_url, init) => {
      attempt++;
      if (attempt === 1) {
        await new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
      }
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 });
    });
    const out = await embed({ config: { ...baseConfig, timeoutMs: 50 }, inputs: ['a'] });
    assert.equal(attempt, 2);
    assert.equal(out.length, 1);
  });

  it('throws after exhausting retries with retry count in message', async () => {
    let attempt = 0;
    restore = installMockFetch(async () => {
      attempt++;
      return new Response('Service Unavailable', { status: 503 });
    });
    await assert.rejects(
      () => embed({ config: baseConfig, inputs: ['a'] }),
      (err) => {
        assert.match(err.message, /after 2 retries/i);
        assert.match(err.message, /503/);
        return true;
      },
    );
    assert.equal(attempt, 3, 'should attempt 3 times total');
  });
});
