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
 * @returns {{workfile_hashes: Record<string, string>, config_commit: string}}
 */
export function computeGovernance(io, cycleId) {
  let workfileHashes;
  try {
    const lawFiles = io.readDir('.foundry/laws/');
    workfileHashes = {};
    for (const name of lawFiles) {
      const content = io.readFile('.foundry/laws/' + name);
      workfileHashes[name] = sha256Text(content);
    }
  } catch {
    workfileHashes = {};
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

  return { workfile_hashes: workfileHashes, config_commit: configCommit };
}

/**
 * Build a minimal cycle attestation for an empty run.
 *
 * @param {string} runId - ULID run identifier
 * @param {object} [governance] - Governance workfile hashes
 * @returns {object} Minimal cycle attestation object
 */
function buildMinimalCycle(runId, governance) {
  const gov = governance || { workfile_hashes: {}, config_commit: 'none' };
  return {
    schema: 'foundry-cycle-attestation/v1',
    cycle: runId,
    stage_attestations: [],
    composite_status: 'incomplete',
    cycle_duration_ms: null,
    feedback_summary: { opened: 0, resolved: 0, rejected: 0, open_remaining: 0 },
    artefact_summary: { total_changed: 0, unique_paths: 0 },
    governance: gov,
  };
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
    return { attestation: { ...parsed, _hash_mismatch: true }, mismatch: true };
  }

  return { attestation: parsed };
}

/**
 * Parse all non-empty lines from a JSONL file, verifying hashes and
 * collecting stage attestations. Pre-existing cycle lines (with schema
 * foundry-cycle-attestation/v1) are verified but excluded from the result.
 *
 * @param {string[]} lines - Non-empty lines from the JSONL file
 * @returns {object[]} Verified stage attestation objects
 */
/**
 * Handle a line with a hash mismatch: include stage lines, skip cycle lines.
 *
 * @param {{attestation: object, mismatch: boolean}} result - verifyStageLine result
 * @param {object[]} results - accumulator for included attestations
 */
function handleMismatchLine(result) {
  if (result.attestation.schema === 'foundry-cycle-attestation/v1') {
    throw new Error('pre-existing cycle line hash mismatch — composite cannot be trusted');
  }
  console.warn('skipping line with hash mismatch');
}

/**
 * Parse all non-empty lines from a JSONL file, verifying hashes and
 * collecting stage attestations. Pre-existing cycle lines (with schema
 * foundry-cycle-attestation/v1) are verified but excluded from the result.
 *
 * @param {string[]} lines - Non-empty lines from the JSONL file
 * @returns {object[]} Verified stage attestation objects
 */
function parseAttestationLines(lines) {
  const results = [];
  for (const line of lines) {
    const result = verifyStageLine(line);
    if (result.error) {
      console.error(result.error);
      continue;
    }
    if (result.mismatch) {
      handleMismatchLine(result);
      continue;
    }
    if (result.attestation.schema === 'foundry-cycle-attestation/v1') {
      continue;
    }
    results.push(result.attestation);
  }
  return results;
}

/**
 * Build the cycle attestation seal payload from verified stage attestations.
 *
 * Uses buildCycleAttestation when stage attestations exist; falls back to
 * buildMinimalCycle when there are none.
 *
 * @param {object[]} stageAttestations - Verified stage attestation objects
 * @param {string} runId - ULID run identifier (fallback for cycle value)
 * @param {object} io - IO interface for computing governance data
 * @returns {object} Cycle attestation object (without _hash)
 */
function buildSealPayload(stageAttestations, runId, io) {
  const cycleId = stageAttestations.length > 0 ? stageAttestations[0].cycle : undefined;
  const governance = computeGovernance(io, cycleId);
  if (stageAttestations.length > 0) {
    return buildCycleAttestation({
      cycle: stageAttestations[0].cycle,
      stage_attestations: stageAttestations,
      governance,
    });
  }
  return buildMinimalCycle(runId, governance);
}

/**
 * Seal a run by reading its JSONL attestation file, verifying every line,
 * building a composite cycle attestation, and appending the seal line.
 *
 * @param {string} runId - ULID run identifier (resolved from WORK.md if falsy)
 * @param {object} io - IO interface with exists, readFile, appendFile
 * @returns {Promise<{ok: boolean, cycle?: string, composite_status?: string,
 *   stage_count?: number, seal_hash?: string, error?: string}>}
 */
export async function sealCycleAttestation(runId, io) {
  const resolvedRunId = runId || readRunId(io);
  if (!resolvedRunId) {
    return {
      ok: false,
      error:
        'no run ID available — WORK.md is missing or has no foundry-run field',
    };
  }

  const path = `.foundry/attestations/${resolvedRunId}.jsonl`;

  if (!io.exists(path)) {
    return {
      ok: false,
      error: `no attestation file found for run ${resolvedRunId}`,
    };
  }

  const content = io.readFile(path);
  const lines = content.split('\n').filter(line => line.trim() !== '');
  let stageAttestations;
  try {
    stageAttestations = parseAttestationLines(lines);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const cycleAttestation = buildSealPayload(stageAttestations, resolvedRunId, io);
  const sealHash = hashAttestation(cycleAttestation);

  const sealedLine = { ...cycleAttestation, _hash: sealHash };
  await io.appendFile(path, JSON.stringify(sealedLine) + '\n');

  return {
    ok: true,
    cycle: cycleAttestation.cycle,
    composite_status: cycleAttestation.composite_status,
    stage_count: stageAttestations.length,
    seal_hash: sealHash,
  };
}
