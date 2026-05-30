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
  const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
    { stage, cycle, token }, makeCtx(dir),
  ));
  assert.equal(res.ok, true, `beginStage failed: ${res.error}`);
}

// ── Feedback tools ──

describe('feedback tools require active stage', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

function feedbackArgs(toolName) {
  const base = { id: '01HXY8K9Q5Z3WN0GJM2TYBR4AB' };
  if (toolName === 'foundry_feedback_add') {
    return { file: 'x.md', tag: 'validation', text: 't' };
  }
  if (toolName === 'foundry_feedback_resolve') {
    return { ...base, resolution: 'approved' };
  }
  if (toolName === 'foundry_feedback_wontfix') {
    return { ...base, reason: 'r' };
  }
  return base; // foundry_feedback_action
}

  for (const toolName of ['foundry_feedback_add', 'foundry_feedback_action', 'foundry_feedback_wontfix', 'foundry_feedback_resolve']) {
    it(`${toolName} errors with no active stage`, async () => {
      const args = feedbackArgs(toolName);
      const res = JSON.parse(await plugin.tool[toolName].execute(args, makeCtx(dir)));
      assert.match(res.error, /requires active/);
    });
  }

  it('foundry_feedback_list is always allowed (read-only)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_feedback_list.execute({}, makeCtx(dir)));
    assert.equal(res.error, undefined);
  });
});

describe('feedback tag allow-list per stage', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  it('forge cannot add feedback', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'validation' }, makeCtx(dir),
    ));
    assert.match(res.error, /forge stages do not add feedback/);
  });

  it('quench may only add tags starting with "law:"', async () => {
    await beginStage(plugin, dir, 'quench:c', 'c');
    // law:* tags should be accepted
    const goodRes = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'law:some-law:validator' }, makeCtx(dir),
    ));
    assert.equal(goodRes.ok, true);
    
    // non-law tags should be rejected
    const badRes = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'validation' }, makeCtx(dir),
    ));
    assert.match(badRes.error, /quench.*law:/i);
  });

  it('quench rejects non-law tags', async () => {
    await beginStage(plugin, dir, 'quench:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'random' }, makeCtx(dir),
    ));
    assert.match(res.error, /quench.*law:/i);
  });

  it('appraise requires tag starting with "law:"', async () => {
    await beginStage(plugin, dir, 'appraise:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'validation' }, makeCtx(dir),
    ));
    assert.match(res.error, /must start with "law:"/);
  });

  it('human-appraise requires tag "human"', async () => {
    await beginStage(plugin, dir, 'human-appraise:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'law:foo' }, makeCtx(dir),
    ));
    assert.match(res.error, /may only add tag "human"/);
  });

  it('assay cannot add feedback (assay no longer produces feedback)', async () => {
    await beginStage(plugin, dir, 'assay:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'validation' }, makeCtx(dir),
    ));
    assert.match(res.error, /assay/);
    assert.match(res.error, /do not add feedback|cannot add feedback|not permitted/i);
  });
});

describe('feedback stage-base allow-list on action/wontfix/resolve', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  it('forge stage rejects resolve', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_resolve.execute(
      { id: '01HXY8K9Q5Z3WN0GJM2TYBR4AB', resolution: 'approved' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires active quench\|appraise\|human-appraise/);
  });

  it('quench stage rejects action (only forge can)', async () => {
    await beginStage(plugin, dir, 'quench:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_action.execute(
      { id: '01HXY8K9Q5Z3WN0GJM2TYBR4AB' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires active forge/);
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

describe('foundry_artefacts_list', () => {
  let dir, plugin;
  beforeEach(async () => {
    dir = initRepo();
    plugin = await FoundryPlugin({ directory: dir });
  });

  it('returns artefact file changes when on a work branch', async () => {
    // With no git changes detected, the tool returns an empty list
    const res = JSON.parse(await plugin.tool.foundry_artefacts_list.execute({}, makeCtx(dir)));
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
