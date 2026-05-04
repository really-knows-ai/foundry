/**
 * Attestation commit message renderer.
 *
 * Formats commit messages with human-readable summaries and canonical attestation blocks.
 */

export function renderAttestedCommitMessage({ humanSummary, payloadJson }) {
  return [
    humanSummary,
    '',
    '-----BEGIN FOUNDRY ATTESTATION-----',
    payloadJson,
    '-----END FOUNDRY ATTESTATION-----',
    '',
  ].join('\n');
}
