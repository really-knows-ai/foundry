// tests/lib/stage-output-schemas.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateForgeOutput,
  validateAppraiseOutput,
  validateHumanAppraiseOutput,
} from '../../src/scripts/lib/stage-output-schemas.js';

// ── Forge ──────────────────────────────────────────────────────────

describe('validateForgeOutput — valid objects', () => {
  test('accepts { status: "done" }', () => {
    assert.deepEqual(validateForgeOutput({ status: 'done' }), { ok: true });
  });

  test('accepts { status: "actioned" }', () => {
    assert.deepEqual(validateForgeOutput({ status: 'actioned' }), { ok: true });
  });

  test('accepts { status: "wont-fix", reason: "x" }', () => {
    assert.deepEqual(validateForgeOutput({ status: 'wont-fix', reason: 'x' }), { ok: true });
  });

  test('accepts { status: "wont-fix", reason: "" } (empty reason is acceptable)', () => {
    assert.deepEqual(validateForgeOutput({ status: 'wont-fix', reason: '' }), { ok: true });
  });
});

describe('validateForgeOutput — non-object inputs', () => {
  test('rejects null', () => {
    const r = validateForgeOutput(null);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge — must be a plain object']);
  });

  test('rejects array', () => {
    const r = validateForgeOutput([1, 2]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge — must be a plain object']);
  });

  test('rejects string', () => {
    const r = validateForgeOutput('hello');
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge — must be a plain object']);
  });

  test('rejects number', () => {
    const r = validateForgeOutput(5);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge — must be a plain object']);
  });
});

describe('validateForgeOutput — status field', () => {
  test('rejects invalid status value', () => {
    const r = validateForgeOutput({ status: 'fixed' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: status — must be one of "done", "actioned", "wont-fix"']);
  });

  test('rejects missing status', () => {
    const r = validateForgeOutput({});
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: status — is required']);
  });
});

describe('validateForgeOutput — reason conditional', () => {
  test('rejects wont-fix without reason', () => {
    const r = validateForgeOutput({ status: 'wont-fix' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: reason — is required']);
  });

  test('rejects wont-fix with non-string reason', () => {
    const r = validateForgeOutput({ status: 'wont-fix', reason: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: reason — must be a string']);
  });


});

describe('validateForgeOutput — reports all errors', () => {
  test('reports invalid status value', () => {
    const r = validateForgeOutput({ status: 'fixed' });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.ok(r.errors.some(e => e.includes('status')));
  });
});

// ── Appraise ───────────────────────────────────────────────────────

describe('validateAppraiseOutput — valid objects', () => {
  test('accepts required fields only', () => {
    assert.deepEqual(
      validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0 }),
      { ok: true },
    );
  });

  test('accepts all optional fields', () => {
    assert.deepEqual(
      validateAppraiseOutput({
        file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0,
        evidence: 'e', severity: 'high', location: 'line 5',
      }),
      { ok: true },
    );
  });

  test('accepts subset of optional fields', () => {
    assert.deepEqual(
      validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0, evidence: 'e' }),
      { ok: true },
    );
  });
});

describe('validateAppraiseOutput — non-object inputs', () => {
  test('rejects null', () => {
    const r = validateAppraiseOutput(null);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise — must be a plain object']);
  });

  test('rejects array', () => {
    const r = validateAppraiseOutput([1, 2]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise — must be a plain object']);
  });

  test('rejects string', () => {
    const r = validateAppraiseOutput('hello');
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise — must be a plain object']);
  });

  test('rejects number', () => {
    const r = validateAppraiseOutput(5);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise — must be a plain object']);
  });
});

describe('validateAppraiseOutput — missing required fields', () => {
  test('rejects missing file', () => {
    const r = validateAppraiseOutput({ law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: file — is required']);
  });

  test('rejects missing law', () => {
    const r = validateAppraiseOutput({ file: 'f', text: 't', group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: law — is required']);
  });

  test('rejects missing text', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: text — is required']);
  });

  test('rejects missing group', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: group — is required']);
  });

  test('rejects missing appraiser', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: appraiser — is required']);
  });

  test('rejects missing pass', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: pass — is required']);
  });
});

describe('validateAppraiseOutput — empty required strings', () => {
  test('rejects empty file', () => {
    const r = validateAppraiseOutput({ file: '', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: file — must be a non-empty string']);
  });

  test('rejects empty law', () => {
    const r = validateAppraiseOutput({ file: 'f', law: '', text: 't', group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: law — must be a non-empty string']);
  });

  test('rejects empty text', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: '', group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: text — must be a non-empty string']);
  });
});

describe('validateAppraiseOutput — type mismatches on required fields', () => {
  test('rejects non-string file', () => {
    const r = validateAppraiseOutput({ file: 5, law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: file — must be a string']);
  });

  test('rejects non-string law', () => {
    const r = validateAppraiseOutput({ file: 'f', law: true, text: 't', group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: law — must be a string']);
  });

  test('rejects non-string text', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: null, group: 'g', appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: text — must be a string']);
  });

  test('rejects non-string group', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 5, appraiser: 'a', pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: group — must be a string']);
  });

  test('rejects non-string appraiser', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: true, pass: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: appraiser — must be a string']);
  });

  test('rejects non-integer pass (string)', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 'yes' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: pass — must be an integer']);
  });

  test('rejects non-integer pass (float)', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0.5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: pass — must be an integer']);
  });

  test('rejects non-integer pass (null)', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: null });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: pass — must be an integer']);
  });
});

describe('validateAppraiseOutput — type mismatches on optional fields', () => {
  test('rejects non-string evidence', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0, evidence: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: evidence — must be a string']);
  });

  test('rejects non-string severity', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0, severity: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: severity — must be a string']);
  });

  test('rejects non-string location', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', group: 'g', appraiser: 'a', pass: 0, location: {} });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: location — must be a string']);
  });
});

describe('validateAppraiseOutput — reports all errors', () => {
  test('reports multiple field errors together', () => {
    const r = validateAppraiseOutput({
      file: '', law: '', text: '',
      group: '', appraiser: '', pass: 'not-an-int',
    });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 4);
    assert.ok(r.errors.every(e => e.startsWith('appraise:')));
  });
});

describe('validateAppraiseOutput — pass field integer validation', () => {
  test('accepts pass: 0', () => {
    assert.deepEqual(
      validateAppraiseOutput({
        file: 'f', law: 'l', text: 't',
        group: 'g', appraiser: 'a', pass: 0,
      }),
      { ok: true },
    );
  });

  test('accepts pass: 1', () => {
    assert.deepEqual(
      validateAppraiseOutput({
        file: 'f', law: 'l', text: 't',
        group: 'g', appraiser: 'a', pass: 1,
      }),
      { ok: true },
    );
  });

  test('accepts pass: -1 (negative integer is still a valid integer)', () => {
    assert.deepEqual(
      validateAppraiseOutput({
        file: 'f', law: 'l', text: 't',
        group: 'g', appraiser: 'a', pass: -1,
      }),
      { ok: true },
    );
  });

  test('rejects pass: true', () => {
    const r = validateAppraiseOutput({
      file: 'f', law: 'l', text: 't',
      group: 'g', appraiser: 'a', pass: true,
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: pass — must be an integer']);
  });
});

// ── Human-Appraise ─────────────────────────────────────────────────

describe('validateHumanAppraiseOutput — valid object', () => {
  test('accepts { verdict: "approved" }', () => {
    assert.deepEqual(
      validateHumanAppraiseOutput({ verdict: 'approved' }),
      { ok: true },
    );
  });

  test('accepts extra fields', () => {
    assert.deepEqual(
      validateHumanAppraiseOutput({ verdict: 'approved', extra: 'field' }),
      { ok: true },
    );
  });
});

describe('validateHumanAppraiseOutput — non-object inputs', () => {
  test('rejects null', () => {
    const r = validateHumanAppraiseOutput(null);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise — must be a plain object']);
  });

  test('rejects array', () => {
    const r = validateHumanAppraiseOutput([1, 2]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise — must be a plain object']);
  });

  test('rejects string', () => {
    const r = validateHumanAppraiseOutput('hello');
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise — must be a plain object']);
  });

  test('rejects number', () => {
    const r = validateHumanAppraiseOutput(5);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise — must be a plain object']);
  });
});

describe('validateHumanAppraiseOutput — verdict field', () => {
  test('rejects invalid verdict value', () => {
    const r = validateHumanAppraiseOutput({ verdict: 'rejected' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: verdict — must be "approved"']);
  });

  test('rejects non-string verdict value', () => {
    const r = validateHumanAppraiseOutput({ verdict: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: verdict — must be "approved"']);
  });

  test('rejects missing verdict', () => {
    const r = validateHumanAppraiseOutput({});
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: verdict — is required']);
  });
});

describe('validateHumanAppraiseOutput — reports all errors', () => {
  test('reports invalid verdict', () => {
    const r = validateHumanAppraiseOutput({ verdict: 'rejected' });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.ok(r.errors.every(e => e.startsWith('human-appraise:')));
  });
});
