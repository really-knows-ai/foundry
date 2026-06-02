/**
 * Tests for evaluation-unit and dispatch-matrix computation (R7, R8).
 *
 * Pure unit tests with no mocking, no async, no IO. The module under
 * test is deterministic and synchronous.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeUnits,
  computeDispatchMatrix,
  buildDispatch,
} from '../../../src/scripts/lib/evaluation-units.js';

// ── Test data fixtures ──

const bundleConfig = new Map([
  ['default', { mode: 'bundle', passes: 1, appraisers: ['skeptic', 'auditor'] }],
  ['security', { mode: 'bundle', passes: 2, appraisers: ['skeptic', 'auditor', 'generalist'] }],
]);

const lawByLawConfig = new Map([
  ['default', { mode: 'bundle', passes: 1, appraisers: ['skeptic'] }],
  ['security', { mode: 'law-by-law', passes: 3, appraisers: ['skeptic', 'auditor'] }],
]);

const lawsByGroup = new Map([
  ['default', [
    { id: 'no-secrets', text: '...', group: 'default' },
    { id: 'no-logs', text: '...', group: 'default' },
  ]],
  ['security', [
    { id: 'auth-all-endpoints', text: '...', group: 'security' },
    { id: 'sanitise-input', text: '...', group: 'security' },
    { id: 'rate-limit', text: '...', group: 'security' },
  ]],
]);

// ── computeUnits tests ──

test('UC1 - Bundle mode produces one unit per group', () => {
  const result = computeUnits(lawsByGroup, bundleConfig);

  assert.equal(result.size, 2);

  const defaultUnits = result.get('default');
  assert.equal(defaultUnits.length, 1);
  assert.deepEqual(defaultUnits[0], {
    unitId: 'default::bundle::0',
    group: 'default',
    mode: 'bundle',
    lawIds: ['no-secrets', 'no-logs'],
  });

  const securityUnits = result.get('security');
  assert.equal(securityUnits.length, 1);
  assert.deepEqual(securityUnits[0], {
    unitId: 'security::bundle::0',
    group: 'security',
    mode: 'bundle',
    lawIds: ['auth-all-endpoints', 'sanitise-input', 'rate-limit'],
  });
});

test('UC2 - Law-by-law mode produces one unit per law', () => {
  const result = computeUnits(lawsByGroup, lawByLawConfig);

  // Default group is still bundle in this config
  const defaultUnits = result.get('default');
  assert.equal(defaultUnits.length, 1);
  assert.equal(defaultUnits[0].mode, 'bundle');

  const securityUnits = result.get('security');
  assert.equal(securityUnits.length, 3);
  assert.equal(securityUnits[0].mode, 'law-by-law');
  assert.equal(securityUnits[1].mode, 'law-by-law');
  assert.equal(securityUnits[2].mode, 'law-by-law');
});

test('UC3 - Law-by-law unitId increments sequentially per law', () => {
  const result = computeUnits(lawsByGroup, lawByLawConfig);

  const securityUnits = result.get('security');
  assert.equal(securityUnits[0].unitId, 'security::law-by-law::0');
  assert.equal(securityUnits[1].unitId, 'security::law-by-law::1');
  assert.equal(securityUnits[2].unitId, 'security::law-by-law::2');

  assert.deepEqual(securityUnits[0].lawIds, ['auth-all-endpoints']);
  assert.deepEqual(securityUnits[1].lawIds, ['sanitise-input']);
  assert.deepEqual(securityUnits[2].lawIds, ['rate-limit']);
});

test('UC4 - Empty group produces empty unit array', () => {
  const groups = new Map([
    ...lawsByGroup,
    ['empty-group', []],
  ]);
  const result = computeUnits(groups, bundleConfig);

  assert.deepEqual(result.get('empty-group'), []);
});

test('UC5 - Group absent from groupConfigs uses default config (bundle)', () => {
  const groups = new Map([
    ['missing', [{ id: 'some-law', text: '...', group: 'missing' }]],
  ]);
  const configs = new Map(); // does not contain 'missing'
  const result = computeUnits(groups, configs);

  const units = result.get('missing');
  assert.equal(units.length, 1);
  assert.equal(units[0].unitId, 'missing::bundle::0');
  assert.equal(units[0].mode, 'bundle');
  assert.deepEqual(units[0].lawIds, ['some-law']);
});

test('UC6 - LawIds order matches input order', () => {
  const groups = new Map([
    ['test', [
      { id: 'c', group: 'test' },
      { id: 'a', group: 'test' },
      { id: 'b', group: 'test' },
    ]],
  ]);
  const result = computeUnits(groups, bundleConfig);

  const units = result.get('test');
  assert.deepEqual(units[0].lawIds, ['c', 'a', 'b']);
});

// ── computeDispatchMatrix tests ──

test('DC1 - Bundle mode dispatch count = pool size times passes', () => {
  const units = computeUnits(lawsByGroup, bundleConfig);
  const entries = computeDispatchMatrix(units, bundleConfig);

  // default: 2 appraisers x 1 pass = 2
  // security: 3 appraisers x 2 passes = 6
  assert.equal(entries.length, 8);
});

test('DC2 - Law-by-law mode dispatch count = laws times pool times passes', () => {
  const units = computeUnits(lawsByGroup, lawByLawConfig);
  const entries = computeDispatchMatrix(units, lawByLawConfig);

  // default: 1 unit x 1 appraiser x 1 pass = 1
  // security: 3 units x 2 appraisers x 3 passes = 18
  assert.equal(entries.length, 19);
});

test('DC3 - Pass index is 1-based, increments per appraiser', () => {
  const units = computeUnits(lawsByGroup, bundleConfig);
  const entries = computeDispatchMatrix(units, bundleConfig);

  // Collect entries for the 'default' group only
  const defaultEntries = entries.filter(e => e.group === 'default');

  assert.equal(defaultEntries.length, 2);

  assert.equal(defaultEntries[0].appraiser, 'skeptic');
  assert.equal(defaultEntries[0].pass, 1);

  assert.equal(defaultEntries[1].appraiser, 'auditor');
  assert.equal(defaultEntries[1].pass, 1);

  // No pass: 0 appears
  for (const entry of defaultEntries) {
    assert.ok(entry.pass >= 1);
  }
});

test('DC4 - Each appraiser receives all passes before next appraiser starts', () => {
  const units = computeUnits(lawsByGroup, bundleConfig);
  const entries = computeDispatchMatrix(units, bundleConfig);

  // Security group: pool [skeptic, auditor, generalist], passes: 2
  const securityEntries = entries.filter(e => e.group === 'security');

  assert.equal(securityEntries.length, 6);

  const expected = [
    { appraiser: 'skeptic', pass: 1 },
    { appraiser: 'skeptic', pass: 2 },
    { appraiser: 'auditor', pass: 1 },
    { appraiser: 'auditor', pass: 2 },
    { appraiser: 'generalist', pass: 1 },
    { appraiser: 'generalist', pass: 2 },
  ];

  for (let i = 0; i < expected.length; i++) {
    assert.equal(securityEntries[i].appraiser, expected[i].appraiser,
      `Entry ${i}: expected appraiser ${expected[i].appraiser}`);
    assert.equal(securityEntries[i].pass, expected[i].pass,
      `Entry ${i}: expected pass ${expected[i].pass}`);
  }
});

test('DC5 - Empty appraiser pool produces zero entries', () => {
  const groups = new Map([
    ['empty', [
      { id: 'law-a', group: 'empty' },
    ]],
  ]);
  const configs = new Map([
    ['empty', { mode: 'bundle', passes: 1, appraisers: [] }],
  ]);
  const units = computeUnits(groups, configs);
  const entries = computeDispatchMatrix(units, configs);

  assert.equal(entries.length, 0);
});

test('DC6 - Empty units produce zero entries', () => {
  const unitsByGroup = new Map([
    ['empty-group', []],
  ]);
  const entries = computeDispatchMatrix(unitsByGroup, bundleConfig);

  assert.equal(entries.length, 0);
});

test('DC7 - Group absent from groupConfigs yields zero entries (empty pool default)', () => {
  const groups = new Map([
    ['missing', [
      { id: 'law-a', group: 'missing' },
    ]],
  ]);
  const configs = new Map(); // does not contain 'missing'
  const units = computeUnits(groups, configs);
  const entries = computeDispatchMatrix(units, configs);

  // The group has one bundle unit, but default config gives empty appraiser pool
  assert.equal(entries.length, 0);
});

// ── buildDispatch tests ──

test('BD1 - Returns both unitsByGroup and dispatchMatrix', () => {
  const result = buildDispatch(lawsByGroup, bundleConfig);

  assert.ok(result.unitsByGroup instanceof Map);
  assert.ok(Array.isArray(result.dispatchMatrix));

  // Verify consistency with individual calls
  const expectedUnits = computeUnits(lawsByGroup, bundleConfig);
  const expectedMatrix = computeDispatchMatrix(expectedUnits, bundleConfig);

  assert.equal(result.unitsByGroup.size, expectedUnits.size);
  assert.equal(result.dispatchMatrix.length, expectedMatrix.length);
});

test('BD2 - Every dispatch entry references a valid unit in unitsByGroup', () => {
  const result = buildDispatch(lawsByGroup, bundleConfig);

  // Build a set of all valid unitIds
  const allUnitIds = new Set();
  for (const [, units] of result.unitsByGroup) {
    for (const unit of units) {
      allUnitIds.add(unit.unitId);
    }
  }

  for (const entry of result.dispatchMatrix) {
    assert.ok(entry.unit, 'Entry must have a unit object');
    assert.ok(typeof entry.unit.unitId === 'string', 'Unit must have a unitId');
    assert.ok(allUnitIds.has(entry.unit.unitId),
      `Unit ${entry.unit.unitId} from dispatch entry must exist in unitsByGroup`);
  }
});
