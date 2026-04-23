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


import { diskIO } from '../_helpers.js';

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
  it('returns a preview (no mutation) when confirm is not true', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'method', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class', 'method'], targets: ['class', 'method'], body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'writes', sources: ['class'], targets: ['method'], body: 'b' });
    writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'),
      '{"name":"a","value":"v"}\n{"name":"b","value":"v"}\n');
    writeFileSync(join(root, 'foundry/memory/relations/calls.ndjson'),
      '{"from_name":"a","from_type":"class","to_name":"b","to_type":"method"}\n' +
      '{"from_name":"a","from_type":"method","to_name":"b","to_type":"method"}\n');

    const out = await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: false });
    assert.equal(out.requiresConfirm, true);
    assert.equal(out.preview.type, 'entity');
    assert.equal(out.preview.name, 'class');
    assert.equal(out.preview.entityRows, 2);
    // `writes` cascades (class is the only source → empty after filter).
    // `calls` prunes (one of two rows references class).
    const byName = Object.fromEntries(out.preview.affectedEdges.map((e) => [e.name, e]));
    assert.equal(byName.writes.action, 'cascadeDrop');
    assert.equal(byName.calls.action, 'prune');
    assert.equal(byName.calls.rowsAffected, 1);

    // Nothing was mutated.
    assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/edges/writes.md')));
    rmSync(root, { recursive: true, force: true });
  });

  it('omitted confirm also returns preview (no mutation)', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    const out = await dropEntityType({ worktreeRoot: root, io, name: 'class' });
    assert.equal(out.requiresConfirm, true);
    assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
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
