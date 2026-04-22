import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

function setupWorktreeWithCycle() {
  const root = mkdtempSync(join(tmpdir(), 'mem-perms-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\nBody.\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nBody.\n');
  writeFileSync(join(root, 'foundry/memory/edges/calls.md'),
    '---\ntype: calls\nsources: [class]\ntargets: [class]\n---\n\nBody.\n');
  const schema = {
    version: 1,
    entities: {
      class: { frontmatterHash: hashFrontmatter({ type: 'class' }) },
      finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) },
    },
    edges: { calls: { frontmatterHash: hashFrontmatter({ type: 'calls', sources: ['class'], targets: ['class'] }) } },
    embeddings: null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/readonly-inspect.md'),
    `---\noutput: report\nmemory:\n  read: [class]\n---\n\nCycle body.\n`);
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput: report\nmemory:\n  read: [class]\n  write: [finding]\n---\n\nCycle body.\n`);
  return root;
}

describe('memory tools respect cycle permissions', () => {
  let root, plugin;
  before(async () => { root = setupWorktreeWithCycle(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('rejects put outside write permission', async () => {
    const ctx = { worktree: root, cycle: 'readonly-inspect' };
    const out = await plugin.tool.foundry_memory_put.execute({ type: 'class', name: 'com.A', value: 'v' }, ctx);
    assert.match(out, /write permission/);
  });

  it('allows put within write permission', async () => {
    const ctx = { worktree: root, cycle: 'observe' };
    const out = await plugin.tool.foundry_memory_put.execute({ type: 'finding', name: 'f1', value: 'noted' }, ctx);
    assert.match(out, /ok.*true/);
  });

  it('returns null for get on out-of-read-scope type', async () => {
    await plugin.tool.foundry_memory_put.execute({ type: 'finding', name: 'f2', value: 'x' }, { worktree: root, cycle: 'observe' });
    const out = await plugin.tool.foundry_memory_get.execute({ type: 'finding', name: 'f2' }, { worktree: root, cycle: 'readonly-inspect' });
    assert.equal(JSON.parse(out), null);
  });

  it('query rejects relations outside read scope', async () => {
    const out = await plugin.tool.foundry_memory_query.execute(
      { datalog: '?[n] := *ent_finding{name: n}' },
      { worktree: root, cycle: 'readonly-inspect' },
    );
    assert.match(out, /cannot query relation/);
  });

  it('unscoped direct call (no cycle) has full access', async () => {
    const out = await plugin.tool.foundry_memory_get.execute({ type: 'finding', name: 'f2' }, { worktree: root });
    assert.equal(JSON.parse(out).name, 'f2');
  });
});
