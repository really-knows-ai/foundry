// tests/lib/constants-export.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Q1: Import TOOL_MANAGED and isToolManaged from both sources
import {
  TOOL_MANAGED as TOOL_MANAGED_POLICY,
  isToolManaged as isToolManaged_POLICY,
} from '../../src/scripts/lib/git-policy.js';

// Q2: Import DRY_RUN_RE from branch-guard (canonical source)
import { DRY_RUN_RE } from '../../src/scripts/lib/branch-guard.js';

// Q3: Import CONFIG_RE from branch-guard (canonical source)
import { CONFIG_RE } from '../../src/scripts/lib/branch-guard.js';

describe('Q1: TOOL_MANAGED exports from git-policy', () => {
  it('exports TOOL_MANAGED array', () => {
    assert.ok(Array.isArray(TOOL_MANAGED_POLICY));
    assert.ok(TOOL_MANAGED_POLICY.includes('WORK.md'));
    assert.ok(TOOL_MANAGED_POLICY.includes('WORK.history.yaml'));
    assert.ok(TOOL_MANAGED_POLICY.includes('WORK.feedback.yaml'));
    assert.ok(TOOL_MANAGED_POLICY.includes('.gitignore'));
  });

  it('exports isToolManaged function', () => {
    assert.equal(typeof isToolManaged_POLICY, 'function');
    assert.equal(isToolManaged_POLICY('WORK.md'), true);
    assert.equal(isToolManaged_POLICY('.foundry/active-stage.json'), true);
    assert.equal(isToolManaged_POLICY('README.md'), false);
  });
});

describe('Q2: DRY_RUN_RE export from branch-guard', () => {
  it('exports DRY_RUN_RE regex', () => {
    assert.ok(DRY_RUN_RE instanceof RegExp);
    assert.equal(DRY_RUN_RE.test('dry-run/foo/bar'), true);
    assert.equal(DRY_RUN_RE.test('dry-run/a/b'), true);
    assert.equal(DRY_RUN_RE.test('dry-run/foo/bar/baz'), false);
    assert.equal(DRY_RUN_RE.test('work/foo-bar'), false);
  });
});

describe('Q3: CONFIG_RE export from branch-guard', () => {
  it('exports CONFIG_RE regex', () => {
    assert.ok(CONFIG_RE instanceof RegExp);
    assert.equal(CONFIG_RE.test('config/foo'), true);
    assert.equal(CONFIG_RE.test('config/bar-baz'), true);
    assert.equal(CONFIG_RE.test('config/foo/bar'), false);
    assert.equal(CONFIG_RE.test('work/foo'), false);
  });
});
