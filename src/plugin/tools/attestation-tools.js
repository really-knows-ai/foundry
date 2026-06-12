// src/plugin/tools/attestation-tools.js
// User-facing tools for inspecting and verifying per-run attestation JSONL files.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { hashAttestation } from '../../scripts/lib/attestation/hash.js';
import { errorJson } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attestationsDir(cwd) {
  return path.join(cwd, '.foundry', 'attestations');
}

function jsonlPath(cwd, runId) {
  return path.join(attestationsDir(cwd), `${runId}.jsonl`);
}

function listRuns(cwd) {
  const dir = attestationsDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace(/\.jsonl$/, ''))
    .sort();
}

/**
 * Verify a single parsed JSONL line by recomputing its _hash.
 *
 * @param {object} lineObj  Parsed JSON object with an optional _hash field
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function verifyJsonlLine(lineObj) {
  if (lineObj._hash === undefined) {
    return { ok: false, error: 'line missing _hash field' };
  }
  const savedHash = lineObj._hash;
  const computedHash = hashAttestation(lineObj);
  if (savedHash !== computedHash) {
    return { ok: false, error: `hash mismatch: expected ${savedHash}, computed ${computedHash}` };
  }
  return { ok: true };
}

/**
 * Parse a single JSONL line and verify its hash.
 * Returns the parsed object on success, or an error object on failure.
 */
function parseAndVerifyLine(line, index) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { error: `unparseable JSON at line ${index + 1}` };
  }
  const result = verifyJsonlLine(parsed);
  if (!result.ok) {
    return { error: `line ${index + 1}: ${result.error}` };
  }
  return { parsed };
}

/**
 * Read and verify every line in a JSONL file.
 *
 * @param {string} filePath  Absolute path to the JSONL file
 * @returns {{ ok: true, entries: object[], linesVerified: number, sealVerified: boolean }
 *        | { ok: false, error: string }}
 */
function verifyJsonlFile(filePath) {
  if (!existsSync(filePath)) {
    return { ok: false, error: `attestation file not found: ${filePath}` };
  }
  const content = readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { ok: true, entries: [], linesVerified: 0, sealVerified: false };
  }

  return processLines(lines);
}

/**
 * Verify every embedded attestation record's _hash is present and correct.
 *
 * @param {object[]} embedded  Embedded stage attestations from the cycle line
 * @returns {string|null}  Error string or null when all records are valid
 */
function verifyEmbeddedHashes(embedded) {
  for (let i = 0; i < embedded.length; i++) {
    const rec = embedded[i];
    if (rec._hash === undefined || hashAttestation(rec) !== rec._hash) {
      return `embedded stage attestation ${i} hash validation failed`;
    }
  }
  return null;
}

/**
 * Check that the count of embedded records matches file stage entries.
 *
 * @param {object[]} embedded  Embedded stage attestations from the cycle line
 * @param {object[]} stageEntries  Stage entries from the file
 * @returns {string|null}  Error string or null when counts match
 */
function checkAttestationCount(embedded, stageEntries) {
  if (embedded.length !== stageEntries.length) {
    return `embedded stage attestation count mismatch: embedded ${embedded.length}, file ${stageEntries.length}`;
  }
  return null;
}

/**
 * Cross-check two sets of attestations by comparing sorted _hash values.
 *
 * @param {object[]} embedded  Embedded stage attestations from the cycle line
 * @param {object[]} stageEntries  Stage entries from the file
 * @returns {string|null}  Error string or null when sets match
 */
function compareAttestationSets(embedded, stageEntries) {
  const entryHashes = stageEntries.map(e => e._hash).sort();
  const embeddedHashes = embedded.map(e => e._hash).sort();
  for (let i = 0; i < entryHashes.length; i++) {
    if (entryHashes[i] !== embeddedHashes[i]) {
      return `embedded stage attestation content mismatch at sorted index ${i}`;
    }
  }
  return null;
}

/**
 * Verify a cycle attestation line by cross-checking its embedded
 * stage_attestations against the actual stage entries in the file.
 *
 * @param {object} cycleParsed  Parsed cycle attestation object
 * @param {object[]} stageEntries  Stage entries from the file (excluding cycle lines)
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function verifyCycleLine(cycleParsed, stageEntries) {
  const embedded = cycleParsed.stage_attestations || [];

  const hashError = verifyEmbeddedHashes(embedded);
  if (hashError) return { ok: false, error: hashError };

  const countError = checkAttestationCount(embedded, stageEntries);
  if (countError) return { ok: false, error: countError };

  const contentError = compareAttestationSets(embedded, stageEntries);
  if (contentError) return { ok: false, error: contentError };

  return { ok: true };
}

/**
 * Process verified lines: collect entries and detect seal line.
 * Extracted from verifyJsonlFile to reduce function complexity.
 */
function processLines(lines) {
  const entries = [];
  let sealVerified = false;

  for (let i = 0; i < lines.length; i++) {
    const r = parseAndVerifyLine(lines[i], i);
    if (r.error) {
      return { ok: false, error: r.error };
    }
    entries.push(r.parsed);
    if (r.parsed.schema === 'foundry-cycle-attestation/v1') {
      const stageEntries = entries.filter(
        e => e.schema !== 'foundry-cycle-attestation/v1'
      );
      const result = verifyCycleLine(r.parsed, stageEntries);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      sealVerified = true;
    }
  }

  return { ok: true, entries, linesVerified: lines.length, sealVerified };
}

// ---------------------------------------------------------------------------
// Commit seal helpers
// ---------------------------------------------------------------------------

/**
 * Read the attestation-seal and foundry-run fields from the HEAD commit body.
 *
 * @param {string} cwd  Repository working directory
 * @returns {{ foundryRun: string|null, attestationSeal: string|null }}
 */
function readCommitSeal(cwd) {
  try {
    const msg = execSync('git log -1 --pretty=%B', { cwd, encoding: 'utf8' });
    const foundryRunMatch = msg.match(/^foundry-run:\s*(\S+)/m);
    const sealMatch = msg.match(/^attestation-seal:\s*(\S+)/m);
    return {
      foundryRun: foundryRunMatch ? foundryRunMatch[1] : null,
      attestationSeal: sealMatch ? sealMatch[1] : null,
    };
  } catch {
    return { foundryRun: null, attestationSeal: null };
  }
}

/**
 * Cross-check the last cycle-attestation line's _hash against the
 * attestation-seal stored in the HEAD commit message.
 *
 * Returns extra fields to merge into the verify output, or an object
 * with an `error` key when the seal does not match.
 *
 * @param {object[]} entries  Parsed and verified JSONL entries
 * @param {string} cwd        Repository working directory
 * @returns {{ error: string } | { commit_seal_match?: true, commit_seal_present?: false }}
 */
function checkCommitSeal(entries, cwd) {
  const cycleEntry = entries.find(
    e => e.schema === 'foundry-cycle-attestation/v1'
  );
  if (!cycleEntry) return {};

  const commitSeal = readCommitSeal(cwd);
  if (!commitSeal.attestationSeal) {
    return { commit_seal_present: false };
  }

  if (commitSeal.attestationSeal !== cycleEntry._hash) {
    return {
      error: `commit attestation-seal (${commitSeal.attestationSeal}) does not match cycle line _hash (${cycleEntry._hash})`,
    };
  }

  return { commit_seal_match: true };
}

// ---------------------------------------------------------------------------
// Tool: foundry_attestation_show
// ---------------------------------------------------------------------------

function createShowTool(tool) {
  return tool({
    description:
      'Show attestation records for a run. When run_id is provided, returns the ' +
      'parsed JSONL entries for that run. When run_id is absent, lists all available runs.',
    args: {
      run_id: tool.schema.string().optional()
        .describe('Run identifier (ULID). When absent, lists available runs.'),
    },
    async execute(args, context) {
      try {
        const cwd = context.worktree;
        const runId = args.run_id;

        if (!runId) {
          const runs = listRuns(cwd);
          return JSON.stringify({ ok: true, runs });
        }

        const fPath = jsonlPath(cwd, runId);
        if (!existsSync(fPath)) {
          return JSON.stringify({ ok: false, error: `no attestation file found for run ${runId}` });
        }

        const content = readFileSync(fPath, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        const entries = lines.map(l => JSON.parse(l));

        return JSON.stringify({ ok: true, run_id: runId, entries });
      } catch (err) {
        return errorJson(err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Tool: foundry_attestation_verify
// ---------------------------------------------------------------------------

/**
 * Execute the verify tool logic. Extracted from createVerifyTool to keep
 * function size and complexity within project limits.
 */
async function executeVerifyTool(args, context) {
  try {
    const cwd = context.worktree;
    const runId = args.run_id;

    if (!runId) {
      const runs = listRuns(cwd);
      return JSON.stringify({ ok: true, runs });
    }

    const fPath = jsonlPath(cwd, runId);
    const result = verifyJsonlFile(fPath);
    if (!result.ok) {
      return JSON.stringify(result);
    }

    const sealExtra = checkCommitSeal(result.entries, cwd);
    if (sealExtra.error) {
      return JSON.stringify({ ok: false, error: sealExtra.error });
    }

    return JSON.stringify({
      ok: true,
      run_id: runId,
      entries_verified: result.linesVerified,
      seal_verified: result.sealVerified,
      ...sealExtra,
    });
  } catch (err) {
    return errorJson(err);
  }
}

function createVerifyTool(tool) {
  return tool({
    description:
      'Verify every line hash in a run attestation JSONL file. When run_id is ' +
      'provided, re-computes the _hash for each line and confirms it matches. ' +
      'When run_id is absent, lists available runs. ' +
      'The tool also cross-checks the cycle line _hash against the ' +
      'attestation-seal stored in the HEAD commit message.',
    args: {
      run_id: tool.schema.string().optional()
        .describe('Run identifier (ULID). When absent, lists available runs.'),
    },
    execute: executeVerifyTool,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createAttestationTools({ tool }) {
  return {
    foundry_attestation_show: createShowTool(tool),
    foundry_attestation_verify: createVerifyTool(tool),
  };
}


