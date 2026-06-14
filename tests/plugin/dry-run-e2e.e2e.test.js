// Phase 5, Task 5.11: end-to-end dry-run smoke test.
//
// Simulates the spec §15.7 dry-run workflow:
//   main → config/foo (edit a law) → dry-run/foo/flow-x-goal-x
//   (trace cycle tools, then simulate a flow run by writing artefacts)
//   → foundry_git_finish snapshots and discards.
//
// Assertions: snapshot exists with all four files, dry-run branch is gone,
// HEAD is config/foo with clean tracked tree, trace file is empty,
// snapshot is gitignored (not in `git status`).
//
// We don't drive a full orchestrate cycle here. The trace assertions use
// safe violation paths for cycle tools, then snapshot a simulated run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function git(cwd, ...args) {
  return execSync(`git ${args.join(' ')}`, { cwd, env: GIT_ENV }).toString();
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-dry-run-e2e-'));
  execSync('git init -q', { cwd: dir, env: GIT_ENV });
  execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV });

  // Minimal foundry scaffold so the foundational guards pass.
  mkdirSync(join(dir, 'foundry'), { recursive: true });
  mkdirSync(join(dir, 'foundry/laws'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'),
    '.foundry/\n.snapshots/\nfoundry-memory/\n');
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -m init -q', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function call(plugin, name, args, dir) {
  return JSON.parse(await plugin.tool[name].execute(args, makeCtx(dir)));
}

test('e2e: config branch → dry-run → finish snapshots and discards', async () => {
  const dir = initRepo();
  try {
    const plugin = await FoundryPlugin({ directory: dir });

    // 1. Create a config branch off main.
    const cfgRes = await call(plugin, 'foundry_git_branch',
      { kind: 'config', description: 'edit-law' }, dir);
    assert.equal(cfgRes.ok, true, JSON.stringify(cfgRes));
    assert.equal(cfgRes.branch, 'config/edit-law');

    // 2. Edit a law (simulate by writing the file directly + commit).
    writeFileSync(join(dir, 'foundry/laws/no-shouting.md'),
      '---\napplies-to: any\n---\n\n# No shouting\n\nDo not use exclamation marks.\n');
    execSync('git add . && git commit -m "config: add law" -q',
      { cwd: dir, env: GIT_ENV });

    // 3. Branch into dry-run mode.
    const dryRes = await call(plugin, 'foundry_git_branch',
      { kind: 'dry-run', flowId: 'flow-x', description: 'goal-x' }, dir);
    assert.equal(dryRes.ok, true, JSON.stringify(dryRes));
    assert.equal(dryRes.branch, 'dry-run/edit-law/flow-x-goal-x');

    // Confirm trace file is empty (truncated at branch creation).
    const traceFile = '.foundry/trace/dry-run-edit-law-flow-x-goal-x.jsonl';
    if (existsSync(join(dir, traceFile))) {
      assert.equal(readFileSync(join(dir, traceFile), 'utf8'), '');
    }

    // 4. Exercise cycle tool tracing without creating a run.
    const missingFlow = await call(plugin, 'foundry_cycle_run',
      { flow: 'missing-flow', goal: 'goal-x' }, dir);
    assert.equal(missingFlow.error, 'foundry_cycle_run: flow missing-flow not found');

    const missingWork = await call(plugin, 'foundry_cycle_continue', {}, dir);
    assert.equal(missingWork.action, 'violation');
    assert.match(missingWork.details, /WORK\.md not found/);

    // 5. Simulate flow output: write a WORK.md and an artefact, commit.
    writeFileSync(join(dir, 'WORK.md'),
      '---\nflow: flow-x\ngoal: goal-x\nstatus: done\n---\n\n# Work\n');
    writeFileSync(join(dir, 'output.md'), '# output\n');
    execSync('git add . && git commit -m "flow output" -q',
      { cwd: dir, env: GIT_ENV });

    // 6. Make a snapshot call so the trace file gets another record.
    // foundry_snapshot_list is read-only and works on any branch — and
    // it's wired through guarded() with the tracing factories, so it
    // emits a JSONL record on a dry-run branch.
    const listOnDry = await call(plugin, 'foundry_snapshot_list', {}, dir);
    assert.deepEqual(listOnDry, []);

    const traceAfter = readFileSync(join(dir, traceFile), 'utf8');
    assert.ok(traceAfter.length > 0,
      `expected trace records after a foundry_* call, got: ${JSON.stringify(traceAfter)}`);
    const traceLines = traceAfter.split('\n').filter(Boolean);
    assert.ok(traceLines.length >= 3);
    const firstRec = JSON.parse(traceLines[0]);
    const secondRec = JSON.parse(traceLines[1]);
    const thirdRec = JSON.parse(traceLines[2]);
    assert.equal(firstRec.tool, 'foundry_cycle_run');
    assert.equal(secondRec.tool, 'foundry_cycle_continue');
    assert.equal(thirdRec.tool, 'foundry_snapshot_list');
    assert.ok(typeof firstRec.duration_ms === 'number');

    // 7. Finish (preview, then apply).
    const preview = await call(plugin, 'foundry_git_finish',
      { message: 'tested it' }, dir);
    assert.equal(preview.ok, false);
    assert.match(preview.error, /requires \{confirm: true\}/);

    const finish = await call(plugin, 'foundry_git_finish',
      { message: 'tested the new law', confirm: true }, dir);
    assert.equal(finish.ok, true, JSON.stringify(finish));
    assert.equal(finish.branch, 'config/edit-law');
    assert.match(finish.runId,
      /^dry-run-edit-law-flow-x-goal-x-[0-9A-HJKMNP-TV-Z]{26}$/);

    // 8. Snapshot exists with all four files.
    const snap = join(dir, finish.snapshotPath);
    assert.ok(existsSync(join(snap, 'README.md')));
    assert.ok(existsSync(join(snap, 'work/WORK.md')));
    assert.ok(existsSync(join(snap, 'diff.patch')));
    assert.ok(existsSync(join(snap, 'trace.jsonl')));

    // README contains the user message and parsed metadata.
    const readme = readFileSync(join(snap, 'README.md'), 'utf8');
    assert.match(readme, /tested the new law/);
    assert.match(readme, /branch: dry-run\/edit-law\/flow-x-goal-x/);
    assert.match(readme, /parent: config\/edit-law/);
    assert.match(readme, /flow: flow-x/);
    assert.match(readme, /exitReason: done/);

    // 9. Dry-run branch is gone.
    const branches = git(dir, 'branch', '--list');
    assert.ok(!branches.includes('dry-run/edit-law/flow-x-goal-x'),
      `expected dry-run branch deleted, got: ${branches}`);

    // 10. HEAD is config/edit-law with clean tracked tree.
    const cur = git(dir, 'branch', '--show-current').trim();
    assert.equal(cur, 'config/edit-law');
    const porcelain = git(dir, 'status', '--porcelain', '--untracked-files=no').trim();
    assert.equal(porcelain, '',
      `expected clean tracked tree, got: ${porcelain}`);

    // 11. Snapshot is NOT in `git status` (gitignored via .snapshots/).
    const fullStatus = git(dir, 'status', '--porcelain').trim();
    assert.ok(!fullStatus.includes('.snapshots/'),
      `expected .snapshots/ to be ignored, got: ${fullStatus}`);

    // 12. Trace file is empty (truncated at finish).
    if (existsSync(join(dir, traceFile))) {
      assert.equal(readFileSync(join(dir, traceFile), 'utf8'), '',
        'expected trace file empty after finish');
    }

    // 13. Snapshot tools work on the parent config branch.
    const list = await call(plugin, 'foundry_snapshot_list', {}, dir);
    assert.equal(Array.isArray(list), true);
    assert.equal(list.length, 1);
    assert.equal(list[0].runId, finish.runId);
    assert.equal(list[0].branch, 'dry-run/edit-law/flow-x-goal-x');
    assert.equal(list[0].parent, 'config/edit-law');

    const show = await call(plugin, 'foundry_snapshot_show',
      { runId: finish.runId }, dir);
    assert.equal(show.runId, finish.runId);
    assert.ok(show.metadata);
    assert.ok(show.diff);
    assert.ok(show.trace);
    assert.deepEqual(show.missing, []);
  } finally {
    cleanup(dir);
  }
});

test('e2e: failure-path dry run still produces a snapshot', async () => {
  const dir = initRepo();
  try {
    const plugin = await FoundryPlugin({ directory: dir });

    await call(plugin, 'foundry_git_branch',
      { kind: 'config', description: 'fail-trial' }, dir);
    writeFileSync(join(dir, 'foundry/laws/dud.md'),
      '---\napplies-to: any\n---\n\n# Dud\n');
    execSync('git add . && git commit -m "config: dud law" -q',
      { cwd: dir, env: GIT_ENV });

    await call(plugin, 'foundry_git_branch',
      { kind: 'dry-run', flowId: 'flow-x', description: 'attempt' }, dir);

    // Simulate a flow that ended in failure.
    writeFileSync(join(dir, 'WORK.md'),
      '---\nflow: flow-x\ngoal: try\nstatus: failed\n---\n');
    execSync('git add . && git commit -m "failed flow" -q',
      { cwd: dir, env: GIT_ENV });

    const finish = await call(plugin, 'foundry_git_finish',
      { message: 'flow failed at quench', confirm: true }, dir);
    assert.equal(finish.ok, true, JSON.stringify(finish));

    const readme = readFileSync(join(dir, finish.snapshotPath, 'README.md'),
      'utf8');
    assert.match(readme, /exitReason: failed/);
    assert.match(readme, /flow failed at quench/);
  } finally {
    cleanup(dir);
  }
});
