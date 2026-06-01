// src/plugin/tools/stage-output-tool.js
// Stage output tool for foundry stages — validates structured output and
// writes directly to a JSONL file on disk. Registered as `foundry_stage_output`.

import { stageBaseOf, requireActiveStage } from '../../scripts/lib/stage-guard.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { makeIO, flowBranchGuard, branchIoFactory, asyncIoFactory } from './helpers.js';
import {
  validateForgeOutput,
  validateAppraiseOutput,
  validateHumanAppraiseOutput,
} from '../../scripts/lib/stage-output-schemas.js';

/** Gate that rejects when the subagent's flow is in a failed state. */
const gateNotFailed = notFailedGuard(makeIO);

/** Validator dispatch table keyed by stage base name. */
const VALIDATORS = Object.freeze({
  forge: validateForgeOutput,
  appraise: validateAppraiseOutput,
  'human-appraise': validateHumanAppraiseOutput,
});

/**
 * Read an output JSONL file and return parsed lines.
 * @param {import('./helpers.js').IO} io
 * @param {string} filePath
 * @returns {object[]}
 */
function readOutputLines(io, filePath) {
  if (!io.exists(filePath)) return [];
  const content = io.readFile(filePath);
  return content.trim().split('\n').filter(Boolean).map(function(l) {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Append a JSON line to a session output file, returning the resulting line count.
 * Creates the file and parent directory if they do not exist.
 * @param {import('./helpers.js').IO} io
 * @param {string} sessionId
 * @param {object} data
 * @returns {number}
 */
function appendSessionOutput(io, sessionId, data) {
  const outFile = '.foundry/stage-outputs/' + sessionId + '.jsonl';
  io.mkdir('.foundry/stage-outputs/');
  const existing = readOutputLines(io, outFile);
  const line = JSON.stringify(data) + '\n';
  io.writeFile(outFile, io.exists(outFile) ? io.readFile(outFile) + line : line);
  return existing.length + 1;
}

/**
 * Execute the stage output handler: validate data against the active stage
 * schema and write it as a JSONL line to the session's output file on disk.
 * @param {{ data: object }} args
 * @param {{ worktree: string, sessionID: string }} context
 * @returns {Promise<string>} JSON result
 */
async function handleStageOutput(args, context) {
  const io = makeIO(context.worktree);
  const activeResult = requireActiveStage(io);
  if (!activeResult.ok) {
    return JSON.stringify({ error: `foundry_stage_output: ${activeResult.error}` });
  }

  const base = stageBaseOf(activeResult.active.stage);
  const validator = VALIDATORS[base];
  if (!validator) {
    return JSON.stringify({ error: `unknown stage base: ${base}` });
  }

  const validationResult = validator(args.data);
  if (!validationResult.ok) {
    const msg = `${base} stage_output: ${validationResult.errors.join('; ')}`;
    return JSON.stringify({ error: msg });
  }

  if (!context.sessionID) {
    return JSON.stringify({ error: 'foundry_stage_output: no sessionID in context' });
  }

  const count = appendSessionOutput(io, context.sessionID, args.data);
  return JSON.stringify({ ok: true, count: count });
}

export function createStageOutputTool({ tool }) {
  return {
    foundry_stage_output: tool({
      description: 'Validate and store structured output for the active stage. Output is written directly to .foundry/stage-outputs/<sessionId>.jsonl. Call before foundry_stage_end(). Forge and human-appraise stages require exactly one call; appraise stages accept zero or more.',
      args: {
        data: tool.schema.object().describe('The JSON data to validate against the active stage schema'),
      },
      execute: guarded('foundry_stage_output', [flowBranchGuard, gateNotFailed],
        handleStageOutput,
        { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
