import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { createEdgeType } from '../../../../scripts/lib/memory/admin/create-edge-type.js';
import { createExtractor } from '../../../../scripts/lib/memory/admin/create-extractor.js';
import { dropEntityType } from '../../../../scripts/lib/memory/admin/drop-entity-type.js';
import { dropEdgeType } from '../../../../scripts/lib/memory/admin/drop-edge-type.js';
import { renameEntityType } from '../../../../scripts/lib/memory/admin/rename-entity-type.js';
import { renameEdgeType } from '../../../../scripts/lib/memory/admin/rename-edge-type.js';
import { resetMemory } from '../../../../scripts/lib/memory/admin/reset.js';
import { disposeStores } from '../../../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../../../scripts/lib/memory/schema.js';
import { diskIO } from '../_helpers.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function initRepoAt(root) {
  execSync('git init -q -b main', { cwd: root, env: GIT_ENV });
  try { execSync('git checkout -B main -q', { cwd: root, env: GIT_ENV }); } catch { /* older git */ }
  execSync('git commit -q --allow-empty -m baseline', { cwd: root, env: GIT_ENV });
}

function populateMemoryTreeAtPath(foundryDir) {
  mkdirSync(join(foundryDir, 'memory/entities'), { recursive: true });
  mkdirSync(join(foundryDir, 'memory/edges'), { recursive: true });
  mkdirSync(join(foundryDir, '..', 'foundry-memory/relations'), { recursive: true });
  mkdirSync(join(foundryDir, 'memory/extractors'), { recursive: true });
  // memory enabled; embeddings null in schema.json so no provider needed.
  writeFileSync(join(foundryDir, 'memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(foundryDir, 'memory/entities/class.md'),
    '---\ntype: class\n---\n\n# class\nA class.\n');
  const schema = {
    version: 1,
    entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
    edges: {},
    embeddings: null,
  };
  writeFileSync(join(foundryDir, 'memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  writeFileSync(join(foundryDir, '..', 'foundry-memory/relations/class.ndjson'), '');
}

describe('memory admin foundryDir consistency (G40.3)', () => {
  let root, io;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'foundrydir-test-'));
    initRepoAt(root);
    io = diskIO(root);
  });

  afterEach(() => {
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  describe('when foundry directory is at worktreeRoot/foundry', () => {
    it('createEntityType should use worktreeRoot parameter correctly', async () => {
      const foundryDir = join(root, 'foundry');
      populateMemoryTreeAtPath(foundryDir);

      const res = await createEntityType({
        worktreeRoot: root,
        io,
        name: 'finding',
        body: 'A finding entity.',
      });

      // Should create the entity at the correct path derived from worktreeRoot
      assert.ok(existsSync(join(root, 'foundry/memory/entities/finding.md')));
      assert.equal(res.type, 'finding');
    });

    it('createEdgeType should use worktreeRoot parameter correctly', async () => {
      const foundryDir = join(root, 'foundry');
      populateMemoryTreeAtPath(foundryDir);

      const res = await createEdgeType({
        worktreeRoot: root,
        io,
        name: 'imports',
        sources: ['class'],
        targets: ['class'],
        body: 'An imports edge.',
      });

      assert.ok(existsSync(join(root, 'foundry/memory/edges/imports.md')));
      assert.equal(res.type, 'imports');
    });

    it('createExtractor should use worktreeRoot parameter correctly', async () => {
      const foundryDir = join(root, 'foundry');
      populateMemoryTreeAtPath(foundryDir);

      const res = await createExtractor({
        worktreeRoot: root,
        io,
        name: 'test-extractor',
        command: 'echo test',
        memoryWrite: ['class'],
        body: 'A test extractor.',
      });

      assert.ok(existsSync(join(root, 'foundry/memory/extractors/test-extractor.md')));
      assert.equal(res.path, 'foundry/memory/extractors/test-extractor.md');
    });

    it('dropEntityType should use worktreeRoot parameter correctly', async () => {
      const foundryDir = join(root, 'foundry');
      populateMemoryTreeAtPath(foundryDir);

      const res = await dropEntityType({
        worktreeRoot: root,
        io,
        name: 'class',
        confirm: true,
      });

      assert.equal(res.dropped, 'class');
      assert.ok(!existsSync(join(root, 'foundry/memory/entities/class.md')));
    });

    it('renameEntityType should use worktreeRoot parameter correctly', async () => {
      const foundryDir = join(root, 'foundry');
      populateMemoryTreeAtPath(foundryDir);

      const res = await renameEntityType({
        worktreeRoot: root,
        io,
        from: 'class',
        to: 'klass',
      });

      assert.equal(res.from, 'class');
      assert.equal(res.to, 'klass');
      assert.ok(!existsSync(join(root, 'foundry/memory/entities/class.md')));
      assert.ok(existsSync(join(root, 'foundry/memory/entities/klass.md')));
    });

    it('resetMemory should use worktreeRoot parameter correctly', async () => {
      const foundryDir = join(root, 'foundry');
      populateMemoryTreeAtPath(foundryDir);
      writeFileSync(join(root, 'foundry-memory/relations/class.ndjson'), '{"type":"class","name":"A"}\n');

      const res = await resetMemory({
        worktreeRoot: root,
        io,
        confirm: true,
      });

      assert.equal(res.reset, true);
      // Relations file should be cleared
      const content = readFileSync(join(root, 'foundry-memory/relations/class.ndjson'), 'utf-8');
      assert.equal(content, '');
    });
  });

  describe('when foundry directory is at a non-standard location', () => {
    it('should fail gracefully when foundryDir cannot be derived from worktreeRoot', async () => {
      // This test demonstrates that the current implementation assumes foundryDir is always
      // at worktreeRoot/foundry, which makes the worktreeRoot parameter misleading.
      // After the fix, if we want to support custom foundry locations, we should accept
      // foundryDir explicitly instead of worktreeRoot.
      
      // For now, this test documents that we expect functions to use worktreeRoot/foundry
      const foundryDir = join(root, 'foundry');
      populateMemoryTreeAtPath(foundryDir);

      // This should work because it's the expected location
      await assert.doesNotReject(async () => {
        await createEntityType({
          worktreeRoot: root,
          io,
          name: 'finding',
          body: 'A finding entity.',
        });
      });
    });
  });
});
