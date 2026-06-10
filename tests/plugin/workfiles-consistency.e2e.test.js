import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { makeIO } from '../../src/plugin/tools/helpers.js';
import { appendEntry } from '../../src/scripts/lib/history.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function writeActiveStage(dir, { cycle = 'write-haiku', stage, baseSha = 'test-sha' }) {
  writeFileSync(
    path.join(dir, '.foundry', 'active-stage.json'),
    JSON.stringify({ cycle, stage, baseSha }),
    'utf-8',
  );
}

function makeWorktree({ stage = 'appraise:w', cycle = 'write-haiku', flow = 'creative' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fdy-workfiles-consistency-'));
  // Branch guard: feedback-* mutations need work/<x>.
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['checkout', '-q', '-b', 'work/wfc-test'], { cwd: dir, env: GIT_ENV });
  mkdirSync(path.join(dir, '.foundry'), { recursive: true });
  writeActiveStage(dir, { cycle, stage });
  writeFileSync(
    path.join(dir, 'WORK.md'),
    `---\nflow: ${flow}\ncycle: ${cycle}\nstages:\n  - appraise:w\n  - forge:w\n---\n\n# Goal\n\ngo\n`,
    'utf-8',
  );
  return dir;
}

async function tools(dir) {
  const plugin = await FoundryPlugin({ directory: dir });
  return plugin.tool;
}

function parseResult(raw) {
  return JSON.parse(raw);
}

function loadFeedbackAndHistory(worktree) {
  const feedbackDoc = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
  const historyEntries = yaml.load(readFileSync(path.join(worktree, 'WORK.history.yaml'), 'utf-8')) || [];
  return { feedbackDoc, historyEntries };
}

function appendHistory(worktree, entry) {
  appendEntry('WORK.history.yaml', entry, makeIO(worktree));
}

function isExemptSnapshot(snap) {
  // Sort-written deadlocked snapshots are exempt per spec §9.3. Any
  // other state on stage: sort is a bug and must be flagged. The reverse
  // direction is intentionally not asserted per spec §9.3.
  return snap.stage === 'sort' && snap.state === 'deadlocked';
}

function checkSnapshotHistory(item, snap, historyPairs) {
  if (isExemptSnapshot(snap)) return null;
  const key = `${snap.stage}||${snap.cycle}`;
  if (!historyPairs.has(key)) {
    return `${item.id}@${snap.state}: stage=${snap.stage} cycle=${snap.cycle}`;
  }
  return null;
}

function findMissingSnapshots(items, historyPairs) {
  const missing = [];
  for (const item of items) {
    for (const snap of item.history) {
      const mismatch = checkSnapshotHistory(item, snap, historyPairs);
      if (mismatch) missing.push(mismatch);
    }
  }
  return missing;
}

function assertFeedbackHistoryConsistent(feedbackDoc, historyEntries) {
  const historyPairs = new Set(historyEntries.map(e => `${e.stage}||${e.cycle}`));
  const items = feedbackDoc.items || [];
  const missing = findMissingSnapshots(items, historyPairs);

  if (missing.length) {
    assert.fail(`feedback/history inconsistency: ${missing.length} snapshots lack matching history rows:\n${missing.join('\n')}`);
  }
}

// A ULID-legal fixture id. 'I' is NOT in the Crockford base32 alphabet;
// use 'J' instead. 26 chars total: 3 prefix + 23 'Z'.
const FIXTURE_ID = 'JD0' + 'Z'.repeat(23);

describe('workfiles consistency — synthetic', () => {
  test('matching (stage, cycle) pairs pass the invariant', () => {
    const feedbackDoc = yaml.load(yaml.dump({
      items: [{
        id: FIXTURE_ID,
        file: 'a.md',
        tag: 'law:x',
        text: 't',
        source: 'appraise:w',
        history: [
          { state: 'resolved', stage: 'appraise:w', cycle: 'c1', timestamp: 'T3', reason: 'good now' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    }));
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
      { stage: 'forge:w', cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 1, iteration: 1, open_feedback: 1 },
      { stage: 'appraise:w', cycle: 'c1', comment: 'resolve', timestamp: 'T3', seq: 2, iteration: 1, open_feedback: 0 },
    ];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });

  test('missing history row for a non-sort stage fails', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'forge:w', cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 0, iteration: 0, open_feedback: 1 },
    ];
    assert.throws(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries), /inconsistency/);
  });

  test('a sort-written deadlocked snapshot is allowed without a history row', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'deadlocked', stage: 'sort', cycle: 'c1', timestamp: 'T4', reason: 'depth=3' },
          { state: 'rejected', stage: 'appraise:w', cycle: 'c1', timestamp: 'T3', reason: 'still bad' },
          { state: 'actioned', stage: 'forge:w', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
      { stage: 'forge:w', cycle: 'c1', comment: 'action', timestamp: 'T2', seq: 1, iteration: 1, open_feedback: 1 },
      { stage: 'appraise:w', cycle: 'c1', comment: 'reject', timestamp: 'T3', seq: 2, iteration: 1, open_feedback: 1 },
    ];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });

  test('a non-deadlocked snapshot on stage: sort FAILS the invariant', () => {
    const feedbackDoc = {
      items: [{
        id: FIXTURE_ID,
        file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:w',
        history: [
          { state: 'actioned', stage: 'sort', cycle: 'c1', timestamp: 'T2' },
          { state: 'open', stage: 'appraise:w', cycle: 'c1', timestamp: 'T1' },
        ],
      }],
    };
    const historyEntries = [
      { stage: 'appraise:w', cycle: 'c1', comment: 'open', timestamp: 'T1', seq: 0, iteration: 0, open_feedback: 1 },
    ];
    assert.throws(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries), /inconsistency/);
  });

  test('empty store with empty history passes', () => {
    const feedbackDoc = { items: [] };
    const historyEntries = [];
    assert.doesNotThrow(() => assertFeedbackHistoryConsistent(feedbackDoc, historyEntries));
  });
});

describe('workfiles consistency — driven', () => {
  test('after a full appraise/forge/appraise round-trip, the invariant holds', async () => {
    const worktree = makeWorktree();
    try {
      const now = new Date().toISOString();
      const itemId = '01HXY8K9Q5Z3WN0GJM2TYBR4ZZ';

      // Seed a feedback item directly (tools were removed; this simulates
      // what the orchestration does).
      writeFileSync(path.join(worktree, 'WORK.feedback.yaml'), yaml.dump({
        items: [{
          id: itemId, file: 'haiku.md', tag: 'law:dark',
          text: 'too cheerful', source: 'appraise:w',
          artefact_version: '',
          history: [{ state: 'open', stage: 'appraise:w', cycle: 'write-haiku', timestamp: now }],
        }],
      }));
      appendHistory(worktree, {
        cycle: 'write-haiku',
        stage: 'appraise:w',
        iteration: 0,
        comment: 'feedback added',
        openFeedback: 1,
      });
      assert.doesNotThrow(() => assertFeedbackHistoryConsistent(
        loadFeedbackAndHistory(worktree).feedbackDoc,
        loadFeedbackAndHistory(worktree).historyEntries,
      ));

      // Transition to actioned — simulate forge dispatch.
      const doc1 = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
      doc1.items[0].history.unshift({
        state: 'actioned', stage: 'forge:w', cycle: 'write-haiku', timestamp: new Date().toISOString(),
      });
      writeFileSync(path.join(worktree, 'WORK.feedback.yaml'), yaml.dump(doc1));
      appendHistory(worktree, {
        cycle: 'write-haiku',
        stage: 'forge:w',
        iteration: 1,
        comment: 'feedback actioned',
        openFeedback: 1,
      });
      assert.doesNotThrow(() => assertFeedbackHistoryConsistent(
        loadFeedbackAndHistory(worktree).feedbackDoc,
        loadFeedbackAndHistory(worktree).historyEntries,
      ));

      // Transition to resolved — simulate appraise consensus.
      const doc2 = yaml.load(readFileSync(path.join(worktree, 'WORK.feedback.yaml'), 'utf-8'));
      doc2.items[0].history.unshift({
        state: 'resolved', stage: 'appraise:w', cycle: 'write-haiku',
        timestamp: new Date().toISOString(), reason: 'fix verified',
      });
      writeFileSync(path.join(worktree, 'WORK.feedback.yaml'), yaml.dump(doc2));
      appendHistory(worktree, {
        cycle: 'write-haiku',
        stage: 'appraise:w',
        iteration: 1,
        comment: 'feedback resolved',
        openFeedback: 0,
      });
      assert.doesNotThrow(() => assertFeedbackHistoryConsistent(
        loadFeedbackAndHistory(worktree).feedbackDoc,
        loadFeedbackAndHistory(worktree).historyEntries,
      ));
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});
