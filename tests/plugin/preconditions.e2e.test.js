// tests/plugin/preconditions.test.js
// Plugin-level tests verifying that guards (stage lock, key whitelists,
// confirmation flags, etc.) are wired in correctly on tool bodies.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { signToken } from '../../src/scripts/lib/token.js';
import { readOrCreateSecret } from '../../src/scripts/lib/secret.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-pre-'));
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  writeFileSync(join(dir, 'WORK.md'), [
    '---', 'flow: f', 'cycle: c', '---',
    '', '# Goal', '', 'test', '',
  ].join('\n'));
  execSync('git add . && git commit -m init -q', { cwd: dir, env: GIT_ENV });
  // Branch guard: feedback/stage/artefact mutations require work/<x>.
  execSync('git checkout -q -b work/preconditions-test', { cwd: dir, env: GIT_ENV });
  return dir;
}

async function beginStage(plugin, dir, stage, cycle, nonce = 'n1') {
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = readOrCreateSecret(dir);
  const payload = { route: stage, cycle, nonce, exp: Date.now() + 60_000 };
  pending.add(nonce, payload);
  const token = signToken(payload, secret);
  writeFileSync(join(dir, '.foundry/dispatch-token'), token);
  const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
    { stage, cycle }, makeCtx(dir),
  ));
  assert.equal(res.ok, true, `beginStage failed: ${res.error}`);
}

// ── Feedback tools ──

describe('foundry_feedback_list', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  it('is always allowed without active stage (read-only)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_feedback_list.execute({}, makeCtx(dir)));
    assert.equal(res.error, undefined);
  });

  it('returns an array of items', async () => {
    const res = JSON.parse(await plugin.tool.foundry_feedback_list.execute({}, makeCtx(dir)));
    assert.ok(Array.isArray(res));
  });
});

// ── Artefacts tools ──



describe('foundry_artefacts_add removed', () => {
  it('is not registered as a tool', async () => {
    const dir = initRepo();
    const plugin = await FoundryPlugin({ directory: dir });
    assert.equal(plugin.tool.foundry_artefacts_add, undefined);
  });
});

describe('foundry_artefact_list', () => {
  let dir, plugin;
  beforeEach(async () => {
    dir = initRepo();
    plugin = await FoundryPlugin({ directory: dir });
  });

  it('returns artefact file changes when on a work branch', async () => {
    // With no git changes detected, the tool returns an empty list
    const res = JSON.parse(await plugin.tool.foundry_artefact_list.execute({}, makeCtx(dir)));
    // New implementation uses branch discovery; with no changes, returns []
    assert.ok(Array.isArray(res), 'result should be an array');
  });
});

// ── Workfile tools ──

describe('workfile tools preconditions', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  it('workfile_delete requires {confirm:true}', async () => {
    const res = JSON.parse(await plugin.tool.foundry_workfile_delete.execute(
      { confirm: false }, makeCtx(dir),
    ));
    assert.match(res.error, /requires \{confirm: true\}/);
  });

  it('workfile_delete requires no active stage', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_workfile_delete.execute(
      { confirm: true }, makeCtx(dir),
    ));
    assert.match(res.error, /is already active/);
  });

  it('workfile_delete succeeds with confirm:true and no active stage', async () => {
    const res = JSON.parse(await plugin.tool.foundry_workfile_delete.execute(
      { confirm: true }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(existsSync(join(dir, 'WORK.md')), false);
  });

  it('workfile_delete removes WORK.feedback.yaml when present', async () => {
    writeFileSync(join(dir, 'WORK.history.yaml'), '[]\n');
    writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []\n');

    const res = JSON.parse(await plugin.tool.foundry_workfile_delete.execute(
      { confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true);
    assert.equal(existsSync(join(dir, 'WORK.feedback.yaml')), false);
  });

  it('workfile_create errors when WORK.md exists', async () => {
    const res = JSON.parse(await plugin.tool.foundry_workfile_create.execute(
      { flow: 'f', cycle: 'c', goal: 'g' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires no WORK.md; current: exists/);
  });

  it('workfile_create requires no active stage', async () => {
    // Delete WORK.md so the "exists" check doesn't short-circuit first — but
    // we have to delete via the tool (which itself has the guard), so instead
    // begin stage THEN assert workfile_create is blocked.
    // Remove WORK.md directly from disk bypassing the tool.
    rmSync(join(dir, 'WORK.md'));
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_workfile_create.execute(
      { flow: 'f', cycle: 'c', goal: 'g' }, makeCtx(dir),
    ));
    assert.match(res.error, /is already active/);
  });

  it('workfile_get succeeds during active stage (read-only)', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_workfile_get.execute({}, makeCtx(dir)));
    assert.equal(res.error, undefined);
    assert.equal(res.cycle, 'c');
  });
});

describe('foundry_workfile_configure_from_cycle', () => {
  // Tool deregistered in v2.3 (absorbed by foundry_orchestrate); tests removed.
});

// ── History tool ──

describe('foundry_history_append preconditions', () => {
  // Tool deregistered in v2.3 (absorbed by foundry_orchestrate); tests removed.
});

// ── Git tools ──

describe('git tools require no active stage', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  it('foundry_git_branch errors when stage active', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_git_branch.execute(
      { flowId: 'f', description: 'x' }, makeCtx(dir),
    ));
    assert.match(res.error, /is already active/);
  });

  it('foundry_git_finish errors when stage active', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'squash' }, makeCtx(dir),
    ));
    assert.match(res.error, /is already active/);
  });
});
