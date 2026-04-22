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

function diskIO(root) {
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => existsSync(abs(p)),
    readFile: async (p) => readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => { mkdirSync(join(abs(p), '..'), { recursive: true }); writeFileSync(abs(p), c, 'utf-8'); },
    readDir: async (p) => { try { return readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => mkdirSync(abs(p), { recursive: true }),
    unlink: async (p) => { if (existsSync(abs(p))) unlinkSync(abs(p)); },
  };
}

describe('resetMemory', () => {
  it('empties relation files and keeps types', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reset-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    const io = diskIO(root);
    await createEntityType({ worktreeRoot: root, io, name: 'class', body: 'b' });
    writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'), '{"name":"com.A","value":"v"}\n');

    await resetMemory({ worktreeRoot: root, io, confirm: true });

    assert.equal(readFileSync(join(root, 'foundry/memory/relations/class.ndjson'), 'utf-8'), '');
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    assert.ok(schema.entities.class);
    rmSync(root, { recursive: true, force: true });
  });
});
