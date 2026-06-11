import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { ulid } from '../ulid.js';
import { buildStageAttestation } from './stage-payload.js';

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sortPaths(paths) {
  return [...paths].sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}

export function hashAttestation(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new TypeError('hashAttestation expects a plain object');
  }
  const copy = { ...obj };
  delete copy._hash;
  return sha256Text(canonicalJson(copy));
}

export function generateRunId() {
  return ulid();
}

/**
 * Append a stage attestation line to the run-scoped JSONL file.
 *
 * Creates the attestations directory if needed, builds the attestation
 * payload, computes the content hash, and appends a self-verifying JSON
 * line to `.foundry/attestations/<runId>.jsonl`.
 *
 * @param {object} io - IO interface with mkdir(dir, opts) and appendFile(path, data)
 * @param {string} runId - ULID run identifier
 * @param {object} params - Parameters forwarded to buildStageAttestation
 * @returns {Promise<{ok: boolean, filePath?: string, hash?: string, error?: *}>}
 */
export async function appendStageAttestation(io, runId, params) {
  try {
    await io.mkdir('.foundry/attestations', { recursive: true });
  } catch (error) {
    return { ok: false, error };
  }

  const payload = buildStageAttestation(params);
  const hash = hashAttestation(payload);
  const line = { ...payload, _hash: hash };
  const jsonLine = JSON.stringify(line);
  const filePath = `.foundry/attestations/${runId}.jsonl`;

  try {
    await io.appendFile(filePath, jsonLine + '\n');
  } catch (error) {
    return { ok: false, error };
  }

  return { ok: true, filePath, hash };
}
