import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCyclePromptExtras } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

function setupWorktreeWithCycle() {
  const root = mkdtempSync(join(tmpdir(), 'mem-pi-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\nA class.\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nA finding.\n');
  const schema = {
    version: 1,
    entities: {
      class: { frontmatterHash: hashFrontmatter({ type: 'class' }) },
      finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) },
    },
    edges: {},
    embeddings: null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput: report\nmemory:\n  read: [class]\n  write: [finding]\n---\n\nCycle body.\n`);
  writeFileSync(join(root, 'foundry/cycles/no-mem.md'),
    `---\noutput: report\n---\n\nCycle body.\n`);
  return root;
}

describe('memory prompt injection', () => {
  let root;
  before(() => { root = setupWorktreeWithCycle(); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('adds memory block to cycle prompt when memory is enabled', async () => {
    const out = await buildCyclePromptExtras({ worktree: root, cycleId: 'observe' });
    assert.match(out, /## Flow memory/);
    assert.match(out, /class.*\(read-only\)/);
    assert.match(out, /finding.*\(read\+write\)/);
    assert.match(out, /foundry_memory_put/);
  });

  it('returns empty string when cycle has no memory block', async () => {
    const out = await buildCyclePromptExtras({ worktree: root, cycleId: 'no-mem' });
    assert.equal(out, '');
  });

  it('returns empty string when cycleId is null', async () => {
    const out = await buildCyclePromptExtras({ worktree: root, cycleId: null });
    assert.equal(out, '');
  });

  it('returns empty string (does not throw) when cycle does not exist', async () => {
    const out = await buildCyclePromptExtras({ worktree: root, cycleId: 'nonexistent' });
    assert.equal(out, '');
  });
});
