// src/plugin/tools/stage-output-tool.js
// Stage output tool for foundry stages — validates and accumulates structured
// output before stage end. Registered as `foundry_stage_output`.

import { stageBaseOf, requireActiveStage } from '../../scripts/lib/stage-guard.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { makeIO, flowBranchGuard, branchIoFactory, asyncIoFactory } from './helpers.js';
import {
  validateForgeOutput,
  validateAppraiseOutput,
  validateHumanAppraiseOutput,
} from '../../scripts/lib/stage-output-schemas.js';

/** @type {Map<string, object[]>} In-memory buffer keyed by full stage ID. */
const stageOutputsBuffer = new Map();

/** Gate that rejects when the subagent's flow is in a failed state. */
const gateNotFailed = notFailedGuard(makeIO);

/** Validator dispatch table keyed by stage base name. */
const VALIDATORS = Object.freeze({
  forge: validateForgeOutput,
  appraise: validateAppraiseOutput,
  'human-appraise': validateHumanAppraiseOutput,
});

/**
 * Execute the stage output handler: validate data against the active stage
 * schema and accumulate it in the in-memory buffer.
 * @param {{ data: object }} args
 * @param {{ worktree: string }} context
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
    return JSON.stringify({ error: validationResult.errors.join('; ') });
  }

  const stageId = activeResult.active.stage;
  const buf = stageOutputsBuffer.get(stageId) || [];
  buf.push(args.data);
  stageOutputsBuffer.set(stageId, buf);

  return JSON.stringify({ ok: true, count: buf.length });
}

export function createStageOutputTool({ tool }) {
  return {
    foundry_stage_output: tool({
      description: 'Validate and store structured output for the active stage. Call before foundry_stage_end(). Forge and human-appraise stages require exactly one call; appraise stages accept zero or more.',
      args: {
        data: tool.schema.object().describe('The JSON data to validate against the active stage schema'),
      },
      execute: guarded('foundry_stage_output', [flowBranchGuard, gateNotFailed],
        handleStageOutput,
        { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}

/**
 * Retrieve all accumulated outputs for a given stage ID.
 * Returns a shallow copy of the internal array to prevent mutation.
 * @param {string} stageId - The full stage alias (e.g. "forge:cycle-1")
 * @returns {object[]} Array of validated data objects
 */
export function getStageOutputs(stageId) {
  return [...(stageOutputsBuffer.get(stageId) || [])];
}

/**
 * Clear all accumulated outputs for a given stage ID.
 * Used after flushing buffer entries to disk.
 * @param {string} stageId - The full stage alias (e.g. "forge:cycle-1")
 */
export function clearStageOutputs(stageId) {
  stageOutputsBuffer.delete(stageId);
}

/**
 * Clear all accumulated outputs for every stage.
 * Internal helper for test isolation — exported with underscore prefix.
 */
export function _clearAllOutputs() {
  stageOutputsBuffer.clear();
}
