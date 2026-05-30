// tests/orchestrate.test.js — Unit tests for Phase 1 single-item forge dispatch.
// Tests captureForgeContext, renderDispatchPrompt, and buildDispatchAction.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

let renderDispatchPrompt;
let __captureForgeContextForTest;
let __handleSortResultForTest;

beforeEach(async () => {
  const mod = await import('../src/scripts/orchestrate.js');
  renderDispatchPrompt = mod.renderDispatchPrompt;
  __captureForgeContextForTest = mod.__captureForgeContextForTest;
  __handleSortResultForTest = mod.__handleSortResultForTest;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIo(files = {}) {
  const fs = new Map(Object.entries(files));
  return {
    fs,
    exists: (p) => fs.has(p),
    readFile: (p) => {
      if (!fs.has(p)) throw new Error(`ENOENT: ${p}`);
      return fs.get(p);
    },
    writeFile: (p, c) => fs.set(p, c),
    rename: (from, to) => {
      if (!fs.has(from)) throw new Error(`ENOENT: ${from}`);
      fs.set(to, fs.get(from));
      fs.delete(from);
    },
    unlink: (p) => fs.delete(p),
    mkdir: () => {},
    exec: () => '',
  };
}

function buildItem(opts) {
  const defaults = {
    file: 'test.md', tag: 'law:test', text: 'test feedback',
    source: 'quench:test-cycle', state: 'open', cycle: 'test-cycle',
  };
  const merged = { ...defaults, ...opts };
  return {
    id: merged.id, file: merged.file, tag: merged.tag,
    text: merged.text, source: merged.source,
    artefact_version: merged.artefactVersion,
    history: [{
      state: merged.state, stage: merged.source,
      cycle: merged.cycle, timestamp: new Date().toISOString(),
    }],
  };
}

function makeFeedbackYaml(items) {
  return yaml.dump({ items });
}

// Base IO with cycle and artefact definitions for forge-context tests.
function forgeCtxIo(extra = {}) {
  return makeIo({
    'foundry/cycles/test-cycle.md': `---
id: test-cycle
output-type: test-type
---
# Test Cycle
`,
    'foundry/artefacts/test-type/definition.md': `---
id: test-type
file-patterns: []
---
# Test Type
`,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Test 1: captureForgeContext writes single forgeItem (not array)
// ---------------------------------------------------------------------------

describe('captureForgeContext', () => {

  test('writes single forgeItem with correct fields', async () => {
    const io = forgeCtxIo({
      'WORK.feedback.yaml': makeFeedbackYaml([
        buildItem({ id: 'item-1', state: 'open' }),
      ]),
    });
    await __captureForgeContextForTest(
      { route: 'forge:test-cycle' }, // sortResult (unused by function)
      { cwd: '/tmp/test' },          // args
      { cycleId: 'test-cycle' },     // preCheck
      io,
    );
    const raw = io.readFile('.foundry/forge-context.json');
    const ctx = JSON.parse(raw);

    // Must NOT have forgeItems (array)
    assert.equal(ctx.forgeItems, undefined, 'should not contain forgeItems array');

    // Must have forgeItem (single object)
    assert.ok(ctx.forgeItem, 'should contain forgeItem');
    assert.equal(ctx.forgeItem.id, 'item-1');
    assert.equal(ctx.forgeItem.file, 'test.md');
    assert.equal(ctx.forgeItem.tag, 'law:test');
    assert.equal(ctx.forgeItem.text, 'test feedback');
    assert.equal(ctx.forgeItem.source, 'quench');
    assert.equal(ctx.forgeItem.sourceAlias, 'quench:test-cycle');

    // Must have forgePreVersion (string)
    assert.equal(typeof ctx.forgePreVersion, 'string');
    assert.ok(ctx.forgePreVersion.length > 0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: picks first item when multiple unresolved exist
  // ---------------------------------------------------------------------------

  test('picks first item when multiple unresolved exist', async () => {
    const io = forgeCtxIo({
      'WORK.feedback.yaml': makeFeedbackYaml([
        buildItem({ id: 'item-1', text: 'first item', state: 'open' }),
        buildItem({ id: 'item-2', text: 'second item', state: 'open' }),
        buildItem({ id: 'item-3', text: 'third item', state: 'rejected' }),
      ]),
    });
    await __captureForgeContextForTest(
      { route: 'forge:test-cycle' },
      { cwd: '/tmp/test' },
      { cycleId: 'test-cycle' },
      io,
    );
    const raw = io.readFile('.foundry/forge-context.json');
    const ctx = JSON.parse(raw);

    assert.ok(ctx.forgeItem);
    assert.equal(ctx.forgeItem.id, 'item-1');
    assert.equal(ctx.forgeItem.text, 'first item');

    // The other items should not appear in forgeItem
    assert.notEqual(ctx.forgeItem.id, 'item-2');
    assert.notEqual(ctx.forgeItem.id, 'item-3');
  });

  // ---------------------------------------------------------------------------
  // Test 3: writes forgeItem: null when no unresolved items
  // ---------------------------------------------------------------------------

  test('writes forgeItem null when no unresolved items', async () => {
    const io = forgeCtxIo({
      'WORK.feedback.yaml': makeFeedbackYaml([
        buildItem({ id: 'item-1', state: 'actioned' }),
        buildItem({ id: 'item-2', state: 'wont-fix' }),
        buildItem({ id: 'item-3', state: 'resolved' }),
      ]),
    });
    await __captureForgeContextForTest(
      { route: 'forge:test-cycle' },
      { cwd: '/tmp/test' },
      { cycleId: 'test-cycle' },
      io,
    );
    const raw = io.readFile('.foundry/forge-context.json');
    const ctx = JSON.parse(raw);

    assert.equal(ctx.forgeItem, null);
  });

  test('writes forgeItem null when no feedback file exists', async () => {
    const io = forgeCtxIo({});
    await __captureForgeContextForTest(
      { route: 'forge:test-cycle' },
      { cwd: '/tmp/test' },
      { cycleId: 'test-cycle' },
      io,
    );
    const raw = io.readFile('.foundry/forge-context.json');
    const ctx = JSON.parse(raw);

    assert.equal(ctx.forgeItem, null);
  });
});

// ---------------------------------------------------------------------------
// Test 4: renderDispatchPrompt includes item text when forgeItem provided
// ---------------------------------------------------------------------------

describe('renderDispatchPrompt with forgeItem', () => {

  test('includes item text, file, and source when forgeItem provided', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'TOKEN',
      cwd: '/tmp/work',
      outputType: 'test-type',
      forgeItem: {
        id: 'item-1',
        file: 'src/test.md',
        tag: 'law:quality',
        text: 'This code needs improvement',
        source: 'quench',
      },
    });

    assert.match(prompt, /This code needs improvement/);
    assert.match(prompt, /src\/test\.md/);
    assert.match(prompt, /Source: quench\b/);
    assert.doesNotMatch(prompt, /Source: quench:test-cycle/);
  });

  test('renders source base (not full alias) in Source: line', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'TOKEN',
      cwd: '/tmp/work',
      outputType: 'test-type',
      forgeItem: {
        id: 'item-1',
        file: 'src/test.md',
        tag: 'law:quality',
        text: 'This code needs improvement',
        source: 'quench',
      },
    });

    // Should show the base "quench", not the full alias "quench:test-cycle"
    assert.match(prompt, /Source: quench\b/);
    assert.doesNotMatch(prompt, /Source: quench:test-cycle/);
  });

  // ---------------------------------------------------------------------------
  // Test 5: does not reference feedback tools when forgeItem provided
  // ---------------------------------------------------------------------------

  test('does not reference foundry_feedback_list when forgeItem provided', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'TOKEN',
      cwd: '/tmp/work',
      outputType: 'test-type',
      forgeItem: {
        id: 'item-1', file: 'a.md', tag: 't', text: 'fix it', source: 'quench',
      },
    });

    assert.doesNotMatch(prompt, /foundry_feedback_list/);
    assert.doesNotMatch(prompt, /foundry_feedback_action/);
    assert.doesNotMatch(prompt, /foundry_feedback_wontfix/);
  });

  // ---------------------------------------------------------------------------
  // Test 6: includes quench-must-fix rule
  // ---------------------------------------------------------------------------

  test('includes quench-must-fix rule for quench-sourced items', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'TOKEN',
      cwd: '/tmp/work',
      outputType: 'test-type',
      forgeItem: {
        id: 'item-1', file: 'a.md', tag: 't', text: 'fix it', source: 'quench',
      },
    });

    assert.match(prompt, /"actioned"/);
    assert.match(prompt, /"wont-fix"/);
  });

  test('includes ACTIONED and WONT-FIX options for quench-sourced items', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'TOKEN',
      cwd: '/tmp/work',
      outputType: 'test-type',
      forgeItem: {
        id: 'item-1', file: 'a.md', tag: 't', text: 'fix it', source: 'quench',
      },
    });

    // The prompt shows the same feedback handling for all sources:
    // actioned to fix and wont-fix when the issue does not apply.
    assert.match(prompt, /"actioned"/);
    assert.match(prompt, /"wont-fix"/);
  });

  // ---------------------------------------------------------------------------
  // Test 6b: null/undefined source is handled gracefully (Issue 2 guard)
  // ---------------------------------------------------------------------------

  test('renders empty source for null forgeItem.source', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'TOKEN',
      cwd: '/tmp/work',
      outputType: 'test-type',
      forgeItem: {
        id: 'item-1', file: 'a.md', tag: 't', text: 'fix it', source: null,
      },
    });

    assert.match(prompt, /Source: /);
    assert.doesNotMatch(prompt, /Source: null/);
  });

  test('renders empty source for undefined forgeItem.source', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'TOKEN',
      cwd: '/tmp/work',
      outputType: 'test-type',
      forgeItem: {
        id: 'item-1', file: 'a.md', tag: 't', text: 'fix it',
      },
    });

    assert.match(prompt, /Source: /);
    assert.doesNotMatch(prompt, /Source: undefined/);
  });

  test('handles forgeItem being null without crashing', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'TOKEN',
      cwd: '/tmp/work',
      outputType: 'test-type',
      forgeItem: null,
    });

    assert.ok(prompt);
    assert.doesNotMatch(prompt, /FEEDBACK ITEM TO ADDRESS/);
  });
});

// ---------------------------------------------------------------------------
// Test 7: buildDispatchAction reads FORGE_CTX and passes item to render
// ---------------------------------------------------------------------------

describe('buildDispatchAction via handleSortResult', () => {

  test('reads forgeItem from FORGE_CTX and includes text in prompt', async () => {
    const io = makeIo({
      'WORK.md': `---
cycle: test-cycle
stages:
  - forge:test-cycle
max-iterations: 3
---
# Test
`,
      'foundry/cycles/test-cycle.md': `---
id: test-cycle
output-type: test-type
---
`,
      'foundry/artefacts/test-type/definition.md': `---
id: test-type
file-patterns: []
---
`,
      '.foundry/forge-context.json': JSON.stringify({
        forgePreVersion: 'abc123',
        forgeItem: { id: 'item-1', file: 'test.md', tag: 'law:test', text: 'resolve this issue', source: 'quench', sourceAlias: 'quench:test-cycle' },
      }),
      '.opencode/agents/foundry-openai-gpt-4o.md': '# agent',
    });
    const ctx = { cycleId: 'test-cycle', cwd: '/tmp/test', io, foundryDir: 'foundry', baseBranch: 'main' };
    const result = await __handleSortResultForTest(
      { route: 'forge:test-cycle', model: 'openai/gpt-4o', token: 'T1' },
      ctx,
    );

    assert.equal(result.action, 'dispatch');
    assert.equal(result.stage, 'forge:test-cycle');
    assert.ok(result.prompt);
    assert.match(result.prompt, /resolve this issue/);
    assert.match(result.prompt, /FEEDBACK ITEM TO ADDRESS/);
  });

  test('produces prompt without feedback section when no forgeItem in ctx', async () => {
    const io = makeIo({
      'WORK.md': `---
cycle: test-cycle
stages:
  - forge:test-cycle
max-iterations: 3
---
# Test
`,
      'foundry/cycles/test-cycle.md': `---
id: test-cycle
output-type: test-type
---
`,
      'foundry/artefacts/test-type/definition.md': `---
id: test-type
file-patterns: []
---
`,
      '.foundry/forge-context.json': JSON.stringify({
        forgePreVersion: 'abc123',
        forgeItem: null,
      }),
      '.opencode/agents/foundry-openai-gpt-4o.md': '# agent',
    });
    const ctx = { cycleId: 'test-cycle', cwd: '/tmp/test', io, foundryDir: 'foundry', baseBranch: 'main' };
    const result = await __handleSortResultForTest(
      { route: 'forge:test-cycle', model: 'openai/gpt-4o', token: 'T1' },
      ctx,
    );

    assert.equal(result.action, 'dispatch');
    assert.ok(result.prompt);
    assert.doesNotMatch(result.prompt, /FEEDBACK ITEM TO ADDRESS/);
  });
});

// ---------------------------------------------------------------------------
// Tests for existing behaviour preservation
// ---------------------------------------------------------------------------

describe('existing renderDispatchPrompt behaviour preserved', () => {

  test('includes standard sections for forge without forgeItem', () => {
    const prompt = renderDispatchPrompt({
      stage: 'forge:test-cycle',
      cycle: 'test-cycle',
      token: 'T',
      cwd: '/w',
      filePatterns: ['out/*.md'],
    });
    assert.match(prompt, /Stage: forge:test-cycle/);
    assert.match(prompt, /Cycle: test-cycle/);
    assert.match(prompt, /Token: T/);
    assert.match(prompt, /Working directory: \/w/);
    assert.match(prompt, /File patterns \(forge only\)/);
    assert.match(prompt, /foundry_stage_begin/);
    assert.match(prompt, /foundry_stage_end/);
  });

  test('omits file-patterns line for non-forge stages', () => {
    const prompt = renderDispatchPrompt({
      stage: 'quench:test-cycle',
      cycle: 'test-cycle',
      token: 'T',
      cwd: '/w',
      filePatterns: null,
    });
    assert.doesNotMatch(prompt, /File patterns/);
  });
});
