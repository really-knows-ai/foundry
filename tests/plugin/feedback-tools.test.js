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

describe('foundry_feedback_action — id-based', () => {
  test('transitions an open item to actioned from a forge stage', async () => {
    worktree = makeWorktree();
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    // Rewrite active-stage to forge:write and call action.
    writeActiveStage(worktree, { stage: 'forge:write', cycle: 'write-haiku' });
    const tAct = await tools(worktree);
    const res = parseResult(await tAct.foundry_feedback_action.execute({ id }, { worktree }));
    assert.equal(res.ok, true);

    const doc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
    assert.equal(doc.items[0].history[0].state, 'actioned');
    assert.equal(doc.items[0].history[0].stage, 'forge:write');
  });

  test('rejects non-forge stage', async () => {
    worktree = makeWorktree();
    const t = await tools(worktree);
    const { id } = parseResult(await t.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    // active-stage is still appraise:write-check; foundry_feedback_action requires forge.
    const res = parseResult(await t.foundry_feedback_action.execute({ id }, { worktree }));
    assert.ok(res.error);
    assert.match(res.error, /forge/);
  });

  test('rejects unknown id', async () => {
    worktree = makeWorktree({ stage: 'forge:write' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_action.execute({ id: 'DOES_NOT_EXIST' }, { worktree }));
    assert.ok(res.error);
    assert.match(res.error, /not found/);
  });
});

describe('foundry_feedback_wontfix — id-based', () => {
  test('transitions to wont-fix with reason from a forge stage', async () => {
    worktree = makeWorktree({ stage: 'forge:write' });
    // First add from an appraise stage (forge cannot add).
    writeActiveStage(worktree, { stage: 'appraise:a', cycle: 'write-haiku' });
    const t1 = await tools(worktree);
    const { id } = parseResult(await t1.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    // Switch to forge, call wontfix.
    writeActiveStage(worktree, { stage: 'forge:write', cycle: 'write-haiku' });
    const t2 = await tools(worktree);
    const res = parseResult(await t2.foundry_feedback_wontfix.execute(
      { id, reason: 'out of scope' },
      { worktree },
    ));
    assert.equal(res.ok, true);
    const doc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
    assert.equal(doc.items[0].history[0].state, 'wont-fix');
    assert.equal(doc.items[0].history[0].reason, 'out of scope');
  });

  test('rejects missing reason', async () => {
    worktree = makeWorktree();
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    writeActiveStage(worktree, { stage: 'forge:write', cycle: 'write-haiku' });
    const tWf = await tools(worktree);
    const res = parseResult(await tWf.foundry_feedback_wontfix.execute({ id, reason: '' }, { worktree }));
    assert.ok(res.error);
    assert.match(res.error, /reason/);
  });
});

describe('foundry_feedback_resolve — id-based', () => {
  async function setupToActioned(stage, cycle = 'write-haiku') {
    worktree = makeWorktree({ stage });
    const t1 = await tools(worktree);
    const { id } = parseResult(await t1.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: stage.startsWith('appraise') ? 'law:x' : 'validation' },
      { worktree },
    ));
    // Switch to forge, action it.
    writeActiveStage(worktree, { stage: 'forge:write', cycle });
    const t2 = await tools(worktree);
    const actRes = parseResult(await t2.foundry_feedback_action.execute({ id }, { worktree }));
    assert.equal(actRes.ok, true);
    return id;
  }

  test('source stage resolves an actioned item', async () => {
    const id = await setupToActioned('appraise:write-check');
    // Switch back to source.
    writeActiveStage(worktree, { stage: 'appraise:write-check', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved', reason: 'fix verified' },
      { worktree },
    ));
    assert.equal(res.ok, true);
    const doc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
    assert.equal(doc.items[0].history[0].state, 'resolved');
  });

  test('non-source stage cannot resolve', async () => {
    const id = await setupToActioned('appraise:write-check');
    writeActiveStage(worktree, { stage: 'appraise:other-check', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved' },
      { worktree },
    ));
    assert.match(res.error, /source/);
  });

  test('rejected resolution requires reason', async () => {
    const id = await setupToActioned('appraise:write-check');
    writeActiveStage(worktree, { stage: 'appraise:write-check', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'rejected' },
      { worktree },
    ));
    assert.match(res.error, /reason/);
  });
});

describe('foundry_feedback_resolve — deadlock override', () => {
  test('human-appraise can resolve a deadlocked item regardless of source', async () => {
    worktree = makeWorktree({ stage: 'appraise:write-check' });
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    // Simulate sort-side deadlock: write the snapshot directly via yaml.
    const feedbackPath = path.join(worktree, 'WORK.feedback.yaml');
    const doc = yaml.load(readFileSync(feedbackPath, 'utf-8'));
    doc.items[0].history.unshift({
      state: 'deadlocked',
      stage: 'sort',
      cycle: 'write-haiku',
      timestamp: new Date().toISOString(),
      reason: 'depth=3',
    });
    writeFileSync(feedbackPath, yaml.dump(doc), 'utf-8');

    // Switch to human-appraise stage, resolve it.
    writeActiveStage(worktree, { stage: 'human-appraise:review', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved', reason: 'accepting as-is' },
      { worktree },
    ));
    assert.equal(res.ok, true);
    const after = yaml.load(readFileSync(feedbackPath, 'utf-8'));
    assert.equal(after.items[0].history[0].state, 'resolved');
  });

  test('deadlock override requires a reason', async () => {
    worktree = makeWorktree({ stage: 'appraise:write-check' });
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    const feedbackPath = path.join(worktree, 'WORK.feedback.yaml');
    const doc = yaml.load(readFileSync(feedbackPath, 'utf-8'));
    doc.items[0].history.unshift({
      state: 'deadlocked',
      stage: 'sort',
      cycle: 'write-haiku',
      timestamp: new Date().toISOString(),
      reason: 'depth=3',
    });
    writeFileSync(feedbackPath, yaml.dump(doc), 'utf-8');
    writeActiveStage(worktree, { stage: 'human-appraise:review', cycle: 'write-haiku' });
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved' }, // no reason
      { worktree },
    ));
    assert.match(res.error, /reason/);
  });

  test('appraise CANNOT override a deadlocked item even when source matches', async () => {
    worktree = makeWorktree({ stage: 'appraise:write-check' });
    const tAdd = await tools(worktree);
    const { id } = parseResult(await tAdd.foundry_feedback_add.execute(
      { file: 'haiku.md', text: 'x', tag: 'law:x' },
      { worktree },
    ));
    const feedbackPath = path.join(worktree, 'WORK.feedback.yaml');
    const doc = yaml.load(readFileSync(feedbackPath, 'utf-8'));
    doc.items[0].history.unshift({
      state: 'deadlocked',
      stage: 'sort',
      cycle: 'write-haiku',
      timestamp: new Date().toISOString(),
      reason: 'depth=3',
    });
    writeFileSync(feedbackPath, yaml.dump(doc), 'utf-8');
    // active-stage is still appraise:write-check (matches source).
    const t = await tools(worktree);
    const res = parseResult(await t.foundry_feedback_resolve.execute(
      { id, resolution: 'approved', reason: 'trying' },
      { worktree },
    ));
    // State machine refuses: only human-appraise overrides deadlocked.
    assert.ok(res.error);
  });
});


