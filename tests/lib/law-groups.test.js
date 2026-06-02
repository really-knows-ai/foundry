import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getFlowLawGroups } from '../../src/scripts/lib/config.js';
import { parseFrontmatter } from '../../src/scripts/lib/workfile.js';

describe('getFlowLawGroups', () => {
  it('parses a law-groups block with default and a custom group', () => {
    const frontmatter = {
      'law-groups': {
        default: { mode: 'bundle', passes: 1 },
        security: {
          mode: 'law-by-law',
          passes: 3,
          appraisers: ['skeptic', 'auditor'],
        },
      },
    };
    const result = getFlowLawGroups(frontmatter);
    assert.equal(typeof result, 'object');
    assert.ok(result.default);
    assert.ok(result.security);
    assert.equal(result.default.mode, 'bundle');
    assert.equal(result.default.passes, 1);
    assert.equal(result.security.mode, 'law-by-law');
    assert.equal(result.security.passes, 3);
    assert.deepEqual(result.security.appraisers, ['skeptic', 'auditor']);
  });

  it('returns an empty object when law-groups is absent', () => {
    const frontmatter = { cycles: ['build'] };
    const result = getFlowLawGroups(frontmatter);
    assert.deepEqual(result, {});
  });

  it('returns an empty object when frontmatter is empty', () => {
    const result = getFlowLawGroups({});
    assert.deepEqual(result, {});
  });

  it('parses a single-entry law-groups block with only the default group', () => {
    const frontmatter = {
      'law-groups': {
        default: { mode: 'bundle' },
      },
    };
    const result = getFlowLawGroups(frontmatter);
    assert.equal(typeof result, 'object');
    assert.equal(Object.keys(result).length, 1);
    assert.ok(result.default);
    assert.equal(result.default.mode, 'bundle');
  });

  it('preserves array-valued appraisers field', () => {
    const frontmatter = {
      'law-groups': {
        compliance: {
          appraisers: ['auditor', 'compliance-bot', 'reviewer'],
        },
      },
    };
    const result = getFlowLawGroups(frontmatter);
    assert.ok(Array.isArray(result.compliance.appraisers));
    assert.equal(result.compliance.appraisers.length, 3);
    assert.deepEqual(result.compliance.appraisers, [
      'auditor',
      'compliance-bot',
      'reviewer',
    ]);
  });

  it('treats the default key as a plain group name, not special-cased', () => {
    const frontmatter = {
      'law-groups': {
        default: { mode: 'law-by-law', passes: 2 },
      },
    };
    const result = getFlowLawGroups(frontmatter);
    // The default key is a plain group name like any other
    assert.equal(result.default.mode, 'law-by-law');
    assert.equal(result.default.passes, 2);
    // Verify it behaves identically to a custom group by comparing shape
    assert.deepEqual(Object.keys(result.default), ['mode', 'passes']);
  });

  it('parses a law-groups block from real YAML frontmatter via parseFrontmatter', () => {
    const doc = [
      '---',
      'cycles:',
      '  - build',
      'law-groups:',
      '  default:',
      '    mode: bundle',
      '    passes: 1',
      '  security:',
      '    mode: law-by-law',
      '    passes: 3',
      '    appraisers:',
      '      - skeptic',
      '      - auditor',
      '---',
      'Flow body.',
    ].join('\n');
    const fm = parseFrontmatter(doc);
    const result = getFlowLawGroups(fm);
    assert.equal(typeof result, 'object');
    assert.ok(result.default);
    assert.ok(result.security);
    assert.equal(result.default.mode, 'bundle');
    assert.equal(result.default.passes, 1);
    assert.equal(result.security.mode, 'law-by-law');
    assert.equal(result.security.passes, 3);
    assert.deepEqual(result.security.appraisers, ['skeptic', 'auditor']);
  });

  it('returns empty object when law-groups absent from real YAML frontmatter', () => {
    const doc = [
      '---',
      'cycles:',
      '  - build',
      '---',
      'Flow body.',
    ].join('\n');
    const fm = parseFrontmatter(doc);
    const result = getFlowLawGroups(fm);
    assert.deepEqual(result, {});
  });

  it('passes raw values through without validation', () => {
    const frontmatter = {
      'law-groups': {
        risky: { passes: 0, mode: 'unknown-mode' },
      },
    };
    const result = getFlowLawGroups(frontmatter);
    // Phase 02 does no validation — raw values pass through as-is
    assert.equal(result.risky.passes, 0);
    assert.equal(result.risky.mode, 'unknown-mode');
  });
});
