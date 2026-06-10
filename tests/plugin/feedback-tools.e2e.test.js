// tests/plugin/feedback-tools.e2e.test.js
// E2E tests for foundry_feedback_list — the only remaining feedback tool.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeWorktree({ cycle = 'write-haiku', flow = 'creative' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fdy-feedback-tools-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['checkout', '-q', '-b', 'work/feedback-test'], { cwd: dir, env: GIT_ENV });
  mkdirSync(path.join(dir, '.foundry'), { recursive: true });
  writeFileSync(
    path.join(dir, 'WORK.md'),
    `---\nflow: ${flow}\ncycle: ${cycle}\n---\n\n# Goal\n\ngo\n`,
    'utf-8',
  );
  return dir;
}

function seedFeedback(dir, items) {
  writeFileSync(
    path.join(dir, 'WORK.feedback.yaml'),
    yaml.dump({ items }),
    'utf-8',
  );
}

const now = new Date().toISOString();

function feedbackItem(overrides = {}) {
  return {
    id: overrides.id || '01HXY8K9Q5Z3WN0GJM2TYBR4AA',
    file: overrides.file || 'haiku.md',
    tag: overrides.tag || 'law:dark',
    text: overrides.text || 'too cheerful',
    source: overrides.source || 'appraise:write-check',
    artefact_version: overrides.artefact_version || '',
    history: [{
      state: overrides.state || 'open',
      stage: overrides.source || 'appraise:write-check',
      cycle: 'write-haiku',
      timestamp: now,
      ...(overrides.reason ? { reason: overrides.reason } : {}),
    }],
  };
}

let worktree;

afterEach(() => {
  if (worktree) {
    rmSync(worktree, { recursive: true, force: true });
    worktree = null;
  }
});

describe('foundry_feedback_list', () => {
  test('returns items with expected fields', async () => {
    worktree = makeWorktree();
    seedFeedback(worktree, [feedbackItem()]);
    const plugin = await FoundryPlugin({ directory: worktree });
    const raw = await plugin.tool.foundry_feedback_list.execute({}, { worktree });
    const items = JSON.parse(raw);
    assert.equal(Array.isArray(items), true);
    assert.equal(items.length, 1);
    const it = items[0];
    assert.equal(it.id, '01HXY8K9Q5Z3WN0GJM2TYBR4AA');
    assert.equal(it.file, 'haiku.md');
    assert.equal(it.tag, 'law:dark');
    assert.equal(it.text, 'too cheerful');
    assert.equal(it.source, 'appraise:write-check');
    assert.equal(it.state, 'open');
    assert.equal(it.depth, 1);
  });

  test('filters by file when file argument is supplied', async () => {
    worktree = makeWorktree();
    seedFeedback(worktree, [
      feedbackItem({ id: 'a', file: 'a.md' }),
      feedbackItem({ id: 'b', file: 'b.md' }),
    ]);
    const plugin = await FoundryPlugin({ directory: worktree });
    const raw = await plugin.tool.foundry_feedback_list.execute({ file: 'a.md' }, { worktree });
    const items = JSON.parse(raw);
    assert.equal(items.length, 1);
    assert.equal(items[0].file, 'a.md');
  });

  test('returns an empty array when WORK.feedback.yaml is absent', async () => {
    worktree = makeWorktree();
    const plugin = await FoundryPlugin({ directory: worktree });
    const raw = await plugin.tool.foundry_feedback_list.execute({}, { worktree });
    assert.deepEqual(JSON.parse(raw), []);
  });

  test('returns a tool-prefixed error when WORK.md is absent', async () => {
    worktree = makeWorktree();
    rmSync(path.join(worktree, 'WORK.md'), { force: true });
    const plugin = await FoundryPlugin({ directory: worktree });
    const raw = await plugin.tool.foundry_feedback_list.execute({}, { worktree });
    const res = JSON.parse(raw);
    assert.equal(res.error, 'foundry_feedback_list: WORK.md cycle not found');
  });

  test('works without an active stage (read-only)', async () => {
    worktree = makeWorktree();
    seedFeedback(worktree, [feedbackItem()]);
    const plugin = await FoundryPlugin({ directory: worktree });
    const raw = await plugin.tool.foundry_feedback_list.execute({}, { worktree });
    const items = JSON.parse(raw);
    assert.equal(items.length, 1);
  });

  test('reports resolved item state and depth correctly', async () => {
    worktree = makeWorktree();
    // Build the item manually so history contains all three transitions.
    const item = {
      id: 'resolved-item',
      file: 'haiku.md',
      tag: 'law:dark',
      text: 'too cheerful',
      source: 'appraise:write-check',
      artefact_version: '',
      history: [
        { state: 'resolved', stage: 'system', cycle: 'write-haiku', timestamp: now, reason: 'fixed' },
        { state: 'actioned', stage: 'forge:write-haiku', cycle: 'write-haiku', timestamp: now },
        { state: 'open', stage: 'appraise:write-check', cycle: 'write-haiku', timestamp: now },
      ],
    };
    seedFeedback(worktree, [item]);
    const plugin = await FoundryPlugin({ directory: worktree });
    const raw = await plugin.tool.foundry_feedback_list.execute({}, { worktree });
    const items = JSON.parse(raw);
    assert.equal(items.length, 1);
    assert.equal(items[0].state, 'resolved');
    assert.equal(items[0].depth, 3);
    assert.equal(items[0].reason, 'fixed');
  });
});
