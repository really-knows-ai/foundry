import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  readdirSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../src/scripts/lib/memory/admin/create-entity-type.js';
import { openStore, closeStore } from '../../../../src/scripts/lib/memory/store.js';


import { diskIO } from '../_helpers.js';

function setup({ embeddings } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cet-'));
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

describe('createEntityType', () => {
  it('creates type file, empty relation file, and updates schema', async () => {
    const root = setup();
    await createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: 'A Java class body, non-empty.' });
    assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(existsSync(join(root, 'foundry-memory/relations/class.ndjson')));
    assert.equal(readFileSync(join(root, 'foundry-memory/relations/class.ndjson'), 'utf-8'), '');
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.entities.class);
    assert.equal(schema.version, 2);
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects invalid name', async () => {
    const root = setup();
    await assert.rejects(
      () => createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'BadName', body: 'body' }),
      /identifier/i,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects empty body', async () => {
    const root = setup();
    await assert.rejects(
      () => createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: '   ' }),
      /body/i,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects duplicate', async () => {
    const root = setup();
    await createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: 'body' });
    await assert.rejects(
      () => createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: 'body' }),
      /exists/i,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('creates the live Cozo relation for an already-open store', async () => {
    const root = setup();
    const io = diskIO(root);
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(root, 'foundry/memory/memory.db') });
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'body' });
    const relations = (await store.db.run('::relations')).rows.map((row) => row[0]);
    assert.ok(relations.includes('ent_class'));
    closeStore(store);
    rmSync(root, { recursive: true, force: true });
  });

  it('creates an embedded live relation that is usable without reopening', async () => {
    const root = setup({ embeddings: { model: 'fake', dimensions: 3 } });
    const io = diskIO(root);
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    const store = await openStore({ foundryDir: 'foundry', schema, io, dbAbsolutePath: join(root, 'foundry/memory/memory.db') });

    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'body' });

    const indices = (await store.db.run('::indices ent_class')).rows.map((row) => row[0]);
    assert.ok(indices.includes('vec'));
    await store.db.run(
      '?[name, value, embedding] <- [["com.A", "body", vec([1, 0, 0])]]\n:put ent_class { name => value, embedding }',
    );
    const rows = (await store.db.run('?[name, value, embedding] := *ent_class{name, value, embedding}')).rows;
    assert.deepEqual(rows, [['com.A', 'body', [1, 0, 0]]]);

    closeStore(store);
    rmSync(root, { recursive: true, force: true });
  });
});
