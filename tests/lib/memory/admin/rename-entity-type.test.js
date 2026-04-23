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
import { renameEntityType } from '../../../../scripts/lib/memory/admin/rename-entity-type.js';


import { diskIO } from '../_helpers.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ren-e-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('renameEntityType', () => {
  it('renames entity and rewrites dependent edge rows and frontmatter', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'klass', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'method', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['klass', 'method'], targets: ['klass', 'method'], body: 'b' });

    // Seed data manually.
    writeFileSync(join(root, 'foundry/memory/relations/klass.ndjson'), '{"name":"com.A","value":"va"}\n');
    writeFileSync(join(root, 'foundry/memory/relations/calls.ndjson'),
      '{"from_name":"com.A","from_type":"klass","to_name":"com.A","to_type":"klass"}\n');

    await renameEntityType({ worktreeRoot: root, io, from: 'klass', to: 'class' });

    assert.ok(!existsSync(join(root, 'foundry/memory/entities/klass.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(readFileSync(join(root, 'foundry/memory/entities/class.md'), 'utf-8').includes('type: class'));

    assert.ok(!existsSync(join(root, 'foundry/memory/relations/klass.ndjson')));
    const entRows = readFileSync(join(root, 'foundry/memory/relations/class.ndjson'), 'utf-8');
    assert.match(entRows, /com\.A/);

    const edgeText = readFileSync(join(root, 'foundry/memory/relations/calls.ndjson'), 'utf-8');
    assert.match(edgeText, /"from_type":"class"/);
    assert.match(edgeText, /"to_type":"class"/);

    const callsMd = readFileSync(join(root, 'foundry/memory/edges/calls.md'), 'utf-8');
    assert.match(callsMd, /sources: \[class, method\]/);
    assert.match(callsMd, /targets: \[class, method\]/);

    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.entities.class);
    assert.ok(!schema.entities.klass);
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects rename to existing name', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'a', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'b', body: 'b' });
    await assert.rejects(() => renameEntityType({ worktreeRoot: root, io, from: 'a', to: 'b' }), /exists/i);
    rmSync(root, { recursive: true, force: true });
  });
});
