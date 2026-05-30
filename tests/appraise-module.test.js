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

const mockGetArtefactFiles = mock.fn();
const mockGetCycleDefinition = mock.fn();
const mockSelectAppraisers = mock.fn();
const mockGetLaws = mock.fn();
const mockComputeArtefactVersion = mock.fn();
const mockOpenFeedbackStore = mock.fn();

mock.module('../src/scripts/lib/artefacts.js', {
  namedExports: {
    getArtefactFiles: mockGetArtefactFiles,
    computeArtefactVersion: mockComputeArtefactVersion,
  },
});

mock.module('../src/scripts/lib/config.js', {
  namedExports: {
    getCycleDefinition: mockGetCycleDefinition,
    selectAppraisers: mockSelectAppraisers,
    getLaws: mockGetLaws,
  },
});

mock.module('../src/scripts/lib/feedback-store.js', {
  namedExports: { openFeedbackStore: mockOpenFeedbackStore },
});

// Module under test — loaded dynamically in beforeEach after mocks reset
let gatherAppraiseContext;
let consolidateAppraise;
let resolveStaleFeedback;

beforeEach(async () => {
  mockGetArtefactFiles.mock.resetCalls();
  mockGetCycleDefinition.mock.resetCalls();
  mockSelectAppraisers.mock.resetCalls();
  mockGetLaws.mock.resetCalls();
  mockComputeArtefactVersion.mock.resetCalls();
  mockOpenFeedbackStore.mock.resetCalls();

  // Default mocks so existing consolidate tests work without stale-specific setup
  mockComputeArtefactVersion.mock.mockImplementation(() => Promise.resolve('v1'));
  mockOpenFeedbackStore.mock.mockImplementation(() => ({
    list: () => [],
    autoResolve: mock.fn(),
  }));

  const mod = await import('../src/scripts/appraise-module.js');
  gatherAppraiseContext = mod.gatherAppraiseContext;
  consolidateAppraise = mod.consolidateAppraise;
  resolveStaleFeedback = mod.resolveStaleFeedback;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_SHA = 'abc1234';

const DEFAULT_IO_MOCKS = {
  readFile: mock.fn(() => ''),
  writeFile: mock.fn(),
  exists: mock.fn(() => true),
  readDir: mock.fn(() => []),
  unlink: mock.fn(),
};

const IO_PROP_MAP = {
  readFile: 'ioReadFile',
  writeFile: 'ioWriteFile',
  exists: 'ioExists',
  readDir: 'ioReadDir',
  unlink: 'ioUnlink',
};

function makeMockIO(overrides) {
  const result = {};
  for (const key of Object.keys(IO_PROP_MAP)) {
    const ov = overrides;
    result[key] = ov && ov[IO_PROP_MAP[key]] ? ov[IO_PROP_MAP[key]] : DEFAULT_IO_MOCKS[key];
  }
  return result;
}

/**
 * Set up IO mock with stage output files in .foundry/stage-outputs/.
 * Each entry in `files` maps a filename (e.g. "appraiser-1.jsonl") to a
 * string content (the JSONL content). The helper wires readDir to return
 * the filenames and readFile to return the content for matching paths.
 */
function setupStageOutputFiles(ioMock, files) {
  const filenames = Object.keys(files);
  ioMock.readDir = mock.fn((dir) => {
    if (dir === '.foundry/stage-outputs') return filenames;
    return [];
  });
  ioMock.readFile = mock.fn((fp) => {
    for (const name of filenames) {
      if (fp === `.foundry/stage-outputs/${name}` || fp.endsWith(`/${name}`)) {
        return files[name];
      }
    }
    throw new Error(`ENOENT: ${fp}`);
  });
  ioMock.unlink = mock.fn();
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
    state: 'new',
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
    mockGetCycleDefinition.mock.mockImplementation(() => ({
      frontmatter: { 'output-type': 'haiku' },
    }));
    mockGetArtefactFiles.mock.mockImplementation(() => []);
    const ctx = createGatherCtx();

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.action, 'dispatch_multi');
    assert.deepEqual(result.tasks, []);
    assert.equal(result.stage, 'appraise:haiku-cycle');
    assert.equal(result.cycle, 'haiku-cycle');
  });

  // AC2.2: no appraisers available → empty tasks (not a violation)
  it('returns empty tasks when no appraisers are selected', async () => {
    mockGetCycleDefinition.mock.mockImplementation(() => ({
      frontmatter: { 'output-type': 'haiku' },
    }));
    mockGetArtefactFiles.mock.mockImplementation(() => [
      makeArtefact(),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => []);
    mockGetLaws.mock.mockImplementation(() => [makeLaw()]);
    const ctx = createGatherCtx();

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.action, 'dispatch_multi');
    assert.deepEqual(result.tasks, []);
    assert.equal(result.stage, 'appraise:haiku-cycle');
    assert.equal(result.cycle, 'haiku-cycle');
  });

  // AC2.1: happy path — one artefact, one appraiser
  it('builds correct dispatch_multi with one task per appraiser', async () => {
    mockGetCycleDefinition.mock.mockImplementation(() => ({
      frontmatter: { 'output-type': 'haiku' },
    }));
    mockGetArtefactFiles.mock.mockImplementation(() => [
      makeArtefact({ file: 'poem.md' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'strict', personality: 'You are strict.', model: 'openai/gpt-4o' }),
    ]);
    mockGetLaws.mock.mockImplementation(() => [
      makeLaw({ id: 'dark', text: 'Avoid dark themes.' }),
    ]);
    const ctx = createGatherCtx();

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.action, 'dispatch_multi');
    assert.equal(result.tasks.length, 1);
    assert.equal(result.stage, 'appraise:haiku-cycle');
    assert.equal(result.cycle, 'haiku-cycle');

    const task = result.tasks[0];
    assert.equal(task.subagent_type, 'foundry-openai-gpt-4o');
    assert.match(task.prompt, /You are an appraiser/);
    assert.match(task.prompt, /You are strict/);
    assert.match(task.prompt, /"haiku"/);
    assert.match(task.prompt, /foundry_config_artefact_type/);
    assert.match(task.prompt, /foundry_config_laws/);
    assert.match(task.prompt, /foundry_artefacts_list/);
    assert.match(task.prompt, /JSONL/);
  });

  // AC2.1: multiple artefacts, one appraiser → one task per appraiser (not per artefact)
  it('creates one task per appraiser regardless of artefact count', async () => {
    mockGetCycleDefinition.mock.mockImplementation(() => ({
      frontmatter: { 'output-type': 'haiku' },
    }));
    mockGetArtefactFiles.mock.mockImplementation(() => [
      makeArtefact({ file: 'poem1.md', state: 'new' }),
      makeArtefact({ file: 'poem2.md', state: 'new' }),
    ]);
    const callCount = { haiku: 0 };
    mockSelectAppraisers.mock.mockImplementation(async (foundryDir, typeId) => {
      callCount[typeId] = (callCount[typeId] || 0) + 1;
      if (typeId === 'haiku') return [makeAppraiser({ id: 'strict', model: 'openai/gpt-4o' })];
      return [];
    });
    mockGetLaws.mock.mockImplementation(async (foundryDir, io, { typeId }) => {
      if (typeId === 'haiku') return [makeLaw({ id: 'dark' })];
      return [];
    });
    const ctx = createGatherCtx();

    const result = await gatherAppraiseContext(ctx);

    // One appraiser → one task (appraiser discovers artefacts via tool calls)
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].subagent_type, 'foundry-openai-gpt-4o');
    assert.match(result.tasks[0].prompt, /"haiku"/);

    // selectAppraisers called once per unique type
    assert.equal(callCount.haiku, 1);
  });

  // Model name conversion: dots and slashes become hyphens
  it('converts model names to agent names correctly', async () => {
    mockGetCycleDefinition.mock.mockImplementation(() => ({
      frontmatter: { 'output-type': 'haiku' },
    }));
    mockGetArtefactFiles.mock.mockImplementation(() => [
      makeArtefact({ file: 'poem.md' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'custom', model: 'github-copilot/claude-sonnet-4.6' }),
    ]);
    const ctx = createGatherCtx();

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.tasks[0].subagent_type, 'foundry-github-copilot-claude-sonnet-4-6');
  });

  // Fallback to foundry-appraise when neither model nor defaultModel is specified
  it('uses foundry-appraise subagent_type when no model is specified', async () => {
    mockGetCycleDefinition.mock.mockImplementation(() => ({
      frontmatter: { 'output-type': 'haiku' },
    }));
    mockGetArtefactFiles.mock.mockImplementation(() => [
      makeArtefact({ file: 'poem.md' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'basic', model: undefined }),
    ]);
    const ctx = createGatherCtx({ defaultModel: undefined });

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.tasks[0].subagent_type, 'foundry-appraise');
  });

  // Artefact content is NOT read from disk — subagent discovers it via tool calls
  it('does not inline artefact content in the prompt', async () => {
    mockGetCycleDefinition.mock.mockImplementation(() => ({
      frontmatter: { 'output-type': 'haiku' },
    }));
    mockGetArtefactFiles.mock.mockImplementation(() => [
      makeArtefact({ file: 'unique-file.md', state: 'new' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'strict', model: 'openai/gpt-4o' }),
    ]);
    const ioReadFile = mock.fn(() => 'the actual content');
    const ctx = createGatherCtx({ ioReadFile });

    const result = await gatherAppraiseContext(ctx);

    assert.equal(ioReadFile.mock.calls.length, 0);
    assert.equal(result.tasks.length, 1);
  });

  // Deleted artefacts do not affect task creation
  it('creates tasks regardless of artefact state', async () => {
    mockGetCycleDefinition.mock.mockImplementation(() => ({
      frontmatter: { 'output-type': 'haiku' },
    }));
    mockGetArtefactFiles.mock.mockImplementation(() => [
      makeArtefact({ file: 'deleted.md', state: 'deleted' }),
    ]);
    mockSelectAppraisers.mock.mockImplementation(() => [
      makeAppraiser({ id: 'strict', model: 'openai/gpt-4o' }),
    ]);
    const ioReadFile = mock.fn(() => 'should not be called');
    const ctx = createGatherCtx({ ioReadFile });

    const result = await gatherAppraiseContext(ctx);

    assert.equal(result.tasks.length, 1);
    assert.equal(ioReadFile.mock.calls.length, 0);
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
    setupStageOutputFiles(ctx.io, {
      'appraiser-1.jsonl': '{"file": "poem.md", "law": "dark", "text": "Too dark", "evidence": "shadows"}',
    });
    const lastResults = [
      { ok: true, output: '' },
      { ok: false, error: 'crashed' },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    assert.equal(ctx.feedback.add.mock.calls.length, 1);
    assert.equal(ctx.feedback.add.mock.calls[0].arguments[0].file, 'poem.md');
    assert.equal(ctx.feedback.add.mock.calls[0].arguments[0].tag, 'law:dark');
  });

  // AC2.5: de-duplicates overlapping issue descriptions
  it('de-duplicates issues with same (file, law, issue text)', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    setupStageOutputFiles(ctx.io, {
      'a.jsonl': '{"file": "poem.md", "law": "dark", "text": "Too dark", "evidence": "shadows"}',
      'b.jsonl': '{"file": "poem.md", "law": "dark", "text": "Too dark", "evidence": "shadows everywhere"}',
    });
    const lastResults = [
      { ok: true, output: '' },
      { ok: true, output: '' },
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
    setupStageOutputFiles(ctx.io, {
      'a.jsonl': '{"file": "poem.md", "law": "dark", "text": "Too dark", "evidence": "shadows"}\n{"file": "poem.md", "law": "dark", "text": "Gloomy tone", "evidence": "sad words"}',
    });
    const lastResults = [
      { ok: true, output: '' },
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
    setupStageOutputFiles(ctx.io, {
      'a.jsonl': '{"file": "poem1.md", "law": "dark", "text": "Too dark", "evidence": "shadows"}',
      'b.jsonl': '{"file": "poem2.md", "law": "dark", "text": "Too dark", "evidence": "shadows"}',
    });
    const lastResults = [
      { ok: true, output: '' },
      { ok: true, output: '' },
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
    assert.equal(feedbackAdd.mock.calls.length, 0);
  });

  it('parses JSONL output from appraisers', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });
    setupStageOutputFiles(ctx.io, {
      'appraiser-1.jsonl': [
        '{"file": "poem.md", "law": "imagery", "text": "The haiku compares rain to human constructs instead of nature", "evidence": "like a drum of war"}',
        '{"file": "poem.md", "law": "mood", "text": "No seasonal reference (kigo) — lacks classical grounding", "evidence": "no mention of season"}',
      ].join('\n'),
    });
    const lastResults = [
      { ok: true, output: '' },
    ];

    const result = await consolidateAppraise(ctx, lastResults);

    assert.equal(result.ok, true);
    assert.equal(feedbackAdd.mock.calls.length, 2);
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].file, 'poem.md');
    assert.equal(feedbackAdd.mock.calls[0].arguments[0].tag, 'law:imagery');
    assert.match(feedbackAdd.mock.calls[0].arguments[0].text, /human constructs/);
    assert.equal(feedbackAdd.mock.calls[1].arguments[0].tag, 'law:mood');
    assert.match(feedbackAdd.mock.calls[1].arguments[0].text, /kigo/);
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
    setupStageOutputFiles(ctx.io, {
      'appraiser-1.jsonl': '{"file": "poem.md", "law": "dark", "text": "Too dark", "evidence": "shadows"}',
    });
    const lastResults = [
      { ok: true, output: '' },
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
    setupStageOutputFiles(ctx.io, {
      'a.jsonl': '{"file": "poem.md", "law": "dark", "text": "Too dark", "evidence": "shadows"}',
    });
    const lastResults = [
      { ok: true, output: '' },
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
    setupStageOutputFiles(ctx.io, {
      'a.jsonl': '{"file": "poem.md", "law": "dark-themes", "text": "Too dark", "evidence": "shadows"}',
    });
    const lastResults = [
      { ok: true, output: '' },
    ];

    await consolidateAppraise(ctx, lastResults);

    assert.equal(feedbackAdd.mock.calls[0].arguments[0].tag, 'law:dark-themes');
  });

  // Consolidate finalises stage
  it('calls finalize after successful consolidation', async () => {
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ finalize });
    setupStageOutputFiles(ctx.io, {
      'a.jsonl': '{"file": "poem.md", "law": "dark", "text": "Too dark", "evidence": "shadows"}',
    });
    const lastResults = [
      { ok: true, output: '' },
    ];

    await consolidateAppraise(ctx, lastResults);

    assert.equal(finalize.mock.calls.length, 1);
    const args = finalize.mock.calls[0].arguments[0];
    assert.equal(args.lastStage.stage, 'appraise:haiku-cycle');
    assert.equal(args.lastStage.baseSha, BASE_SHA);
    assert.equal(args.activeStage, ctx.activeStage);
    assert.match(args.lastStage.summary, /actioned:1/);
  });

  // Empty lastResults
  it('handles empty lastResults gracefully', async () => {
    const feedbackAdd = mock.fn();
    const finalize = mock.fn();
    const ctx = createConsolidateCtx({ feedbackAdd, finalize });

    const result = await consolidateAppraise(ctx, []);

    assert.equal(result.ok, true);
    assert.equal(feedbackAdd.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// resolveStaleFeedback — stale feedback detection (Phase 4)
// ---------------------------------------------------------------------------

describe('resolveStaleFeedback (appraise)', () => {
  function makeItem(overrides = {}) {
    return {
      id: 'item-1',
      source: 'appraise:test-cycle',
      artefact_version: 'old-version',
      history: [{ state: 'open' }],
      file: 'a.md',
      tag: 'law:x',
      ...overrides,
    };
  }

  it('resolves items with mismatched version', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 1);
    assert.match(feedback.autoResolve.mock.calls[0].arguments[0].reason, /superseded by forge revision/);
    assert.equal(feedback.autoResolve.mock.calls[0].arguments[0].cycle, 'cycle-1');
  });

  it('skips items with matching version', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v1', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('skips items from other source bases', () => {
    const items = [makeItem({ source: 'quench:test-cycle' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('skips already-resolved items', () => {
    const items = [makeItem({ history: [{ state: 'resolved' }] })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'cycle-1');
    assert.equal(feedback.autoResolve.mock.calls.length, 0);
  });

  it('passes cycle through to autoResolve', () => {
    const items = [makeItem({ artefact_version: 'v1' })];
    const feedback = { autoResolve: mock.fn() };
    resolveStaleFeedback(items, 'v2', 'appraise', feedback, 'my-cycle');
    assert.equal(feedback.autoResolve.mock.calls[0].arguments[0].cycle, 'my-cycle');
  });
});
