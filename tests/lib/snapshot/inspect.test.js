// tests/lib/snapshot/inspect.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { realFsIo } from '../helpers/real-fs-io.js';
import { createUlidGenerator } from '../../../scripts/lib/ulid.js';
import {
  listSnapshots,
  showSnapshot,
  deleteSnapshot,
  pruneSnapshots,
} from '../../../scripts/lib/snapshot/inspect.js';

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
    'message body',
    '',
  ].join('\n');
}

async function writeSnapshot(io, runId, opts = {}) {
  const dir = `.snapshots/${runId}`;
  await io.mkdirp(`${dir}/work`);
  if (opts.readme !== false) {
    await io.writeFile(`${dir}/README.md`, opts.readme ?? makeReadme({
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
    await io.writeFile(`${dir}/work/WORK.md`, opts.work ?? '---\nflow: x\n---\n# Goal\n');
  }
  if (opts.diff !== false) {
    await io.writeFile(`${dir}/diff.patch`, opts.diff ?? 'diff --git a/x b/x\n+a\n-b\n');
  }
  if (opts.trace !== false) {
    await io.writeFile(`${dir}/trace.jsonl`, opts.trace ?? '{"ts":"2025-01-01T00:00:00.000Z"}\n{"ts":"2025-01-01T00:01:00.000Z"}\n');
  }
}

describe('snapshot inspect', () => {
  let root;
  let io;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    io = realFsIo(root);
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('listSnapshots: empty when no .snapshots/', async () => {
    const result = await listSnapshots({ io });
    assert.deepEqual(result, []);
  });

  test('listSnapshots: happy-path entry with metadata', async () => {
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    await writeSnapshot(io, runId);
    const result = await listSnapshots({ io });
    assert.equal(result.length, 1);
    const e = result[0];
    assert.equal(e.runId, runId);
    assert.equal(e.branch, 'dry-run/main/x');
    assert.equal(e.parent, 'config/main');
    assert.equal(e.flow, 'creative-flow');
    assert.equal(e.goal, 'do a thing');
    assert.equal(e.startedAt, '2025-01-01T00:00:00.000Z');
    assert.equal(e.finishedAt, '2025-01-01T00:01:00.000Z');
    assert.equal(e.exitReason, 'completed');
    assert.ok(!e.error);
  });

  test('listSnapshots: incomplete (missing trace) flags error', async () => {
    // fresh root
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    await writeSnapshot(io2, runId, { trace: false });
    const result = await listSnapshots({ io: io2 });
    assert.equal(result.length, 1);
    assert.equal(result[0].error, 'incomplete');
    assert.deepEqual(result[0].missing, ['trace.jsonl']);
    assert.equal(result[0].branch, 'dry-run/main/x'); // metadata still parsed
    rmSync(root2, { recursive: true, force: true });
  });

  test('listSnapshots: missing README returns no metadata', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    await writeSnapshot(io2, runId, { readme: false });
    const result = await listSnapshots({ io: io2 });
    assert.equal(result.length, 1);
    assert.equal(result[0].runId, runId);
    assert.equal(result[0].error, 'incomplete');
    assert.ok(result[0].missing.includes('README.md'));
    assert.equal(result[0].branch, undefined);
    assert.equal(result[0].flow, undefined);
    rmSync(root2, { recursive: true, force: true });
  });

  test('listSnapshots: sorted by startedAt descending', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const a = `dry-run-a-${gen(1700000000000)}`;
    const b = `dry-run-b-${gen(1700000001000)}`;
    const c = `dry-run-c-${gen(1700000002000)}`;
    await writeSnapshot(io2, a, { readme: makeReadme({
      branch: 'x', parent: 'y', flow: 'f', goal: 'g',
      startedAt: '2025-01-01T00:00:00.000Z', finishedAt: 'null', exitReason: 'completed',
    }) });
    await writeSnapshot(io2, b, { readme: makeReadme({
      branch: 'x', parent: 'y', flow: 'f', goal: 'g',
      startedAt: '2025-01-03T00:00:00.000Z', finishedAt: 'null', exitReason: 'completed',
    }) });
    await writeSnapshot(io2, c, { readme: makeReadme({
      branch: 'x', parent: 'y', flow: 'f', goal: 'g',
      startedAt: '2025-01-02T00:00:00.000Z', finishedAt: 'null', exitReason: 'completed',
    }) });
    const result = await listSnapshots({ io: io2 });
    assert.equal(result.length, 3);
    assert.equal(result[0].startedAt, '2025-01-03T00:00:00.000Z');
    assert.equal(result[1].startedAt, '2025-01-02T00:00:00.000Z');
    assert.equal(result[2].startedAt, '2025-01-01T00:00:00.000Z');
    rmSync(root2, { recursive: true, force: true });
  });

  test('showSnapshot: happy path with diff stats from multi-file patch', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    const diff = [
      'diff --git a/foo b/foo',
      '--- a/foo',
      '+++ b/foo',
      '+added1',
      '+added2',
      '-removed1',
      'diff --git a/bar b/bar',
      '--- a/bar',
      '+++ b/bar',
      '+added3',
      '',
    ].join('\n');
    await writeSnapshot(io2, runId, { diff });
    const result = await showSnapshot({ runId, io: io2 });
    assert.equal(result.runId, runId);
    assert.equal(result.diff.files, 2);
    assert.equal(result.diff.insertions, 3);
    assert.equal(result.diff.deletions, 1);
    assert.equal(result.metadata.flow, 'creative-flow');
    assert.deepEqual(result.missing, []);
    rmSync(root2, { recursive: true, force: true });
  });

  test('parseDiffStats: heuristic edge cases (C39)', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    // Heuristic counts lines starting with +/- (but not ++/--) as changes.
    // Known undercount: additions/deletions inside quoted strings or binary patches.
    // Known overcount: context lines that happen to start with +/- inside actual patch content.
    const trickyDiff = [
      'diff --git a/test.txt b/test.txt',
      '--- a/test.txt',
      '+++ b/test.txt',
      '@@ -1,3 +1,4 @@',
      ' unchanged line',
      '+added line',  // counted
      '-removed line',  // counted
      ' +context line that starts with + but is unchanged',  // NOT counted (no leading +)
      'diff --git a/binary.dat b/binary.dat',
      'Binary files differ',  // no +/- lines, not counted
      '',
    ].join('\n');
    await writeSnapshot(io2, runId, { diff: trickyDiff });
    const result = await showSnapshot({ runId, io: io2 });
    assert.equal(result.diff.files, 2);  // both files counted
    assert.equal(result.diff.insertions, 1);  // only the real + line
    assert.equal(result.diff.deletions, 1);  // only the real - line
    // The heuristic works for standard unified diff output. Edge case:
    // If patch content itself contains lines starting with + or -, those
    // would be miscounted, but this is acceptable for forensic snapshots
    // where approximate stats suffice.
    rmSync(root2, { recursive: true, force: true });
  });

  test('showSnapshot: trace stats parse first/last ts', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    const trace = [
      '{"ts":"2025-01-01T00:00:00.000Z","kind":"a"}',
      '{"ts":"2025-01-01T00:00:30.000Z","kind":"b"}',
      '{"ts":"2025-01-01T00:01:00.000Z","kind":"c"}',
      '',
    ].join('\n');
    await writeSnapshot(io2, runId, { trace });
    const result = await showSnapshot({ runId, io: io2 });
    assert.equal(result.trace.lineCount, 3);
    assert.equal(result.trace.firstTs, '2025-01-01T00:00:00.000Z');
    assert.equal(result.trace.lastTs, '2025-01-01T00:01:00.000Z');
    rmSync(root2, { recursive: true, force: true });
  });

  test('showSnapshot: missing trace yields zero stats and missing array', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    await writeSnapshot(io2, runId, { trace: false });
    const result = await showSnapshot({ runId, io: io2 });
    assert.deepEqual(result.trace, { lineCount: 0, firstTs: null, lastTs: null });
    assert.ok(result.missing.includes('trace.jsonl'));
    rmSync(root2, { recursive: true, force: true });
  });

  test('showSnapshot: unknown runId returns error', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const result = await showSnapshot({ runId: 'nonexistent', io: io2 });
    assert.equal(result.error, 'unknown_runId');
    assert.ok(Array.isArray(result.missing));
    assert.ok(result.missing.length > 0);
    rmSync(root2, { recursive: true, force: true });
  });

  test('deleteSnapshot: without confirm returns preview', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    await writeSnapshot(io2, runId);
    const result = await deleteSnapshot({ runId, io: io2 });
    assert.equal(result.ok, false);
    assert.match(result.error, /requires.*confirm/);
    assert.deepEqual(result.planned, { runId, path: `.snapshots/${runId}` });
    assert.equal(await io2.exists(`.snapshots/${runId}`), true);
    rmSync(root2, { recursive: true, force: true });
  });

  test('deleteSnapshot: with confirm removes directory', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const runId = `dry-run-main-x-${gen(1700000000000)}`;
    await writeSnapshot(io2, runId);
    const result = await deleteSnapshot({ runId, io: io2, confirm: true });
    assert.equal(result.ok, true);
    assert.equal(result.runId, runId);
    assert.equal(result.removed, `.snapshots/${runId}`);
    assert.equal(await io2.exists(`.snapshots/${runId}`), false);
    rmSync(root2, { recursive: true, force: true });
  });

  test('deleteSnapshot: unknown runId returns error', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const result = await deleteSnapshot({ runId: 'nope', io: io2, confirm: true });
    assert.equal(result.ok, false);
    assert.match(result.error, /unknown runId/);
    rmSync(root2, { recursive: true, force: true });
  });

  test('pruneSnapshots: candidates determined by ULID time prefix', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const now = Date.now();
    const oldId = `dry-run-x-${gen(now - 10 * 86400000)}`;
    const newId = `dry-run-y-${gen(now)}`;
    await writeSnapshot(io2, oldId);
    await writeSnapshot(io2, newId);
    const result = await pruneSnapshots({ olderThanDays: 7, io: io2, now });
    assert.equal(result.ok, false);
    assert.deepEqual(result.candidates, [oldId]);
    rmSync(root2, { recursive: true, force: true });
  });

  test('pruneSnapshots: without confirm returns preview', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const now = Date.now();
    const oldId = `dry-run-x-${gen(now - 30 * 86400000)}`;
    await writeSnapshot(io2, oldId);
    const result = await pruneSnapshots({ olderThanDays: 7, io: io2, now });
    assert.equal(result.ok, false);
    assert.match(result.error, /requires.*confirm/);
    assert.deepEqual(result.candidates, [oldId]);
    assert.ok(typeof result.cutoff === 'string');
    assert.equal(await io2.exists(`.snapshots/${oldId}`), true);
    rmSync(root2, { recursive: true, force: true });
  });

  test('pruneSnapshots: with confirm removes them', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const gen = createUlidGenerator();
    const now = Date.now();
    const oldId = `dry-run-x-${gen(now - 30 * 86400000)}`;
    const newId = `dry-run-y-${gen(now)}`;
    await writeSnapshot(io2, oldId);
    await writeSnapshot(io2, newId);
    const result = await pruneSnapshots({ olderThanDays: 7, io: io2, now, confirm: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.removed, [oldId]);
    assert.equal(await io2.exists(`.snapshots/${oldId}`), false);
    assert.equal(await io2.exists(`.snapshots/${newId}`), true);
    rmSync(root2, { recursive: true, force: true });
  });

  test('pruneSnapshots: empty when no .snapshots/', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    const result = await pruneSnapshots({ olderThanDays: 7, io: io2, now: Date.now(), confirm: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.removed, []);
    rmSync(root2, { recursive: true, force: true });
  });

  test('pruneSnapshots: skips entries with malformed ULID', async () => {
    const root2 = mkdtempSync(path.join(tmpdir(), 'snap-inspect-'));
    const io2 = realFsIo(root2);
    // 26 chars but contains invalid char 'I' in time region
    const badId = 'dry-run-x-IIIIIIIIIIabcdefghijklmnop';
    await writeSnapshot(io2, badId);
    const result = await pruneSnapshots({ olderThanDays: 1, io: io2, now: Date.now() });
    assert.equal(result.ok, false);
    assert.deepEqual(result.candidates, []);
    rmSync(root2, { recursive: true, force: true });
  });
});
