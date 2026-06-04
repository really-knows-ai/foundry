/**
 * Appraise dispatch — CLI spawn dispatch for appraise stages.
 *
 * Exports: dispatchAppraisePrompt, batchAppraiseDispatch
 *
 * Each appraiser dispatch spawns `opencode run --attach` as a child process.
 * The prompt is written to a temp file to avoid shell injection. Batches
 * dispatch at most 4 concurrent processes with sequential fallback on failure.
 * Appraisers do not use tokens — the orchestrator manages stage lifecycle.
 */

import { buildAppraiserPrompt } from '../appraise-module.js';

/**
 * Build the wrapped prompt content for a single appraiser dispatch.
 * Enriches the unit with law objects, calls buildAppraiserPrompt,
 * and wraps the result in <appraiser_instructions> XML tags.
 */
function buildWrappedPrompt(entry, lawGroups, outputType) {
  const { unit, appraiser } = entry;

  const groupLaws = lawGroups.get(unit.group) || [];
  const promptUnit = unit.mode === 'bundle'
    ? Object.assign({}, unit, { laws: groupLaws })
    : Object.assign({}, unit, {
        law: groupLaws.find(function(l) { return l.id === unit.lawIds[0]; }) || { id: unit.lawIds[0], text: '' },
      });

  const promptStr = buildAppraiserPrompt({
    appraiser,
    typeId: outputType,
    unit: promptUnit,
    identity: { group: entry.group, appraiser: appraiser.id, pass: entry.pass },
  });

  return [
    '<appraiser_instructions>',
    '<persona>',
    promptStr,
    '</persona>',
    'Your task is to evaluate the artefact according to your persona above.',
    'Call foundry_stage_output for each finding, then foundry_stage_end.',
    '</appraiser_instructions>',
  ].join('\n');
}

/**
 * Dispatch a single (unit, appraiser, pass) evaluation via CLI spawn.
 *
 * Builds the appraiser prompt, wraps the persona in <appraiser_instructions>
 * XML tags at the end of the message, writes the prompt to a temp file,
 * spawns `opencode run --attach` as a child process, awaits completion,
 * and cleans up the prompt file.
 *
 * Accepts dispatch helpers via opts for test injection.
 * Returns nothing — stage output is collected later by readAppraiseStageOutputs.
 */
export async function dispatchAppraisePrompt(entry, opts) {
  const {
    io, worktree, lawGroups, outputType, timeoutMs = 300_000,
    writePromptFile, spawnDispatch, awaitProcess, withCleanup,
  } = opts;

  const wrappedContent = buildWrappedPrompt(entry, lawGroups, outputType);

  return withCleanup(io, async (paths) => {
    const promptPath = writePromptFile(io, wrappedContent);
    paths.push(promptPath);
    const child = spawnDispatch(worktree, promptPath);
    await awaitProcess(child, timeoutMs);
  });
}

/**
 * Batch dispatch appraise evaluations with bounded concurrency.
 *
 * Partitions the dispatch matrix into batches of at most 4 entries.
 * Each batch is dispatched concurrently via Promise.allSettled.
 * If any entry in a batch rejects, remaining entries are dispatched
 * sequentially (one at a time) to avoid resource exhaustion.
 *
 * Returns a flat PromiseSettledResult[] array matching dispatchMatrix order.
 */
export async function batchAppraiseDispatch(dispatchMatrix, opts) {
  const BATCH_SIZE = 4;
  const results = [];
  let sequential = false;

  for (let i = 0; i < dispatchMatrix.length; i += BATCH_SIZE) {
    const batch = dispatchMatrix.slice(i, i + BATCH_SIZE);

    let batchResults;
    if (sequential) {
      batchResults = [];
      for (const entry of batch) {
        const result = await Promise.allSettled([dispatchAppraisePrompt(entry, opts)]);
        batchResults.push(result[0]);
      }
    } else {
      batchResults = await Promise.allSettled(
        batch.map(function(entry) { return dispatchAppraisePrompt(entry, opts); })
      );
      if (batchResults.some(function(r) { return r.status === 'rejected'; })) {
        sequential = true;
      }
    }

    results.push(...batchResults);
  }

  return results;
}
