// Tests for foundry_snapshot_{list,show,delete,prune} MCP tools.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { createUlidGenerator } from '../../src/scripts/lib/ulid.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function setupRepoWithFoundry() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-snap-'));
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  try { execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV }); } catch { /* ignore */ }
  mkdirSync(join(dir, 'foundry'), { recursive: true });
  writeFileSync(join(dir, 'foundry/.gitkeep'), '');
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -qm init', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeReadme({ branch, parent, flow, goal, startedAt, finishedAt, exitReason }) {
  return [
    '---',
    `branch: ${branch}`,
    `parent: ${parent}`,
    `flow: ${flow}`,
    `goal: ${JSON.stringify(goal)}`,
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    `exitReason: ${exitReason}`,
    '---',
    '',
    '# Dry-run snapshot',
    '',
    'body',
    '',
  ].join('\n');
}

function writeSnapshot(dir, runId, opts = {}) {
  const snapDir = join(dir, '.snapshots', runId);
  mkdirSync(join(snapDir, 'work'), { recursive: true });
  if (opts.readme !== false) {
    writeFileSync(join(snapDir, 'README.md'), opts.readme ?? makeReadme({
      branch: 'dry-run/main/x',
      parent: 'config/main',
      flow: 'creative-flow',
      goal: 'do a thing',
      startedAt: '2025-01-01T00:00:00.000Z',
      finishedAt: '2025-01-01T00:01:00.000Z',
      exitReason: 'completed',
    }));
  }
  if (opts.work !== false) {
    writeFileSync(join(snapDir, 'work/WORK.md'), '---\nflow: x\n---\n# Goal\n');
  }
  if (opts.diff !== false) {
    writeFileSync(join(snapDir, 'diff.patch'), 'diff --git a/x b/x\n+a\n-b\n');
  }
  if (opts.trace !== false) {
    writeFileSync(join(snapDir, 'trace.jsonl'),
      '{"ts":"2025-01-01T00:00:00.000Z"}\n{"ts":"2025-01-01T00:01:00.000Z"}\n');
  }
}

// ---------------------------------------------------------------------------
// _list
// ---------------------------------------------------------------------------

test('foundry_snapshot_list: empty .snapshots/ returns []', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_list.execute({}, makeCtx(dir)));
    assert.deepEqual(res, []);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_list: returns array including a complete snapshot', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    writeSnapshot(dir, runId);
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_list.execute({}, makeCtx(dir)));
    assert.equal(Array.isArray(res), true);
    assert.equal(res.length, 1);
    assert.equal(res[0].runId, runId);
    assert.equal(res[0].flow, 'creative-flow');
    assert.equal(res[0].error, undefined);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_list: incomplete snapshot surfaces with error: incomplete', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    writeSnapshot(dir, runId, { readme: false });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_list.execute({}, makeCtx(dir)));
    assert.equal(res.length, 1);
    assert.equal(res[0].error, 'incomplete');
    assert.ok(res[0].missing.includes('README.md'));
  } finally { cleanup(dir); }
});

test('foundry_snapshot_list: works on main branch (no branch guard)', async () => {
  const dir = setupRepoWithFoundry();
  try {
    // Verify we're on main.
    const branch = execSync('git rev-parse --abbrev-ref HEAD',
      { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.equal(branch, 'main');
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_list.execute({}, makeCtx(dir)));
    assert.deepEqual(res, []);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// _show
// ---------------------------------------------------------------------------

test('foundry_snapshot_show: happy path', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    writeSnapshot(dir, runId);
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_show.execute(
      { runId }, makeCtx(dir),
    ));
    assert.equal(res.runId, runId);
    assert.ok(typeof res.readme === 'string');
    assert.equal(res.metadata.flow, 'creative-flow');
    assert.equal(typeof res.diff.files, 'number');
    assert.equal(typeof res.trace.lineCount, 'number');
    assert.deepEqual(res.missing, []);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_show: unknown runId returns error', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_show.execute(
      { runId: 'does-not-exist' }, makeCtx(dir),
    ));
    assert.equal(res.error, 'unknown_runId');
    assert.ok(Array.isArray(res.missing));
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// _delete
// ---------------------------------------------------------------------------

test('foundry_snapshot_delete: without confirm returns preview, dir still exists', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    writeSnapshot(dir, runId);
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_delete.execute(
      { runId }, makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /confirm/);
    assert.equal(existsSync(join(dir, '.snapshots', runId)), true);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_delete: with confirm removes directory', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    writeSnapshot(dir, runId);
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_delete.execute(
      { runId, confirm: true }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(existsSync(join(dir, '.snapshots', runId)), false);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_delete: unknown runId returns error', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_delete.execute(
      { runId: 'does-not-exist', confirm: true }, makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown runId/);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// _prune
// ---------------------------------------------------------------------------

test('foundry_snapshot_prune: olderThanDays = 0 returns integer-validation error', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_prune.execute(
      { olderThanDays: 0 }, makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /positive integer/);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_prune: olderThanDays = -1 returns integer-validation error', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_prune.execute(
      { olderThanDays: -1 }, makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /positive integer/);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_prune: valid days, no confirm, returns candidates and cutoff', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const now = Date.now();
    const gen = createUlidGenerator();
    const oldId = `dry-run-x-y-${gen(now - 30 * 86400000)}`;
    const newId = `dry-run-x-y-${gen(now)}`;
    writeSnapshot(dir, oldId);
    writeSnapshot(dir, newId);

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_prune.execute(
      { olderThanDays: 7 }, makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.candidates));
    assert.ok(res.candidates.includes(oldId));
    assert.ok(!res.candidates.includes(newId));
    assert.ok(typeof res.cutoff === 'string');
    // Both still on disk.
    assert.equal(existsSync(join(dir, '.snapshots', oldId)), true);
    assert.equal(existsSync(join(dir, '.snapshots', newId)), true);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_prune: with confirm removes matching snapshots', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const now = Date.now();
    const gen = createUlidGenerator();
    const oldId = `dry-run-x-y-${gen(now - 30 * 86400000)}`;
    const newId = `dry-run-x-y-${gen(now)}`;
    writeSnapshot(dir, oldId);
    writeSnapshot(dir, newId);

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_prune.execute(
      { olderThanDays: 7, confirm: true }, makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.ok(res.removed.includes(oldId));
    assert.ok(!res.removed.includes(newId));
    assert.equal(existsSync(join(dir, '.snapshots', oldId)), false);
    assert.equal(existsSync(join(dir, '.snapshots', newId)), true);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// Foundational guards
// ---------------------------------------------------------------------------

test('foundry_snapshot_list: rejects when foundry/ is absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-snap-nofnd-'));
  try {
    execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
    try { execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV }); } catch { /* ignore */ }
    writeFileSync(join(dir, 'README.md'), 'x\n');
    execSync('git add . && git commit -qm init', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_list.execute({}, makeCtx(dir)));
    assert.ok(res.error, 'expected guard error');
    assert.match(res.error, /^foundry_snapshot_list:/);
    assert.match(res.error, /foundry\//);
  } finally { cleanup(dir); }
});

test('foundry_snapshot_list: rejects when not in a git repo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-snap-nogit-'));
  try {
    mkdirSync(join(dir, 'foundry'), { recursive: true });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_snapshot_list.execute({}, makeCtx(dir)));
    assert.ok(res.error);
    assert.match(res.error, /^foundry_snapshot_list:/);
    assert.match(res.error, /git repository/);
  } finally { cleanup(dir); }
});
