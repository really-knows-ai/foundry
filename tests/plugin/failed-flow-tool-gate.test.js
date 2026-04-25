import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

function setupFailedWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'gate-'));
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
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: f\ncycle: observe\nstatus: failed\nreason: test\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n`);
  return root;
}

function expectFailedError(res, toolName) {
  const out = typeof res === 'string' ? JSON.parse(res) : res;
  assert.ok(out.error, `${toolName}: expected error, got ${JSON.stringify(out)}`);
  assert.match(out.error, /flow is in failed state/i,
    `${toolName}: error should mention failed state, got: ${out.error}`);
}

describe('failed-flow tool gate', () => {
  let root, plugin;
  before(async () => { root = setupFailedWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  const ctx = () => ({ worktree: root, cycle: 'observe' });

  it('stage_begin refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:observe', cycle: 'observe', token: 'x' }, ctx()), 'stage_begin');
  });

  it('workfile_create refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_workfile_create.execute(
      { flow: 'f', cycle: 'observe', goal: 'g' }, ctx()), 'workfile_create');
  });

  it('artefacts_set_status refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_artefacts_set_status.execute(
      { file: 'x.md', status: 'done' }, ctx()), 'artefacts_set_status');
  });

  it('feedback_add refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', tag: 'validation', text: 'y' }, ctx()), 'feedback_add');
  });

  it('feedback_resolve refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_feedback_resolve.execute(
      { file: 'x.md', index: 0, resolution: 'approved' }, ctx()), 'feedback_resolve');
  });

  it('feedback_action refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_feedback_action.execute(
      { file: 'x.md', index: 0 }, ctx()), 'feedback_action');
  });

  it('feedback_wontfix refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_feedback_wontfix.execute(
      { file: 'x.md', index: 0, reason: 'r' }, ctx()), 'feedback_wontfix');
  });

  it('assay_run refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'observe', extractors: ['e'] }, ctx()), 'assay_run');
  });

  it('orchestrate refuses under failed', async () => {
    const out = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, ctx()));
    // orchestrate tool returns {action:'violation'} shape on normal error paths,
    // but our guard returns {error} JSON directly, bypassing the orchestrate runner.
    assert.ok(out.error, `orchestrate: expected error, got ${JSON.stringify(out)}`);
    assert.match(out.error, /flow is in failed state/i);
  });

  it('memory_put refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'x', value: 'y' }, ctx()), 'memory_put');
  });

  it('memory_relate refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_memory_relate.execute(
      { from_type: 'finding', from_name: 'a', edge_type: 'e', to_type: 'finding', to_name: 'b' }, ctx()), 'memory_relate');
  });

  it('memory_unrelate refuses under failed', async () => {
    expectFailedError(await plugin.tool.foundry_memory_unrelate.execute(
      { from_type: 'finding', from_name: 'a', edge_type: 'e', to_type: 'finding', to_name: 'b' }, ctx()), 'memory_unrelate');
  });

  // Escape hatches and read-only tools MUST still work.
  it('workfile_delete still works under failed (escape hatch)', async () => {
    const root2 = setupFailedWorktree();
    const plugin2 = await FoundryPlugin({ directory: root2 });
    const out = JSON.parse(await plugin2.tool.foundry_workfile_delete.execute(
      { confirm: true }, { worktree: root2, cycle: 'observe' }));
    assert.equal(out.ok, true, `workfile_delete should succeed under failed flow: ${JSON.stringify(out)}`);
    rmSync(root2, { recursive: true, force: true });
  });

  it('workfile_get still works under failed (read-only)', async () => {
    const out = JSON.parse(await plugin.tool.foundry_workfile_get.execute({}, ctx()));
    assert.equal(out.status, 'failed');
    assert.equal(out.reason, 'test');
  });

  it('memory_list still works under failed (read-only)', async () => {
    const out = JSON.parse(await plugin.tool.foundry_memory_list.execute(
      { type: 'finding' }, ctx()));
    // memory_list returns an array (possibly empty) when successful, or {error} on failure.
    // Under failed flow it MUST NOT be gated, so success shape (array) expected.
    assert.ok(Array.isArray(out) || (out && !out.error && !String(out.error || '').match(/flow is in failed/)),
      `memory_list should not be gated by failed flow: ${JSON.stringify(out)}`);
  });
});
