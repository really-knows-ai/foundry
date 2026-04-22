import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  readdirSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType } from '../../../../scripts/lib/memory/admin/create-edge-type.js';

function diskIO(root) {
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => existsSync(abs(p)),
    readFile: async (p) => readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { mkdirSync(join(abs(p), '..'), { recursive: true }); writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => mkdirSync(abs(p), { recursive: true }),
    unlink: async (p) => { if (existsSync(abs(p))) unlinkSync(abs(p)); },
  };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cdt-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('createEdgeType', () => {
  it('creates edge with declared sources/targets', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'class body' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'calls body' });
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.edges.calls);
    assert.ok(existsSync(join(root, 'foundry/memory/relations/calls.ndjson')));
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts 'any' as wildcard", async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'refs', sources: 'any', targets: 'any', body: 'b' });
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects sources referencing undeclared entity type', async () => {
    const root = setup();
    const io = diskIO(root);
    await assert.rejects(
      () => createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['ghost'], targets: ['class'], body: 'b' }),
      /not declared/i,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects edge name colliding with entity type', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await assert.rejects(
      () => createEdgeType({ worktreeRoot: root, io, name: 'class', sources: ['class'], targets: ['class'], body: 'b' }),
      /already declared/i,
    );
    rmSync(root, { recursive: true, force: true });
  });
});
