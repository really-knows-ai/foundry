import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  readdirSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../src/scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType } from '../../../../src/scripts/lib/memory/admin/create-edge-type.js';
import { dropEntityType } from '../../../../src/scripts/lib/memory/admin/drop-entity-type.js';
import { openStore, closeStore } from '../../../../src/scripts/lib/memory/store.js';


import { diskIO } from '../_helpers.js';

function setup({ embeddings } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'drop-e-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(
    join(root, 'foundry/memory/schema.json'),
    JSON.stringify({ version: 1, entities: {}, edges: {}, embeddings: embeddings ?? null }) + '\n',
  );
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
    writeFileSync(join(root, 'foundry-memory/relations/class.ndjson'),
      '{"name":"a","value":"v"}\n{"name":"b","value":"v"}\n');
    writeFileSync(join(root, 'foundry-memory/relations/calls.ndjson'),
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
    writeFileSync(join(root, 'foundry-memory/relations/calls.ndjson'),
      '{"from_name":"a","from_type":"class","to_name":"b","to_type":"method"}\n' +
      '{"from_name":"a","from_type":"method","to_name":"b","to_type":"method"}\n');

    await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: true });

    assert.ok(!existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(!existsSync(join(root, 'foundry-memory/relations/class.ndjson')));
    const callsMd = readFileSync(join(root, 'foundry/memory/edges/calls.md'), 'utf-8');
    assert.match(callsMd, /sources: \[method\]/);
    assert.match(callsMd, /targets: \[method\]/);
    const callsRel = readFileSync(join(root, 'foundry-memory/relations/calls.ndjson'), 'utf-8');
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

  it('drops live Cozo relations for an already-open store', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'table', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'writes', sources: ['class'], targets: ['table'], body: 'b' });
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(root, 'foundry/memory/memory.db') });

    await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: true });

    const relations = (await store.db.run('::relations')).rows.map((row) => row[0]);
    assert.ok(!relations.includes('ent_class'));
    assert.ok(!relations.includes('edge_writes'));
    closeStore(store);
    rmSync(root, { recursive: true, force: true });
  });

  it('drops an embedded live relation without reopening the store', async () => {
    const root = setup({ embeddings: { model: 'fake', dimensions: 3 } });
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'table', body: 'b' });
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(root, 'foundry/memory/memory.db') });

    await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: true });

    const relations = (await store.db.run('::relations')).rows.map((row) => row[0]);
    assert.ok(!relations.includes('ent_class'));
    assert.ok(relations.includes('ent_table'));
    await store.db.run('? [name, value, embedding] <- [["t1", "body", vec([0, 1, 0])]]\n:put ent_table { name => value, embedding }');
    const rows = (await store.db.run('?[name, value, embedding] := *ent_table{name, value, embedding}')).rows;
    assert.deepEqual(rows, [['t1', 'body', [0, 1, 0]]]);

    closeStore(store);
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps a pruned live edge relation usable on an already-open store', async () => {
    const root = setup();
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    await createEntityType({ worktreeRoot: root, io, name: 'method', body: 'b' });
    await createEdgeType({ worktreeRoot: root, io, name: 'calls', sources: ['class', 'method'], targets: ['class', 'method'], body: 'b' });
    writeFileSync(join(root, 'foundry-memory/relations/calls.ndjson'),
      '{"from_name":"a","from_type":"class","to_name":"b","to_type":"method"}\n' +
      '{"from_name":"a","from_type":"method","to_name":"b","to_type":"method"}\n');
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(root, 'foundry/memory/memory.db') });

    await dropEntityType({ worktreeRoot: root, io, name: 'class', confirm: true });

    const relations = (await store.db.run('::relations')).rows.map((row) => row[0]);
    assert.ok(!relations.includes('ent_class'));
    assert.ok(relations.includes('edge_calls'));
    const prunedRows = (await store.db.run('?[ft, fn, tt, tn] := *edge_calls{from_type: ft, from_name: fn, to_type: tt, to_name: tn}')).rows;
    assert.deepEqual(prunedRows, [['method', 'a', 'method', 'b']]);
    await store.db.run(
      '?[from_type, from_name, to_type, to_name] <- [["method", "c", "method", "d"]]\n:put edge_calls { from_type, from_name, to_type, to_name }',
    );
    const allRows = (await store.db.run('?[ft, fn, tt, tn] := *edge_calls{from_type: ft, from_name: fn, to_type: tt, to_name: tn}')).rows;
    assert.deepEqual(allRows, [
      ['method', 'a', 'method', 'b'],
      ['method', 'c', 'method', 'd'],
    ]);

    closeStore(store);
    rmSync(root, { recursive: true, force: true });
  });
});
