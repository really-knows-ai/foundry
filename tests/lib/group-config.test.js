import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGroupConfig } from '../../src/scripts/lib/group-config.js';

const FULL_POOL = [
  { id: 'generalist' },
  { id: 'skeptic' },
  { id: 'auditor' },
  { id: 'mentor' },
];

const POOL_AB = [
  { id: 'a' },
  { id: 'b' },
];

// ---------------------------------------------------------------------------
// Cascade tests
// ---------------------------------------------------------------------------

describe('cascade — no flow groups, no type override', () => {
  it('resolves to built-in defaults', () => {
    const result = resolveGroupConfig('default', {}, null, FULL_POOL);
    assert.deepEqual(result, {
      mode: 'bundle',
      passes: 1,
      appraisers: FULL_POOL,
      warnings: [],
    });
  });

  it('unknown group name resolves from defaults', () => {
    const result = resolveGroupConfig('nonexistent', {}, null, FULL_POOL);
    assert.equal(result.mode, 'bundle');
    assert.equal(result.passes, 1);
    assert.deepEqual(result.appraisers, FULL_POOL);
    assert.deepEqual(result.warnings, []);
  });
});

describe('cascade — flow overrides', () => {
  it('flow group overrides mode only', () => {
    const result = resolveGroupConfig('security', {
      security: { mode: 'law-by-law' },
    }, null, FULL_POOL);

    assert.equal(result.mode, 'law-by-law');
    assert.equal(result.passes, 1);
    assert.deepEqual(result.appraisers, FULL_POOL);
    assert.deepEqual(result.warnings, []);
  });

  it('flow group overrides passes only', () => {
    const result = resolveGroupConfig('security', {
      security: { passes: 3 },
    }, null, FULL_POOL);

    assert.equal(result.mode, 'bundle');
    assert.equal(result.passes, 3);
    assert.deepEqual(result.appraisers, FULL_POOL);
    assert.deepEqual(result.warnings, []);
  });

  it('flow group overrides appraisers pool', () => {
    const result = resolveGroupConfig('security', {
      security: { appraisers: ['skeptic'] },
    }, null, FULL_POOL);

    assert.equal(result.mode, 'bundle');
    assert.equal(result.passes, 1);
    assert.deepEqual(result.appraisers, [{ id: 'skeptic' }]);
    assert.deepEqual(result.warnings, []);
  });
});

describe('cascade — type override', () => {
  it('type override replaces appraiser pool for group', () => {
    const result = resolveGroupConfig('security', {}, {
      security: ['auditor'],
    }, FULL_POOL);

    assert.equal(result.mode, 'bundle');
    assert.equal(result.passes, 1);
    assert.deepEqual(result.appraisers, [{ id: 'auditor' }]);
    assert.deepEqual(result.warnings, []);
  });

  it('type override references a group absent from flowGroups', () => {
    const result = resolveGroupConfig('security', {}, {
      security: ['auditor'],
    }, FULL_POOL);

    assert.equal(result.mode, 'bundle');
    assert.deepEqual(result.appraisers, [{ id: 'auditor' }]);
  });

  it('full cascade: defaults → flow → type', () => {
    const result = resolveGroupConfig('security', {
      security: { mode: 'law-by-law', passes: 2 },
    }, {
      security: ['auditor'],
    }, FULL_POOL);

    assert.equal(result.mode, 'law-by-law');
    assert.equal(result.passes, 2);
    assert.deepEqual(result.appraisers, [{ id: 'auditor' }]);
    assert.deepEqual(result.warnings, []);
  });
});

describe('cascade — unknown appraiser in flow', () => {
  it('flow group references unknown appraiser ID', () => {
    const result = resolveGroupConfig('security', {
      security: { appraisers: ['unknown_id'] },
    }, null, FULL_POOL);

    assert.deepEqual(result.appraisers, []);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('unknown_id'));
    assert.ok(result.warnings[0].includes('in flow definition'));
  });
});

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe('validation — passes', () => {
  it('passes is string (non-integer) throws with group name', () => {
    assert.throws(
      () => resolveGroupConfig('g', { g: { passes: '2' } }, null, FULL_POOL),
      /Group "g".*passes/
    );
  });

  it('passes is float throws with group name', () => {
    assert.throws(
      () => resolveGroupConfig('g', { g: { passes: 2.5 } }, null, FULL_POOL),
      /Group "g".*passes/
    );
  });

  it('passes is 0 throws with group name', () => {
    assert.throws(
      () => resolveGroupConfig('g', { g: { passes: 0 } }, null, FULL_POOL),
      /Group "g".*passes/
    );
  });

  it('passes is negative throws with group name', () => {
    assert.throws(
      () => resolveGroupConfig('g', { g: { passes: -1 } }, null, FULL_POOL),
      /Group "g".*passes/
    );
  });

  it('passes is null throws with group name', () => {
    assert.throws(
      () => resolveGroupConfig('g', { g: { passes: null } }, null, FULL_POOL),
      /Group "g".*passes/
    );
  });
});

describe('validation — legacy keys', () => {
  it('legacy key count in typeAppraisers throws with artefact type', () => {
    assert.throws(
      () => resolveGroupConfig('security', {}, { count: ['a'] }, FULL_POOL, 'code'),
      /"code".*"count"/
    );
  });

  it('legacy key allowed in typeAppraisers throws with artefact type', () => {
    assert.throws(
      () => resolveGroupConfig('security', {}, { allowed: ['a'] }, FULL_POOL, 'code'),
      /"code".*"allowed"/
    );
  });

  it('both count and allowed present throws', () => {
    assert.throws(
      () => resolveGroupConfig('security', {}, { count: ['a'], allowed: ['b'] }, FULL_POOL, 'code'),
      /"code"/
    );
  });

  it('legacy key count with no artefactTypeId omits type name', () => {
    assert.throws(
      () => resolveGroupConfig('security', {}, { count: ['a'] }, FULL_POOL),
      /legacy key "count"/
    );
    assert.throws(
      () => resolveGroupConfig('security', {}, { count: ['a'] }, FULL_POOL),
      /upgrade-foundry/
    );
  });

  it('legacy key allowed with no artefactTypeId omits type name', () => {
    assert.throws(
      () => resolveGroupConfig('security', {}, { allowed: ['a'] }, FULL_POOL),
      /legacy key "allowed"/
    );
  });
});

describe('validation — invalid typeAppraisers group value type', () => {
  it('bare string value throws with artefact type and group name', () => {
    assert.throws(
      () => resolveGroupConfig('g', {}, { g: 'rogue' }, FULL_POOL, 'code'),
      /Group "g".*"code".*string/
    );
  });

  it('number value throws with artefact type', () => {
    assert.throws(
      () => resolveGroupConfig('g', {}, { g: 3 }, FULL_POOL, 'code'),
      /Group "g".*"code".*number/
    );
  });

  it('boolean value throws with artefact type', () => {
    assert.throws(
      () => resolveGroupConfig('g', {}, { g: true }, FULL_POOL, 'code'),
      /Group "g".*"code".*boolean/
    );
  });

  it('invalid value type without artefactTypeId omits type name', () => {
    assert.throws(
      () => resolveGroupConfig('g', {}, { g: 'rogue' }, FULL_POOL),
      /Group "g"/
    );
    assert.throws(
      () => resolveGroupConfig('g', {}, { g: 'rogue' }, FULL_POOL),
      /string/
    );
  });
});

// ---------------------------------------------------------------------------
// Warning tests
// ---------------------------------------------------------------------------

describe('warnings — type override mode/passes', () => {
  it('type override has mode key with appraisers', () => {
    const result = resolveGroupConfig('g', {
      g: { passes: 3 },
    }, {
      g: { mode: 'law-by-law', appraisers: ['a'] },
    }, POOL_AB);

    assert.equal(result.mode, 'bundle', 'mode override from type is ignored');
    assert.equal(result.passes, 3, 'flow-level passes preserved');
    assert.deepEqual(result.appraisers, [{ id: 'a' }]);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('mode'));
  });

  it('type override has passes key with appraisers', () => {
    const result = resolveGroupConfig('g', {
      g: { mode: 'law-by-law' },
    }, {
      g: { passes: 5, appraisers: ['a'] },
    }, POOL_AB);

    assert.equal(result.mode, 'law-by-law', 'flow-level mode preserved');
    assert.equal(result.passes, 1, 'passes override from type is ignored');
    assert.deepEqual(result.appraisers, [{ id: 'a' }]);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('passes'));
  });

  it('type override has both mode and passes with appraisers', () => {
    const result = resolveGroupConfig('g', {}, {
      g: { mode: 'law-by-law', passes: 5, appraisers: ['a'] },
    }, POOL_AB);

    assert.equal(result.mode, 'bundle');
    assert.equal(result.passes, 1);
    assert.deepEqual(result.appraisers, [{ id: 'a' }]);
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.some(w => w.includes('mode')));
    assert.ok(result.warnings.some(w => w.includes('passes')));
  });

  it('type override has mode key, no appraisers key', () => {
    const result = resolveGroupConfig('g', {
      g: { passes: 3 },
    }, {
      g: { mode: 'law-by-law' },
    }, POOL_AB);

    assert.equal(result.mode, 'bundle', 'mode override ignored');
    assert.equal(result.passes, 3, 'flow-level passes preserved');
    assert.deepEqual(result.appraisers, POOL_AB, 'pool unchanged');
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('mode'));
  });
});

describe('warnings — unknown appraiser IDs', () => {
  it('unknown appraiser ID in type override', () => {
    const result = resolveGroupConfig('g', {}, {
      g: ['unknown_id'],
    }, FULL_POOL);

    assert.deepEqual(result.appraisers, []);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('unknown_id'));
    assert.ok(result.warnings[0].includes('in type override'));
  });

  it('mixed known and unknown appraiser IDs in type override', () => {
    const result = resolveGroupConfig('g', {}, {
      g: ['generalist', 'unknown_id'],
    }, FULL_POOL);

    assert.deepEqual(result.appraisers, [{ id: 'generalist' }]);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('unknown_id'));
  });
});

// ---------------------------------------------------------------------------
// Edge-case tests
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('empty fullAppraiserPool, no override — appraisers resolves to []', () => {
    const result = resolveGroupConfig('default', {}, null, []);
    assert.deepEqual(result.appraisers, []);
    assert.deepEqual(result.warnings, []);
  });

  it('single-element appraisers list resolves correctly', () => {
    const pool = [{ id: 'only' }];
    const result = resolveGroupConfig('g', {
      g: { appraisers: ['only'] },
    }, null, pool);

    assert.deepEqual(result.appraisers, [{ id: 'only' }]);
  });

  it('typeAppraisers is undefined treated same as null', () => {
    const result = resolveGroupConfig('default', {}, undefined, FULL_POOL);
    assert.deepEqual(result, {
      mode: 'bundle',
      passes: 1,
      appraisers: FULL_POOL,
      warnings: [],
    });
  });

  it('typeAppraisers is {} — no-op for any groupName', () => {
    const result = resolveGroupConfig('default', {}, {}, FULL_POOL);
    assert.deepEqual(result.appraisers, FULL_POOL);
    assert.deepEqual(result.warnings, []);
  });

  it('flow group sets appraisers to empty array — appraisers is []', () => {
    const result = resolveGroupConfig('g', {
      g: { appraisers: [] },
    }, null, FULL_POOL);

    assert.deepEqual(result.appraisers, []);
    assert.deepEqual(result.warnings, []);
  });

  it('typeAppraisers key with null value is no-op', () => {
    const result = resolveGroupConfig('g', {}, {
      g: null,
    }, FULL_POOL);

    assert.deepEqual(result.appraisers, FULL_POOL);
    assert.deepEqual(result.warnings, []);
  });

  it('typeAppraisers key with undefined value throws (invalid value type)', () => {
    assert.throws(
      () => resolveGroupConfig('g', {}, { g: undefined }, FULL_POOL),
      /expected an array or object/
    );
  });
});
