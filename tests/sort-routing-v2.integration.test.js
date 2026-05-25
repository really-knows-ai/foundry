/**
 * Integration tests for the sort routing v2 decision tree.
 *
 * Each test calls determineRoute with realistic fixtures and asserts
 * the expected route.  Covers R1–R4, R7, R3 human-appraise gates,
 * deadlock and iteration cap, R7 chain restart, and edge cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { determineRoute } from '../src/scripts/sort.js';
import { makeFeedbackWithVersion } from './helpers/version-test-utils.js';

// ---------------------------------------------------------------------------
// Tests 1–9: Routing decision tree (R1–R4)
// ---------------------------------------------------------------------------

describe('routing decision tree — R1–R4', () => {
  const stages = ['forge:haiku-cycle', 'quench:haiku-cycle', 'appraise:haiku-cycle'];
  const opts = { cycle: 'haiku-cycle' };

  // #1 — First run, no history
  it('returns first stage when no history exists', () => {
    const result = determineRoute(stages, [], [], 3, opts);
    assert.equal(result, 'forge:haiku-cycle');
  });

  // #2 — After forge with no unresolved or addressed items
  it('routes to first evaluation stage after forge when clean', () => {
    const history = [{ stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' }];
    const result = determineRoute(stages, history, [], 3, opts);
    assert.equal(result, 'quench:haiku-cycle');
  });

  // #3 — After forge with unresolved items
  it('routes back to forge when unresolved items exist after forge', () => {
    const history = [{ stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' }];
    const feedback = [makeFeedbackWithVersion({ state: 'open' })];
    const result = determineRoute(stages, history, feedback, 3, opts);
    assert.equal(result, 'forge:haiku-cycle');
  });

  // #4 — Unresolved items from any last stage route to forge
  it('routes to forge when unresolved items exist and last stage is not forge', () => {
    const history = [{ stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' }];
    const feedback = [makeFeedbackWithVersion({ state: 'open' })];
    const result = determineRoute(stages, history, feedback, 3, opts);
    assert.equal(result, 'forge:haiku-cycle');
  });

  // #5 — Addressed items from quench route to quench
  it('routes to quench when quench-sourced addressed items exist', () => {
    const history = [{ stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' }];
    const feedback = [makeFeedbackWithVersion({ state: 'actioned', source: 'quench:haiku-cycle' })];
    const result = determineRoute(stages, history, feedback, 3, opts);
    assert.equal(result, 'quench:haiku-cycle');
  });

  // #6 — Mixed addressed items from quench + appraise route to quench (earliest)
  it('routes to earliest source (quench) when both quench and appraise have addressed items', () => {
    const history = [{ stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' }];
    const feedback = [
      makeFeedbackWithVersion({ state: 'actioned', source: 'appraise:haiku-cycle' }),
      makeFeedbackWithVersion({ state: 'actioned', source: 'quench:haiku-cycle' }),
    ];
    const result = determineRoute(stages, history, feedback, 3, opts);
    assert.equal(result, 'quench:haiku-cycle');
  });

  // #7 — Addressed items from appraise only route to appraise
  it('routes to appraise when appraise-sourced addressed items exist', () => {
    const history = [{ stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' }];
    const feedback = [makeFeedbackWithVersion({ state: 'actioned', source: 'appraise:haiku-cycle' })];
    const result = determineRoute(stages, history, feedback, 3, opts);
    assert.equal(result, 'appraise:haiku-cycle');
  });

  // #8 — Clean state forward progression
  it('advances to next stage in chain when no unresolved or addressed items', () => {
    const history = [{ stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' }];
    const result = determineRoute(stages, history, [], 3, opts);
    assert.equal(result, 'quench:haiku-cycle');
  });

  // #9 — Clean state → done when at end of chain
  it('returns done when at end of chain with no items', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const result = determineRoute(stages, history, [], 3, opts);
    assert.equal(result, 'done');
  });
});

// ---------------------------------------------------------------------------
// Tests 10–13: Human-appraise gates (R3)
// ---------------------------------------------------------------------------

describe('human-appraise gates — R3', () => {
  const stages = ['forge:haiku-cycle', 'quench:haiku-cycle', 'appraise:haiku-cycle', 'human-appraise:haiku-cycle'];

  // #10 — alwaysHumanAppraise: true, clean state after appraise → human-appraise
  it('routes to human-appraise when alwaysHumanAppraise is true and state is clean after appraise', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const result = determineRoute(stages, history, [], 3, { alwaysHumanAppraise: true, cycle: 'haiku-cycle' });
    assert.equal(result, 'human-appraise:haiku-cycle');
  });

  // #11 — alwaysHumanAppraise: true, unresolved items after appraise → forge, not human-appraise
  it('routes to forge (not human-appraise) when unresolved items exist and alwaysHumanAppraise is true', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const feedback = [makeFeedbackWithVersion({ state: 'open', source: 'appraise:haiku-cycle' })];
    const result = determineRoute(stages, history, feedback, 3, { alwaysHumanAppraise: true, cycle: 'haiku-cycle' });
    assert.equal(result, 'forge:haiku-cycle');
  });

  // #12 — alwaysHumanAppraise: true with quench-sourced addressed items routes to quench first
  it('routes to quench (addressed items priority) even when alwaysHumanAppraise is true', () => {
    const history = [{ stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' }];
    const feedback = [makeFeedbackWithVersion({ state: 'actioned', source: 'quench:haiku-cycle' })];
    const result = determineRoute(stages, history, feedback, 3, { alwaysHumanAppraise: true, cycle: 'haiku-cycle' });
    assert.equal(result, 'quench:haiku-cycle');
  });

  // #13 — alwaysHumanAppraise: false, clean state after appraise → done, skips human-appraise
  it('returns done when alwaysHumanAppraise is false and next stage is human-appraise', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const result = determineRoute(stages, history, [], 3, { alwaysHumanAppraise: false, cycle: 'haiku-cycle' });
    assert.equal(result, 'done');
  });
});

// ---------------------------------------------------------------------------
// Tests 14–17: Deadlock and iteration cap (R4)
// ---------------------------------------------------------------------------

describe('deadlock and iteration cap — R4', () => {
  const stages = ['forge:haiku-cycle', 'quench:haiku-cycle', 'appraise:haiku-cycle', 'human-appraise:haiku-cycle'];
  const stagesNoHuman = ['forge:haiku-cycle', 'quench:haiku-cycle', 'appraise:haiku-cycle'];

  // Build history with 3 successful forge runs followed by quench
  const deadlockHistory = [
    { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true },
    { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
    { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true },
    { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
    { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true },
    { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
  ];

  const unresolvedFeedback = [makeFeedbackWithVersion({ state: 'open' })];
  const opts = { cycle: 'haiku-cycle' };

  // #14 — forgeCount >= maxIterations, unresolved, deadlockHumanAppraise: true → human-appraise
  it('routes to human-appraise when forge cap reached with unresolved items and deadlockHumanAppraise is true', () => {
    const result = determineRoute(stages, deadlockHistory, unresolvedFeedback, 3, {
      ...opts,
      deadlockHumanAppraise: true,
    });
    assert.equal(result, 'human-appraise:haiku-cycle');
  });

  // #15 — forgeCount >= maxIterations, unresolved, deadlockHumanAppraise: false → blocked
  it('returns blocked when forge cap reached with unresolved items and deadlockHumanAppraise is false', () => {
    const result = determineRoute(stagesNoHuman, deadlockHistory, unresolvedFeedback, 3, {
      ...opts,
      deadlockHumanAppraise: false,
    });
    assert.equal(result, 'blocked');
  });

  // #16 — alwaysHumanAppraise: true bypasses iteration cap
  it('bypasses iteration cap when alwaysHumanAppraise is true, routing to forge', () => {
    const result = determineRoute(stagesNoHuman, deadlockHistory, unresolvedFeedback, 3, {
      ...opts,
      alwaysHumanAppraise: true,
    });
    assert.equal(result, 'forge:haiku-cycle');
  });

  // #17 — alwaysHumanAppraise + deadlockHumanAppraise — alwaysHumanAppraise takes priority
  it('alwaysHumanAppraise takes priority over deadlockHumanAppraise, routing to forge', () => {
    const result = determineRoute(stages, deadlockHistory, unresolvedFeedback, 3, {
      ...opts,
      alwaysHumanAppraise: true,
      deadlockHumanAppraise: true,
    });
    assert.equal(result, 'forge:haiku-cycle');
  });
});

// ---------------------------------------------------------------------------
// Tests 18–19: R7 after forge
// ---------------------------------------------------------------------------

describe('R7 — After forge restarts at first evaluation stage', () => {
  // #18 — After forge, addressed items exist, version differs → skip source-stage routing
  it('R7 restarts at first evaluation stage after forge even when addressed items exist', () => {
    const stages = ['forge:haiku-cycle', 'quench:haiku-cycle', 'appraise:haiku-cycle'];
    const history = [{ stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true }];
    // Quench-sourced addressed items would normally route to quench, but R7
    // chain restart takes priority since the last stage is forge
    const feedback = [makeFeedbackWithVersion({ state: 'actioned', source: 'quench:haiku-cycle' })];
    const result = determineRoute(stages, history, feedback, 3, { cycle: 'haiku-cycle' });
    assert.equal(result, 'quench:haiku-cycle');
  });

  // #19 — After forge with no quench in chain → routes to appraise directly
  it('routes to appraise after forge when quench is omitted from chain', () => {
    const stages = ['forge:haiku-cycle', 'appraise:haiku-cycle'];
    const history = [{ stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true }];
    const result = determineRoute(stages, history, [], 3, { cycle: 'haiku-cycle' });
    assert.equal(result, 'appraise:haiku-cycle');
  });
});

// ---------------------------------------------------------------------------
// Tests 20–24: Edge cases and validation
// ---------------------------------------------------------------------------

describe('edge cases and validation', () => {
  const stages = ['forge:haiku-cycle', 'quench:haiku-cycle', 'appraise:haiku-cycle'];

  // #20 — maxIterations: 0
  it('returns blocked when maxIterations is 0', () => {
    const history = [{ stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' }];
    const result = determineRoute(stages, history, [], 0, { cycle: 'haiku-cycle' });
    assert.equal(result, 'blocked');
  });

  // #21 — maxIterations: -1
  it('returns blocked when maxIterations is negative', () => {
    const history = [{ stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' }];
    const result = determineRoute(stages, history, [], -1, { cycle: 'haiku-cycle' });
    assert.equal(result, 'blocked');
  });

  // #22 — Empty stages list
  it('returns blocked when stages list is empty', () => {
    const result = determineRoute([], [], [], 3, { cycle: 'haiku-cycle' });
    assert.equal(result, 'blocked');
  });

  // #23 — No forge stage and unresolved items exist
  it('returns blocked when no forge stage exists and unresolved items remain', () => {
    const noForgeStages = ['quench:haiku-cycle', 'appraise:haiku-cycle'];
    const history = [{ stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' }];
    const feedback = [makeFeedbackWithVersion({ state: 'open' })];
    const result = determineRoute(noForgeStages, history, feedback, 3, { cycle: 'haiku-cycle' });
    assert.equal(result, 'blocked');
  });

  // #24 — Source stage missing from stages for addressed item — skip to next or forward
  it('skips addressed items whose source stage is not in configured stages, falling through to forwardClean', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    // Human-appraise-sourced addressed item, but human-appraise is not in stages
    const feedback = [makeFeedbackWithVersion({ state: 'actioned', source: 'human-appraise:haiku-cycle' })];
    const result = determineRoute(stages, history, feedback, 3, { cycle: 'haiku-cycle' });
    // No source stage matches → forwardClean → done (end of chain)
    assert.equal(result, 'done');
  });
});
