import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadExtractor, listExtractors } from '../../../scripts/lib/assay/loader.js';
import { diskIO } from '../memory/_helpers.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'assay-loader-'));
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  return root;
}

describe('loadExtractor', () => {
  let root;
  before(() => {
    root = setup();
    writeFileSync(join(root, 'foundry/memory/extractors/java-symbols.md'),
`---
command: scripts/extract-java.sh
memory:
  write: [class, method]
timeout: 30s
---

# java-symbols

Walks the Java source tree.
`);
    writeFileSync(join(root, 'foundry/memory/extractors/no-timeout.md'),
`---
command: scripts/x.sh
memory:
  write: [file]
---

# no-timeout
`);
    writeFileSync(join(root, 'foundry/memory/extractors/bad-missing-command.md'),
`---
memory:
  write: [class]
---
`);
    writeFileSync(join(root, 'foundry/memory/extractors/bad-empty-write.md'),
`---
command: scripts/y.sh
memory:
  write: []
---
`);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('parses frontmatter, body, and defaults timeout to 60000ms', async () => {
    const io = diskIO(root);
    const ext = await loadExtractor('foundry', 'java-symbols', io);
    assert.equal(ext.name, 'java-symbols');
    assert.equal(ext.command, 'scripts/extract-java.sh');
    assert.deepEqual(ext.memoryWrite, ['class', 'method']);
    assert.equal(ext.timeoutMs, 30_000);
    assert.match(ext.body, /Walks the Java source tree/);
  });

  it('applies the 60s default when timeout is absent', async () => {
    const io = diskIO(root);
    const ext = await loadExtractor('foundry', 'no-timeout', io);
    assert.equal(ext.timeoutMs, 60_000);
  });

  it('rejects missing command', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => loadExtractor('foundry', 'bad-missing-command', io),
      /command.*required/i,
    );
  });

  it('rejects empty memory.write', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => loadExtractor('foundry', 'bad-empty-write', io),
      /memory\.write.*non-empty/i,
    );
  });

  it('throws a clear error when the file does not exist', async () => {
    const io = diskIO(root);
    await assert.rejects(
      () => loadExtractor('foundry', 'missing', io),
      /extractor not found/i,
    );
  });
});

describe('listExtractors', () => {
  let root;
  before(() => {
    root = setup();
    writeFileSync(join(root, 'foundry/memory/extractors/a.md'),
      `---\ncommand: x\nmemory:\n  write: [t]\n---\n`);
    writeFileSync(join(root, 'foundry/memory/extractors/b.md'),
      `---\ncommand: y\nmemory:\n  write: [t]\n---\n`);
    writeFileSync(join(root, 'foundry/memory/extractors/not-md.txt'), 'ignore');
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('returns extractor names without extension, sorted, only .md files', async () => {
    const io = diskIO(root);
    const names = await listExtractors('foundry', io);
    assert.deepEqual(names, ['a', 'b']);
  });

  it('returns [] when the directory does not exist', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'assay-empty-'));
    const io = diskIO(tmp);
    const names = await listExtractors('foundry', io);
    assert.deepEqual(names, []);
    rmSync(tmp, { recursive: true, force: true });
  });
});
