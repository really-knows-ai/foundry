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
import { dropEntityType } from '../../../../scripts/lib/memory/admin/drop-entity-type.js';

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
  const root = mkdtempSync(join(tmpdir(), 'drop-e-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('dropEntityType', () => {
  it('requires confirm: true', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await assert.rejects(() => dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: false }), /confirm/);
    rmSync(root, { recursive: true, force: true });
  });

  it('drops type, relation file, cascades edge-source adjustment', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'method', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class', 'method'], targets: ['class', 'method'], body: 'b' });
    writeFileSync(join(root, 'foundry/memory/relations/calls.ndjson'),
      '{"from_name":"a","from_type":"class","to_name":"b","to_type":"method"}\n' +
      '{"from_name":"a","from_type":"method","to_name":"b","to_type":"method"}\n');

    await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: true });

    assert.ok(!existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(!existsSync(join(root, 'foundry/memory/relations/class.ndjson')));
    const callsMd = readFileSync(join(root, 'foundry/memory/edges/calls.md'), 'utf-8');
    assert.match(callsMd, /sources: \[method\]/);
    assert.match(callsMd, /targets: \[method\]/);
    const callsRel = readFileSync(join(root, 'foundry/memory/relations/calls.ndjson'), 'utf-8');
    assert.doesNotMatch(callsRel, /"class"/);
    rmSync(root, { recursive: true, force: true });
  });

  it('cascades to drop entire edge type if its sources or targets becomes empty', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'table', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'writes', sources: ['class'], targets: ['table'], body: 'b' });

    await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: true });

    assert.ok(!existsSync(join(root, 'foundry/memory/edges/writes.md')));
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(!schema.edges.writes);
    rmSync(root, { recursive: true, force: true });
  });
});
