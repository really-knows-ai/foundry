import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { signToken } from '../../src/scripts/lib/token.js';
import { readOrCreateSecret } from '../../src/scripts/lib/secret.js';

function makeCtx(worktree) { return { worktree }; }

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function initRepo(dir) {
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  execSync('git commit --allow-empty -m init -q', { cwd: dir, env: GIT_ENV });
  // stage_begin/stage_end require work/<x> branch.
  execSync('git checkout -q -b work/forge-tool-calls', { cwd: dir, env: GIT_ENV });
}

async function beginForgeStage(plugin, dir, nonce = 'n1') {
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = readOrCreateSecret(dir);
  const payload = { route: 'forge:c', cycle: 'c', nonce, exp: Date.now() + 60_000 };
  pending.add(nonce, payload);
  const token = signToken(payload, secret);
  const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
    { stage: 'forge:c', cycle: 'c', token }, makeCtx(dir),
  ));
  return res;
}

describe('forge tool call log on stage_begin', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-forge-log-begin-'));
    initRepo(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates an empty call log file for forge stages', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = await beginForgeStage(plugin, dir);
    assert.equal(res.ok, true);
    const logPath = join(dir, '.foundry/.forge-tool-calls.jsonl');
    assert.ok(existsSync(logPath));
    assert.equal(readFileSync(logPath, 'utf-8'), '');
  });

  it('does not create a call log for non-forge stages', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'quench:c', cycle: 'c', nonce: 'nq', exp: Date.now() + 60_000 };
    pending.add('nq', payload);
    const token = signToken(payload, secret);
    const res = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage: 'quench:c', cycle: 'c', token }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    const logPath = join(dir, '.foundry/.forge-tool-calls.jsonl');
    assert.equal(existsSync(logPath), false);
  });
});

describe('forge tool call verification on stage_end', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'foundry-forge-log-end-'));
    initRepo(dir);
    // Seed empty feedback file so the store can open it.
    writeFileSync(join(dir, 'WORK.feedback.yaml'), yaml.dump({ items: [] }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns ok when all required tools were called', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginForgeStage(plugin, dir);
    // Simulate required tool calls by writing to the log file.
    const logPath = join(dir, '.foundry/.forge-tool-calls.jsonl');
    const lines = [
      JSON.stringify({ tool: 'foundry_stage_begin', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_config_cycle', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_workfile_get', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_config_artefact_type', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_config_laws', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_feedback_list', ts: Date.now() }),
    ].join('\n') + '\n';
    writeFileSync(logPath, lines);

    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute(
      { summary: 'done' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(logPath), false);
  });

  it('posts system feedback when required tools are missing', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginForgeStage(plugin, dir);
    // No tool calls recorded — log file is empty.

    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute(
      { summary: 'done' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));

    // Verify system feedback was posted.
    const fbPath = join(dir, 'WORK.feedback.yaml');
    const doc = yaml.load(readFileSync(fbPath, 'utf-8'));
    const sysItems = doc.items.filter(item => item.tag === 'system:missing-tool-calls');
    assert.equal(sysItems.length, 1);
    assert.match(sysItems[0].text, /Missing required forge tools:/);
    assert.equal(sysItems[0].history[0].state, 'open');
  });

  it('resolves prior system feedback when all required tools are called', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    await beginForgeStage(plugin, dir);
    // Setup: prior system feedback exists.
    writeFileSync(join(dir, 'WORK.feedback.yaml'), yaml.dump({
      items: [{
        id: '01KS_TEST_SYSTEM_ITEM_00000',
        file: '(forge)',
        tag: 'system:missing-tool-calls',
        text: 'Missing required forge tools: foundry_config_laws',
        source: 'forge:c',
        history: [{ state: 'open', stage: 'forge:c', cycle: 'c', timestamp: '2026-05-23T00:00:00.000Z' }],
      }],
    }));

    // Simulate all required tool calls in the log.
    const logPath = join(dir, '.foundry/.forge-tool-calls.jsonl');
    writeFileSync(logPath, [
      JSON.stringify({ tool: 'foundry_config_cycle', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_workfile_get', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_config_artefact_type', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_config_laws', ts: Date.now() }),
      JSON.stringify({ tool: 'foundry_feedback_list', ts: Date.now() }),
    ].join('\n') + '\n');

    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute(
      { summary: 'done' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));

    // Verify system feedback was resolved.
    const fbDoc = yaml.load(readFileSync(join(dir, 'WORK.feedback.yaml'), 'utf-8'));
    const sysItem = fbDoc.items.find(item => item.id === '01KS_TEST_SYSTEM_ITEM_00000');
    assert.equal(sysItem.history[0].state, 'resolved');
  });

  it('does not verify tool calls for non-forge stages', async () => {
    const plugin = await FoundryPlugin({ directory: dir });
    // Begin a quench stage instead of forge.
    const pending = plugin[Symbol.for('foundry.test.pending')];
    const secret = readOrCreateSecret(dir);
    const payload = { route: 'quench:c', cycle: 'c', nonce: 'nend', exp: Date.now() + 60_000 };
    pending.add('nend', payload);
    const token = signToken(payload, secret);
    await plugin.tool.foundry_stage_begin.execute(
      { stage: 'quench:c', cycle: 'c', token }, makeCtx(dir),
    );

    const res = JSON.parse(await plugin.tool.foundry_stage_end.execute(
      { summary: 'done' }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    // No system feedback should have been posted.
    const fbDoc = yaml.load(readFileSync(join(dir, 'WORK.feedback.yaml'), 'utf-8'));
    const sysItems = fbDoc.items.filter(item => item.tag === 'system:missing-tool-calls');
    assert.equal(sysItems.length, 0);
  });
});
