import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryDb, createEntityRelation, createEdgeRelation, dropRelation, listRelations, checkpoint, closeMemoryDb, cozoStringLit } from '../../../scripts/lib/memory/cozo.js';

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

describe('cozoStringLit', () => {
  it('wraps in single quotes so Cozo honours escape sequences', () => {
    assert.equal(cozoStringLit('hello'), "'hello'");
  });

  it('escapes backslash', () => {
    assert.equal(cozoStringLit('a\\b'), "'a\\\\b'");
  });

  it('escapes single quote (the delimiter)', () => {
    assert.equal(cozoStringLit("o'clock"), "'o\\'clock'");
  });

  it('passes double quote through (single-quote literals do not need to escape it)', () => {
    assert.equal(cozoStringLit('say "hi"'), "'say \"hi\"'");
  });

  it('escapes newline, carriage return, and tab', () => {
    assert.equal(cozoStringLit('a\nb\rc\td'), "'a\\nb\\rc\\td'");
  });

  it('survives a round-trip through Cozo for control-heavy values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cozo-esc-'));
    const db = openMemoryDb(join(dir, 'memory.db'));
    try {
      await createEntityRelation(db, 'x');
      const problematic = `line1\nline2\twith"dq'sq\\bs\rcr`;
      await db.run(`?[name, value] <- [[${cozoStringLit('k')}, ${cozoStringLit(problematic)}]]\n:put ent_x { name => value }`);
      const res = await db.run(`?[v] := *ent_x{name: ${cozoStringLit('k')}, value: v}`);
      assert.equal(res.rows[0][0], problematic);
    } finally {
      closeMemoryDb(db);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
