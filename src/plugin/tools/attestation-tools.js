// src/plugin/tools/attestation-tools.js
// User-facing tools for inspecting and verifying per-run attestation JSONL files.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
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
      sealVerified = true;
    }
  }

  return { ok: true, entries, linesVerified: lines.length, sealVerified };
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

function createVerifyTool(tool) {
  return tool({
    description:
      'Verify every line hash in a run attestation JSONL file. When run_id is ' +
      'provided, re-computes the _hash for each line and confirms it matches. ' +
      'When run_id is absent, lists available runs.',
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
        const result = verifyJsonlFile(fPath);
        if (!result.ok) {
          return JSON.stringify(result);
        }

        return JSON.stringify({
          ok: true,
          run_id: runId,
          entries_verified: result.linesVerified,
          seal_verified: result.sealVerified,
        });
      } catch (err) {
        return errorJson(err);
      }
    },
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
