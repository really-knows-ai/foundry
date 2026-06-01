// tests/orchestrate.test.js — Unit tests for renderDispatchPrompt.
// renderDispatchPrompt was moved to orchestrate-cycle.js during the SDK
// orchestration migration; captureForgeContext and handleSortResult were
// removed as part of deleting the old LLM-driven dispatch system.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let renderDispatchPrompt;

beforeEach(async () => {
  const mod = await import('../src/scripts/orchestrate-cycle.js');
  renderDispatchPrompt = mod.renderDispatchPrompt;
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

// buildDispatchAction via handleSortResult tests removed — this function
// was part of the old LLM-driven dispatch system and is no longer available.

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
