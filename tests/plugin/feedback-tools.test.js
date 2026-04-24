// tests/plugin/feedback-tools.test.js
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

// ---------------------------------------------------------------------------
// Test harness — real plugin, no stub layer.
// Pattern copied from tests/plugin/assay-tools.test.js and
// tests/plugin/stage-end-failed-flow.test.js. Do not invent stubs.
// ---------------------------------------------------------------------------

/**
 * Write the active-stage JSON file. Production shape is {cycle, stage, baseSha}
 * (see scripts/lib/state.js). baseSha is a dummy in tests; real callers set it.
 */
function writeActiveStage(dir, { cycle = 'write-haiku', stage, baseSha = 'test-sha' }) {
  writeFileSync(
    path.join(dir, '.foundry', 'active-stage.json'),
    JSON.stringify({ cycle, stage, baseSha }),
    'utf-8',
  );
}

function makeWorktree({ stage = 'appraise:write-check', cycle = 'write-haiku', flow = 'creative' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fdy-feedback-tools-'));
  mkdirSync(path.join(dir, '.foundry'), { recursive: true });
  writeActiveStage(dir, { cycle, stage });
  writeFileSync(
    path.join(dir, 'WORK.md'),
    `---\nflow: ${flow}\ncycle: ${cycle}\nstages:\n  - ${stage}\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n`,
    'utf-8',
  );
  return dir;
}

async function getPlugin(dir) {
  return FoundryPlugin({ directory: dir });
}

async function tools(dir) {
  const plugin = await getPlugin(dir);
  return plugin.tool;
}

function parseResult(raw) {
  return JSON.parse(raw);
}

let worktree;
afterEach(() => {
  if (worktree) {
    rmSync(worktree, { recursive: true, force: true });
    worktree = null;
  }
});

describe('foundry_feedback_add — id-based API', () => {
  test('writes WORK.feedback.yaml with a new item and returns the id', async () => {
    worktree = makeWorktree();
    const plugin = await getPlugin(worktree);
    const raw = await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'too cheerful', tag: 'law:dark' },
      { worktree },
    );
    const res = parseResult(raw);
    assert.equal(res.ok, true);
    assert.equal(typeof res.id, 'string');
    assert.equal(res.id.length, 26);
    assert.equal(res.deduped, false);

    const doc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
    assert.equal(doc.items.length, 1);
    assert.equal(doc.items[0].id, res.id);
    assert.equal(doc.items[0].source, 'appraise:write-check');
    assert.equal(doc.items[0].history[0].state, 'open');
  });

  test('returns deduped:true when the same (file, tag, text) exists', async () => {
    worktree = makeWorktree();
    const plugin = await getPlugin(worktree);
    const first = parseResult(await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'too cheerful', tag: 'law:dark' },
      { worktree },
    ));
    const second = parseResult(await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'too cheerful', tag: 'law:dark' },
      { worktree },
    ));
    assert.equal(second.ok, true);
    assert.equal(second.deduped, true);
    assert.equal(second.id, first.id);
  });

  test('rejects forge stage (forge cannot add feedback)', async () => {
    worktree = makeWorktree({ stage: 'forge:write' });
    const plugin = await getPlugin(worktree);
    const raw = await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'hitl' },
      { worktree },
    );
    const res = parseResult(raw);
    assert.ok(res.error);
    assert.match(res.error, /forge/);
  });

  test('rejects when no active stage', async () => {
    worktree = makeWorktree();
    rmSync(path.join(worktree, '.foundry', 'active-stage.json'), { force: true });
    const plugin = await getPlugin(worktree);
    const raw = await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    );
    const res = parseResult(raw);
    assert.ok(res.error);
    assert.match(res.error, /active stage/);
  });

  test('per-stage tag allow-list still enforced (quench may only add #validation)', async () => {
    worktree = makeWorktree({ stage: 'quench:check' });
    const plugin = await getPlugin(worktree);
    const raw = await plugin.tool.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:nope' },
      { worktree },
    );
    const res = parseResult(raw);
    assert.match(res.error, /quench.*validation/);
  });
});

describe('foundry_feedback_list — new response shape', () => {
  test('returns items with {id, file, tag, text, source, state, depth} fields', async () => {
    worktree = makeWorktree();
    const t = await tools(worktree);
    const addRes = parseResult(await t.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'too cheerful', tag: 'law:dark' },
      { worktree },
    ));

    const listRaw = await t.foundry_feedback_list.execute({}, { worktree });
    const items = parseResult(listRaw);
    assert.equal(Array.isArray(items), true);
    assert.equal(items.length, 1);
    const it = items[0];
    assert.equal(it.id, addRes.id);
    assert.equal(it.file, 'haiku.md');
    assert.equal(it.tag, 'law:dark');
    assert.equal(it.text, 'too cheerful');
    assert.equal(it.source, 'appraise:write-check');
    assert.equal(it.state, 'open');
    assert.equal(it.depth, 1);
    assert.equal(it.reason, undefined);
  });

  test('filters by file when `file` argument is supplied', async () => {
    worktree = makeWorktree();
    const t = await tools(worktree);
    await t.foundry_feedback_add.execute({ file: 'a.md', text: 't1', tag: 'law:x' }, { worktree });
    await t.foundry_feedback_add.execute({ file: 'b.md', text: 't2', tag: 'law:x' }, { worktree });
    const items = parseResult(await t.foundry_feedback_list.execute({ file: 'a.md' }, { worktree }));
    assert.equal(items.length, 1);
    assert.equal(items[0].file, 'a.md');
  });

  test('returns an empty array when WORK.feedback.yaml is absent', async () => {
    worktree = makeWorktree();
    const t = await tools(worktree);
    const items = parseResult(await t.foundry_feedback_list.execute({}, { worktree }));
    assert.deepEqual(items, []);
  });
});
