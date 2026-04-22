import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { embed, probeEmbeddings } from '../../../scripts/lib/memory/embeddings.js';

// Minimal fetch mock: replace global fetch for the duration of a test.
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

describe('embed', () => {
  let restore;
  afterEach(() => restore && restore());

  it('posts batched requests matching OpenAI shape and returns vectors', async () => {
    const calls = [];
    restore = installMockFetch(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        data: body.input.map((_, i) => ({ embedding: [i, i + 1, i + 2], index: i })),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const out = await embed({ config: baseConfig, inputs: ['a', 'b', 'c'] });
    assert.equal(out.length, 3);
    assert.deepEqual(out[0], [0, 1, 2]);
    assert.equal(calls.length, 2); // batchSize: 2
    assert.equal(calls[0].url, 'http://localhost:11434/v1/embeddings');
    assert.equal(calls[0].body.model, 'nomic-embed-text');
    assert.deepEqual(calls[0].body.input, ['a', 'b']);
  });

  it('sends Authorization header when apiKey is set', async () => {
    let seen;
    restore = installMockFetch(async (_url, init) => {
      seen = init.headers;
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 });
    });
    await embed({ config: { ...baseConfig, apiKey: 'sk-xyz' }, inputs: ['a'] });
    assert.equal(seen.Authorization, 'Bearer sk-xyz');
  });

  it('throws when dimension mismatches', async () => {
    restore = installMockFetch(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 2], index: 0 }] }), { status: 200 }));
    await assert.rejects(() => embed({ config: baseConfig, inputs: ['a'] }), /dimension/i);
  });

  it('surfaces provider errors with status code', async () => {
    restore = installMockFetch(async () => new Response('{"error":"model not found"}', { status: 404 }));
    await assert.rejects(() => embed({ config: baseConfig, inputs: ['a'] }), /404|not found/);
  });

  it('times out after timeoutMs', async () => {
    restore = installMockFetch(async (_url, init) => {
      await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    await assert.rejects(
      () => embed({ config: { ...baseConfig, timeoutMs: 50 }, inputs: ['a'] }),
      /abort|timeout/i,
    );
  });
});

describe('probeEmbeddings', () => {
  let restore;
  afterEach(() => restore && restore());

  it('returns {ok: true, dimensions} on success', async () => {
    restore = installMockFetch(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 }));
    const r = await probeEmbeddings({ config: baseConfig });
    assert.equal(r.ok, true);
    assert.equal(r.dimensions, 3);
  });

  it('returns {ok: false, error} on network failure', async () => {
    restore = installMockFetch(async () => { throw new Error('ECONNREFUSED'); });
    const r = await probeEmbeddings({ config: baseConfig });
    assert.equal(r.ok, false);
    assert.match(r.error, /ECONNREFUSED|connect/i);
  });

  it('returns {ok: false} when dimension does not match config', async () => {
    restore = installMockFetch(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 2], index: 0 }] }), { status: 200 }));
    const r = await probeEmbeddings({ config: baseConfig });
    assert.equal(r.ok, false);
    assert.match(r.error, /dimension/i);
  });
});
