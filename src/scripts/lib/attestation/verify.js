import { execFileSync } from 'node:child_process';
import { extractAttestationBlock } from './parse.js';

export function verifyAttestationRef({ cwd, ref = 'HEAD' }) {
  execFileSync('git', ['verify-commit', ref], { cwd, encoding: 'utf8', stdio: 'pipe' });
  const message = execFileSync('git', ['log', '-1', '--pretty=%B', ref], { cwd, encoding: 'utf8', stdio: 'pipe' });
  const json = extractAttestationBlock(message);
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error(`malformed attestation JSON: ${json}`);
  }
  return { status: 'verified', schema: payload.schema, payload };
}
