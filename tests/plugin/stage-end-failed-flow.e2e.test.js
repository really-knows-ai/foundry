import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { disposeStores } from '../../src/scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../src/scripts/lib/memory/schema.js';
import { _clearAllOutputs } from '../../src/plugin/tools/stage-output-tool.js';

function setupWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'failed-flow-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  // Branch guard: stage_end + foundry_memory_put need work/<x>.
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'work/stage-end-failed-test'], { cwd: root });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
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
    `---\noutput-type: report\nmemory:\n  write: [finding]\n---\n\nCycle body.\n`);
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: f\ncycle: observe\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n`);
  return root;
}

describe('stage_end: sync failure marks flow failed', () => {
  let root, plugin;
  before(async () => { root = setupWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => {
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('marks WORK.md failed when syncStore throws, keeps active stage cleared, returns flow_failed', async () => {
    const ctx = { worktree: root, cycle: 'observe', sessionID: 'test-session' };
    const putOut = await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'f1', value: 'pending' }, ctx);
    assert.equal(JSON.parse(putOut).ok, true);

    writeFileSync(join(root, '.foundry/active-stage.json'),
      JSON.stringify({ cycle: 'observe', stage: 'forge:observe', baseSha: 'abc123' }));

    // Populate buffer to satisfy forge contract (exactly 1 output)
    _clearAllOutputs();
    await plugin.tool.foundry_stage_output.execute({ data: { status: 'done' } }, ctx);

    // Deterministic write-failure injection: place a directory where syncStore
    // expects to writeFileSync the entity NDJSON. writeFileSync against a
    // directory path raises EISDIR on every platform/filesystem, unlike chmod
    // which depends on POSIX permissions and user privileges.
    mkdirSync(join(root, 'foundry-memory/relations/finding.ndjson'));

    const endOut = JSON.parse(await plugin.tool.foundry_stage_end.execute({}, ctx));
    assert.equal(endOut.flow_failed, true, `expected flow_failed:true, got ${JSON.stringify(endOut)}`);
    assert.match(endOut.error, /memory sync/i);

    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    assert.match(work, /status: failed/);
    assert.match(work, /reason: /);

    assert.equal(existsSync(join(root, '.foundry/active-stage.json')), false,
      'active stage should be cleared even on sync failure so user can abandon');

    assert.equal(existsSync(join(root, '.foundry/last-stage.json')), true);
  });
});
