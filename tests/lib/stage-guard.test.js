// tests/lib/stage-guard.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireNoActiveStage, requireActiveStage, stageBaseOf } from '../../scripts/lib/stage-guard.js';

function fakeIO(active) {
  const store = new Map();
  if (active) store.set('.foundry/active-stage.json', JSON.stringify(active));
  return {
    exists: (p) => store.has(p),
    readFile: (p) => store.get(p),
  };
}

describe('stage-guard', () => {
  it('requireNoActiveStage ok when absent', () => {
    assert.equal(requireNoActiveStage(fakeIO(null)).ok, true);
  });

  it('requireNoActiveStage errors when present', () => {
    const r = requireNoActiveStage(fakeIO({ cycle: 'c', stage: 'forge:c' }));
    assert.equal(r.ok, false);
    assert.match(r.error, /no active stage.*forge:c/);
  });

  it('requireActiveStage matches stageBase + cycle', () => {
    const io = fakeIO({ cycle: 'c', stage: 'forge:c' });
    assert.ok(requireActiveStage(io, { stageBase: 'forge', cycle: 'c' }).ok);
  });

  it('requireActiveStage rejects stageBase mismatch', () => {
    const io = fakeIO({ cycle: 'c', stage: 'forge:c' });
    const r = requireActiveStage(io, { stageBase: 'quench', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /requires active quench stage/);
  });

  it('stageBaseOf splits on colon', () => {
    assert.equal(stageBaseOf('forge:create-haiku'), 'forge');
    assert.equal(stageBaseOf('human-appraise:x'), 'human-appraise');
  });
});
