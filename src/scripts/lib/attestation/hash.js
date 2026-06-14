import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { ulid } from '../ulid.js';
import { buildStageAttestation } from './stage-payload.js';
import { buildCycleAttestation } from './cycle-payload.js';
import { readRunId } from '../workfile.js';

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
 * Builds the attestation payload, computes the content hash, and appends
 * a self-verifying JSON line to `.foundry/attestations/<runId>.jsonl`.
 * The `.foundry/attestations/` directory is created at foundry init by
 * `bootstrapDotFoundryDirs` and is guaranteed to exist.
 *
 * @param {object} io - IO interface with appendFile(path, data)
 * @param {string} runId - ULID run identifier
 * @param {object} params - Parameters forwarded to buildStageAttestation
 * @returns {Promise<{ok: boolean, filePath?: string, hash?: string, error?: *}>}
 */
export async function appendStageAttestation(io, runId, params) {

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

// ---------------------------------------------------------------------------
// Private helpers for sealCycleAttestation
// ---------------------------------------------------------------------------

/**
 * Compute governance data from the repository.
 *
 * Reads law files from .foundry/laws/ and computes their SHA-256 hashes.
 * When a cycle ID is provided, hashes the cycle configuration file at
 * .foundry/cycles/<cycleId>.yaml. All errors produce a fallback rather
 * than throwing.
 *
 * @param {object} io - IO interface with readDir, readFile
 * @param {string} [cycleId] - Cycle identifier for config file hashing
 * @returns {{law_hashes: Record<string, string>, config_commit: string}}
 */
export function computeGovernance(io, cycleId) {
  let lawHashes;
  try {
    const lawFiles = io.readDir('.foundry/laws/');
    lawHashes = {};
    for (const name of lawFiles) {
      const content = io.readFile('.foundry/laws/' + name);
      lawHashes[name] = sha256Text(content);
    }
  } catch {
    lawHashes = {};
  }

  let configCommit;
  if (cycleId) {
    try {
      const content = io.readFile(`.foundry/cycles/${cycleId}.yaml`);
      configCommit = sha256Text(content);
    } catch {
      configCommit = 'none';
    }
  } else {
    configCommit = 'none';
  }

  return { law_hashes: lawHashes, config_commit: configCommit };
}

/**
 * Parse a single JSONL line and verify its hash.
 *
 * Returns an object with either an `attestation` (verified parsed object),
 * an `error` string describing why the line was skipped, or a `mismatch`
 * flag when the line has a valid structure but a tampered hash.
 *
 * @param {string} line - A single line from the JSONL file
 * @returns {{attestation?: object, error?: string, mismatch?: boolean}}
 */
function verifyStageLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    const snippet = line.length > 60 ? line.slice(0, 60) + '...' : line;
    return { error: `skipping unparseable line: ${snippet}` };
  }

  if (parsed._hash === undefined) {
    return { error: 'skipping line without hash' };
  }

  const savedHash = parsed._hash;
  const computedHash = hashAttestation(parsed);
  if (savedHash !== computedHash) {
    return { attestation: { ...parsed, _hash_mismatch: true }, mismatch: true, savedHash, computedHash };
  }

  return { attestation: parsed };
}

/**
 * Build the identifying parts for a hash-mismatch log message.
 *
 * @param {{lineNumber?: number, savedHash?: string, computedHash?: string}} details
 * @returns {string[]}
 */
function buildMismatchParts(details) {
  const parts = [];
  if (details.lineNumber !== undefined) parts.push(`line ${details.lineNumber}`);
  if (details.savedHash !== undefined && details.computedHash !== undefined) {
    parts.push(`stored ${details.savedHash}, computed ${details.computedHash}`);
  }
  return parts;
}

/**
 * Log a warning for a line with a hash mismatch.
 *
 * @param {{lineNumber?: number, savedHash?: string, computedHash?: string}} details
 */
function handleMismatchLine(details) {
  const parts = buildMismatchParts(details);
  if (parts.length > 0) {
    console.warn(`skipping line with hash mismatch (${parts.join(', ')})`);
  } else {
    console.warn('skipping line with hash mismatch');
  }
}

/**
 * Classify a verification result into an action for the line parser.
 *
 * Returns an action object that tells the caller what to do:
 * - `{ type: 'skip' }` — log and move to the next line
 * - `{ type: 'cycle', attestation }` — record the pre-existing cycle line
 * - `{ type: 'stage', attestation }` — collect this stage attestation
 */
function classifyMismatchLine(result, lineNumber) {
  if (result.attestation && result.attestation.schema === 'foundry-cycle-attestation/v1') {
    return { type: 'error', message: `cycle line hash mismatch at line ${lineNumber}: stored ${result.savedHash}, computed ${result.computedHash} — the composite cannot be trusted` };
  }
  handleMismatchLine({ lineNumber, savedHash: result.savedHash, computedHash: result.computedHash });
  return { type: 'mismatch_stage' };
}

function classifyLineResult(result, lineNumber) {
  if (result.error) {
    console.error(result.error);
    return { type: 'skip' };
  }
  if (result.mismatch) {
    return classifyMismatchLine(result, lineNumber);
  }
  if (result.attestation.schema === 'foundry-cycle-attestation/v1') {
    return { type: 'cycle', attestation: result.attestation };
  }
  return { type: 'stage', attestation: result.attestation };
}

/**
 * Parse all non-empty lines from a JSONL file, verifying hashes and
 * collecting stage attestations. Lines whose `_hash` does not verify
 * are skipped regardless of schema. Pre-existing cycle lines (with
 * schema foundry-cycle-attestation/v1) that pass hash verification are
 * returned via the `cycleAttestation` field; their presence is also
 * reported via the `hasCycleLine` flag.
 *
 * @param {string[]} lines - Non-empty lines from the JSONL file
 * @returns {{ stageAttestations: object[], hasCycleLine: boolean, cycleAttestation: object|null }}
 */
function parseAttestationLines(lines) {
  const stageAttestations = [];
  let cycleAttestation = null;
  let mismatchedCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const result = verifyStageLine(lines[i]);
    const action = classifyLineResult(result, i + 1);

    if (action.type === 'error') {
      return { error: action.message };
    }
    if (action.type === 'cycle') {
      cycleAttestation = action.attestation;
      continue;
    }
    if (action.type === 'mismatch_stage') {
      mismatchedCount++;
      continue;
    }
    if (action.type === 'stage') {
      stageAttestations.push(action.attestation);
    }
  }
  return { stageAttestations, hasCycleLine: cycleAttestation !== null, cycleAttestation, mismatchedCount };
}

/**
 * Build the cycle attestation seal payload from verified stage attestations.
 *
 * @param {object[]} stageAttestations - Verified stage attestation objects
 * @param {string} runId - ULID run identifier (fallback for cycle value when
 *   stage attestations are empty)
 * @param {object} io - IO interface for computing governance data
 * @returns {object} Cycle attestation object (without _hash)
 */
function buildSealPayload(stageAttestations, runId, io) {
  const cycle = stageAttestations.length > 0 ? stageAttestations[0].cycle : runId;
  const cycleId = stageAttestations.length > 0 ? stageAttestations[0].cycle : undefined;
  const governance = computeGovernance(io, cycleId);
  return buildCycleAttestation({
    cycle,
    stage_attestations: stageAttestations,
    governance,
  });
}

/**
 * Write a seal line to the JSONL file. Returns true on success and false
 * when the append fails.
 *
 * @param {object} io - IO interface with appendFile
 * @param {string} path - Path to the JSONL file
 * @param {object} sealedLine - Cycle attestation object with _hash
 * @returns {Promise<boolean>}
 */
async function writeSealLine(io, path, sealedLine) {
  try {
    await io.appendFile(path, JSON.stringify(sealedLine) + '\n');
    return true;
  } catch (err) {
    console.warn('seal: cycle attestation append failed', err);
    return false;
  }
}

/**
 * Return an early-sealed result in the standard seal return shape when
 * the JSONL file already contains a verified cycle attestation line.
 * Extracts composite_status, stage_count, and seal_hash from the
 * pre-existing cycle attestation. Returns null when no cycle line exists
 * and sealing should proceed normally.
 */
function checkExistingCycle(stageAttestations, hasCycleLine, resolvedRunId, cycleAttestation) {
  if (!hasCycleLine) return null;
  return {
    ok: true,
    cycle: cycleAttestation.cycle || (stageAttestations.length > 0 ? stageAttestations[0].cycle : resolvedRunId),
    composite_status: cycleAttestation.composite_status,
    stage_count: (cycleAttestation.stage_attestations || []).length,
    seal_hash: cycleAttestation._hash,
  };
}

/**
 * Resolve the run ID from the argument or WORK.md, returning null when
 * no run ID is available.
 */
function resolveRunId(runId, io) {
  const resolvedRunId = runId || readRunId(io);
  if (!resolvedRunId) return null;
  return resolvedRunId;
}

/**
 * Read a run's JSONL file, returning its content or an error.
 * Attempts the read directly; the IO layer surfaces the error
 * when the file does not exist or cannot be read.
 */
function readRunFile(io, path, resolvedRunId) {
  try {
    return { ok: true, content: io.readFile(path) };
  } catch (err) {
    if (err.code === 'ENOENT' || err.message?.startsWith('ENOENT')) {
      return { ok: false, error: `no attestation file found for run ${resolvedRunId}` };
    }
    return { ok: false, error: `IO read failure for run ${resolvedRunId}: ${err.message}` };
  }
}

/**
 * Seal a run by reading its JSONL attestation file, verifying every line,
 * building a composite cycle attestation, and appending the seal line.
 *
 * @param {string} runId - ULID run identifier (resolved from WORK.md if falsy)
 * @param {object} io - IO interface with readFile, appendFile
 * @returns {Promise<{ok: boolean, cycle?: string, composite_status?: string,
 *   stage_count?: number, seal_hash?: string, error?: string}>}
 */
function resolveAndReadRunFile(runId, io) {
  const resolvedRunId = resolveRunId(runId, io);
  if (!resolvedRunId) {
    return { ok: false, error: 'no run ID available — WORK.md is missing or has no foundry-run field' };
  }

  const path = `.foundry/attestations/${resolvedRunId}.jsonl`;
  const readResult = readRunFile(io, path, resolvedRunId);
  if (!readResult.ok) return readResult;

  return { ok: true, content: readResult.content, resolvedRunId, path };
}

export async function sealCycleAttestation(runId, io) {
  const fileResult = resolveAndReadRunFile(runId, io);
  if (!fileResult.ok) return fileResult;

  const { content, resolvedRunId, path } = fileResult;
  const lines = content.split('\n').filter(line => line.trim() !== '');
  const parsed = parseAttestationLines(lines);
  if (parsed.error) {
    return { ok: false, error: parsed.error };
  }
  const { stageAttestations, hasCycleLine, cycleAttestation: existingCycleAttestation } = parsed;

  const earlyResult = checkExistingCycle(stageAttestations, hasCycleLine, resolvedRunId, existingCycleAttestation);
  if (earlyResult) return earlyResult;

  const sealPayload = buildSealPayload(stageAttestations, resolvedRunId, io);
  const sealHash = hashAttestation(sealPayload);

  const sealedLine = { ...sealPayload, _hash: sealHash };
  const wroteSeal = await writeSealLine(io, path, sealedLine);
  if (!wroteSeal) {
    return { ok: false, error: 'failed to append cycle attestation line to seal the run' };
  }

  return {
    ok: true,
    cycle: sealPayload.cycle,
    composite_status: sealPayload.composite_status,
    stage_count: stageAttestations.length,
    seal_hash: sealHash,
  };
}
