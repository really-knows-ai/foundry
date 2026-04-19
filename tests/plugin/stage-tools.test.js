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

describe('foundry_stage_end', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-stageend-'));
    initRepo(dir);
  });

  async function beginStage(plugin, nonce = 'na') {
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = plugin[Symbol.for('foundry.test.secret')];
    const payload = { route: 'forge:c', cycle: 'c', nonce, exp: Date.now() + 60_000 };
    pending.add(nonce, payload);
    const token = signToken(payload, secret);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token }, makeCtx(dir));
  }

  it('clears active-stage and writes last-stage', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginStage(plugin);
    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute({ summary: 'done' }, makeCtx(dir)));
    assert.equal(res.ok, true);
    assert.equal(res.summary, 'done');
    assert.equal(existsSync(join(dir, '.foundry/active-stage.json')), false);
    assert.ok(existsSync(join(dir, '.foundry/last-stage.json')));
    const last = JSON.parse(readFileSync(join(dir, '.foundry/last-stage.json'), 'utf-8'));
    assert.equal(last.cycle, 'c');
    assert.equal(last.stage, 'forge:c');
    assert.ok(last.baseSha);
    assert.equal(last.summary, 'done');
  });

  it('errors when no active stage', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute({ summary: 'x' }, makeCtx(dir)));
    assert.match(res.error, /requires active stage/);
  });
});

describe('foundry_stage_finalize', () => {
  let dir;

  function seedFoundryConfig(d) {
    execSync(`mkdir -p ${d}/foundry/cycles ${d}/foundry/artefacts/haiku`);
    writeFileSync(join(d, 'foundry/cycles/c.md'), '---\noutput: haiku\n---\nCycle c.');
    writeFileSync(join(d, 'foundry/artefacts/haiku/definition.md'), '---\nfile-patterns:\n  - "haikus/*.md"\n---\nHaiku.');
  }

  async function beginEndStage(plugin, d, nonce = 'n') {
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = plugin[Symbol.for('foundry.test.secret')];
    const payload = { route: 'forge:c', cycle: 'c', nonce, exp: Date.now() + 60_000 };
    pending.add(nonce, payload);
    const token = signToken(payload, secret);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c', token }, makeCtx(d));
    return { pending, secret };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-stagefin-'));
    initRepo(dir);
    // Commit foundry config so baseSha includes it (clean diff at stage_begin).
    seedFoundryConfig(dir);
    // Seed an empty WORK.md with artefacts table so addArtefactRow has something to append to.
    writeFileSync(join(dir, 'WORK.md'), [
      '---',
      'flow: f',
      'cycle: c',
      '---',
      '',
      '# Goal',
      '',
      'test',
      '',
      '## Artefacts',
      '',
      '| File | Type | Status | Cycle |',
      '|------|------|--------|-------|',
      '',
    ].join('\n'));
    execSync('git add .', { cwd: dir, env: GIT_ENV });
    execSync('git commit -m seed -q', { cwd: dir, env: GIT_ENV });
  });

  it('happy path: forge stage, matching file, registers artefact row', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginEndStage(plugin, dir);
    execSync(`mkdir -p ${dir}/haikus`);
    writeFileSync(join(dir, 'haikus/one.md'), 'a\nb\nc\n');
    await plugin.tool.foundry_stage_end.execute({ summary: 'done' }, makeCtx(dir));

    const res = JSON.parse(await plugin.tool.foundry_stage_finalize.execute({ cycle: 'c' }, makeCtx(dir)));
    assert.equal(res.ok, true);
    assert.deepEqual(res.artefacts, [{ file: 'haikus/one.md', type: 'haiku', status: 'draft' }]);
    const work = readFileSync(join(dir, 'WORK.md'), 'utf-8');
    assert.match(work, /haikus\/one\.md/);
    assert.match(work, /\| haiku \|/);
  });

  it('rejects unexpected files and returns files list', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginEndStage(plugin, dir);
    writeFileSync(join(dir, 'stray.txt'), 'x');
    await plugin.tool.foundry_stage_end.execute({ summary: 'x' }, makeCtx(dir));

    const res = JSON.parse(await plugin.tool.foundry_stage_finalize.execute({ cycle: 'c' }, makeCtx(dir)));
    assert.equal(res.ok, false);
    assert.equal(res.error, 'unexpected_files');
    assert.deepEqual(res.files, ['stray.txt']);
  });

  it('requires no active stage', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginEndStage(plugin, dir);
    // Do NOT call stage_end — active-stage.json still present.
    const res = JSON.parse(await plugin.tool.foundry_stage_finalize.execute({ cycle: 'c' }, makeCtx(dir)));
    assert.match(res.error, /no active stage/);
  });

  it('errors when no last-stage recorded', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_stage_finalize.execute({ cycle: 'c' }, makeCtx(dir)));
    assert.match(res.error, /no last stage/);
  });

  it('errors on cycle mismatch', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginEndStage(plugin, dir);
    await plugin.tool.foundry_stage_end.execute({ summary: 'x' }, makeCtx(dir));
    const res = JSON.parse(await plugin.tool.foundry_stage_finalize.execute({ cycle: 'other' }, makeCtx(dir)));
    assert.match(res.error, /cycle mismatch/);
  });
});
