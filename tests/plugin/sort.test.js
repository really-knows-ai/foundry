// tests/plugin/sort.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

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

function writeWork(dir, body) {
  writeFileSync(join(dir, 'WORK.md'), body);
}

const FRESH_WORK = [
  '---',
  'cycle: c1',
  'stages:',
  '  - forge:write',
  '  - quench:review',
  '---',
  '',
  '## Artefacts',
  '| File | Type | Status |',
  '| ---- | ---- | ------ |',
  '',
].join('\n');

const DONE_WORK_HISTORY = '- { cycle: c1, stage: forge:write, iteration: 1, comment: x }\n';
const DONE_WORK = [
  '---',
  'cycle: c1',
  'stages:',
  '  - forge:write',
  '---',
  '',
  '## Artefacts',
  '| File | Type | Status |',
  '| ---- | ---- | ------ |',
  '',
].join('\n');

describe('foundry_sort plugin tool', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-sort-'));
    initRepo(dir);
  });

  it('returns a token for a dispatchable route and registers it in pending', async () => {
    writeWork(dir, FRESH_WORK);
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const before = pending.size();

    const res = JSON.parse(await plugin.tool.foundry_sort.execute({}, makeCtx(dir)));
    assert.equal(res.route, 'forge:write');
    assert.equal(typeof res.token, 'string');
    assert.ok(res.token.length > 0);
    assert.equal(pending.size(), before + 1);
  });

  it('token minted by sort is accepted by stage_begin end-to-end', async () => {
    writeWork(dir, FRESH_WORK);
    const plugin = await FoundryPlugin({ directory: dir });

    const sortRes = JSON.parse(await plugin.tool.foundry_sort.execute({}, makeCtx(dir)));
    assert.equal(sortRes.route, 'forge:write');

    const beginRes = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:write', cycle: 'c1', token: sortRes.token },
      makeCtx(dir),
    ));
    assert.equal(beginRes.ok, true);
    assert.ok(existsSync(join(dir, '.foundry/active-stage.json')));
  });

  it('returns no token for route=done', async () => {
    writeWork(dir, DONE_WORK);
    writeFileSync(join(dir, 'WORK.history.yaml'), DONE_WORK_HISTORY);
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const before = pending.size();

    const res = JSON.parse(await plugin.tool.foundry_sort.execute({}, makeCtx(dir)));
    assert.equal(res.route, 'done');
    assert.equal(res.token, undefined);
    assert.equal(pending.size(), before);
  });

  it('rejects sort when an active stage exists', async () => {
    writeWork(dir, FRESH_WORK);
    mkdirSync(join(dir, '.foundry'), { recursive: true });
    writeFileSync(
      join(dir, '.foundry/active-stage.json'),
      JSON.stringify({ cycle: 'c1', stage: 'forge:write', tokenHash: 'x', startedAt: new Date().toISOString() }),
    );
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_sort.execute({}, makeCtx(dir)));
    assert.ok(res.error);
    assert.match(res.error, /stage already active|no active stage/);
  });
});
