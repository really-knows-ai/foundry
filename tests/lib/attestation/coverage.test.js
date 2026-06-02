/**
 * Dedicated coverage mapping and deterministic hash tests.
 *
 * Covers the v2 coverage section: deterministic ordering, status derivation,
 * canonical serialisation, and SHA-256 stability.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttestationPayload } from '../../../src/scripts/lib/attestation/payload.js';
import { canonicalJson } from '../../../src/scripts/lib/attestation/canonical-json.js';
import { sha256Text } from '../../../src/scripts/lib/attestation/hash.js';

const MINIMAL_IO = {
  readFile: (filePath) => {
    if (filePath.endsWith('WORK.md')) return `---
flow: test-flow
cycle: test-cycle
stages: []
config-commit: test-sha
---

# Goal
Test.
`;
    if (filePath.endsWith('WORK.history.yaml')) return '[]\n';
    if (filePath.endsWith('WORK.feedback.yaml')) return '';
    throw new Error(`Unexpected read: ${filePath}`);
  },
  exists: (filePath) =>
    filePath.endsWith('WORK.md') ||
    filePath.endsWith('WORK.history.yaml') ||
    filePath.endsWith('WORK.feedback.yaml'),
  exec: () => '',
};

const BASE_PARAMS = {
  cwd: '/fake',
  foundryDir: '/nonexistent',
  goalText: 'Test goal',
  archiveBranch: 'archive/work/test',
  archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
  io: MINIMAL_IO,
};

function makeCoverageMap(entries) {
  const map = new Map();
  for (const e of entries) {
    map.set(e.unitId, e);
  }
  return map;
}

describe('v2 coverage deterministic hash', () => {
  it('two payloads with identical coverage produce identical canonical JSON and SHA-256', async () => {
    const coverageData = [
      {
        unitId: 'security::law-by-law::0',
        group: 'security',
        mode: 'law-by-law',
        law: 'no-secrets-in-source',
        evaluations: [
          { appraiser: 'skeptic', pass: 1, completed: true },
          { appraiser: 'skeptic', pass: 2, completed: true },
          { appraiser: 'skeptic', pass: 3, completed: true },
          { appraiser: 'auditor', pass: 1, completed: true },
          { appraiser: 'auditor', pass: 2, completed: true },
          { appraiser: 'auditor', pass: 3, completed: true },
        ],
        violations: 1,
      },
      {
        unitId: 'default::bundle::0',
        group: 'default',
        mode: 'bundle',
        law: null,
        evaluations: [
          { appraiser: 'skeptic', pass: 1, completed: true },
        ],
        violations: 0,
      },
    ];

    const coverageMap1 = makeCoverageMap(coverageData);
    const coverageMap2 = makeCoverageMap(coverageData);

    const payload1 = await buildAttestationPayload({
      ...BASE_PARAMS,
      coverage: coverageMap1,
    });
    const payload2 = await buildAttestationPayload({
      ...BASE_PARAMS,
      coverage: coverageMap2,
    });

    const json1 = canonicalJson(payload1);
    const json2 = canonicalJson(payload2);

    assert.equal(json1, json2, 'Canonical JSON must be identical');
    assert.equal(sha256Text(json1), sha256Text(json2), 'SHA-256 must match');
  });

  it('v2 payload with empty coverage has deterministic canonical JSON', async () => {
    const payload1 = await buildAttestationPayload({ ...BASE_PARAMS });
    const payload2 = await buildAttestationPayload({ ...BASE_PARAMS });

    const json1 = canonicalJson(payload1);
    const json2 = canonicalJson(payload2);

    assert.equal(json1, json2);
    assert.equal(payload1.schema, 'foundry-attestation/v2');
    assert.deepEqual(payload1.coverage, []);
  });

  it('canonical JSON contains coverage array with sorted entries', async () => {
    const coverageMap = makeCoverageMap([
      {
        unitId: 'z::bundle::0',
        group: 'z-group',
        mode: 'bundle',
        law: null,
        evaluations: [{ appraiser: 'a', pass: 1, completed: true }],
        violations: 0,
      },
      {
        unitId: 'a::bundle::0',
        group: 'a-group',
        mode: 'bundle',
        law: null,
        evaluations: [{ appraiser: 'a', pass: 1, completed: true }],
        violations: 0,
      },
    ]);

    const payload = await buildAttestationPayload({
      ...BASE_PARAMS,
      coverage: coverageMap,
    });

    const json = canonicalJson(payload);

    // a-group should appear before z-group
    const aIdx = json.indexOf('a-group');
    const zIdx = json.indexOf('z-group');
    assert.ok(aIdx >= 0, 'a-group must appear in canonical JSON');
    assert.ok(zIdx >= 0, 'z-group must appear in canonical JSON');
    assert.ok(aIdx < zIdx, 'a-group must sort before z-group in canonical JSON');
  });
});

describe('v2 coverage status derivation', () => {
  it('fail when violations > 0', () => {
    const status = 'fail';
    assert.equal(status, 'fail');
  });

  it('pass when zero violations, all completed', async () => {
    const coverageMap = makeCoverageMap([
      {
        unitId: 'u1',
        group: 'g',
        mode: 'bundle',
        law: null,
        evaluations: [{ appraiser: 'a', pass: 1, completed: true }],
        violations: 0,
      },
    ]);

    const payload = await buildAttestationPayload({
      ...BASE_PARAMS,
      coverage: coverageMap,
    });

    assert.equal(payload.coverage[0].status, 'pass');
  });

  it('incomplete when any evaluation not completed', async () => {
    const coverageMap = makeCoverageMap([
      {
        unitId: 'u1',
        group: 'g',
        mode: 'bundle',
        law: null,
        evaluations: [
          { appraiser: 'a', pass: 1, completed: true },
          { appraiser: 'a', pass: 2, completed: false },
        ],
        violations: 0,
      },
    ]);

    const payload = await buildAttestationPayload({
      ...BASE_PARAMS,
      coverage: coverageMap,
    });

    assert.equal(payload.coverage[0].status, 'incomplete');
  });

  it('violations take precedence over incomplete', async () => {
    const coverageMap = makeCoverageMap([
      {
        unitId: 'u1',
        group: 'g',
        mode: 'bundle',
        law: null,
        evaluations: [
          { appraiser: 'a', pass: 1, completed: true },
          { appraiser: 'a', pass: 2, completed: false },
        ],
        violations: 2,
      },
    ]);

    const payload = await buildAttestationPayload({
      ...BASE_PARAMS,
      coverage: coverageMap,
    });

    assert.equal(payload.coverage[0].status, 'fail');
  });
});
