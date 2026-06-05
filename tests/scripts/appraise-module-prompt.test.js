// tests/scripts/appraise-module-prompt.test.js
// Unit tests for buildAppraiserPrompt — scoped prompt with violations-only protocol

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAppraiserPrompt } from '../../src/scripts/appraise-module.js';

const baseAppraiser = { id: 'skeptic', personality: 'You are strict but fair.' };
const baseIdentity = { group: 'security', appraiser: 'skeptic', pass: 1 };

const bundleUnit = {
  mode: 'bundle',
  group: 'security',
  laws: [
    { id: 'L001', text: 'No secrets in source code.' },
    { id: 'L002', text: 'Logs must not contain PII.' },
  ],
};

const lawByLawUnit = {
  mode: 'law-by-law',
  group: 'security',
  law: { id: 'L001', text: 'No secrets in source code.' },
};

const bundlePrompt = buildAppraiserPrompt({ appraiser: baseAppraiser, typeId: 'custom-code', unit: bundleUnit, identity: baseIdentity });
const lawPrompt = buildAppraiserPrompt({ appraiser: baseAppraiser, typeId: 'custom-code', unit: lawByLawUnit, identity: baseIdentity });

test('bundle-mode prompt lists every law in the group', () => {
  assert.ok(bundlePrompt.includes('L001'), 'should contain L001 law ID');
  assert.ok(bundlePrompt.includes('L002'), 'should contain L002 law ID');
  assert.ok(bundlePrompt.includes('No secrets in source code.'), 'should contain L001 text');
  assert.ok(bundlePrompt.includes('Logs must not contain PII.'), 'should contain L002 text');
});

test('law-by-law prompt contains exactly one law', () => {
  assert.ok(lawPrompt.includes('L001'), 'should contain L001 law ID');
  assert.ok(lawPrompt.includes('No secrets in source code.'), 'should contain L001 text');
  assert.ok(!lawPrompt.includes('L002'), 'should NOT contain L002 law ID');
  assert.ok(!lawPrompt.includes('Logs must not contain PII.'), 'should NOT contain L002 text');
});

test('does not mention foundry_config_laws', () => {
  assert.ok(!bundlePrompt.includes('foundry_config_laws'));
  assert.ok(!lawPrompt.includes('foundry_config_laws'));
});

test('does not ask for a verdict', () => {
  assert.ok(!bundlePrompt.includes('verdict'));
  assert.ok(!lawPrompt.includes('verdict'));
});

test('instructs reporting violations via foundry_stage_output', () => {
  assert.ok(bundlePrompt.includes('foundry_stage_output'));
  assert.ok(lawPrompt.includes('foundry_stage_output'));
});

test('instructs NO output when artefact complies', () => {
  assert.ok(bundlePrompt.includes('call NO tool') || bundlePrompt.includes('produce no output'));
  assert.ok(lawPrompt.includes('call NO tool') || lawPrompt.includes('produce no output'));
});

test('carries identity fields in violation instruction', () => {
  assert.ok(bundlePrompt.includes('group: "security"'), 'should contain group: "security"');
  assert.ok(bundlePrompt.includes('appraiser: "skeptic"'), 'should contain appraiser: "skeptic"');
  assert.ok(bundlePrompt.includes('pass: 1'), 'should contain pass: 1');
});

test('bundle-mode uses group-level language', () => {
  assert.ok(bundlePrompt.includes('every law in the group'));
});

test('law-by-law uses law-specific language', () => {
  assert.ok(lawPrompt.includes('this specific law'));
});

test('existing personality is preserved', () => {
  assert.ok(bundlePrompt.includes('You are strict but fair.'));
  assert.ok(lawPrompt.includes('You are strict but fair.'));
});

test('artefact-discovery tools are still listed', () => {
  assert.ok(bundlePrompt.includes('foundry_config_artefact_type'), 'should keep foundry_config_artefact_type');
  assert.ok(bundlePrompt.includes('foundry_artefacts_list'), 'should keep foundry_artefacts_list');
  assert.ok(lawPrompt.includes('foundry_config_artefact_type'), 'should keep foundry_config_artefact_type');
  assert.ok(lawPrompt.includes('foundry_artefacts_list'), 'should keep foundry_artefacts_list');
});

test('stage lifecycle constraints are preserved', () => {
  assert.ok(bundlePrompt.includes('foundry_stage_end'), 'should mention to call foundry_stage_end');
  assert.ok(lawPrompt.includes('foundry_stage_end'), 'should mention to call foundry_stage_end');
});

test('appraiser.id appears in the identity', () => {
  assert.ok(bundlePrompt.includes('appraiser: "skeptic"'));
  assert.ok(lawPrompt.includes('appraiser: "skeptic"'));
});

test('is exported from appraise-module', async () => {
  const mod = await import('../../src/scripts/appraise-module.js');
  assert.equal(typeof mod.buildAppraiserPrompt, 'function');
});
