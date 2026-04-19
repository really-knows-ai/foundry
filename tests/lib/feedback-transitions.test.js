import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransition, hashText } from '../../scripts/lib/feedback-transitions.js';

describe('validateTransition', () => {
  // forge transitions
  it('forge: open → actioned', () => assert.ok(validateTransition('open', 'actioned', 'forge').ok));
  it('forge: open → wont-fix', () => assert.ok(validateTransition('open', 'wont-fix', 'forge').ok));
  it('forge: rejected → actioned', () => assert.ok(validateTransition('rejected', 'actioned', 'forge').ok));
  it('forge: rejected → wont-fix', () => assert.ok(validateTransition('rejected', 'wont-fix', 'forge').ok));
  it('forge: cannot approve', () => assert.equal(validateTransition('actioned', 'approved', 'forge').ok, false));

  // quench transitions
  it('quench: actioned → approved', () => assert.ok(validateTransition('actioned', 'approved', 'quench').ok));
  it('quench: actioned → rejected', () => assert.ok(validateTransition('actioned', 'rejected', 'quench').ok));
  it('quench: wont-fix → approved REJECTED (quench cannot)', () =>
    assert.equal(validateTransition('wont-fix', 'approved', 'quench').ok, false));
  it('quench: wont-fix → rejected REJECTED', () =>
    assert.equal(validateTransition('wont-fix', 'rejected', 'quench').ok, false));

  // appraise transitions
  it('appraise: actioned → approved', () => assert.ok(validateTransition('actioned', 'approved', 'appraise').ok));
  it('appraise: wont-fix → approved', () => assert.ok(validateTransition('wont-fix', 'approved', 'appraise').ok));
  it('appraise: wont-fix → rejected', () => assert.ok(validateTransition('wont-fix', 'rejected', 'appraise').ok));

  // human-appraise transitions
  it('human-appraise: wont-fix → approved', () =>
    assert.ok(validateTransition('wont-fix', 'approved', 'human-appraise').ok));

  // terminal
  it('approved is terminal', () => {
    assert.equal(validateTransition('approved', 'rejected', 'quench').ok, false);
    assert.equal(validateTransition('approved', 'actioned', 'forge').ok, false);
  });

  // reverse direction
  it('cannot un-action', () => assert.equal(validateTransition('actioned', 'open', 'forge').ok, false));
});

describe('hashText', () => {
  it('is 16 hex chars', () => assert.match(hashText('hi'), /^[0-9a-f]{16}$/));
  it('is deterministic', () => assert.equal(hashText('x'), hashText('x')));
  it('differs for different input', () => assert.notEqual(hashText('a'), hashText('b')));
});
