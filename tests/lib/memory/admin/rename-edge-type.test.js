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
import { renameEdgeType } from '../../../../scripts/lib/memory/admin/rename-edge-type.js';

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
  const root = mkdtempSync(join(tmpdir(), 'ren-ed-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('renameEdgeType', () => {
  it('moves files and updates schema', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'b' });
    writeFileSync(join(root, 'foundry/memory/relations/calls.ndjson'),
      '{"from_name":"com.A","from_type":"class","to_name":"com.B","to_type":"class"}\n');

    await renameEdgeType({ worktreeRoot: root, io, from: 'calls', to: 'invokes' });

    assert.ok(!existsSync(join(root, 'foundry/memory/edges/calls.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/edges/invokes.md')));
    assert.ok(readFileSync(join(root, 'foundry/memory/edges/invokes.md'), 'utf-8').includes('type: invokes'));
    assert.ok(existsSync(join(root, 'foundry/memory/relations/invokes.ndjson')));
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.edges.invokes);
    assert.ok(!schema.edges.calls);
    rmSync(root, { recursive: true, force: true });
  });
});
