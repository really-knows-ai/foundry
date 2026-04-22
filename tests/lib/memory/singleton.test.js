import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrOpenStore, disposeStores } from '../../../scripts/lib/memory/singleton.js';

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

describe('singleton store', () => {
  let root;
  after(() => { disposeStores(); if (root) rmSync(root, { recursive: true, force: true }); });

  it('opens once and reuses', async () => {
    root = mkdtempSync(join(tmpdir(), 'sing-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');

    const s1 = await getOrOpenStore({ worktreeRoot: root, io: diskIO(root) });
    const s2 = await getOrOpenStore({ worktreeRoot: root, io: diskIO(root) });
    assert.strictEqual(s1, s2);
  });

  it('throws if memory not enabled', async () => {
    const r2 = mkdtempSync(join(tmpdir(), 'sing2-'));
    mkdirSync(join(r2, 'foundry/memory'), { recursive: true });
    writeFileSync(join(r2, 'foundry/memory/config.md'), '---\nenabled: false\n---\n');
    writeFileSync(join(r2, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    await assert.rejects(() => getOrOpenStore({ worktreeRoot: r2, io: diskIO(r2) }), /not enabled/i);
    rmSync(r2, { recursive: true, force: true });
  });

  it('invalidateStore clears and reopens fresh', async () => {
    const r = mkdtempSync(join(tmpdir(), 'inv-'));
    mkdirSync(join(r, 'foundry/memory'), { recursive: true });
    writeFileSync(join(r, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(r, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    const { invalidateStore } = await import('../../../scripts/lib/memory/singleton.js');
    const s1 = await getOrOpenStore({ worktreeRoot: r, io: diskIO(r) });
    invalidateStore(r);
    const s2 = await getOrOpenStore({ worktreeRoot: r, io: diskIO(r) });
    assert.notStrictEqual(s1, s2);
    rmSync(r, { recursive: true, force: true });
  });
});
