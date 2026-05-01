import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  readdirSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEntityType } from '../../../../scripts/lib/memory/admin/create-entity-type.js';
import { resetMemory } from '../../../../scripts/lib/memory/admin/reset.js';


import { diskIO } from '../_helpers.js';

describe('resetMemory', () => {
  it('empties relation files and keeps types', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reset-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    writeFileSync(join(root, 'foundry-memory/relations/class.ndjson'), '{"name":"com.A","value":"v"}\n');

    await resetMemory({ worktreeRoot: root, io, confirm: true });

    assert.equal(readFileSync(join(root, 'foundry-memory/relations/class.ndjson'), 'utf-8'), '');
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.entities.class);
    rmSync(root, { recursive: true, force: true });
  });

  it('does not fail when WAL/SHM sidecar files do not exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reset-wal-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{"class":{"brief":"b"}},"edges":{},"embeddings":null}\n');
    
    // Create the relation file
    writeFileSync(join(root, 'foundry-memory/relations/class.ndjson'), '');
    
    // Create just the main DB file, not the WAL/SHM sidecars
    // This simulates the state after a clean checkpoint or when WAL mode isn't active
    writeFileSync(join(root, 'foundry/memory/memory.db'), '');
    
    // Create a strict IO implementation that throws ENOENT for missing files
    const strictIO = {
      exists: async (p) => existsSync(join(root, p)),
      readFile: async (p) => readFileSync(join(root, p), 'utf-8'),
      writeFile: async (p, c) => {
        mkdirSync(join(join(root, p), '..'), { recursive: true });
        writeFileSync(join(root, p), c, 'utf-8');
      },
      readDir: async (p) => {
        try { return readdirSync(join(root, p)); } catch { return []; }
      },
      mkdir: async (p) => mkdirSync(join(root, p), { recursive: true }),
      // Strict unlink that throws ENOENT for missing files (unlike the lenient test helper)
      unlink: async (p) => {
        const fullPath = join(root, p);
        unlinkSync(fullPath); // Will throw ENOENT if file doesn't exist
      },
    };
    
    // This should fail because -wal and -shm files don't exist and strict unlink throws
    await resetMemory({ worktreeRoot: root, io: strictIO, confirm: true });

    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.entities.class);
    assert.equal(schema.version, 2); // Version should be bumped
    rmSync(root, { recursive: true, force: true });
  });
});
