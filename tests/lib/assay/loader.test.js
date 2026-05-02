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

  it('rejects timeout exceeding 600000ms when specified as number', async () => {
    const io = diskIO(root);
    writeFileSync(join(root, 'foundry/memory/extractors/timeout-too-high.md'),
`---
command: scripts/x.sh
memory:
  write: [file]
timeout: 600001
---
`);
    await assert.rejects(
      () => loadExtractor('foundry', 'timeout-too-high', io),
      /timeout must not exceed 600000ms/i,
    );
  });

  it('rejects timeout exceeding 600000ms when specified as string', async () => {
    const io = diskIO(root);
    writeFileSync(join(root, 'foundry/memory/extractors/timeout-string-high.md'),
`---
command: scripts/x.sh
memory:
  write: [file]
timeout: 11m
---
`);
    await assert.rejects(
      () => loadExtractor('foundry', 'timeout-string-high', io),
      /timeout must not exceed 600000ms/i,
    );
  });

  it('accepts timeout exactly at 600000ms', async () => {
    const io = diskIO(root);
    writeFileSync(join(root, 'foundry/memory/extractors/timeout-at-limit.md'),
`---
command: scripts/x.sh
memory:
  write: [file]
timeout: 600000
---
`);
    const ext = await loadExtractor('foundry', 'timeout-at-limit', io);
    assert.equal(ext.timeoutMs, 600_000);
  });

  it('accepts timeout as 10m (600000ms)', async () => {
    const io = diskIO(root);
    writeFileSync(join(root, 'foundry/memory/extractors/timeout-10m.md'),
`---
command: scripts/x.sh
memory:
  write: [file]
timeout: 10m
---
`);
    const ext = await loadExtractor('foundry', 'timeout-10m', io);
    assert.equal(ext.timeoutMs, 600_000);
  });

  it('handles UTF-8 BOM at start of file', async () => {
    const io = diskIO(root);
    // UTF-8 BOM is U+FEFF
    const contentWithBOM = '\uFEFF---\ncommand: scripts/bom-test.sh\nmemory:\n  write: [file]\n---\n\nBOM test content';
    writeFileSync(join(root, 'foundry/memory/extractors/with-bom.md'), contentWithBOM, 'utf8');
    const ext = await loadExtractor('foundry', 'with-bom', io);
    assert.equal(ext.name, 'with-bom');
    assert.equal(ext.command, 'scripts/bom-test.sh');
    assert.deepEqual(ext.memoryWrite, ['file']);
    assert.match(ext.body, /BOM test content/);
  });

  it('strips leading whitespace from body field', async () => {
    const io = diskIO(root);
    // Body has leading newlines and spaces
    const contentWithLeadingWhitespace = '---\ncommand: scripts/test.sh\nmemory:\n  write: [file]\n---\n\n\n   Body content starts here';
    writeFileSync(join(root, 'foundry/memory/extractors/leading-ws.md'), contentWithLeadingWhitespace, 'utf8');
    const ext = await loadExtractor('foundry', 'leading-ws', io);
    // Leading whitespace should be stripped
    assert.equal(ext.body, 'Body content starts here');
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
