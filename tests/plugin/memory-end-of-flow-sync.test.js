import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

function setupWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'mem-end-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, '.foundry'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nA finding.\n');
  const schema = {
    version: 1,
    entities: { finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) } },
    edges: {},
    embeddings: null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput: report\nmemory:\n  write: [finding]\n---\n\nCycle body.\n`);
  return root;
}

describe('end-of-flow memory sync', () => {
  let root, plugin;
  before(async () => { root = setupWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('flushes pending NDJSON on stage end (end-of-flow trigger)', async () => {
    const ctx = { worktree: root, cycle: 'observe' };
    // Cycle-scoped put: goes into Cozo but NOT flushed to NDJSON (syncIfOutOfCycle is a no-op).
    const putOut = await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'f-flow-end', value: 'pending' }, ctx);
    assert.match(putOut, /ok.*true/);

    const ndPath = join(root, 'foundry/memory/relations/finding.ndjson');
    // Before stage end: file should either not exist, or not contain the record yet.
    const beforeContent = existsSync(ndPath) ? readFileSync(ndPath, 'utf-8') : '';
    assert.doesNotMatch(beforeContent, /f-flow-end/);

    // Simulate an open stage so foundry_stage_end proceeds.
    writeFileSync(join(root, '.foundry/active-stage.json'),
      JSON.stringify({ cycle: 'observe', stage: 'forge:observe', baseSha: 'abc123' }));

    const endOut = await plugin.tool.foundry_stage_end.execute({ summary: 'done' }, ctx);
    assert.match(endOut, /ok.*true/);

    // After stage end: sync should have flushed the record to NDJSON.
    assert.ok(existsSync(ndPath), 'finding.ndjson should exist after sync');
    const afterContent = readFileSync(ndPath, 'utf-8');
    assert.match(afterContent, /f-flow-end/);
  });
});
