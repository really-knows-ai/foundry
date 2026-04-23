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
import { dropEdgeType } from '../../../../scripts/lib/memory/admin/drop-edge-type.js';


import { diskIO } from '../_helpers.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'drop-ed-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('dropEdgeType', () => {
  it('returns a preview (no mutation) when confirm is not true', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'b' });
    writeFileSync(join(root, 'foundry/memory/relations/calls.ndjson'),
      '{"from_name":"a","from_type":"class","to_name":"b","to_type":"class"}\n' +
      '{"from_name":"c","from_type":"class","to_name":"d","to_type":"class"}\n');
    const out = await dropEdgeType({ worktreeRoot: root, io, name: 'calls', confirm: false });
    assert.equal(out.requiresConfirm, true);
    assert.deepEqual(out.preview, { type: 'edge', name: 'calls', rows: 2 });
    assert.ok(existsSync(join(root, 'foundry/memory/edges/calls.md')));
    rmSync(root, { recursive: true, force: true });
  });

  it('omitted confirm also returns preview', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'b' });
    const out = await dropEdgeType({ worktreeRoot: root, io, name: 'calls' });
    assert.equal(out.requiresConfirm, true);
    rmSync(root, { recursive: true, force: true });
  });

  it('drops edge type and relation', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class'], targets: ['class'], body: 'b' });
    await dropEdgeType({ worktreeRoot: root, io, name: 'calls', confirm: true });
    assert.ok(!existsSync(join(root, 'foundry/memory/edges/calls.md')));
    assert.ok(!existsSync(join(root, 'foundry/memory/relations/calls.ndjson')));
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(!schema.edges.calls);
    rmSync(root, { recursive: true, force: true });
  });
});
