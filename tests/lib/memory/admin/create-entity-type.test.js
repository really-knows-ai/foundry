import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  readdirSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';


import { diskIO } from '../_helpers.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cet-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
  return root;
}

describe('createEntityType', () => {
  it('creates type file, empty relation file, and updates schema', async () => {
    const root = setup();
    await createEntityType({ worktreeRoot: root, io: diskIO(root), name: 'class', body: 'A Java class body, non-empty.' });
    assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/relations/class.ndjson')));
    assert.equal(readFileSync(join(root, 'foundry/memory/relations/class.ndjson'), 'utf-8'), '');
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
});
