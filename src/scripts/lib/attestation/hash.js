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
 * Reads law files from .foundry/laws/ and computes their SHA-256 hashes,
 * and reads the cycle configuration file to compute its content hash.
 *
 * @param {object} io - IO interface with readDir, readFile
 * @param {string} cycleId - Cycle identifier used to locate the config file
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
  try {
    const configContent = io.readFile(`.foundry/cycles/${cycleId}.md`);
    configCommit = sha256Text(configContent);
  } catch {
    configCommit = 'unknown';
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
  const gov = governance || { workfile_hashes: {}, config_commit: 'unknown' };
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

function handleMismatchLine(result) {
  if (result.attestation.schema === 'foundry-cycle-attestation/v1') {
    throw new Error('pre-existing cycle line hash mismatch — composite cannot be trusted');
  }
  console.warn('skipping line with hash mismatch');
}

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

function buildSealPayload(stageAttestations, runId, io, cycleId) {
  const effectiveCycleId =
    stageAttestations.length > 0 ? stageAttestations[0].cycle : cycleId;
  const governance = computeGovernance(io, effectiveCycleId);
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
 * @param {string} cycleId - Cycle identifier used for the governance config hash
 * @returns {Promise<{ok: boolean, cycle?: string, composite_status?: string,
 *   stage_count?: number, seal_hash?: string, error?: string}>}
 */
export async function sealCycleAttestation(runId, io, cycleId) {
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
  const cycleAttestation = buildSealPayload(stageAttestations, resolvedRunId, io, cycleId);
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
