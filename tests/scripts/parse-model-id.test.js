// tests/scripts/parse-model-id.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelId } from '../../src/scripts/lib/parse-model-id.js';

test('parseModelId parses standard provider/model string', () => {
  const result = parseModelId('opencode-go/deepseek-v4-flash');
  assert.deepEqual(result, { providerID: 'opencode-go', modelID: 'deepseek-v4-flash' });
});

test('parseModelId returns empty providerID when no slash present', () => {
  const result = parseModelId('deepseek-v4-flash');
  assert.deepEqual(result, { providerID: '', modelID: 'deepseek-v4-flash' });
});

test('parseModelId returns null for empty string input', () => {
  const result = parseModelId('');
  assert.equal(result, null);
});

test('parseModelId returns null for non-string input', () => {
  const result = parseModelId(null);
  assert.equal(result, null);
});

test('parseModelId handles model with provider path containing hyphens', () => {
  const result = parseModelId('azure-eastus/gpt-4');
  assert.deepEqual(result, { providerID: 'azure-eastus', modelID: 'gpt-4' });
});
