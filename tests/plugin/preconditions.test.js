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

describe('foundry_artefacts_list cycle filter', () => {
  let dir, plugin;
  beforeEach(async () => {
    dir = initRepo();
    plugin = await FoundryPlugin({ directory: dir });
    const p = join(dir, 'WORK.md');
    const t = readFileSync(p, 'utf-8').replace(
      '|------|------|-------|--------|\n',
      '|------|------|-------|--------|\n' +
      '| stale.md | foo | old-cycle | done |\n' +
      '| fresh.md | foo | c | draft |\n' +
      '| also-fresh.md | bar | c | done |\n',
    );
    writeFileSync(p, t);
  });

  it('returns all rows when no cycle arg', async () => {
    const res = JSON.parse(await plugin.tool.foundry_artefacts_list.execute({}, makeCtx(dir)));
    assert.equal(res.length, 3);
  });

  it('filters to matching cycle when cycle arg given', async () => {
    const res = JSON.parse(await plugin.tool.foundry_artefacts_list.execute({ cycle: 'c' }, makeCtx(dir)));
    assert.equal(res.length, 2);
    assert.ok(res.every(r => r.cycle === 'c'));
    assert.ok(res.find(r => r.file === 'fresh.md'));
    assert.ok(res.find(r => r.file === 'also-fresh.md'));
    assert.ok(!res.find(r => r.file === 'stale.md'));
  });

  it('returns empty array when no rows match cycle', async () => {
    const res = JSON.parse(await plugin.tool.foundry_artefacts_list.execute({ cycle: 'nope' }, makeCtx(dir)));
    assert.deepEqual(res, []);
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

describe('foundry_workfile_configure_from_cycle', () => {
  let dir, plugin;
  beforeEach(async () => {
    dir = initRepo();
    plugin = await FoundryPlugin({ directory: dir });
    execSync(`mkdir -p ${dir}/foundry/cycles`, { env: GIT_ENV });
  });

  function writeCycleDef(cycleId, frontmatter) {
    const lines = ['---'];
    for (const [k, v] of Object.entries(frontmatter)) {
      if (typeof v === 'object') {
        lines.push(`${k}:`);
        for (const [k2, v2] of Object.entries(v)) lines.push(`  ${k2}: ${v2}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
    lines.push('---', 'body', '');
    writeFileSync(join(dir, 'foundry/cycles', `${cycleId}.md`), lines.join('\n'));
  }

  it('applies defaults when cycle def omits fields', async () => {
    writeCycleDef('c', { output: 'haiku' });
    const res = JSON.parse(await plugin.tool.foundry_workfile_configure_from_cycle.execute(
      { cycleId: 'c', stages: ['forge', 'appraise'] }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(res.applied['max-iterations'], 3);
    assert.equal(res.applied['human-appraise'], false);
    assert.equal(res.applied['deadlock-appraise'], true);
    assert.equal(res.applied['deadlock-iterations'], 5);
    assert.deepEqual(res.applied.stages, ['forge:c', 'appraise:c']);
    assert.equal(res.applied.models, undefined);

    const text = readFileSync(join(dir, 'WORK.md'), 'utf-8');
    assert.match(text, /cycle: c/);
    assert.match(text, /max-iterations: 3/);
    assert.match(text, /human-appraise: false/);
    assert.match(text, /deadlock-appraise: true/);
    assert.match(text, /deadlock-iterations: 5/);
  });

  it('copies values from cycle def when present', async () => {
    writeCycleDef('c', {
      output: 'haiku',
      'max-iterations': 7,
      'human-appraise': true,
      'deadlock-appraise': false,
      'deadlock-iterations': 2,
    });
    const res = JSON.parse(await plugin.tool.foundry_workfile_configure_from_cycle.execute(
      { cycleId: 'c', stages: ['forge:c', 'quench:c', 'appraise:c', 'human-appraise:c'] }, makeCtx(dir),
    ));
    assert.equal(res.applied['max-iterations'], 7);
    assert.equal(res.applied['human-appraise'], true);
    assert.equal(res.applied['deadlock-appraise'], false);
    assert.equal(res.applied['deadlock-iterations'], 2);
  });

  it('writes models map when cycle def has one', async () => {
    writeCycleDef('c', { output: 'haiku', models: { forge: 'openai/gpt-4o' } });
    const res = JSON.parse(await plugin.tool.foundry_workfile_configure_from_cycle.execute(
      { cycleId: 'c', stages: ['forge'] }, makeCtx(dir),
    ));
    assert.deepEqual(res.applied.models, { forge: 'openai/gpt-4o' });
    const text = readFileSync(join(dir, 'WORK.md'), 'utf-8');
    assert.match(text, /models:/);
    assert.match(text, /forge: openai\/gpt-4o/);
  });

  it('enriches bare stage names with cycle alias', async () => {
    writeCycleDef('c', { output: 'haiku' });
    const res = JSON.parse(await plugin.tool.foundry_workfile_configure_from_cycle.execute(
      { cycleId: 'c', stages: ['forge', 'quench:custom-alias', 'appraise'] }, makeCtx(dir),
    ));
    assert.deepEqual(res.applied.stages, ['forge:c', 'quench:custom-alias', 'appraise:c']);
  });

  it('errors when WORK.md missing', async () => {
    writeCycleDef('c', { output: 'haiku' });
    rmSync(join(dir, 'WORK.md'));
    const res = JSON.parse(await plugin.tool.foundry_workfile_configure_from_cycle.execute(
      { cycleId: 'c', stages: ['forge'] }, makeCtx(dir),
    ));
    assert.match(res.error, /WORK.md not found/);
  });

  it('errors when cycle def missing', async () => {
    const res = JSON.parse(await plugin.tool.foundry_workfile_configure_from_cycle.execute(
      { cycleId: 'nope', stages: ['forge'] }, makeCtx(dir),
    ));
    assert.match(res.error, /Cycle not found/);
  });

  it('requires no active stage', async () => {
    writeCycleDef('c', { output: 'haiku' });
    await beginStage(plugin, dir, 'forge:c', 'c');
    const res = JSON.parse(await plugin.tool.foundry_workfile_configure_from_cycle.execute(
      { cycleId: 'c', stages: ['forge'] }, makeCtx(dir),
    ));
    assert.match(res.error, /requires no active stage/);
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
