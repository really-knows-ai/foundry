import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateMemory } from '../../../../scripts/lib/memory/admin/validate.js';

function diskIO(root) {
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => existsSync(abs(p)),
    readFile: async (p) => readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => writeFileSync(abs(p), c, 'utf-8'),
    readDir: async (p) => { try { return readdirSync(abs(p)); } catch { return []; } },
    mkdir: async (p) => mkdirSync(abs(p), { recursive: true }),
  };
}

describe('validateMemory', () => {
  it('clean project: no issues', async () => {
    const root = mkdtempSync(join(tmpdir(), 'val-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    const report = await validateMemory({ io: diskIO(root) });
    assert.equal(report.ok, true);
    assert.equal(report.issues.length, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it('reports drift', async () => {
    const root = mkdtempSync(join(tmpdir(), 'val-d-'));
    mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
    mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
    writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root, 'foundry/memory/entities/ghost.md'), '---\ntype: ghost\n---\n\nBody.\n');
    writeFileSync(join(root, 'foundry/memory/schema.json'), '{"version":1,"entities":{},"edges":{},"embeddings":null}\n');
    const report = await validateMemory({ io: diskIO(root) });
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((i) => i.kind === 'unknown-type'));
    rmSync(root, { recursive: true, force: true });
  });
});
