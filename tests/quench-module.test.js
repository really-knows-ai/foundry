/**
 * Unit tests for quench-module.js — runQuench() with mocked dependencies.
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock quench-module's imported dependencies before it is loaded.
// Specifiers are relative to this test file (in tests/ directory).
// ---------------------------------------------------------------------------

const mockReadActiveStage = mock.fn();
const mockGetArtefactsForCycle = mock.fn();
const mockSetArtefactStatus = mock.fn();
const mockPerformValidation = mock.fn();

mock.module('../src/scripts/lib/state.js', {
  exports: { readActiveStage: mockReadActiveStage },
});

mock.module('../src/scripts/lib/artefacts.js', {
  exports: {
    getArtefactsForCycle: mockGetArtefactsForCycle,
    setArtefactStatus: mockSetArtefactStatus,
  },
});

mock.module('../src/scripts/lib/validation.js', {
  exports: { performValidation: mockPerformValidation },
});

// Module under test — loaded dynamically after mocks are in place
let runQuench;

beforeEach(async () => {
  mockReadActiveStage.mock.resetCalls();
  mockGetArtefactsForCycle.mock.resetCalls();
  mockSetArtefactStatus.mock.resetCalls();
  mockPerformValidation.mock.resetCalls();

  // Re-import to get fresh mocks for each test
  const mod = await import('../src/scripts/quench-module.js');
  runQuench = mod.runQuench;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_SHA = 'abc1234';

function makeMockIO(overrides = {}) {
  return {
    readFile: overrides.ioReadFile ?? mock.fn(() => ''),
    writeFile: overrides.ioWriteFile ?? mock.fn(),
    exists: overrides.ioExists ?? mock.fn(() => true),
  };
}

function makeMockFeedback(overrides = {}) {
  return {
    add: overrides.feedbackAdd ?? mock.fn(),
    list: overrides.feedbackList ?? mock.fn(() => []),
    resolve: overrides.feedbackResolve ?? mock.fn(),
  };
}

function createMockCtx(overrides = {}) {
  return {
    cycleId: 'test-cycle',
    stageId: 'quench:test-cycle',
    io: makeMockIO(overrides),
    git: {},
    finalize: overrides.finalize ?? mock.fn(),
    feedback: makeMockFeedback(overrides),
    now: () => new Date().toISOString(),
    ulid: () => 'test-ulid-' + Math.random().toString(36).slice(2, 8),
    foundryDir: '/tmp/test/foundry',
  };
}

function makeValidationResult(overrides = {}) {
  return {
    ok: true,
    validatorsRun: 0,
    items: [],
    errors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC1.2: No artefacts → { ok: true, summary: 'SKIP: no artefacts' }
// ---------------------------------------------------------------------------

describe('runQuench — no artefacts', () => {
  it('returns SKIP with ok true when no artefacts exist', async () => {
    mockReadActiveStage.mock.mockImplementation(() => ({ stage: {}, baseSha: BASE_SHA }));
    mockGetArtefactsForCycle.mock.mockImplementation(() => []);

    const finalize = mock.fn();
    const ctx = createMockCtx({ finalize });
    const result = await runQuench(ctx);

    assert.equal(result.ok, true);
    assert.equal(result.summary, 'SKIP: no artefacts');
    assert.equal(finalize.mock.calls.length, 1);
    assert.equal(finalize.mock.calls[0].arguments[0].lastStage.stage, 'quench:test-cycle');
    assert.equal(finalize.mock.calls[0].arguments[0].lastStage.summary, 'SKIP: no artefacts');
    assert.equal(finalize.mock.calls[0].arguments[0].lastStage.baseSha, BASE_SHA);
    assert.deepEqual(finalize.mock.calls[0].arguments[0].activeStage, { stage: {}, baseSha: BASE_SHA });
  });
});

// ---------------------------------------------------------------------------
// AC1.1: runQuench is exported and callable with mocked ctx
// ---------------------------------------------------------------------------

describe('runQuench — basic interface', () => {
  it('is exported as a function', () => {
    assert.equal(typeof runQuench, 'function');
  });

  it('returns error when no active stage is found', async () => {
    mockReadActiveStage.mock.mockImplementation(() => null);

    const ctx = createMockCtx();
    const result = await runQuench(ctx);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'No active stage found');
  });
});

// ---------------------------------------------------------------------------
// AC1.6: No validators configured → ok: true with 'OK: no validators'
// ---------------------------------------------------------------------------

describe('runQuench — no validators configured', () => {
  it('reports OK: no validators and does not post feedback or block', async () => {
    mockReadActiveStage.mock.mockImplementation(() => ({ stage: {}, baseSha: BASE_SHA }));
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      { file: 'haiku.md', type: 'haiku', cycle: 'test-cycle', status: 'draft' },
    ]);
    mockPerformValidation.mock.mockImplementation(() =>
      makeValidationResult({ ok: true, validatorsRun: 0, items: [], errors: [] })
    );

    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createMockCtx({ feedbackAdd, finalize });

    const result = await runQuench(ctx);

    assert.equal(result.ok, true);
    assert.match(result.summary, /OK: no validators/);
    assert.equal(feedbackAdd.mock.calls.length, 0);
    assert.equal(mockSetArtefactStatus.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC1.3: Validators with items → feedback posted, resolved, finalised
// ---------------------------------------------------------------------------

describe('runQuench — happy path with passing validators', () => {
  it('posts feedback, resolves prior feedback, and finalises stage', async () => {
    mockReadActiveStage.mock.mockImplementation(() => ({ stage: {}, baseSha: BASE_SHA }));
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      { file: 'haiku.md', type: 'haiku', cycle: 'test-cycle', status: 'draft' },
    ]);
    mockPerformValidation.mock.mockImplementation(() =>
      makeValidationResult({
        ok: true,
        validatorsRun: 2,
        items: [
          { lawId: 'dark', validatorId: 'v1', file: 'haiku.md', text: 'too dark' },
          { lawId: 'form', validatorId: 'v2', file: 'haiku.md', text: 'wrong format' },
        ],
      })
    );

    const feedbackAdd = mock.fn();
    const priorItems = [
      { id: 'prior1', file: 'haiku.md', tag: 'law:dark:v1', source: 'quench:test-cycle' },
      { id: 'prior2', file: 'haiku.md', tag: 'law:form:v2', source: 'quench:test-cycle' },
    ];
    const feedbackList = mock.fn(() => priorItems);
    const feedbackResolve = mock.fn();
    const finalize = mock.fn();

    const ctx = createMockCtx({ feedbackAdd, feedbackList, feedbackResolve, finalize });

    const result = await runQuench(ctx);

    assert.equal(result.ok, true);
    assert.match(result.summary, /2 issues found/);

    // Feedback items were posted with correct tags
    assert.equal(feedbackAdd.mock.calls.length, 2);
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].file, 'haiku.md');
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].tag, 'law:dark:v1');
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].text, 'too dark');
    assert.equal(feedbackAdd.mock.calls[1].arguments[0].tag, 'law:form:v2');

    // Prior feedback was listed with correct source filter
    assert.equal(feedbackList.mock.calls.length, 1);
    assert.equal(feedbackList.mock.calls[0].arguments[0].source, 'quench:test-cycle');

    // Prior items matching current items → rejected (still failing)
    assert.equal(feedbackResolve.mock.calls.length, 2);
    assert.equal(feedbackResolve.mock.calls[0].arguments[0], 'prior1');
    assert.equal(feedbackResolve.mock.calls[0].arguments[1], 'rejected');
    assert.equal(feedbackResolve.mock.calls[1].arguments[0], 'prior2');
    assert.equal(feedbackResolve.mock.calls[1].arguments[1], 'rejected');

    // Stage was finalised with summary
    assert.equal(finalize.mock.calls.length, 1);
    assert.equal(finalize.mock.calls[0].arguments[0].lastStage.summary, 'haiku.md: 2 issues found');
    assert.equal(finalize.mock.calls[0].arguments[0].lastStage.baseSha, BASE_SHA);
    assert.equal(finalize.mock.calls[0].arguments[0].lastStage.stage, 'quench:test-cycle');
  });

  it('resolves resolved-away issues as approved', async () => {
    mockReadActiveStage.mock.mockImplementation(() => ({ stage: {}, baseSha: BASE_SHA }));
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      { file: 'haiku.md', type: 'haiku', cycle: 'test-cycle', status: 'draft' },
    ]);
    mockPerformValidation.mock.mockImplementation(() =>
      makeValidationResult({
        ok: true,
        validatorsRun: 1,
        items: [
          { lawId: 'dark', validatorId: 'v1', file: 'haiku.md', text: 'too dark' },
        ],
      })
    );

    // Prior item for a validator that is no longer producing this issue
    const priorItems = [
      { id: 'prior-old', file: 'haiku.md', tag: 'law:form:v2', source: 'quench:test-cycle' },
    ];
    const feedbackResolve = mock.fn();
    const ctx = createMockCtx({
      feedbackAdd: mock.fn(),
      feedbackList: mock.fn(() => priorItems),
      feedbackResolve,
      finalize: mock.fn(),
    });

    await runQuench(ctx);

    // Prior item's (file, tag) doesn't match current → approved
    assert.equal(feedbackResolve.mock.calls.length, 1);
    assert.equal(feedbackResolve.mock.calls[0].arguments[0], 'prior-old');
    assert.equal(feedbackResolve.mock.calls[0].arguments[1], 'approved');
  });
});

// ---------------------------------------------------------------------------
// AC1.4: All validators fail → { ok: false, error, summary }, artefact blocked
// ---------------------------------------------------------------------------

describe('runQuench — all validators fail', () => {
  it('blocks the artefact when all validators produce only errors', async () => {
    mockReadActiveStage.mock.mockImplementation(() => ({ stage: {}, baseSha: BASE_SHA }));
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      { file: 'broken.md', type: 'code', cycle: 'test-cycle', status: 'draft' },
    ]);
    mockPerformValidation.mock.mockImplementation(() =>
      makeValidationResult({
        ok: false,
        validatorsRun: 2,
        items: [],
        errors: [
          { lawId: 'lint', validatorId: 'v1', type: 'parse', message: 'validator crashed: syntax error' },
          { lawId: 'lint', validatorId: 'v2', type: 'parse', message: 'validator not found' },
        ],
      })
    );

    const ioReadFile = mock.fn(() => [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| broken.md | code | test-cycle | draft |',
    ].join('\n'));
    const ioWriteFile = mock.fn();
    const finalize = mock.fn();
    const ctx = createMockCtx({ ioReadFile, ioWriteFile, finalize });

    const result = await runQuench(ctx);

    assert.equal(result.ok, false);
    assert.match(result.error, /failed validation/);
    assert.match(result.summary, /validator crashed/);
    assert.match(result.summary, /validator not found/);

    // Artefact was marked blocked
    assert.equal(mockSetArtefactStatus.mock.calls.length, 1);
    assert.equal(mockSetArtefactStatus.mock.calls[0].arguments[1], 'broken.md');
    assert.equal(mockSetArtefactStatus.mock.calls[0].arguments[2], 'blocked');
  });
});

// ---------------------------------------------------------------------------
// Validator script crashes → recorded as error, continues to next validator
// (Covered by the scenario where some validators produce items and
//  some produce errors — mixed results)
// ---------------------------------------------------------------------------

describe('runQuench — mixed results across artefacts', () => {
  it('handles one passing and one failing artefact', async () => {
    mockReadActiveStage.mock.mockImplementation(() => ({ stage: {}, baseSha: BASE_SHA }));
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      { file: 'good.md', type: 'haiku', cycle: 'test-cycle', status: 'draft' },
      { file: 'bad.md', type: 'code', cycle: 'test-cycle', status: 'draft' },
    ]);

    const mockResults = [
      makeValidationResult({
        ok: true,
        validatorsRun: 1,
        items: [{ lawId: 'form', validatorId: 'v1', file: 'good.md', text: 'needs revision' }],
        errors: [],
      }),
      makeValidationResult({
        ok: false,
        validatorsRun: 1,
        items: [],
        errors: [{ lawId: 'lint', validatorId: 'v1', type: 'parse', message: 'validator failed' }],
      }),
    ];

    let callIndex = 0;
    mockPerformValidation.mock.mockImplementation(() => mockResults[callIndex++]);

    const ioReadFile = mock.fn(() => [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| good.md | haiku | test-cycle | draft |',
      '| bad.md | code | test-cycle | draft |',
    ].join('\n'));
    const ioWriteFile = mock.fn();
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createMockCtx({ ioReadFile, ioWriteFile, feedbackAdd, finalize });

    const result = await runQuench(ctx);

    assert.equal(result.ok, false);
    assert.match(result.summary, /1 issues found/);
    assert.match(result.summary, /validator failed/);
    assert.equal(feedbackAdd.mock.calls.length, 1);
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].file, 'good.md');

    // Only bad.md was blocked
    assert.equal(mockSetArtefactStatus.mock.calls.length, 1);
    assert.equal(mockSetArtefactStatus.mock.calls[0].arguments[1], 'bad.md');
  });
});

// ---------------------------------------------------------------------------
// Validation error → artefact blocked
// ---------------------------------------------------------------------------

describe('runQuench — validation returns error at module level', () => {
  it('blocks the artefact when performValidation returns an error property', async () => {
    mockReadActiveStage.mock.mockImplementation(() => ({ stage: {}, baseSha: BASE_SHA }));
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      { file: 'error.md', type: 'haiku', cycle: 'test-cycle', status: 'draft' },
    ]);
    mockPerformValidation.mock.mockImplementation(() =>
      makeValidationResult({ ok: false, error: 'Artefact type not found: haiku' })
    );

    const ioReadFile = mock.fn(() => [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| error.md | haiku | test-cycle | draft |',
    ].join('\n'));
    const ioWriteFile = mock.fn();
    const finalize = mock.fn();
    const ctx = createMockCtx({ ioReadFile, ioWriteFile, finalize });

    const result = await runQuench(ctx);

    assert.equal(result.ok, false);
    assert.match(result.summary, /Artefact type not found/);

    assert.equal(mockSetArtefactStatus.mock.calls.length, 1);
    assert.equal(mockSetArtefactStatus.mock.calls[0].arguments[1], 'error.md');
    assert.equal(mockSetArtefactStatus.mock.calls[0].arguments[2], 'blocked');
  });
});

// ---------------------------------------------------------------------------
// Finalisation and summary format
// ---------------------------------------------------------------------------

describe('runQuench — finalisation', () => {
  it('calls finalize with correct lastStage and activeStage', async () => {
    const activeStage = { stage: { id: 'quench:test-cycle', startedAt: 'now' }, baseSha: BASE_SHA };
    mockReadActiveStage.mock.mockImplementation(() => activeStage);
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      { file: 'a.md', type: 'haiku', cycle: 'test-cycle', status: 'draft' },
      { file: 'b.md', type: 'haiku', cycle: 'test-cycle', status: 'draft' },
    ]);
    mockPerformValidation.mock.mockImplementation(() =>
      makeValidationResult({
        ok: true,
        validatorsRun: 1,
        items: [{ lawId: 'form', validatorId: 'v1', file: 'a.md', text: 'fix' }],
      })
    );

    const finalize = mock.fn();
    const ctx = createMockCtx({ finalize });

    await runQuench(ctx);

    assert.equal(finalize.mock.calls.length, 1);
    const args = finalize.mock.calls[0].arguments[0];
    assert.equal(args.lastStage.stage, 'quench:test-cycle');
    assert.equal(args.lastStage.baseSha, BASE_SHA);
    assert.equal(args.activeStage, activeStage);
  });
});
