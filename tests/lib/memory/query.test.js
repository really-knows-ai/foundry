import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, closeStore } from '../../../scripts/lib/memory/store.js';
import { putEntity } from '../../../scripts/lib/memory/writes.js';
import { runQuery } from '../../../scripts/lib/memory/query.js';

const vocab = { entities: { class: {} }, edges: {} };
const schema = { version: 1, entities: { class: {} }, edges: {}, embeddings: null };

function diskIO(root) {
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => existsSync(abs(p)),
    readFile: async (p) => readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { mkdirSync(join(abs(p), '..'), { recursive: true }); writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => mkdirSync(abs(p), { recursive: true }),
  };
}

describe('query', () => {
  let root, store;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'q-'));
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    store = await openStore({ foundryDir: 'foundry', schema, io: diskIO(root), dbAbsolutePath: join(root, 'memory.db') });
    await putEntity(store, { type: 'class', name: 'com.A', value: 'va' }, vocab);
  });
  after(() => { closeStore(store); rmSync(root, { recursive: true, force: true }); });

  it('returns structured rows on read', async () => {
    const out = await runQuery(store, '?[n, v] := *ent_class{name: n, value: v}');
    assert.equal(out.rows.length, 1);
    assert.deepEqual(out.rows[0], { n: 'com.A', v: 'va' });
  });

  it('rejects writes', async () => {
    await assert.rejects(() => runQuery(store, ':put ent_class { name => value } [["x", "y"]]'), /read-only/i);
    await assert.rejects(() => runQuery(store, ':rm ent_class { name } [["com.A"]]'), /read-only/i);
    await assert.rejects(() => runQuery(store, ':create bad { a: Int }'), /read-only/i);
  });

  it('surfaces cozo errors clearly', async () => {
    await assert.rejects(() => runQuery(store, '?[x] := *nonexistent{x}'), /nonexistent|not found|error/i);
  });
});
