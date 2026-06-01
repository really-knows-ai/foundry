/**
 * Contract tests for the dispatch_multi action type and its validators.
 *
 * Tests cover:
 *   — DISPATCH_MULTI_ACTION constant
 *   — validateDispatchMulti
 *   — buildDispatchMultiResponse
 *
 * runOrchestrate tests were removed as part of deleting the old LLM-driven
 * orchestration entry point.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DISPATCH_MULTI_ACTION, validateDispatchMulti, buildDispatchMultiResponse } from '../src/scripts/orchestrate-cycle.js';

// ---------------------------------------------------------------------------
// DISPATCH_MULTI_ACTION constant
// ---------------------------------------------------------------------------

describe('DISPATCH_MULTI_ACTION', () => {

  it('is the string "dispatch_multi"', () => {
    assert.equal(DISPATCH_MULTI_ACTION, 'dispatch_multi');
  });

  it('is exported from orchestrate-cycle.js', () => {
    assert.equal(typeof DISPATCH_MULTI_ACTION, 'string');
  });
});

// ---------------------------------------------------------------------------
// validateDispatchMulti
// ---------------------------------------------------------------------------

describe('validateDispatchMulti', () => {

  it('returns undefined for a valid dispatch_multi action', () => {
    const action = buildDispatchMultiResponse(
      [{ subagent_type: 'agent-a', prompt: 'do work' }],
      'appraise:test-cycle',
      'test-cycle',
    );
    const result = validateDispatchMulti(action);
    assert.equal(result, undefined);
  });

  it('returns undefined for empty tasks array', () => {
    const action = buildDispatchMultiResponse([], 'appraise:test-cycle', 'test-cycle');
    const result = validateDispatchMulti(action);
    assert.equal(result, undefined);
  });

  it('returns violation when action is not dispatch_multi', () => {
    const result = validateDispatchMulti({ action: 'dispatch', tasks: [] });
    assert.equal(result.action, 'violation');
    assert.match(result.details, /dispatch_multi/);
  });

  it('returns violation when action is null', () => {
    const result = validateDispatchMulti(null);
    assert.equal(result.action, 'violation');
    assert.match(result.details, /dispatch_multi/);
  });

  it('returns violation when tasks is not an array', () => {
    const result = validateDispatchMulti({ action: 'dispatch_multi', tasks: 'not-array' });
    assert.equal(result.action, 'violation');
    assert.match(result.details, /tasks must be an array/);
  });

  it('returns violation when a task lacks subagent_type', () => {
    const result = validateDispatchMulti({
      action: 'dispatch_multi',
      tasks: [{ prompt: 'work' }],
    });
    assert.equal(result.action, 'violation');
    assert.match(result.details, /subagent_type/);
  });

  it('returns violation when a task has empty subagent_type', () => {
    const result = validateDispatchMulti({
      action: 'dispatch_multi',
      tasks: [{ subagent_type: '', prompt: 'work' }],
    });
    assert.equal(result.action, 'violation');
    assert.match(result.details, /subagent_type/);
  });

  it('returns violation when a task lacks prompt', () => {
    const result = validateDispatchMulti({
      action: 'dispatch_multi',
      tasks: [{ subagent_type: 'agent-a' }],
    });
    assert.equal(result.action, 'violation');
    assert.match(result.details, /prompt/);
  });

  it('returns violation when a task has empty prompt', () => {
    const result = validateDispatchMulti({
      action: 'dispatch_multi',
      tasks: [{ subagent_type: 'agent-a', prompt: '' }],
    });
    assert.equal(result.action, 'violation');
    assert.match(result.details, /prompt/);
  });

  it('validates all tasks and reports the first index with an error', () => {
    const result = validateDispatchMulti({
      action: 'dispatch_multi',
      tasks: [
        { subagent_type: 'good', prompt: 'ok' },
        { subagent_type: '', prompt: 'bad' },
        { subagent_type: 'also-bad' },
      ],
    });
    assert.equal(result.action, 'violation');
    assert.match(result.details, /tasks\[1\]/);
  });
});

// ---------------------------------------------------------------------------
// buildDispatchMultiResponse
// ---------------------------------------------------------------------------

describe('buildDispatchMultiResponse', () => {

  it('builds a dispatch_multi response with the correct shape', () => {
    const tasks = [{ subagent_type: 'a', prompt: 'p' }];
    const result = buildDispatchMultiResponse(tasks, 'appraise:test-cycle', 'test-cycle');

    assert.equal(result.action, DISPATCH_MULTI_ACTION);
    assert.equal(result.stage, 'appraise:test-cycle');
    assert.equal(result.cycle, 'test-cycle');
    assert.equal(result.tasks, tasks);
  });

  it('accepts an empty tasks array', () => {
    const result = buildDispatchMultiResponse([], 'appraise:c', 'c');
    assert.deepEqual(result.tasks, []);
  });

  it('returns a plain object (not a frozen object)', () => {
    const result = buildDispatchMultiResponse([], 's', 'c');
    result.custom = true;
    assert.equal(result.custom, true);
  });
});

// runOrchestrate tests removed — the old LLM-driven orchestration entry
// point was replaced by runRun/continueRun in run.js.
