import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

// Minimal fetch mock — same pattern as tests/lib/memory/embeddings.test.js. We
// install a fake OpenAI-shape `/embeddings` endpoint so `withStore`'s real
// embedder (which calls global.fetch) becomes deterministic without network.
function installMockFetch(handler) {
  const orig = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = orig; };
}

// Deterministic embedder: vector depends only on the first character of the
// input string. Mirrors the `charEmbedder` used by tests/lib/memory/search.test.js.
function charVector(s, dim) {
  const v = new Array(dim).fill(0);
  v[(s.charCodeAt(0) ?? 0) % dim] = 1;
  return v;
}

function fakeEmbeddingsHandler(dim) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const data = body.input.map((s, i) => ({ embedding: charVector(s, dim), index: i }));
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function setupWorktree({ embeddingsEnabled, dimensions = 4 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'plug-search-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });

  // Two entity types so we can exercise type_filter intersection with cycle
  // read permissions.
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\n# class\nA class.\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\n# finding\nA finding.\n');

  const configBody = embeddingsEnabled
    ? `---\nenabled: true\nembeddings:\n  enabled: true\n  baseURL: http://fake.invalid/v1\n  model: fake-model\n  dimensions: ${dimensions}\n  batchSize: 8\n  timeoutMs: 5000\n---\n`
    : '---\nenabled: true\nembeddings:\n  enabled: false\n---\n';
  writeFileSync(join(root, 'foundry/memory/config.md'), configBody);

  const schema = {
    version: 1,
    entities: {
      class: { frontmatterHash: hashFrontmatter({ type: 'class' }) },
      finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) },
    },
    edges: {},
    embeddings: embeddingsEnabled ? { model: 'fake-model', dimensions } : null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');

  // Cycles for permission scoping.
  writeFileSync(join(root, 'foundry/cycles/class-only.md'),
    '---\noutput-type: report\nmemory:\n  read: [class]\n  write: [class]\n---\n\nCycle body.\n');
  writeFileSync(join(root, 'foundry/cycles/all-access.md'),
    '---\noutput-type: report\nmemory:\n  read: [class, finding]\n  write: [class, finding]\n---\n\nCycle body.\n');

  return root;
}

describe('plugin foundry_memory_search — embeddings disabled', () => {
  let root, plugin;
  before(async () => {
    root = setupWorktree({ embeddingsEnabled: false });
    plugin = await FoundryPlugin({ directory: root });
  });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('returns a clear error when embeddings are disabled in memory config', async () => {
    const out = await plugin.tool.foundry_memory_search.execute(
      { query_text: 'hello' },
      { worktree: root },
    );
    const parsed = JSON.parse(out);
    assert.ok(parsed.error, `expected error, got: ${out}`);
    assert.match(parsed.error, /embeddings.*disabled/i);
  });
});

describe('plugin foundry_memory_search — embeddings enabled (fake provider)', () => {
  const DIM = 4;
  let root, plugin, restoreFetch;

  before(async () => {
    root = setupWorktree({ embeddingsEnabled: true, dimensions: DIM });
    restoreFetch = installMockFetch(fakeEmbeddingsHandler(DIM));
    plugin = await FoundryPlugin({ directory: root });

    // Seed entities. Puts use the real embedder (which goes through our mock
    // fetch), so vectors land in the HNSW index.
    const ctx = { worktree: root };
    await plugin.tool.foundry_memory_put.execute({ type: 'class', name: 'a1', value: 'alpha' }, ctx);
    await plugin.tool.foundry_memory_put.execute({ type: 'class', name: 'b1', value: 'beta' }, ctx);
    await plugin.tool.foundry_memory_put.execute({ type: 'finding', name: 'fa', value: 'alpha' }, ctx);
    await plugin.tool.foundry_memory_put.execute({ type: 'finding', name: 'fc', value: 'cosmic' }, ctx);
  });
  after(() => {
    if (restoreFetch) restoreFetch();
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns nearest entities across all types when no filter and no cycle', async () => {
    const out = JSON.parse(await plugin.tool.foundry_memory_search.execute(
      { query_text: 'alpha', k: 10 },
      { worktree: root },
    ));
    assert.ok(Array.isArray(out));
    // Both 'alpha'-keyed entities should appear and rank ahead of mismatched ones.
    const names = out.map((r) => r.name);
    assert.ok(names.includes('a1'), `expected a1 in results: ${names.join(',')}`);
    assert.ok(names.includes('fa'), `expected fa in results: ${names.join(',')}`);
    // Top result must be a perfect match (distance 0 for char-vector embedder).
    assert.equal(out[0].distance, 0);
    assert.equal(out[0].value, 'alpha');
  });

  it('respects k by capping the number of returned rows', async () => {
    const out = JSON.parse(await plugin.tool.foundry_memory_search.execute(
      { query_text: 'alpha', k: 1 },
      { worktree: root },
    ));
    assert.equal(out.length, 1);
  });

  it('type_filter restricts results to the specified types', async () => {
    const out = JSON.parse(await plugin.tool.foundry_memory_search.execute(
      { query_text: 'alpha', k: 10, type_filter: ['class'] },
      { worktree: root },
    ));
    assert.ok(out.length > 0);
    for (const row of out) assert.equal(row.type, 'class');
  });

  it('intersects type_filter with cycle read permissions (drops disallowed types)', async () => {
    // Cycle 'class-only' permits reading [class]. Caller asks for both
    // [class, finding] — finding must be filtered out, only class results.
    const out = JSON.parse(await plugin.tool.foundry_memory_search.execute(
      { query_text: 'alpha', k: 10, type_filter: ['class', 'finding'] },
      { worktree: root, cycle: 'class-only' },
    ));
    assert.ok(out.length > 0);
    for (const row of out) assert.equal(row.type, 'class');
    // 'fa' (a finding) must not leak through.
    assert.ok(!out.some((r) => r.name === 'fa'),
      `finding entity leaked across permission boundary: ${JSON.stringify(out)}`);
  });

  it('falls back to readable types when type_filter is omitted under a restrictive cycle', async () => {
    const out = JSON.parse(await plugin.tool.foundry_memory_search.execute(
      { query_text: 'alpha', k: 10 },
      { worktree: root, cycle: 'class-only' },
    ));
    for (const row of out) assert.equal(row.type, 'class');
  });

  it('without cycle context, full access (consistent with other memory tools)', async () => {
    const out = JSON.parse(await plugin.tool.foundry_memory_search.execute(
      { query_text: 'alpha', k: 10 },
      { worktree: root },
    ));
    const types = new Set(out.map((r) => r.type));
    assert.ok(types.has('class'));
    assert.ok(types.has('finding'));
  });

  it('surfaces provider failures as errorJson rather than crashing', async () => {
    // Swap the fetch mock to one that always 500s; the search call should
    // return an error envelope, not throw.
    const restorePrev = restoreFetch;
    const failingRestore = installMockFetch(async () =>
      new Response('{"error":"upstream boom"}', { status: 500 }));
    try {
      const out = await plugin.tool.foundry_memory_search.execute(
        { query_text: 'alpha', k: 3 },
        { worktree: root },
      );
      const parsed = JSON.parse(out);
      assert.ok(parsed.error, `expected error envelope, got: ${out}`);
      assert.match(parsed.error, /500|upstream/i);
    } finally {
      failingRestore();
      // Reinstall the deterministic fake so the `after` hook restores the
      // original global.fetch via `restoreFetch`.
      restoreFetch = installMockFetch(fakeEmbeddingsHandler(DIM));
      // Track the chained restore so `after` returns to the true original.
      const reinstalled = restoreFetch;
      restoreFetch = () => { reinstalled(); restorePrev(); };
    }
  });
});
