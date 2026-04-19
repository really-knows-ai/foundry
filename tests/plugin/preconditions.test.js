// tests/plugin/preconditions.test.js
// Plugin-level tests verifying that guards (stage lock, key whitelists,
// confirmation flags, etc.) are wired in correctly on tool bodies.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { signToken } from '../../scripts/lib/token.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-pre-'));
  execSync('git init -q', { cwd: dir, env: GIT_ENV });
  writeFileSync(join(dir, 'WORK.md'), [
    '---', 'flow: f', 'cycle: c', '---',
    '', '# Goal', '', 'test', '',
    '## Artefacts', '',
    '| File | Type | Cycle | Status |',
    '|------|------|-------|--------|',
    '',
  ].join('\n'));
  execSync('git add . && git commit -m init -q', { cwd: dir, env: GIT_ENV });
  return dir;
}

async function beginStage(plugin, dir, stage, cycle, nonce = 'n1') {
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = plugin[Symbol.for('foundry.test.secret')];
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

  for (const toolName of ['foundry_feedback_add', 'foundry_feedback_action', 'foundry_feedback_wontfix', 'foundry_feedback_resolve']) {
    it(`${toolName} errors with no active stage`, async () => {
      const args = toolName === 'foundry_feedback_add'
        ? { file: 'x.md', tag: 'validation', text: 't' }
        : toolName === 'foundry_feedback_resolve'
        ? { file: 'x.md', index: 0, resolution: 'approved' }
        : toolName === 'foundry_feedback_wontfix'
        ? { file: 'x.md', index: 0, reason: 'r' }
        : { file: 'x.md', index: 0 };
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

  it('quench may only add tag "validation"', async () => {
    await beginStage(plugin, dir, 'quench:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'law:foo' }, makeCtx(dir),
    ));
    assert.match(res.error, /quench may only add tag/);
  });

  it('quench allows tag "validation"', async () => {
    await beginStage(plugin, dir, 'quench:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_add.execute(
      { file: 'x.md', text: 't', tag: 'validation' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
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
});

describe('feedback stage-base allow-list on action/wontfix/resolve', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  it('forge stage rejects resolve', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_resolve.execute(
      { file: 'x.md', index: 0, resolution: 'approved' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires active quench\|appraise\|human-appraise/);
  });

  it('quench stage rejects action (only forge can)', async () => {
    await beginStage(plugin, dir, 'quench:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_feedback_action.execute(
      { file: 'x.md', index: 0 }, makeCtx(dir),
    ));
    assert.match(res.error, /requires active forge/);
  });
});

// ── Artefacts tools ──

describe('foundry_artefacts_set_status preconditions', () => {
  let dir, plugin;
  beforeEach(async () => {
    dir = initRepo();
    plugin = await FoundryPlugin({ directory: dir });
    // Seed an artefact row.
    const p = join(dir, 'WORK.md');
    const t = readFileSync(p, 'utf-8').replace(
      '|------|------|-------|--------|\n',
      '|------|------|-------|--------|\n| x.md | foo | c | draft |\n',
    );
    writeFileSync(p, t);
  });

  it('rejects status "draft"', async () => {
    const res = JSON.parse(await plugin.tool.foundry_artefacts_set_status.execute(
      { file: 'x.md', status: 'draft' }, makeCtx(dir),
    ));
    assert.match(res.error, /status draft not permitted/);
  });

  it('accepts status "done" with no active stage', async () => {
    const res = JSON.parse(await plugin.tool.foundry_artefacts_set_status.execute(
      { file: 'x.md', status: 'done' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
  });

  it('rejects during active stage', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_artefacts_set_status.execute(
      { file: 'x.md', status: 'done' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires no active stage/);
  });
});

describe('foundry_artefacts_add removed', () => {
  it('is not registered as a tool', async () => {
    const dir = initRepo();
    const plugin = await FoundryPlugin({ directory: dir });
    assert.equal(plugin.tool.foundry_artefacts_add, undefined);
  });
});

// ── Workfile tools ──

describe('workfile tools preconditions', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  it('workfile_set rejects unknown key', async () => {
    const res = JSON.parse(await plugin.tool.foundry_workfile_set.execute(
      { key: 'foo', value: 'bar' }, makeCtx(dir),
    ));
    assert.match(res.error, /key must be one of cycle\|stages\|max-iterations\|models/);
  });

  it('workfile_set accepts cycle', async () => {
    const res = JSON.parse(await plugin.tool.foundry_workfile_set.execute(
      { key: 'cycle', value: 'c2' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
  });

  it('workfile_set requires no active stage', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_workfile_set.execute(
      { key: 'cycle', value: 'c2' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires no active stage/);
  });

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
    assert.match(res.error, /requires no active stage/);
  });

  it('workfile_delete succeeds with confirm:true and no active stage', async () => {
    const res = JSON.parse(await plugin.tool.foundry_workfile_delete.execute(
      { confirm: true }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(existsSync(join(dir, 'WORK.md')), false);
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
    assert.match(res.error, /requires no active stage/);
  });

  it('workfile_get succeeds during active stage (read-only)', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_workfile_get.execute({}, makeCtx(dir)));
    assert.equal(res.error, undefined);
    assert.equal(res.cycle, 'c');
  });
});

// ── History tool ──

describe('foundry_history_append preconditions', () => {
  let dir, plugin;
  beforeEach(async () => { dir = initRepo(); plugin = await FoundryPlugin({ directory: dir }); });

  it('stage=sort is always allowed (with no active stage)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_history_append.execute(
      { cycle: 'c', stage: 'sort', comment: 'routed', route: 'forge:c' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
  });

  it('stage=forge:c errors when no prior sort', async () => {
    const res = JSON.parse(await plugin.tool.foundry_history_append.execute(
      { cycle: 'c', stage: 'forge:c', comment: 'started' }, makeCtx(dir),
    ));
    assert.match(res.error, /does not match last sort route none/);
  });

  it('stage=forge:c errors when last sort routed elsewhere', async () => {
    await plugin.tool.foundry_history_append.execute(
      { cycle: 'c', stage: 'sort', comment: 'routed', route: 'quench:c' }, makeCtx(dir),
    );
    const res = JSON.parse(await plugin.tool.foundry_history_append.execute(
      { cycle: 'c', stage: 'forge:c', comment: 'wrong' }, makeCtx(dir),
    ));
    assert.match(res.error, /does not match last sort route quench:c/);
  });

  it('stage=forge:c ok when last sort routed to forge:c', async () => {
    await plugin.tool.foundry_history_append.execute(
      { cycle: 'c', stage: 'sort', comment: 'routed', route: 'forge:c' }, makeCtx(dir),
    );
    const res = JSON.parse(await plugin.tool.foundry_history_append.execute(
      { cycle: 'c', stage: 'forge:c', comment: 'starting' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
  });

  it('requires no active stage', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_history_append.execute(
      { cycle: 'c', stage: 'sort', comment: 'x' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires no active stage/);
  });
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
    assert.match(res.error, /requires no active stage/);
  });

  it('foundry_git_commit errors when stage active', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_git_commit.execute(
      { cycle: 'c', stage: 'forge:c', description: 'x' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires no active stage/);
  });

  it('foundry_git_finish errors when stage active', async () => {
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'squash' }, makeCtx(dir),
    ));
    assert.match(res.error, /requires no active stage/);
  });
});
