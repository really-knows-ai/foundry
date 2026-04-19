// tests/plugin/stage-tools.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { signToken } from '../../scripts/lib/token.js';

function makeCtx(worktree) { return { worktree }; }

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function initRepo(dir) {
  execSync('git init -q', { cwd: dir, env: GIT_ENV });
  execSync('git commit --allow-empty -m init -q', { cwd: dir, env: GIT_ENV });
}

describe('foundry_stage_begin', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-stagebegin-'));
    initRepo(dir);
  });

  it('accepts a valid token and writes active-stage.json', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = plugin[Symbol.for('foundry.test.secret')];
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() + 60_000 };
    pending.add('n1', payload);
    const token = signToken(payload, secret);

    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c', token },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.ok(existsSync(join(dir, '.foundry/active-stage.json')));
    const state = JSON.parse(readFileSync(join(dir, '.foundry/active-stage.json'), 'utf-8'));
    assert.equal(state.cycle, 'c');
    assert.equal(state.stage, 'forge:c');
    assert.equal(state.tokenHash.length, 64);
  });

  it('rejects an expired token', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = plugin[Symbol.for('foundry.test.secret')];
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n2', exp: Date.now() - 1 };
    pending.add('n2', payload);
    const token = signToken(payload, secret);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c', token }, makeCtx(dir),
    ));
    assert.match(res.error, /expired/);
    assert.equal(existsSync(join(dir, '.foundry/active-stage.json')), false);
  });

  it('rejects a reused nonce', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = plugin[Symbol.for('foundry.test.secret')];
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n3', exp: Date.now() + 60_000 };
    pending.add('n3', payload);
    const token = signToken(payload, secret);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token }, makeCtx(dir));
    // Clear active-stage to bypass "no active stage" precondition the second time.
    rmSync(join(dir, '.foundry/active-stage.json'));
    const res2 = JSON.parse(await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token }, makeCtx(dir)));
    assert.match(res2.error, /nonce/);
  });

  it('rejects when stage arg mismatches token payload', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = plugin[Symbol.for('foundry.test.secret')];
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n4', exp: Date.now() + 60_000 };
    pending.add('n4', payload);
    const token = signToken(payload, secret);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'quench:c', cycle: 'c', token }, makeCtx(dir),
    ));
    assert.match(res.error, /token.*mismatch/);
  });

  it('rejects when active stage already present', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = plugin[Symbol.for('foundry.test.secret')];
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n5', exp: Date.now() + 60_000 };
    pending.add('n5', payload);
    const token = signToken(payload, secret);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token }, makeCtx(dir));
    // Add another pending nonce and try again without clearing active-stage.
    const p2 = { route: 'forge:c', cycle: 'c', nonce: 'n6', exp: Date.now() + 60_000 };
    pending.add('n6', p2);
    const token2 = signToken(p2, secret);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token: token2 }, makeCtx(dir)));
    assert.match(res.error, /stage already active|no active stage/);
  });
});
