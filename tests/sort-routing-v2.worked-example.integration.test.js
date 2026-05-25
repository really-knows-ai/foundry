/**
 * Reproduces the 10-step worked example from SPEC.md.
 *
 * Each step asserts the route from determineRoute given the state described
 * in the worked example: history entries, artefact version, and feedback
 * items.  Steps accumulate sequentially so the test mirrors the spec's
 * full-cycle narrative.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { determineRoute } from '../src/scripts/sort.js';
import { makeFeedbackWithVersion, HASH_V1, HASH_V2 } from './helpers/version-test-utils.js';

describe('worked example — 10-step haiku flow', () => {
  const stages = [
    'forge:haiku-cycle',
    'quench:haiku-cycle',
    'appraise:haiku-cycle',
    'human-appraise:haiku-cycle',
  ];
  const opts = { alwaysHumanAppraise: true, deadlockHumanAppraise: false, cycle: 'haiku-cycle' };
  const max = 3;

  // Step 1 — Assay (first run, no artefact yet)
  it('Step 1: First run with no history routes to forge:haiku-cycle', () => {
    const route = determineRoute(stages, [], [], max, opts);
    assert.equal(route, 'forge:haiku-cycle');
  });

  // Step 2 — After forge, no unresolved items
  it('Step 2: After clean forge, routes to quench:haiku-cycle', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
    ];
    const route = determineRoute(stages, history, [], max, opts);
    assert.equal(route, 'quench:haiku-cycle');
  });

  // Step 3 — After quench, unresolved item exists (Q1 open)
  it('Step 3: After quench with open Q1, routes to forge:haiku-cycle', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const feedback = [
      makeFeedbackWithVersion({
        state: 'open', source: 'quench:haiku-cycle', artefact_version: HASH_V1,
      }),
    ];
    const route = determineRoute(stages, history, feedback, max, opts);
    assert.equal(route, 'forge:haiku-cycle');
  });

  // Step 4 — After forge, addressed item (Q1 actioned), version changed
  it('Step 4: After forge with actioned Q1, R7 restarts at quench:haiku-cycle', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 2 },
    ];
    const feedback = [
      makeFeedbackWithVersion({
        state: 'actioned', source: 'quench:haiku-cycle', artefact_version: HASH_V1,
      }),
    ];
    const route = determineRoute(stages, history, feedback, max, opts);
    assert.equal(route, 'quench:haiku-cycle');
  });

  // Step 5 — After quench, clean (Q1 resolved), forward progression
  it('Step 5: After clean quench, forward progression to appraise:haiku-cycle', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 2 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const feedback = [
      makeFeedbackWithVersion({
        state: 'resolved', source: 'quench:haiku-cycle', artefact_version: HASH_V1,
      }),
    ];
    const route = determineRoute(stages, history, feedback, max, opts);
    assert.equal(route, 'appraise:haiku-cycle');
  });

  // Step 6 — After appraise, unresolved item (A1 open)
  it('Step 6: After appraise with open A1, routes to forge:haiku-cycle', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 2 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const feedback = [
      makeFeedbackWithVersion({
        state: 'resolved', source: 'quench:haiku-cycle', artefact_version: HASH_V1,
      }),
      makeFeedbackWithVersion({
        id: 'fb-A1',
        state: 'open', source: 'appraise:haiku-cycle', artefact_version: HASH_V2,
      }),
    ];
    const route = determineRoute(stages, history, feedback, max, opts);
    assert.equal(route, 'forge:haiku-cycle');
  });

  // Step 7 — After forge, addressed item (A1 wont-fix), version unchanged
  it('Step 7: After forge with wont-fix A1, R7 restarts at quench:haiku-cycle', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 2 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 3 },
    ];
    const feedback = [
      makeFeedbackWithVersion({
        state: 'resolved', source: 'quench:haiku-cycle', artefact_version: HASH_V1,
      }),
      makeFeedbackWithVersion({
        id: 'fb-A1',
        state: 'wont-fix', source: 'appraise:haiku-cycle', artefact_version: HASH_V2,
      }),
    ];
    const route = determineRoute(stages, history, feedback, max, opts);
    assert.equal(route, 'quench:haiku-cycle');
  });

  // Step 8 — After quench, addressed item from appraise (A1 wont-fix)
  it('Step 8: After quench with wont-fix A1, routes to appraise:haiku-cycle (addressed source)', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 2 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 3 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const feedback = [
      makeFeedbackWithVersion({
        state: 'resolved', source: 'quench:haiku-cycle', artefact_version: HASH_V1,
      }),
      makeFeedbackWithVersion({
        id: 'fb-A1',
        state: 'wont-fix', source: 'appraise:haiku-cycle', artefact_version: HASH_V2,
      }),
    ];
    const route = determineRoute(stages, history, feedback, max, opts);
    assert.equal(route, 'appraise:haiku-cycle');
  });

  // Step 9 — After appraise, clean (A1 resolved), alwaysHumanAppraise → human-appraise
  it('Step 9: After clean appraise with alwaysHumanAppraise, routes to human-appraise:haiku-cycle', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 2 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 3 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const feedback = [
      makeFeedbackWithVersion({
        state: 'resolved', source: 'quench:haiku-cycle', artefact_version: HASH_V1,
      }),
      makeFeedbackWithVersion({
        id: 'fb-A1',
        state: 'resolved', source: 'appraise:haiku-cycle', artefact_version: HASH_V2,
      }),
    ];
    const route = determineRoute(stages, history, feedback, max, opts);
    assert.equal(route, 'human-appraise:haiku-cycle');
  });

  // Step 10 — After human-appraise, clean, terminal
  it('Step 10: After clean human-appraise, returns done', () => {
    const history = [
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 1 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 2 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'forge:haiku-cycle', cycle: 'haiku-cycle', contract_passed: true, iteration: 3 },
      { stage: 'quench:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'appraise:haiku-cycle', cycle: 'haiku-cycle' },
      { stage: 'human-appraise:haiku-cycle', cycle: 'haiku-cycle' },
    ];
    const feedback = [
      makeFeedbackWithVersion({
        state: 'resolved', source: 'quench:haiku-cycle', artefact_version: HASH_V1,
      }),
      makeFeedbackWithVersion({
        id: 'fb-A1',
        state: 'resolved', source: 'appraise:haiku-cycle', artefact_version: HASH_V2,
      }),
    ];
    const route = determineRoute(stages, history, feedback, max, opts);
    assert.equal(route, 'done');
  });
});
