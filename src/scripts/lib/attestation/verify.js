import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractAttestationBlock } from './parse.js';
import { verifyStageLine } from './hash.js';

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

/**
 * Re-verify every line in the JSONL attestation file for a given run ID
 * and report all mismatches. Continues past parse errors and hash mismatches
 * to collect every issue.
 *
 * @param {object} opts
 * @param {string} opts.cwd - Working directory containing .foundry/
 * @param {string} opts.runId - Run ID (ULID) used as the attestation filename
 * @returns {{ ok: boolean, runId: string, total_lines: number,
 *   verified_count: number, mismatch_count: number,
 *   mismatches: Array<{type: string, detail: string, line?: number}>,
 *   payloads: Array<object> }}
 */
export function verifyAttestationRun({ cwd, runId }) {
  const filePath = join(cwd, '.foundry', 'attestations', `${runId}.jsonl`);

  if (!existsSync(filePath)) {
    return {
      ok: false,
      runId,
      total_lines: 0,
      verified_count: 0,
      mismatch_count: 0,
      mismatches: [{ type: 'file_not_found', detail: `Attestation file not found: ${filePath}` }],
      payloads: [],
    };
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim() !== '');
  const mismatches = [];
  const payloads = [];

  for (let i = 0; i < lines.length; i++) {
    const result = verifyStageLine(lines[i]);

    if (result.error) {
      mismatches.push({
        type: 'parse_error',
        detail: result.error,
        line: i + 1,
      });
      continue;
    }

    if (result.mismatch) {
      mismatches.push({
        type: 'hash_mismatch',
        detail: `hash mismatch at line ${i + 1}`,
        line: i + 1,
      });
      continue;
    }

    payloads.push(result.attestation);
  }

  return {
    ok: mismatches.length === 0,
    runId,
    total_lines: lines.length,
    verified_count: payloads.length,
    mismatch_count: mismatches.length,
    mismatches,
    payloads,
  };
}
