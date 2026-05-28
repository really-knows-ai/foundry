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
    assert.deepEqual(r.errors, ['forge: data — must be a plain object']);
  });

  test('rejects array', () => {
    const r = validateForgeOutput([1, 2]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: data — must be a plain object']);
  });

  test('rejects string', () => {
    const r = validateForgeOutput('hello');
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: data — must be a plain object']);
  });

  test('rejects number', () => {
    const r = validateForgeOutput(5);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: data — must be a plain object']);
  });
});

describe('validateForgeOutput — status field', () => {
  test('rejects invalid status value', () => {
    const r = validateForgeOutput({ status: 'fixed' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: status — must be one of done, actioned, wont-fix']);
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
    assert.deepEqual(r.errors, ['forge: reason — is required when status is wont-fix']);
  });

  test('rejects wont-fix with non-string reason', () => {
    const r = validateForgeOutput({ status: 'wont-fix', reason: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: reason — is required when status is wont-fix']);
  });

  test('rejects actioned with reason', () => {
    const r = validateForgeOutput({ status: 'actioned', reason: 'stuff' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: reason — must not be present when status is actioned']);
  });

  test('rejects done with reason', () => {
    const r = validateForgeOutput({ status: 'done', reason: 'stuff' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: reason — must not be present when status is done']);
  });
});

describe('validateForgeOutput — extra fields', () => {
  test('rejects unknown field alongside valid status', () => {
    const r = validateForgeOutput({ status: 'done', extra: true });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['forge: extra — unknown field']);
  });
});

describe('validateForgeOutput — reports all errors', () => {
  test('reports invalid status and extra field together', () => {
    const r = validateForgeOutput({ status: 'fixed', extra: true });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 2);
    assert.ok(r.errors.some(e => e.includes('status')));
    assert.ok(r.errors.some(e => e.includes('extra')));
  });
});

// ── Appraise ───────────────────────────────────────────────────────

describe('validateAppraiseOutput — valid objects', () => {
  test('accepts required fields only', () => {
    assert.deepEqual(
      validateAppraiseOutput({ file: 'f', law: 'l', text: 't' }),
      { ok: true },
    );
  });

  test('accepts all optional fields', () => {
    assert.deepEqual(
      validateAppraiseOutput({
        file: 'f', law: 'l', text: 't',
        evidence: 'e', severity: 'high', location: 'line 5',
      }),
      { ok: true },
    );
  });

  test('accepts subset of optional fields', () => {
    assert.deepEqual(
      validateAppraiseOutput({ file: 'f', law: 'l', text: 't', evidence: 'e' }),
      { ok: true },
    );
  });
});

describe('validateAppraiseOutput — non-object inputs', () => {
  test('rejects null', () => {
    const r = validateAppraiseOutput(null);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: data — must be a plain object']);
  });

  test('rejects array', () => {
    const r = validateAppraiseOutput([1, 2]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: data — must be a plain object']);
  });

  test('rejects string', () => {
    const r = validateAppraiseOutput('hello');
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: data — must be a plain object']);
  });

  test('rejects number', () => {
    const r = validateAppraiseOutput(5);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: data — must be a plain object']);
  });
});

describe('validateAppraiseOutput — missing required fields', () => {
  test('rejects missing file', () => {
    const r = validateAppraiseOutput({ law: 'l', text: 't' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: file — must be a non-empty string']);
  });

  test('rejects missing law', () => {
    const r = validateAppraiseOutput({ file: 'f', text: 't' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: law — must be a non-empty string']);
  });

  test('rejects missing text', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: text — must be a non-empty string']);
  });
});

describe('validateAppraiseOutput — empty required strings', () => {
  test('rejects empty file', () => {
    const r = validateAppraiseOutput({ file: '', law: 'l', text: 't' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: file — must be a non-empty string']);
  });

  test('rejects empty law', () => {
    const r = validateAppraiseOutput({ file: 'f', law: '', text: 't' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: law — must be a non-empty string']);
  });

  test('rejects empty text', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: '' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: text — must be a non-empty string']);
  });
});

describe('validateAppraiseOutput — type mismatches on required fields', () => {
  test('rejects non-string file', () => {
    const r = validateAppraiseOutput({ file: 5, law: 'l', text: 't' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: file — must be a non-empty string']);
  });

  test('rejects non-string law', () => {
    const r = validateAppraiseOutput({ file: 'f', law: true, text: 't' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: law — must be a non-empty string']);
  });

  test('rejects non-string text', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: null });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: text — must be a non-empty string']);
  });
});

describe('validateAppraiseOutput — type mismatches on optional fields', () => {
  test('rejects non-string evidence', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', evidence: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: evidence — must be a string']);
  });

  test('rejects non-string severity', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', severity: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: severity — must be a string']);
  });

  test('rejects non-string location', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', location: {} });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: location — must be a string']);
  });
});

describe('validateAppraiseOutput — extra fields', () => {
  test('rejects unknown field', () => {
    const r = validateAppraiseOutput({ file: 'f', law: 'l', text: 't', unknown: true });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['appraise: unknown — unknown field']);
  });
});

describe('validateAppraiseOutput — reports all errors', () => {
  test('reports multiple field errors and extra field together', () => {
    const r = validateAppraiseOutput({ file: '', law: '', text: '', unknown: true });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 4);
    assert.ok(r.errors.every(e => e.startsWith('appraise:')));
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
});

describe('validateHumanAppraiseOutput — non-object inputs', () => {
  test('rejects null', () => {
    const r = validateHumanAppraiseOutput(null);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: data — must be a plain object']);
  });

  test('rejects array', () => {
    const r = validateHumanAppraiseOutput([1, 2]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: data — must be a plain object']);
  });

  test('rejects string', () => {
    const r = validateHumanAppraiseOutput('hello');
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: data — must be a plain object']);
  });

  test('rejects number', () => {
    const r = validateHumanAppraiseOutput(5);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: data — must be a plain object']);
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
    assert.deepEqual(r.errors, ['human-appraise: verdict — must be "approved"']);
  });
});

describe('validateHumanAppraiseOutput — extra fields', () => {
  test('rejects arbitrary extra field', () => {
    const r = validateHumanAppraiseOutput({ verdict: 'approved', extra: 'yes' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: extra — unknown field']);
  });

  test('rejects reason as extra field', () => {
    const r = validateHumanAppraiseOutput({ verdict: 'approved', reason: 'looks good' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ['human-appraise: reason — unknown field']);
  });
});

describe('validateHumanAppraiseOutput — reports all errors', () => {
  test('reports invalid verdict and extra field together', () => {
    const r = validateHumanAppraiseOutput({ verdict: 'rejected', extra: true });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 2);
    assert.ok(r.errors.every(e => e.startsWith('human-appraise:')));
  });
});
