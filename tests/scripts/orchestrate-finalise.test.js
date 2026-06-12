/**
 * Tests for the sealCycleAttestation wrapper in orchestrate-finalise.js.
 *
 * The wrapper delegates to hash.js's sealCycleAttestation for hashing,
 * then amends the HEAD commit with seal fields (foundry-run,
 * attestation-seal, composite-status, stage-count).
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock hash.js — provide all exports consumed transitively so dependent
// modules (history.js, artefacts.js, etc.) resolve successfully.
// ---------------------------------------------------------------------------

let hashReturnValue = {
  ok: true,
  cycle: 'test-cycle',
  composite_status: 'pass',
  stage_count: 3,
  seal_hash: 'abc123def456',
};
let hashSealCallCount = 0;

mock.module('../../src/scripts/lib/attestation/hash.js', {
  exports: {
    sha256Text: () => 'abc123',
    sha256Buffer: () => 'abc123',
    sortPaths: p => [...p].sort(),
    hashAttestation: () => 'abc123',
    generateRunId: () => '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    appendStageAttestation: () => {},
    sealCycleAttestation: () => {
      hashSealCallCount++;
      if (hashReturnValue instanceof Error) throw hashReturnValue;
      return hashReturnValue;
    },
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGitMock() {
  const calls = [];
  return {
    execFile: (args) => {
      calls.push(args);
      if (args[0] === 'log' && args[1] === '-1') {
        return 'feat: initial commit\n';
      }
      return '';
    },
    _calls: calls,
  };
}

const RUN_ID = '01JKVT7Z8Q3WN0GJM2TYBR4BB';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sealCycleAttestation wrapper', () => {
  let sealCycleAttestation;

  before(async () => {
    const mod = await import('../../src/scripts/orchestrate-finalise.js');
    sealCycleAttestation = mod.sealCycleAttestation;
  });

  beforeEach(() => {
    hashReturnValue = {
      ok: true,
      cycle: 'test-cycle',
      composite_status: 'pass',
      stage_count: 3,
      seal_hash: 'abc123def456',
    };
  });

  it('delegates to hash.js and returns correct shape', () => {
    const git = createGitMock();

    const result = sealCycleAttestation({ runId: RUN_ID, git, io: {} });

    assert.equal(result.ok, true);
    assert.equal(result.sealSha, 'abc123def456');
    assert.equal(result.compositeStatus, 'pass');
    assert.equal(result.stageCount, 3);

    // git commit --amend was called
    const amendCall = git._calls.find(c => c[0] === 'commit');
    assert.ok(amendCall, 'git execFile called with commit as first arg');
    assert.equal(amendCall[0], 'commit');
    assert.equal(amendCall[1], '--amend');
  });

  it('returns violation when hashSealCycle fails', () => {
    // Scenario A: hashSealCycle throws
    hashReturnValue = new Error('seal failed');
    let result = sealCycleAttestation({ runId: RUN_ID, git: createGitMock(), io: {} });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'seal failed');

    // Scenario B: hashSealCycle returns error result
    hashReturnValue = { ok: false, error: 'no file' };
    result = sealCycleAttestation({ runId: RUN_ID, git: createGitMock(), io: {} });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no file');
  });

  it('produces deterministic hash for same inputs', () => {
    const hash = 'deterministic-hash-789';
    hashReturnValue = {
      ok: true,
      cycle: 'test-cycle',
      composite_status: 'pass',
      stage_count: 3,
      seal_hash: hash,
    };

    const git1 = createGitMock();
    const git2 = createGitMock();

    const r1 = sealCycleAttestation({ runId: RUN_ID, git: git1, io: {} });
    const r2 = sealCycleAttestation({ runId: RUN_ID, git: git2, io: {} });

    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.sealSha, hash);
    assert.equal(r2.sealSha, hash);
  });

  it('includes all four fields in commit body', () => {
    hashReturnValue = {
      ok: true,
      cycle: 'test-cycle',
      composite_status: 'pass',
      stage_count: 3,
      seal_hash: 'abc123def456',
    };

    const git = createGitMock();

    sealCycleAttestation({ runId: RUN_ID, git, io: {} });

    const amendCall = git._calls.find(c => c[0] === 'commit');
    assert.ok(amendCall, 'git commit --amend called');
    const msg = amendCall[amendCall.length - 1];
    assert.ok(msg.includes('foundry-run:'), 'commit body includes foundry-run');
    assert.ok(msg.includes('attestation-seal:'), 'commit body includes attestation-seal');
    assert.ok(msg.includes('composite-status:'), 'commit body includes composite-status');
    assert.ok(msg.includes('stage-count:'), 'commit body includes stage-count');
  });
});

// ---------------------------------------------------------------------------
// Helpers for finaliseStage tests
// ---------------------------------------------------------------------------

function createIoMock({ workMdContent, cycleName, cycleStages, historyContent, feedbackExists }) {
  const store = {};

  // Populate store with initial content
  store['WORK.md'] = workMdContent;

  if (cycleName && cycleStages) {
    const stagesYaml = cycleStages.map(s => '  - ' + s).join('\n');
    store[`.foundry/cycles/${cycleName}.yaml`] = `stages:\n${stagesYaml}\n`;
  }

  if (historyContent !== undefined) {
    store['WORK.history.yaml'] = historyContent;
  }

  if (feedbackExists) {
    store['WORK.feedback.yaml'] = '';
  }

  return {
    _store: store,
    readFile: (path) => {
      if (path in store) return store[path];
      const err = new Error(`ENOENT: ${path}`);
      err.code = 'ENOENT';
      throw err;
    },
    exists: (path) => path in store,
    writeFile: (path, content) => { store[path] = content; },
    unlink: (path) => { delete store[path]; },
    rename: (oldPath, newPath) => {
      if (oldPath in store) {
        store[newPath] = store[oldPath];
        delete store[oldPath];
      }
    },
  };
}

function createFinalizeMock(result) {
  const calls = [];
  const fn = async () => {
    calls.push('finalize');
    return result;
  };
  fn._calls = calls;
  return fn;
}

function createGitMockForFinalise() {
  const calls = [];
  return {
    commit: (message, _opts) => {
      calls.push({ method: 'commit', message });
    },
    execFile: (args) => {
      calls.push({ method: 'execFile', args });
      if (args[0] === 'log' && args[1] === '-1') {
        return 'feat: initial commit\n';
      }
      return '';
    },
    _calls: calls,
  };
}

const CYCLE_NAME = 'test-cycle';
const FINAL_STAGES = ['plan', 'build', 'test', 'finalise'];

const WORK_MD_FM = `---
foundry-run: ${RUN_ID}
foundry-cycle: ${CYCLE_NAME}
---

Some body content`;

const WORK_MD_NO_RUN = `---
foundry-cycle: ${CYCLE_NAME}
---

Some body content`;

// ---------------------------------------------------------------------------
// finaliseStage integration tests
// ---------------------------------------------------------------------------

describe('finaliseStage', () => {
  let finaliseStageMod;

  before(async () => {
    const mod = await import('../../src/scripts/orchestrate-finalise.js');
    finaliseStageMod = mod.finaliseStage;
  });

  beforeEach(() => {
    hashSealCallCount = 0;
  });

  it('calls sealCycleAttestation when final stage completes (T5.2 2a)', async () => {
    const io = createIoMock({
      workMdContent: WORK_MD_FM,
      cycleName: CYCLE_NAME,
      cycleStages: FINAL_STAGES,
    });

    const git = createGitMockForFinalise();
    const finalize = createFinalizeMock({ ok: true, changedFiles: [] });

    const result = await finaliseStageMod({
      lastStage: { stage: 'finalise', baseSha: 'abc123' },
      activeStage: { stage: 'finalise' },
      cycleId: CYCLE_NAME,
      io,
      finalize,
      git,
      postVersion: '1.0.0',
      contractPassed: true,
      structuredSummary: 'final stage summary',
    });

    assert.equal(result, null, 'finaliseStage returns null on success');
    assert.equal(hashSealCallCount, 1, 'sealCycleAttestation was called once');
  });

  it('skips sealCycleAttestation for intermediate stage (T5.2 2b)', async () => {
    const io = createIoMock({
      workMdContent: WORK_MD_FM,
      cycleName: CYCLE_NAME,
      cycleStages: FINAL_STAGES,
    });

    const git = createGitMockForFinalise();
    const finalize = createFinalizeMock({ ok: true, changedFiles: [] });

    const result = await finaliseStageMod({
      lastStage: { stage: 'build', baseSha: 'abc123' },
      activeStage: { stage: 'build' },
      cycleId: CYCLE_NAME,
      io,
      finalize,
      git,
      postVersion: '1.0.0',
      contractPassed: true,
      structuredSummary: 'intermediate stage summary',
    });

    assert.equal(result, null, 'finaliseStage returns null on success');
    assert.equal(hashSealCallCount, 0, 'sealCycleAttestation was not called');
  });

  it('handles seal failure with warning without blocking finalise (T5.2 2c)', async () => {
    // Make the seal return failure
    hashReturnValue = { ok: false, error: 'simulated seal failure' };

    const io = createIoMock({
      workMdContent: WORK_MD_FM,
      cycleName: CYCLE_NAME,
      cycleStages: FINAL_STAGES,
    });

    const git = createGitMockForFinalise();
    const finalize = createFinalizeMock({ ok: true, changedFiles: [] });

    const result = await finaliseStageMod({
      lastStage: { stage: 'finalise', baseSha: 'abc123' },
      activeStage: { stage: 'finalise' },
      cycleId: CYCLE_NAME,
      io,
      finalize,
      git,
      postVersion: '1.0.0',
      contractPassed: true,
      structuredSummary: 'final stage summary',
    });

    assert.equal(result, null, 'finaliseStage returns null despite seal failure');
    assert.equal(hashSealCallCount, 1, 'sealCycleAttestation was called once');
  });
});
