import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { disposeStores } from '../../src/scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../src/scripts/lib/memory/schema.js';
import { _clearAllOutputs } from '../../src/plugin/tools/stage-output-tool.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'e2e-failed-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  // Branch guard: memory_put + stage_end + workfile_delete are flow-tier.
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'work/failed-e2e-test'], { cwd: root });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, '.foundry'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nA finding.\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1,
    entities: { finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) } },
    edges: {}, embeddings: null,
  }, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput-type: report\nmemory:\n  write: [finding]\n---\n\nCycle body.\n`);
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: f\ncycle: observe\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n`);
  return root;
}

describe('failed-flow e2e', () => {
  let root, plugin;
  before(async () => { root = setup(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => {
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('memory put → stage_end sync fails → flow failed → next tool refuses → delete escapes', async () => {
    const ctx = { worktree: root, cycle: 'observe', sessionID: 'test-session' };

    const p = JSON.parse(await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'f1', value: 'v1' }, ctx));
    assert.equal(p.ok, true);

    writeFileSync(join(root, '.foundry/active-stage.json'),
      JSON.stringify({ cycle: 'observe', stage: 'forge:observe', baseSha: 'abc' }));

    // Deterministic write-failure injection: directory at the NDJSON path
    // forces EISDIR from writeFileSync inside syncStore. Platform-agnostic
    // and matches the convention used by the assay-tools failure test.
    // Populate buffer to satisfy forge contract (exactly 1 output)
    _clearAllOutputs();
    await plugin.tool.foundry_stage_output.execute({ data: { status: 'done' } }, ctx);

    const poisonPath = join(root, 'foundry-memory/relations/finding.ndjson');
    mkdirSync(poisonPath);

    const end = JSON.parse(await plugin.tool.foundry_stage_end.execute({}, ctx));
    assert.equal(end.flow_failed, true);
    assert.match(readFileSync(join(root, 'WORK.md'), 'utf-8'), /status: failed/);

    const m = JSON.parse(await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'f2', value: 'v2' }, ctx));
    assert.match(m.error, /flow is in failed state/i);

    rmSync(poisonPath, { recursive: true });

    const d = JSON.parse(await plugin.tool.foundry_workfile_delete.execute({ confirm: true }, ctx));
    assert.equal(d.ok, true);
    assert.equal(existsSync(join(root, 'WORK.md')), false);
  });
});
