const BEGIN = '-----BEGIN FOUNDRY ATTESTATION-----';
const END = '-----END FOUNDRY ATTESTATION-----';

export function extractAttestationBlock(message) {
  const start = message.indexOf(BEGIN);
  if (start === -1) {
    throw new Error('attestation block not found');
  }
  const end = message.indexOf(END, start + BEGIN.length);
  if (end === -1 || end <= start) {
    throw new Error('attestation block not found');
  }
  return message.slice(start + BEGIN.length, end).trim();
}
