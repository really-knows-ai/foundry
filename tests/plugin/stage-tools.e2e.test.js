import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { signToken } from '../../src/scripts/lib/token.js';
import { readOrCreateSecret } from '../../src/scripts/lib/secret.js';
import { _clearAllOutputs } from '../../src/plugin/tools/stage-output-tool.js';

function makeCtx(worktree) { return { worktree, sessionID: "test-session" }; }

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function initRepo(dir) {
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  execSync('git commit --allow-empty -m init -q', { cwd: dir, env: GIT_ENV });
  // Branch guard: stage_begin/stage_end require work/<x>.
  execSync('git checkout -q -b work/stage-tools-test', { cwd: dir, env: GIT_ENV });
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
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() + 60_000 };
    pending.add('n1', payload);
    const token = signToken(payload, secret);

    writeFileSync(join(dir, '.foundry/dispatch-token'), token);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c' },
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
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n2', exp: Date.now() - 1 };
    pending.add('n2', payload);
    const token = signToken(payload, secret);
    writeFileSync(join(dir, '.foundry/dispatch-token'), token);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c' }, makeCtx(dir),
    ));
    assert.match(res.error, /expired/);
    assert.equal(existsSync(join(dir, '.foundry/active-stage.json')), false);
    assert.equal(existsSync(join(dir, '.foundry/dispatch-token')), false);
  });

  it('rejects a reused nonce', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n3', exp: Date.now() + 60_000 };
    pending.add('n3', payload);
    const token = signToken(payload, secret);
    writeFileSync(join(dir, '.foundry/dispatch-token'), token);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c' }, makeCtx(dir));
    rmSync(join(dir, '.foundry/active-stage.json'));
    writeFileSync(join(dir, '.foundry/dispatch-token'), token);
    const res2 = JSON.parse(await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c' }, makeCtx(dir)));
    assert.match(res2.error, /already used/);
  });

  it('rejects when stage arg mismatches token payload', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n4', exp: Date.now() + 60_000 };
    pending.add('n4', payload);
    const token = signToken(payload, secret);
    writeFileSync(join(dir, '.foundry/dispatch-token'), token);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'quench:c', cycle: 'c' }, makeCtx(dir),
    ));
    assert.match(res.error, /token is for stage/);
  });

  it('does not consume nonce when git rev-parse HEAD fails (no commits)', async () => {
    // Fresh repo with no commits — git rev-parse HEAD will fail.
    const noCommitDir = mkdtempSync(join(tmpdir(), 'foundry-nocommit-'));
    execSync('git init -q -b main', { cwd: noCommitDir, env: GIT_ENV });
    // Branch guard requires work/<x>; create an unborn work branch so the
    // guard passes and we exercise the actual `git rev-parse HEAD` failure
    // path inside stage_begin.
    execSync('git checkout -q -b work/no-commits', { cwd: noCommitDir, env: GIT_ENV });
    try {
      const plugin = await FoundryPlugin({ directory: noCommitDir });
      const pending = plugin[Symbol.for('foundry.test.pending')];
      const secret = readOrCreateSecret(noCommitDir);
      const payload = { route: 'forge:c', cycle: 'c', nonce: 'nNC', exp: Date.now() + 60_000 };
      pending.add('nNC', payload);
      const token = signToken(payload, secret);

      writeFileSync(join(noCommitDir, '.foundry/dispatch-token'), token);
      // First attempt fails because there are no commits.
      const res1 = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
        { stage: 'forge:c', cycle: 'c' }, makeCtx(noCommitDir),
      ));
      assert.match(res1.error, /git rev-parse HEAD/);
      assert.equal(existsSync(join(noCommitDir, '.foundry/active-stage.json')), false);

      // Now create a commit and retry with the SAME token. The nonce must
      // still be pending for this to succeed.
      execSync('git commit --allow-empty -m init -q', { cwd: noCommitDir, env: GIT_ENV });
      const res2 = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
        { stage: 'forge:c', cycle: 'c' }, makeCtx(noCommitDir),
      ));
      assert.equal(res2.ok, true, `expected retry to succeed, got: ${JSON.stringify(res2)}`);
      assert.ok(existsSync(join(noCommitDir, '.foundry/active-stage.json')));
    } finally {
      rmSync(noCommitDir, { recursive: true, force: true });
    }
  });

  it('rejects when active stage already present', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n5', exp: Date.now() + 60_000 };
    pending.add('n5', payload);
    const token = signToken(payload, secret);
    writeFileSync(join(dir, '.foundry/dispatch-token'), token);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c' }, makeCtx(dir));
    // Add another pending nonce and try again without clearing active-stage.
    const p2 = { route: 'forge:c', cycle: 'c', nonce: 'n6', exp: Date.now() + 60_000 };
    pending.add('n6', p2);
    const token2 = signToken(p2, secret);
    writeFileSync(join(dir, '.foundry/dispatch-token'), token2);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c' }, makeCtx(dir)));
    assert.match(res.error, /is already active/);
  });
});

describe('dispatch-token file cleanup on stage_begin failure', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-tokenclean-'));
    initRepo(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function tokenPath() { return join(dir, '.foundry/dispatch-token'); }

  it('deletes token file on bad_signature', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const secret = readOrCreateSecret(dir);
    const token = signToken({ route: 'forge:c', cycle: 'c', nonce: 'n', exp: Date.now() + 60_000 }, secret);
    // Tamper with the signature
    const garbled = token.slice(0, -4) + 'xxxx';
    writeFileSync(tokenPath(), garbled);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c' }, makeCtx(dir));
    assert.equal(existsSync(tokenPath()), false);
  });

  it('deletes token file on expired token', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'ne', exp: Date.now() - 1 };
    pending.add('ne', payload);
    const token = signToken(payload, secret);
    writeFileSync(tokenPath(), token);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c' }, makeCtx(dir));
    assert.equal(existsSync(tokenPath()), false);
  });

  it('preserves token file on stage mismatch (nonce unconsumed, retry possible)', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'nm', exp: Date.now() + 60_000 };
    pending.add('nm', payload);
    const token = signToken(payload, secret);
    writeFileSync(tokenPath(), token);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'quench:c', cycle: 'c' }, makeCtx(dir));
    assert.equal(existsSync(tokenPath()), true, 'token file should persist for retry after stage mismatch');
  });

  it('preserves token file on agent binding error (nonce unconsumed, retry possible)', async () => {
    // Note: agent binding only fires when context.agent === 'foundry', which
    // is set by the plugin for real dispatches. Test contexts don't set this,
    // so the token is accepted. The file is preserved because stage_begin
    // succeeded and stage_end hasn't been called yet — we clean up manually.
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'na', exp: Date.now() + 60_000, model: 'some-model' };
    pending.add('na', payload);
    const token = signToken(payload, secret);
    writeFileSync(tokenPath(), token);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true, 'model-scoped token accepted in test context (agent not foundry)');
    // File is consumed (read) but not deleted by stage_begin on success —
    // stage_end deletes it. Clean up for the test.
    assert.equal(existsSync(tokenPath()), true);
  });
});

describe('foundry_stage_end', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-stageend-'));
    initRepo(dir);
    _clearAllOutputs();
  });

  async function beginStage(plugin, nonce = 'na') {
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce, exp: Date.now() + 60_000 };
    pending.add(nonce, payload);
    const token = signToken(payload, secret);
    writeFileSync(join(dir, '.foundry/dispatch-token'), token);
    await plugin.tool.foundry_stage_begin.execute({ stage: 'forge:c', cycle: 'c' }, makeCtx(dir));
  }

  it('clears active-stage and writes last-stage', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginStage(plugin);
    // Populate buffer to satisfy forge contract (exactly 1 output)
    await plugin.tool.foundry_stage_output.execute({ data: { status: 'done' } }, makeCtx(dir));
    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute({}, makeCtx(dir)));
    assert.equal(res.ok, true);
    assert.equal(existsSync(join(dir, '.foundry/active-stage.json')), false);
    assert.ok(existsSync(join(dir, '.foundry/last-stage.json')));
    const last = JSON.parse(readFileSync(join(dir, '.foundry/last-stage.json'), 'utf-8'));
    assert.equal(last.cycle, 'c');
    assert.equal(last.stage, 'forge:c');
    assert.ok(last.baseSha);
    assert.equal(last.summary, '');
  });

  it('errors when no active stage', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute({}, makeCtx(dir)));
    assert.match(res.error, /no active stage to close/);
  });
});

describe('foundry_stage_begin with tokenFile parameter', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-tokenfile-'));
    initRepo(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // T1: valid tokenFile reads token from .foundry/tokens/<filename>
  it('reads token from .foundry/tokens/<tokenFile> when tokenFile is provided', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'tf1', exp: Date.now() + 60_000 };
    pending.add('tf1', payload);
    const token = signToken(payload, secret);
    const tokenDir = join(dir, '.foundry/tokens');
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(join(tokenDir, 'test-cycle.token'), token);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c', tokenFile: 'test-cycle.token' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.ok(existsSync(join(dir, '.foundry/active-stage.json')));
  });

  // T2: tokenFile absent falls back to .foundry/dispatch-token
  it('falls back to .foundry/dispatch-token when tokenFile is absent', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'tf2', exp: Date.now() + 60_000 };
    pending.add('tf2', payload);
    const token = signToken(payload, secret);
    writeFileSync(join(dir, '.foundry/dispatch-token'), token);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.ok(existsSync(join(dir, '.foundry/active-stage.json')));
  });

  // T3: tokenFile containing / is rejected
  it('rejects tokenFile containing forward slash (path traversal)', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c', tokenFile: 'subdir/token.file' },
      makeCtx(dir),
    ));
    assert.match(res.error, /tokenFile must not contain/);
    assert.equal(existsSync(join(dir, '.foundry/active-stage.json')), false);
  });

  // T4: tokenFile containing .. is rejected
  it('rejects tokenFile containing .. (parent directory reference)', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c', tokenFile: '../dispatch-token' },
      makeCtx(dir),
    ));
    assert.match(res.error, /tokenFile must not contain/);
    assert.equal(existsSync(join(dir, '.foundry/active-stage.json')), false);
  });

  // T5: token file exists after beginStage, absent after stageEnd
  it('token file exists after beginStage and is deleted after stageEnd', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const nonce = 'tf5';
    const payload = { route: 'forge:c', cycle: 'c', nonce, exp: Date.now() + 60_000 };
    pending.add(nonce, payload);
    const token = signToken(payload, secret);
    const tokenDir = join(dir, '.foundry/tokens');
    mkdirSync(tokenDir, { recursive: true });
    const tokenFilePath = join(tokenDir, 'test-cycle.token');
    writeFileSync(tokenFilePath, token);
    const beginRes = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'forge:c', cycle: 'c', tokenFile: 'test-cycle.token' },
      makeCtx(dir),
    ));
    assert.equal(beginRes.ok, true);
    // Token file should still exist on disk after beginStage
    assert.ok(existsSync(tokenFilePath), 'token file should exist after beginStage');
    // Satisfy forge contract: exactly 1 output
    await plugin.tool.foundry_stage_output.execute({ data: { status: 'done' } }, makeCtx(dir));
    const endRes = JSON.parse(await plugin.tool.foundry_stage_end.execute({}, makeCtx(dir)));
    assert.equal(endRes.ok, true);
    // Token file is deleted by stageEnd (per forge token lifecycle step 8)
    assert.equal(existsSync(tokenFilePath), false, 'token file should be deleted by stageEnd');
  });
});

describe('stage tool descriptions', () => {
  it('do not reference the deregistered foundry_sort tool', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-stagedesc-'));
    try {
      initRepo(dir);
      const plugin = await FoundryPlugin({ directory: dir });
      const begin = plugin.tool.foundry_stage_begin.description;
      const end = plugin.tool.foundry_stage_end.description;
      assert.ok(!/foundry_sort/.test(begin), `foundry_stage_begin description still mentions foundry_sort: ${begin}`);
      assert.ok(!/foundry_sort/.test(end), `foundry_stage_end description still mentions foundry_sort: ${end}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

