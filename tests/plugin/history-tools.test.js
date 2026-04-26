import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

function makeCtx(worktree) { return { worktree }; }

function makeWorktree() {
  return mkdtempSync(join(tmpdir(), 'foundry-history-'));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

test('foundry_history_list returns empty array when WORK.history.yaml is missing', async () => {
  const dir = makeWorktree();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_history_list.execute(
      { cycle: 'creative' }, makeCtx(dir),
    ));
    assert.deepEqual(out, []);
  } finally { cleanup(dir); }
});

test('foundry_history_list returns parsed entries for a cycle, sorted by timestamp', async () => {
  const dir = makeWorktree();
  try {
    const yaml = `
- cycle: creative
  stage: forge
  iteration: 1
  comment: first
  timestamp: '2025-01-01T10:00:00.000Z'
  seq: 0
  open_feedback: 0
- cycle: creative
  stage: appraise
  iteration: 1
  comment: second
  timestamp: '2025-01-01T11:00:00.000Z'
  seq: 1
  open_feedback: 0
`;
    writeFileSync(join(dir, 'WORK.history.yaml'), yaml.trimStart());

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_history_list.execute(
      { cycle: 'creative' }, makeCtx(dir),
    ));

    assert.equal(out.length, 2);
    assert.equal(out[0].comment, 'first');
    assert.equal(out[0].stage, 'forge');
    assert.equal(out[1].comment, 'second');
    assert.equal(out[1].stage, 'appraise');
  } finally { cleanup(dir); }
});

test('foundry_history_list filters entries to the requested cycle only', async () => {
  const dir = makeWorktree();
  try {
    const yaml = `
- cycle: creative
  stage: forge
  iteration: 1
  comment: keep-me
  timestamp: '2025-01-01T10:00:00.000Z'
  seq: 0
  open_feedback: 0
- cycle: review
  stage: forge
  iteration: 1
  comment: drop-me
  timestamp: '2025-01-01T11:00:00.000Z'
  seq: 1
  open_feedback: 0
- cycle: creative
  stage: appraise
  iteration: 1
  comment: keep-me-too
  timestamp: '2025-01-01T12:00:00.000Z'
  seq: 2
  open_feedback: 0
`;
    writeFileSync(join(dir, 'WORK.history.yaml'), yaml.trimStart());

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_history_list.execute(
      { cycle: 'creative' }, makeCtx(dir),
    ));

    assert.equal(out.length, 2);
    assert.ok(out.every(e => e.cycle === 'creative'));
    assert.deepEqual(out.map(e => e.comment), ['keep-me', 'keep-me-too']);
  } finally { cleanup(dir); }
});

test('foundry_history_list returns empty array when no entries match the cycle', async () => {
  const dir = makeWorktree();
  try {
    const yaml = `
- cycle: review
  stage: forge
  iteration: 1
  comment: only-review
  timestamp: '2025-01-01T10:00:00.000Z'
  seq: 0
  open_feedback: 0
`;
    writeFileSync(join(dir, 'WORK.history.yaml'), yaml.trimStart());

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_history_list.execute(
      { cycle: 'creative' }, makeCtx(dir),
    ));
    assert.deepEqual(out, []);
  } finally { cleanup(dir); }
});

test('foundry_history_list orders entries with same timestamp by seq', async () => {
  const dir = makeWorktree();
  try {
    const yaml = `
- cycle: creative
  stage: forge
  iteration: 1
  comment: second-by-seq
  timestamp: '2025-01-01T10:00:00.000Z'
  seq: 2
  open_feedback: 0
- cycle: creative
  stage: forge
  iteration: 1
  comment: first-by-seq
  timestamp: '2025-01-01T10:00:00.000Z'
  seq: 1
  open_feedback: 0
`;
    writeFileSync(join(dir, 'WORK.history.yaml'), yaml.trimStart());

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_history_list.execute(
      { cycle: 'creative' }, makeCtx(dir),
    ));

    assert.equal(out.length, 2);
    assert.equal(out[0].comment, 'first-by-seq');
    assert.equal(out[1].comment, 'second-by-seq');
  } finally { cleanup(dir); }
});
