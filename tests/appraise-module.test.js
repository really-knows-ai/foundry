/**
 * Unit tests for appraise-module.js — gatherAppraiseContext and
 * consolidateAppraise with mocked dependencies.
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock imported dependencies before the module under test is loaded.
// Specifiers are relative to the test file (in tests/ directory).
// ---------------------------------------------------------------------------

const mockGetArtefactsForCycle = mock.fn();
const mockSelectAppraisers = mock.fn();
const mockGetLaws = mock.fn();

mock.module('../src/scripts/lib/artefacts.js', {
  exports: { getArtefactsForCycle: mockGetArtefactsForCycle },
});

mock.module('../src/scripts/lib/config.js', {
  exports: {
    selectAppraisers: mockSelectAppraisers,
    getLaws: mockGetLaws,
  },
});

// Module under test — loaded dynamically in beforeEach after mocks reset
let gatherAppraiseContext;
let consolidateAppraise;

beforeEach(async () => {
  mockGetArtefactsForCycle.mock.resetCalls();
  mockSelectAppraisers.mock.resetCalls();
  mockGetLaws.mock.resetCalls();

  const mod = await import('../src/scripts/appraise-module.js');
  gatherAppraiseContext = mod.gatherAppraiseContext;
  consolidateAppraise = mod.consolidateAppraise;
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

function createGatherCtx(overrides = {}) {
  return {
    cycleId: 'haiku-cycle',
    io: makeMockIO(overrides),
    foundryDir: '/tmp/test/foundry',
    defaultModel: 'openai/gpt-4o',
    ...overrides,
  };
}

function createConsolidateCtx(overrides = {}) {
  return {
    cycleId: 'haiku-cycle',
    io: makeMockIO(overrides),
    feedback: makeMockFeedback(overrides),
    finalize: overrides.finalize ?? mock.fn(),
    activeStage: overrides.activeStage ?? { stage: { id: 'appraise:haiku-cycle', startedAt: 'now' }, baseSha: BASE_SHA },
    lastStage: overrides.lastStage ?? null,
    foundryDir: '/tmp/test/foundry',
    now: () => new Date().toISOString(),
    ulid: () => 'test-ulid-' + Math.random().toString(36).slice(2, 8),
    defaultModel: 'openai/gpt-4o',
    ...overrides,
  };
}

function makeArtefact(overrides = {}) {
  return {
    file: 'poem.md',
    type: 'haiku',
    cycle: 'haiku-cycle',
    status: 'draft',
    ...overrides,
  };
}

function makeAppraiser(overrides = {}) {
  return {
    id: 'strict',
    personality: 'You are strict and pay close attention to form.',
    model: 'openai/gpt-4o',
    ...overrides,
  };
}

function makeLaw(overrides = {}) {
  return {
    id: 'dark',
    text: 'Avoid overly dark themes in poetry.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// gatherAppraiseContext — acceptance criteria
// ---------------------------------------------------------------------------

describe('gatherAppraiseContext', () => {

  // AC2.1 basic: exported and callable
  it('is exported as a function', () => {
    assert.equal(typeof gatherAppraiseContext, 'function');
  });

  // AC2.1: cycleId absent → violation
  it('returns violation when cycleId is absent', async () => {
    const ctx = createGatherCtx({ cycleId: undefined });
    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.action, 'violation');
    assert.match(result.details, /cycleId/);
    assert.equal(result.recoverable, false);
  });

  it('returns violation when cycleId is empty string', async () => {
    const ctx = createGatherCtx({ cycleId: '' });
    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.action, 'violation');
    assert.match(result.details, /cycleId/);
  });

  // AC2.3: no artefacts → empty tasks
  it('returns empty tasks when no artefacts exist for the cycle', async () => {
    mockGetArtefactsForCycle.mock.mockImplementation(() => []);
    const ctx = createGatherCtx();

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.action, 'dispatch_multi');
    assert.deepEqual(result.tasks, []);
    assert.equal(result.stage, 'appraise:haiku-cycle');
    assert.equal(result.cycle, 'haiku-cycle');
  });

  // AC2.2: no appraisers available → empty tasks (not a violation)
  it('returns empty tasks when no appraisers are selected', async () => {
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      makeArtefact(),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => []);
    mockGetLaws.mock.mockImplementation(() => [makeLaw()]);
    const ioReadFile = mock.fn(() => 'silent pond\nfrog jumps\nsplash');
    const ctx = createGatherCtx({ ioReadFile });

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.action, 'dispatch_multi');
    assert.deepEqual(result.tasks, []);
    assert.equal(result.stage, 'appraise:haiku-cycle');
    assert.equal(result.cycle, 'haiku-cycle');
  });

  // AC2.1: happy path — one artefact, one appraiser
  it('builds correct dispatch_multi with one task per (artefact, appraiser)', async () => {
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      makeArtefact({ file: 'poem.md', type: 'haiku' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'strict', personality: 'You are strict.', model: 'openai/gpt-4o' }),
    ]);
    mockGetLaws.mock.mockImplementation(() => [
      makeLaw({ id: 'dark', text: 'Avoid dark themes.' }),
    ]);
    const ioReadFile = mock.fn(() => 'silent pond');
    const ctx = createGatherCtx({ ioReadFile });

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.action, 'dispatch_multi');
    assert.equal(result.tasks.length, 1);
    assert.equal(result.stage, 'appraise:haiku-cycle');
    assert.equal(result.cycle, 'haiku-cycle');

    const task = result.tasks[0];
    assert.equal(task.subagent_type, 'foundry-openai-gpt-4o');
    assert.match(task.prompt, /You are an appraiser/);
    assert.match(task.prompt, /You are strict/);
    assert.match(task.prompt, /## Artefact/);
    assert.match(task.prompt, /silent pond/);
    assert.match(task.prompt, /## Laws/);
    assert.match(task.prompt, /Avoid dark themes/);
    assert.match(task.prompt, /- file: poem.md/);
    assert.match(task.prompt, /- law: <law-id>/);
    assert.match(task.prompt, /If there are no issues/);
  });

  // AC2.1: multiple artefacts, multiple appraisers
  it('creates tasks for all artefact-appraiser pairs', async () => {
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      makeArtefact({ file: 'poem1.md', type: 'haiku' }),
      makeArtefact({ file: 'poem2.md', type: 'sonnet' }),
    ]);
    const callCount = { haiku: 0, sonnet: 0 };
    mockSelectAppraisers.mock.mockImplementation(async (foundryDir, typeId) => {
      callCount[typeId]++;
      if (typeId === 'haiku') return [makeAppraiser({ id: 'strict', model: 'openai/gpt-4o' })];
      if (typeId === 'sonnet') return [makeAppraiser({ id: 'kind', model: 'anthropic/claude' })];
      return [];
    });
    mockGetLaws.mock.mockImplementation(async (foundryDir, io, { typeId }) => {
      if (typeId === 'haiku') return [makeLaw({ id: 'dark' })];
      if (typeId === 'sonnet') return [makeLaw({ id: 'form' })];
      return [];
    });
    const readCalls = { 'poem1.md': 'content 1', 'poem2.md': 'content 2' };
    const ioReadFile = mock.fn(f => readCalls[f] || '');
    const ctx = createGatherCtx({ ioReadFile });

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0].subagent_type, 'foundry-openai-gpt-4o');
    assert.match(result.tasks[0].prompt, /poem1\.md/);
    assert.equal(result.tasks[1].subagent_type, 'foundry-anthropic-claude');
    assert.match(result.tasks[1].prompt, /poem2\.md/);

    // selectAppraisers and getLaws called once per unique type
    assert.equal(callCount.haiku, 1);
    assert.equal(callCount.sonnet, 1);
  });

  // Model name conversion: dots and slashes become hyphens
  it('converts model names to agent names correctly', async () => {
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      makeArtefact({ file: 'poem.md', type: 'haiku' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'custom', model: 'github-copilot/claude-sonnet-4.6' }),
    ]);
    mockGetLaws.mock.mockImplementation(() => [makeLaw()]);
    const ioReadFile = mock.fn(() => 'content');
    const ctx = createGatherCtx({ ioReadFile });

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.tasks[0].subagent_type, 'foundry-github-copilot-claude-sonnet-4-6');
  });

  // Fallback to 'general' when neither model nor defaultModel is specified
  it('uses "general" subagent_type when no model is specified', async () => {
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      makeArtefact({ file: 'poem.md', type: 'haiku' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'basic', model: undefined }),
    ]);
    mockGetLaws.mock.mockImplementation(() => [makeLaw()]);
    const ioReadFile = mock.fn(() => 'content');
    // No defaultModel set — module falls back to 'general'
    const ctx = createGatherCtx({ ioReadFile, defaultModel: undefined });

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.tasks[0].subagent_type, 'general');
  });

  // Artefact content is read from disk
  it('reads artefact content from disk via io', async () => {
    mockGetArtefactsForCycle.mock.mockImplementation(() => [
      makeArtefact({ file: 'unique-file.md', type: 'haiku' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'strict', model: 'openai/gpt-4o' }),
    ]);
    mockGetLaws.mock.mockImplementation(() => [makeLaw()]);
    const ioReadFile = mock.fn(f => {
      if (f === 'unique-file.md') return 'the actual content';
      return '';
    });
    const ctx = createGatherCtx({ ioReadFile });

    const result = await gatherAppraiseContext(ctx);

    assert.match(result.tasks[0].prompt, /the actual content/);
    assert.equal(ioReadFile.mock.calls.length, 1);
    assert.equal(ioReadFile.mock.calls[0].arguments[0], 'unique-file.md');
  });
});

// ---------------------------------------------------------------------------
// consolidateAppraise — acceptance criteria
// ---------------------------------------------------------------------------

describe('consolidateAppraise', () => {

  // Basic interface
  it('is exported as a function', () => {
    assert.equal(typeof consolidateAppraise, 'function');
  });

  // No active stage → violation
  it('returns violation when no active stage exists', async () => {
    const ctx = createConsolidateCtx({ activeStage: null });
    const result = await consolidateAppraise(ctx, []);

    assert.equal(result.action, 'violation');
    assert.match(result.details, /No active stage/);
    assert.equal(result.recoverable, false);
  });

  // AC2.7: all appraisers fail → violation
  it('returns violation when all appraisers fail', async () => {
    const ctx = createConsolidateCtx();
    const lastResults = [
      { ok: false, error: 'subagent crashed' },
      { ok: false, error: 'timeout' },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.action, 'violation');
    assert.match(result.details, /All appraisers failed/);
    assert.equal(result.recoverable, false);
  });

  // AC2.6: one appraiser fails → non-fatal, remaining issues still posted
  it('treats failed appraiser as contributing no issues (non-fatal)', async () => {
    const ctx = createConsolidateCtx();
    const lastResults = [
      { ok: true, output: `- file: poem.md\n  law: dark\n  issue: Too dark\n  evidence: shadows` },
      { ok: false, error: 'crashed' },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    assert.equal(ctx.feedback.add.mock.calls.length, 1);
    assert.equal(ctx.feedback.add.mock.calls[0].arguments[0].file, 'poem.md');
    assert.equal(ctx.feedback.add.mock.calls[0].arguments[0].tag, 'law:dark');
  });

  // AC2.4: unions issues from all successful appraisers
  it('unions issues across multiple successful appraisers', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    const lastResults = [
      {
        ok: true,
        output: [
          '- file: poem.md',
          '  law: dark',
          '  issue: Too dark',
          '  evidence: shadows fall',
        ].join('\n'),
      },
      {
        ok: true,
        output: [
          '- file: poem.md',
          '  law: form',
          '  issue: Wrong syllable count',
          '  evidence: five seven five',
        ].join('\n'),
      },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    assert.equal(feedbackAdd.mock.calls.length, 2);
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].tag, 'law:dark');
    assert.equal(feedbackAdd.mock.calls[1].arguments[0].tag, 'law:form');
  });

  // AC2.5: de-duplicates overlapping issue descriptions
  it('de-duplicates issues with same (file, law, issue text)', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    const lastResults = [
      {
        ok: true,
        output: [
          '- file: poem.md',
          '  law: dark',
          '  issue: Too dark',
          '  evidence: shadows',
        ].join('\n'),
      },
      {
        ok: true,
        output: [
          '- file: poem.md',
          '  law: dark',
          '  issue: Too dark',
          '  evidence: shadows everywhere',
        ].join('\n'),
      },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    // Two identical issues → only one feedback item
    assert.equal(feedbackAdd.mock.calls.length, 1);
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].tag, 'law:dark');
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].text, 'Too dark');
  });

  // AC2.5: same law, different issue text → NOT de-duplicated
  it('keeps separate issues for same law with different descriptions', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    const lastResults = [
      {
        ok: true,
        output: [
          '- file: poem.md',
          '  law: dark',
          '  issue: Too dark',
          '  evidence: shadows',
        ].join('\n'),
      },
      {
        ok: true,
        output: [
          '- file: poem.md',
          '  law: dark',
          '  issue: Gloomy tone',
          '  evidence: sad words',
        ].join('\n'),
      },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    // Different issue descriptions → two separate feedback items
    assert.equal(feedbackAdd.mock.calls.length, 2);
  });

  // AC2.5: different file, same law and issue → NOT de-duplicated
  it('keeps separate issues for different files', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    const lastResults = [
      {
        ok: true,
        output: [
          '- file: poem1.md',
          '  law: dark',
          '  issue: Too dark',
          '  evidence: shadows',
        ].join('\n'),
      },
      {
        ok: true,
        output: [
          '- file: poem2.md',
          '  law: dark',
          '  issue: Too dark',
          '  evidence: shadows',
        ].join('\n'),
      },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    // Different files → two feedback items
    assert.equal(feedbackAdd.mock.calls.length, 2);
  });

  // AC2.8: no issues found → no feedback posted, ok: true
  it('returns ok: true with no issues when outputs are empty', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    const lastResults = [
      { ok: true, output: '' },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    assert.match(result.summary, /No issues found/);
    assert.equal(feedbackAdd.mock.calls.length, 0);
  });

  it('parses "empty list" style output as no issues', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    const lastResults = [
      { ok: true, output: 'No issues found.\n\nThe artefact meets all requirements.' },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    assert.match(result.summary, /No issues found/);
    assert.equal(feedbackAdd.mock.calls.length, 0);
  });

  // AC2.9: prior appraise feedback resolution
  it('resolves prior appraise feedback: approved for stale, rejected for current', async () => {
    const priorItems = [
      { id: 'prior1', file: 'poem.md', tag: 'law:dark', source: 'appraise:haiku-cycle' },
      { id: 'prior2', file: 'poem.md', tag: 'law:form', source: 'appraise:haiku-cycle' },
    ];
    const feedbackList = mock.fn(() => priorItems);
    const feedbackResolve = mock.fn();
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackList, feedbackResolve, feedbackAdd, finalize });
    const lastResults = [
      {
        ok: true,
        output: [
          '- file: poem.md',
          '  law: dark',
          '  issue: Too dark',
          '  evidence: shadows',
        ].join('\n'),
      },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);

    // prior1 (law:dark) still present → rejected (still failing)
    assert.equal(feedbackResolve.mock.calls[0].arguments[0], 'prior1');
    assert.equal(feedbackResolve.mock.calls[0].arguments[1], 'rejected');

    // prior2 (law:form) no longer present → approved (resolved)
    assert.equal(feedbackResolve.mock.calls[1].arguments[0], 'prior2');
    assert.equal(feedbackResolve.mock.calls[1].arguments[1], 'approved');
  });

  it('lists prior feedback with correct source filter', async () => {
    const feedbackList = mock.fn(() => []);
    const ctx = createConsolidateCtx({ feedbackList });
    const lastResults = [
      { ok: true, output: '- file: poem.md\n  law: dark\n  issue: Too dark\n  evidence: shadows' },
    ];

    await consolidateAppraise(ctx, lastResults);

    assert.equal(feedbackList.mock.calls.length, 1);
    assert.equal(feedbackList.mock.calls[0].arguments[0].source, 'appraise:haiku-cycle');
  });

  // AC2.4: feedback tagged with 'law:<slug>'
  it('tags feedback items with law:slug format', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    const lastResults = [
      {
        ok: true,
        output: [
          '- file: poem.md',
          '  law: dark-themes',
          '  issue: Too dark',
          '  evidence: shadows',
        ].join('\n'),
      },
    ];

    await consolidateAppraise(ctx, lastResults);

    assert.equal(feedbackAdd.mock.calls[0].arguments[0].tag, 'law:dark-themes');
  });

  // Consolidate finalises stage
  it('calls finalize after successful consolidation', async () => {
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ finalize });
    const lastResults = [
      {
        ok: true,
        output: '- file: poem.md\n  law: dark\n  issue: Too dark\n  evidence: shadows',
      },
    ];

    await consolidateAppraise(ctx, lastResults);

    assert.equal(finalize.mock.calls.length, 1);
    const args = finalize.mock.calls[0].arguments[0];
    assert.equal(args.lastStage.stage, 'appraise:haiku-cycle');
    assert.equal(args.lastStage.baseSha, BASE_SHA);
    assert.equal(args.activeStage, ctx.activeStage);
    assert.match(args.lastStage.summary, /1 issue/);
  });

  // Empty lastResults
  it('handles empty lastResults gracefully', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });

    const result = await consolidateAppraise(ctx, []);

    assert.equal(result.ok, true);
    assert.match(result.summary, /No issues found/);
    assert.equal(feedbackAdd.mock.calls.length, 0);
  });
});
