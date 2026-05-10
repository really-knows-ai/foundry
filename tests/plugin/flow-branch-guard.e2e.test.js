// tests/plugin/flow-branch-guard.test.js
//
// Phase 4 task 4.9: every flow-tier mutation MCP tool must refuse on
// `main`, `config/<x>`, or any other non-flow branch — accepting only
// `work/<x>` and `dry-run/<x>/<y>`. Read-only flow-tier tools and
// config-tier tools are out of scope here (covered by their own suites).
//
// This file co-locates a single sweep across every affected tool to
// keep the assertion structure uniform; per-tool happy-paths live in
// their existing tests/plugin/<tool>.test.js fixtures, which the same
// PR moved onto work/<x> branches.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { disposeStores } from '../../src/scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../src/scripts/lib/memory/schema.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

// Build a worktree on `main` with enough on-disk fixtures that each tool
// reaches its branch-guard check (the guard runs before any tool-body
// IO, so even malformed args are fine). The body is irrelevant — we
// only assert the structured branch-guard error fires.
function setupWorktreeOnMain() {
  const root = mkdtempSync(join(tmpdir(), 'flow-branch-guard-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: root, env: GIT_ENV });
  // Minimal foundry tree so plugin boot succeeds.
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, 'foundry/artefacts/code'), { recursive: true });
  mkdirSync(join(root, '.foundry'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nA finding.\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1,
    entities: { finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) } },
    edges: {},
    embeddings: null,
  }, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput-type: report\n---\n\nCycle body.\n`);
  writeFileSync(join(root, 'foundry/artefacts/code/definition.md'),
    '---\nname: Code\n---\nCode artefact.\n');
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: f\ncycle: observe\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n`);
  return root;
}

// Each entry: [toolName, args, optionalCustomMatcher]. Defaults to
// matching /requires a work\//.
const FLOW_TIER_MUTATION_CASES = [
  // workfile-tools.js
  ['foundry_workfile_create', { flow: 'f', cycle: 'observe', goal: 'g' }],
  ['foundry_workfile_delete', { confirm: true }],
  // feedback-tools.js
  ['foundry_feedback_add', { file: 'x.md', text: 'y', tag: 'validation' }],
  ['foundry_feedback_action', { id: '01HXY8K9Q5Z3WN0GJM2TYBR4AB' }],
  ['foundry_feedback_wontfix', { id: '01HXY8K9Q5Z3WN0GJM2TYBR4AB', reason: 'r' }],
  ['foundry_feedback_resolve', { id: '01HXY8K9Q5Z3WN0GJM2TYBR4AB', resolution: 'approved' }],
  // assay-tools.js
  ['foundry_assay_run', { cycle: 'observe', extractors: ['e'] }],
  // validate-tools.js
  ['foundry_validate_run', { typeId: 'code', file: 'x.md' }],
  // appraiser-tools.js
  ['foundry_appraisers_select', { typeId: 'code' }],
  // stage-tools.js
  ['foundry_stage_begin', { stage: 'forge:observe', cycle: 'observe', token: 'x' }],
  ['foundry_stage_end', { summary: 'done' }],
  // artefact-tools.js
  ['foundry_artefacts_set_status', { file: 'x.md', status: 'done' }],
  // memory-tools.js
  ['foundry_memory_put', { type: 'finding', name: 'x', value: 'v' }],
  ['foundry_memory_relate', {
    from_type: 'finding', from_name: 'a',
    edge_type: 'e',
    to_type: 'finding', to_name: 'b',
  }],
  ['foundry_memory_unrelate', {
    from_type: 'finding', from_name: 'a',
    edge_type: 'e',
    to_type: 'finding', to_name: 'b',
  }],
];

describe('flow-tier mutation tools: branch guard refuses on main', () => {
  let root, plugin;
  before(async () => { root = setupWorktreeOnMain(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  for (const [toolName, args] of FLOW_TIER_MUTATION_CASES) {
    it(`${toolName}: refuses on main with /requires a work\\//`, async () => {
      const out = JSON.parse(await plugin.tool[toolName].execute(args, { worktree: root, cycle: 'observe' }));
      assert.ok(out.error, `${toolName}: expected error, got ${JSON.stringify(out)}`);
      assert.match(out.error, /requires a work\//,
        `${toolName}: expected branch-guard error, got: ${out.error}`);
    });
  }

  // foundry_orchestrate has its own envelope shape (action: violation /
  // {error}); handle separately. The branch guard fires inline before
  // the failed-flow guard, returning a plain {error} envelope per the
  // tool's documented contract.
  it('foundry_orchestrate: refuses on main with /requires a work\\//', async () => {
    const out = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, { worktree: root, cycle: 'observe' }));
    assert.ok(out.error, `orchestrate: expected error, got ${JSON.stringify(out)}`);
    assert.match(out.error, /requires a work\//);
  });
});

describe('flow-tier mutation tools: branch guard also refuses on config branch', () => {
  let root, plugin;
  before(async () => {
    root = setupWorktreeOnMain();
    execFileSync('git', ['checkout', '-q', '-b', 'config/probe'], { cwd: root, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: root });
  });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  // Spot-check: one tool per file is enough; the previous suite already
  // proves the wiring fires across every tool.
  const SPOT_CHECKS = [
    ['foundry_workfile_create', { flow: 'f', cycle: 'observe', goal: 'g' }],
    ['foundry_memory_put', { type: 'finding', name: 'x', value: 'v' }],
    ['foundry_assay_run', { cycle: 'observe', extractors: ['e'] }],
    ['foundry_appraisers_select', { typeId: 'code' }],
  ];

  for (const [toolName, args] of SPOT_CHECKS) {
    it(`${toolName}: refuses on config/<x>`, async () => {
      const out = JSON.parse(await plugin.tool[toolName].execute(args, { worktree: root, cycle: 'observe' }));
      assert.ok(out.error, `${toolName}: expected error, got ${JSON.stringify(out)}`);
      assert.match(out.error, /requires a work\//,
        `${toolName}: expected branch-guard error, got: ${out.error}`);
    });
  }
});

describe('flow-tier mutation tools: branch guard accepts dry-run/<x>/<y>', () => {
  let root, plugin;
  before(async () => {
    root = setupWorktreeOnMain();
    execFileSync('git', ['checkout', '-q', '-b', 'dry-run/observe/probe'], { cwd: root, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: root });
  });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('foundry_appraisers_select: branch guard passes (no /requires a work\\// error)', async () => {
    // The tool body may still error for unrelated reasons (e.g. no
    // appraisers configured), but the branch-guard error must not fire.
    const out = JSON.parse(await plugin.tool.foundry_appraisers_select.execute(
      { typeId: 'code' }, { worktree: root }));
    if (out.error) {
      assert.doesNotMatch(out.error, /requires a work\//,
        `branch guard should pass on dry-run/<x>/<y>; got: ${out.error}`);
    }
  });
});
