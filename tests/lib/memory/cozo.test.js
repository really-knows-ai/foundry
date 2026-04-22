import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryDb, createEntityRelation, createEdgeRelation, dropRelation, listRelations, checkpoint, closeMemoryDb } from '../../../scripts/lib/memory/cozo.js';

describe('cozo wrapper', () => {
  let dir, db;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'cozo-w-'));
    db = openMemoryDb(join(dir, 'memory.db'));
  });
  after(() => {
    closeMemoryDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates an entity relation', async () => {
    await createEntityRelation(db, 'class');
    const rels = await listRelations(db);
    assert.ok(rels.includes('ent_class'));
  });

  it('creates an edge relation', async () => {
    await createEdgeRelation(db, 'calls');
    const rels = await listRelations(db);
    assert.ok(rels.includes('edge_calls'));
  });

  it('is idempotent: creating same relation twice does not error', async () => {
    await createEntityRelation(db, 'class');
    await createEntityRelation(db, 'class');
  });

  it('drops a relation', async () => {
    await createEntityRelation(db, 'temp');
    await dropRelation(db, 'ent_temp');
    const rels = await listRelations(db);
    assert.ok(!rels.includes('ent_temp'));
  });

  it('checkpoints without error', async () => {
    await checkpoint(db);
  });
});
