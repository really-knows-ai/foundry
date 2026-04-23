import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  readdirSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initMemory } from '../../../../scripts/lib/memory/admin/init.js';
import { loadMemoryConfig } from '../../../../scripts/lib/memory/config.js';


import { diskIO } from '../_helpers.js';

function setupFoundry() {
  const root = mkdtempSync(join(tmpdir(), 'init-mem-'));
  mkdirSync(join(root, 'foundry'), { recursive: true });
  return root;
}

describe('initMemory', () => {
  it('rejects when foundry/ is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'init-mem-'));
    await assert.rejects(
      () => initMemory({ io: diskIO(root), probe: false }),
      /foundry\/ does not exist/,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects when foundry/memory/ already exists', async () => {
    const root = setupFoundry();
    mkdirSync(join(root, 'foundry/memory'), { recursive: true });
    await assert.rejects(
      () => initMemory({ io: diskIO(root), probe: false }),
      /foundry\/memory\/ already exists/,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('creates the full scaffold with embeddings enabled', async () => {
    const root = setupFoundry();
    const out = await initMemory({
      io: diskIO(root),
      embeddingsEnabled: true,
      probe: false,
    });
    assert.ok(existsSync(join(root, 'foundry/memory/entities/.gitkeep')));
    assert.ok(existsSync(join(root, 'foundry/memory/edges/.gitkeep')));
    assert.ok(existsSync(join(root, 'foundry/memory/relations/.gitkeep')));
    assert.ok(existsSync(join(root, 'foundry/memory/config.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/schema.json')));

    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.equal(schema.version, 1);
    assert.deepEqual(schema.entities, {});
    assert.deepEqual(schema.edges, {});
    assert.ok(schema.embeddings && schema.embeddings.dimensions > 0);

    const cfg = await loadMemoryConfig('foundry', diskIO(root));
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.embeddings.enabled, true);

    // .gitignore has the 3 db entries
    const gi = readFileSync(join(root, '.gitignore'), 'utf-8');
    assert.match(gi, /foundry\/memory\/memory\.db$/m);
    assert.match(gi, /foundry\/memory\/memory\.db-wal$/m);
    assert.match(gi, /foundry\/memory\/memory\.db-shm$/m);

    assert.equal(out.gitignoreAdded.length, 3);
    assert.equal(out.probe, null); // probe disabled in test
    rmSync(root, { recursive: true, force: true });
  });

  it('writes embeddings:null in schema when disabled', async () => {
    const root = setupFoundry();
    await initMemory({
      io: diskIO(root),
      embeddingsEnabled: false,
      probe: false,
    });
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.equal(schema.embeddings, null);
    const cfg = await loadMemoryConfig('foundry', diskIO(root));
    assert.equal(cfg.embeddings.enabled, false);
    rmSync(root, { recursive: true, force: true });
  });

  it('is idempotent with respect to .gitignore entries', async () => {
    const root = setupFoundry();
    writeFileSync(
      join(root, '.gitignore'),
      'node_modules/\nfoundry/memory/memory.db\n',
      'utf-8',
    );
    const out = await initMemory({
      io: diskIO(root),
      embeddingsEnabled: true,
      probe: false,
    });
    // only the 2 missing entries added
    assert.deepEqual(out.gitignoreAdded.sort(), [
      'foundry/memory/memory.db-shm',
      'foundry/memory/memory.db-wal',
    ]);
    const gi = readFileSync(join(root, '.gitignore'), 'utf-8');
    // no duplicate of memory.db
    assert.equal(gi.match(/foundry\/memory\/memory\.db$/mg).length, 1);
    rmSync(root, { recursive: true, force: true });
  });

  it('returns a structured probe result without throwing when provider unreachable', async () => {
    const root = setupFoundry();
    // The default embeddings config points at http://localhost:11434, which
    // is almost certainly not running in CI. The tool must surface the
    // failure in the return value rather than throw.
    const out = await initMemory({
      io: diskIO(root),
      embeddingsEnabled: true,
      probe: true,
    });
    assert.ok(out.probe, 'probe result should be present');
    assert.equal(typeof out.probe.ok, 'boolean');
    // We don't assert ok:false because someone might actually have ollama running.
    rmSync(root, { recursive: true, force: true });
  });
});
