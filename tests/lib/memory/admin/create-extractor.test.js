import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExtractor } from '../../../../scripts/lib/memory/admin/create-extractor.js';
import { diskIO } from '../_helpers.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'create-ext-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\n# class\n');
  writeFileSync(join(root, 'foundry/memory/entities/method.md'),
    '---\ntype: method\n---\n\n# method\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1,
    entities: { class: {}, method: {} },
    edges: {},
    embeddings: null,
  }, null, 2));
  return root;
}

describe('createExtractor', () => {
  let root;
  before(() => { root = setup(); });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('writes an extractor file with populated frontmatter', async () => {
    const io = diskIO(root);
    const out = await createExtractor({
      worktreeRoot: root,
      io,
      name: 'java-symbols',
      command: 'scripts/extract-java.sh',
      memoryWrite: ['class', 'method'],
      body: 'Extracts classes and methods.',
    });
    assert.equal(out.path, 'foundry/memory/extractors/java-symbols.md');
    const text = readFileSync(join(root, out.path), 'utf-8');
    assert.match(text, /command: scripts\/extract-java\.sh/);
    assert.match(text, /write:\s*\[\s*class,\s*method\s*\]/);
    assert.match(text, /Extracts classes and methods/);
  });

  it('accepts an optional timeout', async () => {
    const io = diskIO(root);
    await createExtractor({
      worktreeRoot: root, io,
      name: 'with-timeout',
      command: 'x',
      memoryWrite: ['class'],
      timeout: '30s',
      body: 'x',
    });
    const text = readFileSync(join(root, 'foundry/memory/extractors/with-timeout.md'), 'utf-8');
    assert.match(text, /timeout: 30s/);
  });

  it('rejects invalid identifiers', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'Bad Name', command: 'x', memoryWrite: ['class'], body: 'x' }),
      /invalid identifier/i,
    );
  });

  it('rejects empty body', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'empty-body', command: 'x', memoryWrite: ['class'], body: '' }),
      /body.*non-empty/i,
    );
  });

  it('rejects empty memoryWrite', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'nowrite', command: 'x', memoryWrite: [], body: 'x' }),
      /memoryWrite.*non-empty/i,
    );
  });

  it('rejects memoryWrite entries that are not declared entity types', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'bogus-type', command: 'x', memoryWrite: ['class', 'not-a-type'], body: 'x' }),
      /not-a-type.*not declared/i,
    );
  });

  it('rejects duplicate extractor names', async () => {
    const io = diskIO(root);
    await createExtractor({ worktreeRoot: root, io, name: 'dup', command: 'x', memoryWrite: ['class'], body: 'x' });
    await assert.rejects(
      () => createExtractor({ worktreeRoot: root, io, name: 'dup', command: 'y', memoryWrite: ['class'], body: 'y' }),
      /already exists/i,
    );
  });

  it('creates the extractors directory on first use', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'first-ext-'));
    mkdirSync(join(tmp, 'foundry/memory/entities'), { recursive: true });
    writeFileSync(join(tmp, 'foundry/memory/entities/class.md'), '---\ntype: class\n---\n');
    writeFileSync(join(tmp, 'foundry/memory/schema.json'), JSON.stringify({ version: 1, entities: { class: {} }, edges: {}, embeddings: null }));
    const io = diskIO(tmp);
    await createExtractor({ worktreeRoot: tmp, io, name: 'a', command: 'x', memoryWrite: ['class'], body: 'b' });
    assert.ok(existsSync(join(tmp, 'foundry/memory/extractors/a.md')));
    rmSync(tmp, { recursive: true, force: true });
  });
});
