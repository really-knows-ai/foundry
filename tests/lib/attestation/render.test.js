import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAttestedCommitMessage } from '../../../src/scripts/lib/attestation/render.js';

test('renderAttestedCommitMessage keeps human summary outside the canonical block', () => {
  const humanSummary = 'feat: add haiku flow';
  const payloadJson = '{"schema":"foundry-attestation/v1"}';
  
  const message = renderAttestedCommitMessage({ humanSummary, payloadJson });

  const expected = [
    'feat: add haiku flow',
    '',
    '-----BEGIN FOUNDRY ATTESTATION-----',
    '{"schema":"foundry-attestation/v1"}',
    '-----END FOUNDRY ATTESTATION-----',
    '',
  ].join('\n');

  assert.strictEqual(message, expected);
});
