// tests/lib/feedback-transitions.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransition, hashText, canForgeWontFix } from '../../src/scripts/lib/feedback-transitions.js';

describe('validateTransition — forge transitions', () => {
  test('forge: open → actioned is legal', () => {
    assert.deepEqual(
      validateTransition({ currentState: 'open', target: 'actioned', stageBase: 'forge', sourceMatches: false }),
      { ok: true }
    );
  });
  test('forge: open → wont-fix is legal', () => {
    assert.deepEqual(
      validateTransition({ currentState: 'open', target: 'wont-fix', stageBase: 'forge', sourceMatches: false }),
      { ok: true }
    );
  });
  test('forge: rejected → actioned is legal', () => {
    assert.deepEqual(
      validateTransition({ currentState: 'rejected', target: 'actioned', stageBase: 'forge', sourceMatches: false }),
      { ok: true }
    );
  });
  test('forge: rejected → wont-fix is legal', () => {
    assert.deepEqual(
      validateTransition({ currentState: 'rejected', target: 'wont-fix', stageBase: 'forge', sourceMatches: false }),
      { ok: true }
    );
  });
  test('forge: actioned → anything is rejected', () => {
    const r = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'forge', sourceMatches: false });
    assert.equal(r.ok, false);
  });
  test('forge: cannot operate on deadlocked', () => {
    const r = validateTransition({ currentState: 'deadlocked', target: 'actioned', stageBase: 'forge', sourceMatches: false });
    assert.equal(r.ok, false);
  });
  test('forge: cannot operate on resolved', () => {
    const r = validateTransition({ currentState: 'resolved', target: 'actioned', stageBase: 'forge', sourceMatches: false });
    assert.equal(r.ok, false);
  });
});

describe('validateTransition — source-stage transitions', () => {
  test('actioned → resolved requires matching source', () => {
    const ok = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'appraise', sourceMatches: true });
    assert.equal(ok.ok, true);
    const bad = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'appraise', sourceMatches: false });
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /source/);
  });
  test('wont-fix → rejected is legal when source matches', () => {
    const r = validateTransition({ currentState: 'wont-fix', target: 'rejected', stageBase: 'appraise', sourceMatches: true });
    assert.equal(r.ok, true);
  });
  test('quench can resolve only items it sourced', () => {
    const good = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'quench', sourceMatches: true });
    assert.equal(good.ok, true);
    const bad = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'quench', sourceMatches: false });
    assert.equal(bad.ok, false);
  });
  test('human-appraise can resolve items it sourced', () => {
    const r = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'human-appraise', sourceMatches: true });
    assert.equal(r.ok, true);
  });
});

describe('validateTransition — deadlock override', () => {
  test('human-appraise: deadlocked → resolved legal even when source does not match', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'resolved',
      stageBase: 'human-appraise',
      sourceMatches: false,
    });
    assert.equal(r.ok, true);
  });
  test('human-appraise: deadlocked → wont-fix is REJECTED (override mirrors source-stage targets)', () => {
    // wont-fix is a forge declaration ("considered, choosing not to act").
    // The deadlock-override authority answers the source-stage question
    // ("was the actioned/wont-fix outcome correct?") and so produces only
    // {resolved, rejected}. Producing wont-fix from a deadlocked item would
    // be a category error.
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'wont-fix',
      stageBase: 'human-appraise',
      sourceMatches: false,
    });
    assert.equal(r.ok, false);
  });
  test('human-appraise: deadlocked → rejected legal', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'rejected',
      stageBase: 'human-appraise',
      sourceMatches: false,
    });
    assert.equal(r.ok, true);
  });
  test('appraise CANNOT touch a deadlocked item (only human-appraise overrides)', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'resolved',
      stageBase: 'appraise',
      sourceMatches: true,
    });
    assert.equal(r.ok, false);
  });
  test('forge CANNOT touch a deadlocked item', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'actioned',
      stageBase: 'forge',
      sourceMatches: true,
    });
    assert.equal(r.ok, false);
  });
});

describe('validateTransition — terminal state', () => {
  test('resolved is terminal — no transitions allowed', () => {
    for (const target of ['actioned', 'wont-fix', 'rejected', 'resolved', 'deadlocked', 'open']) {
      for (const stage of ['forge', 'quench', 'appraise', 'human-appraise']) {
        const r = validateTransition({ currentState: 'resolved', target, stageBase: stage, sourceMatches: true });
        assert.equal(r.ok, false, `resolved → ${target} from ${stage} must be rejected`);
      }
    }
  });
});

describe('validateTransition — unknown state', () => {
  test('returns ok:false with a clear reason', () => {
    const r = validateTransition({ currentState: 'bogus', target: 'actioned', stageBase: 'forge', sourceMatches: false });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown state/);
  });
});

describe('hashText', () => {
  test('stable for same input', () => {
    assert.equal(hashText('abc'), hashText('abc'));
  });
  test('differs for different input', () => {
    assert.notEqual(hashText('abc'), hashText('abd'));
  });
  test('returns a 16-char hex string', () => {
    assert.match(hashText('anything'), /^[0-9a-f]{16}$/);
  });
});

describe('validateTransition — unsupported stage base', () => {
  test('returns ok:false with a clear reason', () => {
    const r = validateTransition({ currentState: 'open', target: 'actioned', stageBase: 'sort', sourceMatches: false });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unsupported stage base/);
  });
});

describe('validateTransition — sourceMatches guard', () => {
  test('throws when sourceMatches is omitted', () => {
    assert.throws(
      () => validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'appraise' }),
      /sourceMatches must be a boolean/
    );
  });
  test('throws when sourceMatches is a non-boolean truthy value', () => {
    assert.throws(
      () => validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'appraise', sourceMatches: 1 }),
      /sourceMatches must be a boolean/
    );
  });
});

describe('canForgeWontFix — A2 source-scoped wont-fix', () => {
  // Matrix: 3 source bases × 2 target states (actioned, wont-fix).
  // Only forge→wont-fix is affected; the predicate is source-agnostic for
  // the 'actioned' target (always true when called, since forge can always
  // produce 'actioned'). We express the rule as a pure predicate on
  // (item.source base, target) and exercise all 3 source bases.

  test('appraise-sourced item: forge can wont-fix', () => {
    const item = { source: 'appraise:write-check' };
    assert.equal(canForgeWontFix(item, 'forge'), true);
  });

  test('quench-sourced item: forge CANNOT wont-fix', () => {
    const item = { source: 'quench:schema' };
    assert.equal(canForgeWontFix(item, 'forge'), false);
  });

  test('human-appraise-sourced item: forge CANNOT wont-fix', () => {
    const item = { source: 'human-appraise:review' };
    assert.equal(canForgeWontFix(item, 'forge'), false);
  });

  test('non-forge caller: predicate is only meaningful for forge base', () => {
    // The predicate is documented as forge-specific; we codify that non-forge
    // callers get `false` (they should not be asking this question).
    const item = { source: 'appraise:x' };
    assert.equal(canForgeWontFix(item, 'appraise'), false);
    assert.equal(canForgeWontFix(item, 'quench'), false);
    assert.equal(canForgeWontFix(item, 'human-appraise'), false);
  });

  test('malformed source returns false (defensive)', () => {
    assert.equal(canForgeWontFix({ source: '' }, 'forge'), false);
    assert.equal(canForgeWontFix({ source: null }, 'forge'), false);
  });
});
