/**
 * Tests for run-human-appraise.js — human-appraise stage handlers.
 *
 * Covers loadDeadlockItems (4.2), deadlock resolution loop (4.3),
 * always-human-appraise approval/rejection (4.4), and post-removal
 * behaviour (4.5).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeMockIO } from '../helpers/mock-io.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeedbackItem(opts = {}) {
  const id = opts.id || 'item-01';
  const state = opts.state || 'open';
  const history = opts.history || [{ state, stage: 'forge:cycle-1', cycle: 'cycle-1', timestamp: '2025-01-01T00:00:00Z' }];
  return {
    id,
    file: opts.file || 'src/main.js',
    tag: opts.tag || 'law:quality',
    text: opts.text || 'some issue',
    source: opts.source || 'appraise:cycle-1',
    cycle: opts.cycle || 'cycle-1',
    history,
  };
}

function makeFullHistoryItem(id, states) {
  const history = states.map((s, i) => ({
    state: s,
    stage: 'forge:cycle-1',
    cycle: 'cycle-1',
    timestamp: `2025-01-0${i + 1}T00:00:00Z`,
    ...(s === 'wont-fix' ? { reason: 'not applicable' } : {}),
  }));
  return makeFeedbackItem({ id, history, state: states[0] });
}

let _fileCounter = 0;
function writeStageOutputFile(dir, data) {
  const outDir = join(dir, '.foundry/stage-outputs');
  mkdirSync(outDir, { recursive: true });
  _fileCounter++;
  writeFileSync(join(outDir, 'output-' + _fileCounter + '.jsonl'), JSON.stringify(data) + '\n');
}

function makeActiveStage(overrides = {}) {
  return {
    cycle: overrides.cycle || 'cycle-1',
    stage: overrides.stage || 'human-appraise:cycle-1',
    boundaryMarker: overrides.boundaryMarker || 'marker-msg',
    baseSha: overrides.baseSha || 'abc123',
    startedAt: overrides.startedAt || '2025-01-01T00:00:00Z',
  };
}

function makeWorkMd(fmOverrides = {}) {
  const fm = {
    flow: 'haiku',
    cycle: 'cycle-1',
    'artefact-path': 'haikus/test.md',
    goal: 'write a haiku',
    ...fmOverrides,
  };
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (typeof v === 'boolean') {
      lines.push(k + ': ' + (v ? 'true' : 'false'));
    } else {
      lines.push(k + ': ' + JSON.stringify(v));
    }
  }
  lines.push('---');
  lines.push('');
  lines.push('# Work');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 4.2 — loadDeadlockItems returns full items
// ---------------------------------------------------------------------------

describe('loadDeadlockItems — returns full feedback items with history', () => {
  test('returns full item objects including history array', async () => {
    const feedbackYaml = `items:
  - id: item-01
    file: src/main.js
    tag: law:quality
    text: needs work
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
      - state: open
        stage: forge:cycle-1
        cycle: cycle-1
        timestamp: "2025-01-01T00:00:00Z"
`;
    const io = makeMockIO({
      'WORK.feedback.yaml': feedbackYaml,
      'WORK.md': makeWorkMd({ 'deadlock-human-appraise': true }),
    });

    const { loadDeadlockItems } = await import('../../src/scripts/run-human-appraise.js');
    const items = loadDeadlockItems(io, 'WORK.feedback.yaml');

    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'item-01');
    assert.equal(items[0].file, 'src/main.js');
    assert.equal(items[0].text, 'needs work');
    assert.equal(items[0].source, 'appraise:cycle-1');
    assert.ok(Array.isArray(items[0].history), 'history should be an array');
    assert.equal(items[0].history.length, 2, 'should have full history');
    assert.equal(items[0].history[0].state, 'deadlocked');
    assert.equal(items[0].history[1].state, 'open');
  });

  test('excludes resolved items', async () => {
    const feedbackYaml = `items:
  - id: item-01
    file: src/main.js
    tag: law:quality
    text: resolved issue
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: resolved
        stage: appraise:cycle-1
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
  - id: item-02
    file: src/main.js
    tag: law:quality
    text: deadlocked issue
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
`;
    const io = makeMockIO({
      'WORK.feedback.yaml': feedbackYaml,
      'WORK.md': makeWorkMd({ 'deadlock-human-appraise': true }),
    });

    const { loadDeadlockItems } = await import('../../src/scripts/run-human-appraise.js');
    const items = loadDeadlockItems(io, 'WORK.feedback.yaml');

    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'item-02');
  });
});

// ---------------------------------------------------------------------------
// 4.3 — Deadlock override resolution loop
// ---------------------------------------------------------------------------

describe('handleHumanAppraiseResume — deadlock override', () => {
  test('resolves and rejects deadlocked items via stage output records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-deadlock-'));
    try {
      // Write WORK.md with deadlock config
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({ 'deadlock-human-appraise': true }));

      // Write WORK.feedback.yaml with deadlocked items
      const feedbackYaml = `items:
  - id: item-resolve
    file: src/main.js
    tag: law:quality
    text: fix this
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
  - id: item-reject
    file: src/main.js
    tag: law:quality
    text: wrong approach
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
`;
      writeFileSync(join(dir, 'WORK.feedback.yaml'), feedbackYaml);

      // Write stage-output files with resolution records
      writeStageOutputFile(dir, { verdict: 'resolved', itemId: 'item-resolve' });
      writeStageOutputFile(dir, { verdict: 'rejected', itemId: 'item-reject', feedback: 'still broken' });

      // We need a real IO interface that reads/writes to the temp dir
      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();

      // Call handleHumanAppraiseResume
      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      const result = await handleHumanAppraiseResume(realIo, activeStage);

      // Re-open the store to read updated state
      const { openFeedbackStore } = await import('../../src/scripts/lib/feedback-store.js');
      const store = openFeedbackStore('WORK.feedback.yaml', realIo);
      const items = store.list();

      // Verify deadlocked items were resolved
      const resolvedItem = items.find(i => i.id === 'item-resolve');
      const rejectedItem = items.find(i => i.id === 'item-reject');

      assert.ok(resolvedItem, 'item-resolve should exist');
      assert.equal(resolvedItem.history[0].state, 'resolved');

      assert.ok(rejectedItem, 'item-reject should exist');
      assert.equal(rejectedItem.history[0].state, 'rejected');

      // Verify a new feedback entry was added for the rejection with feedback
      const feedbackEntry = items.find(i =>
        i.text === 'still broken' && i.tag === 'human'
      );
      assert.ok(feedbackEntry,
        'a new feedback entry should exist for the rejection feedback');
      assert.equal(feedbackEntry.file, 'src/main.js');
      assert.equal(feedbackEntry.tag, 'human');

      // Stage should close once all deadlocked items are resolved
      assert.ok(result.action === 'continue-run' || result.action === 'done',
        'expected continue-run or done, got: ' + result.action);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('partial resolution re-prompts with remaining unresolved items', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-partial-'));
    try {
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({ 'deadlock-human-appraise': true }));

      const feedbackYaml = `items:
  - id: item-01
    file: src/main.js
    tag: law:quality
    text: first issue
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
  - id: item-02
    file: src/main.js
    tag: law:quality
    text: second issue
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
  - id: item-03
    file: src/main.js
    tag: law:quality
    text: third issue
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
`;
      writeFileSync(join(dir, 'WORK.feedback.yaml'), feedbackYaml);

      // Only resolve 2 of 3 items
      writeStageOutputFile(dir, { verdict: 'resolved', itemId: 'item-01' });
      writeStageOutputFile(dir, { verdict: 'rejected', itemId: 'item-02', feedback: 'no' });

      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();

      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      const result = await handleHumanAppraiseResume(realIo, activeStage);

      // Should re-prompt since item-03 is still deadlocked
      assert.equal(result.action, 'prompt_user',
        'expected prompt_user for remaining items, got: ' + result.action);
      assert.ok(Array.isArray(result.feedback), 'feedback should be an array');

      // The prompt_user returns unresolved items (from loadDeadlockItems)
      // item-01 was resolved, item-02 was rejected (which transitions to rejected state)
      // item-03 is still deadlocked
      const unresolvedIds = result.feedback.map(function(i) { return i.id; });
      assert.ok(unresolvedIds.includes('item-03'),
        'item-03 should be in remaining items, got: ' + JSON.stringify(unresolvedIds));
      // item-02 was rejected (which is not resolved), so it might also appear
      // The important thing is item-01 is NOT in the list
      assert.ok(!unresolvedIds.includes('item-01'),
        'item-01 should not be in remaining items');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns violation when deadlock-human-appraise is true but no items are deadlocked', async () => {
    const feedbackYaml = `items:
  - id: item-01
    file: src/main.js
    tag: law:quality
    text: open issue
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: open
        stage: forge:cycle-1
        cycle: cycle-1
        timestamp: "2025-01-01T00:00:00Z"
  - id: item-02
    file: src/main.js
    tag: law:quality
    text: resolved issue
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: resolved
        stage: appraise:cycle-1
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
`;
    const io = makeMockIO({
      'WORK.md': makeWorkMd({ 'deadlock-human-appraise': true }),
      'WORK.feedback.yaml': feedbackYaml,
    });
    const activeStage = makeActiveStage();
    

    const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
    const result = await handleHumanAppraiseResume(io, activeStage);

    assert.equal(result.action, 'violation',
      'expected violation when no deadlocked items exist, got: ' + result.action);
    assert.ok(result.details.includes('no items in deadlocked state'),
      'violation details should mention missing deadlocked items, got: ' + result.details);
  });

  test('deadlock takes priority when both deadlock-human-appraise and always-human-appraise are set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-priority-'));
    try {
      // Set BOTH flags — deadlock must take priority
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({
        'deadlock-human-appraise': true,
        'always-human-appraise': true,
      }));

      // Create items in deadlocked state
      const feedbackYaml = `items:
  - id: item-01
    file: src/main.js
    tag: law:quality
    text: fix this
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
  - id: item-02
    file: src/main.js
    tag: law:quality
    text: wrong approach
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
`;
      writeFileSync(join(dir, 'WORK.feedback.yaml'), feedbackYaml);

      // Write stage-output records for deadlock resolution
      writeStageOutputFile(dir, { verdict: 'resolved', itemId: 'item-01' });
      writeStageOutputFile(dir, { verdict: 'rejected', itemId: 'item-02', feedback: 'still broken' });

      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();

      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      const result = await handleHumanAppraiseResume(realIo, activeStage);

      // Re-open the store to read updated state
      const { openFeedbackStore } = await import('../../src/scripts/lib/feedback-store.js');
      const store = openFeedbackStore('WORK.feedback.yaml', realIo);
      const items = store.list();

      // Deadlock path was taken: items transitioned to resolved/rejected
      const resolvedItem = items.find(i => i.id === 'item-01');
      const rejectedItem = items.find(i => i.id === 'item-02');

      assert.ok(resolvedItem, 'item-01 should exist');
      assert.equal(resolvedItem.history[0].state, 'resolved',
        'deadlock path should have resolved item-01');

      assert.ok(rejectedItem, 'item-02 should exist');
      assert.equal(rejectedItem.history[0].state, 'rejected',
        'deadlock path should have rejected item-02');

      // Stage should close once all deadlocked items are resolved
      assert.ok(result.action === 'continue-run' || result.action === 'done',
        'expected continue-run or done, got: ' + result.action);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejected items with feedback create new feedback entries in the store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-fb-entry-'));
    try {
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({ 'deadlock-human-appraise': true }));

      const feedbackYaml = `items:
  - id: item-01
    file: src/lib/main.js
    tag: law:quality
    text: wrong approach
    source: appraise:cycle-1
    cycle: cycle-1
    history:
      - state: deadlocked
        stage: sort
        cycle: cycle-1
        timestamp: "2025-01-02T00:00:00Z"
`;
      writeFileSync(join(dir, 'WORK.feedback.yaml'), feedbackYaml);

      // Single rejection with feedback
      writeStageOutputFile(dir, { verdict: 'rejected', itemId: 'item-01', feedback: 'needs more work' });

      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();

      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      await handleHumanAppraiseResume(realIo, activeStage);

      const { openFeedbackStore } = await import('../../src/scripts/lib/feedback-store.js');
      const store = openFeedbackStore('WORK.feedback.yaml', realIo);
      const items = store.list();

      // Original item should be rejected
      const original = items.find(i => i.id === 'item-01');
      assert.ok(original, 'original item should exist');
      assert.equal(original.history[0].state, 'rejected',
        'original item should be rejected');

      // A new feedback entry should have been added for the rejection feedback
      const newFeedback = items.find(i =>
        i.text === 'needs more work' && i.tag === 'human'
      );
      assert.ok(newFeedback,
        'a new feedback entry should be created for the rejection text');
      assert.equal(newFeedback.file, 'src/lib/main.js',
        'new feedback entry should reference the same file');
      assert.equal(newFeedback.source, 'human-appraise:cycle-1',
        'new feedback entry source should be human-appraise');

      // The store should have 2 items (original + new feedback)
      assert.equal(items.length, 2,
        'store should contain the original item plus the new feedback entry');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4.4 — Always-human-appraise
// ---------------------------------------------------------------------------

describe('handleHumanAppraiseResume — always-human-appraise', () => {
  test('approves and closes stage when verdict is approved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-approve-'));
    try {
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({ 'always-human-appraise': true }));
      writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []\n');
      writeStageOutputFile(dir, { verdict: 'approved' });

      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();

      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      const result = await handleHumanAppraiseResume(realIo, activeStage);

      assert.equal(result.action, 'continue-run',
        'expected continue-run on approval, got: ' + result.action);

      // Verify stage was closed
      assert.ok(!realIo.exists('.foundry/active-stage.json'),
        'active-stage should be cleared');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects with feedback stores feedback and closes stage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-reject-'));
    try {
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({ 'always-human-appraise': true }));
      writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []\n');
      writeStageOutputFile(dir, { verdict: 'rejected', feedback: 'wrong approach' });

      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();
      

      // Store feedback was added
      const { openFeedbackStore } = await import('../../src/scripts/lib/feedback-store.js');

      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      const result = await handleHumanAppraiseResume(realIo, activeStage);

      assert.equal(result.action, 'continue-run',
        'expected continue-run on rejection, got: ' + result.action);

      // Verify feedback was stored
      const store = openFeedbackStore('WORK.feedback.yaml', realIo);
      const items = store.list();
      assert.equal(items.length, 1, 'one feedback item should be stored');
      assert.equal(items[0].text, 'wrong approach');
      assert.equal(items[0].tag, 'human');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns prompt_user when no stage-output files exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-nostage-'));
    try {
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({ 'always-human-appraise': true }));
      writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []\n');

      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();

      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      const result = await handleHumanAppraiseResume(realIo, activeStage);

      // No implicit approval — should prompt user
      assert.equal(result.action, 'prompt_user',
        'expected prompt_user (no implicit approval), got: ' + result.action);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4.5 — Verbatim-capture dead code removed
// ---------------------------------------------------------------------------

describe('post-removal — verbatim-capture dead code', () => {
  test('handleHumanAppraiseResume returns prompt_user with empty stage-output (not implicit approval)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-prompt-'));
    try {
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({ 'always-human-appraise': true }));
      writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []\n');

      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();

      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      const result = await handleHumanAppraiseResume(realIo, activeStage);

      assert.equal(result.action, 'prompt_user',
        'expected prompt_user, not implicit approval');
      assert.ok(result.stage, 'prompt_user should include stage');
      assert.ok(result.artefact, 'prompt_user should include artefact');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('verbatim-capture.txt is never created', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ha-noverb-'));
    try {
      writeFileSync(join(dir, 'WORK.md'), makeWorkMd({ 'always-human-appraise': true }));
      writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []\n');
      writeStageOutputFile(dir, { verdict: 'approved' });

      const fs = await import('node:fs');
      const path = await import('node:path');
      const realIo = {
        exists: (p) => fs.existsSync(path.resolve(dir, p)),
        readFile: (p) => fs.readFileSync(path.resolve(dir, p), 'utf8'),
        writeFile: (p, c) => fs.writeFileSync(path.resolve(dir, p), c),
        rename: (from, to) => fs.renameSync(path.resolve(dir, from), path.resolve(dir, to)),
        unlink: (p) => { try { fs.unlinkSync(path.resolve(dir, p)); } catch {} },
        mkdir: (p) => fs.mkdirSync(path.resolve(dir, p), { recursive: true }),
        readDir: (p) => {
          try { return fs.readdirSync(path.resolve(dir, p)); } catch { return []; }
        },
        exec: (cmd) => '',
      };

      const activeStage = makeActiveStage();

      const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
      await handleHumanAppraiseResume(realIo, activeStage);

      // Verify verbatim-capture.txt was NOT created
      assert.ok(!realIo.exists('.foundry/verbatim-capture.txt'),
        'verbatim-capture.txt must not be created');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no old verbatim-capture or approval regex code remains in source', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = path.resolve(
      fileURLToPath(new URL('../../src/scripts/run-human-appraise.js', import.meta.url))
    );
    const source = fs.readFileSync(sourcePath, 'utf8');

    // The old approval word heuristic regex must be completely removed
    assert.ok(!source.includes('looks good|approved|ok|fine|pass|lgtm'),
      'approval word heuristic regex pattern must not appear in source');
    assert.ok(!source.includes('verbatim-capture'),
      'verbatim-capture references must not appear in source');
    assert.ok(!source.includes('ver bt imCapture'),
      'variant spellings of verbatim-capture must not appear');

    // Old removed functions must not be referenced
    const oldFunctions = [
      'handleApprovalCapture', 'handleEmptyCapture',
      'handleFreeFormCapture', 'handleDeadlockCapture',
      'writeVerbatimCapture', 'readVerbatimCapture',
      'deleteVerbatimCapture', 'captureUserText',
      'doCapture', 'storeFeedbackFromCapture',
    ];
    for (const fn of oldFunctions) {
      assert.ok(!source.includes(fn),
        `${fn} must not appear in source after removal`);
    }
  });
});

// ---------------------------------------------------------------------------
// No scenario configured
// ---------------------------------------------------------------------------

describe('handleHumanAppraiseResume — no scenario configured', () => {
  test('returns violation when neither deadlock-human-appraise nor always-human-appraise is set', async () => {
    const io = makeMockIO({
      'WORK.md': makeWorkMd({}),
      'WORK.feedback.yaml': 'items: []\n',
    });
    const activeStage = makeActiveStage();
    

    const { handleHumanAppraiseResume } = await import('../../src/scripts/run-human-appraise.js');
    const result = await handleHumanAppraiseResume(io, activeStage);

    assert.equal(result.action, 'violation',
      'expected violation when no scenario is configured, got: ' + result.action);
    assert.ok(result.details.includes('no scenario configured'),
      'violation details should mention missing scenario configuration');
    assert.equal(result.recoverable, false,
      'violation should not be recoverable');
  });
});
