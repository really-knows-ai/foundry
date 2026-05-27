/**
 * Appraise module — gathers context for parallel appraiser dispatch and
 * consolidates results after all appraisers have run.
 *
 * Gather phase: reads artefacts, selects appraisers, builds subagent prompts
 * with only personality + type ID (no artefact content or laws inlined), and
 * returns a dispatch_multi action so the orchestrator's LLM dispatches
 * appraisers in parallel.
 *
 * Each appraiser subagent discovers artefacts, laws, and file-patterns via
 * tool calls and returns JSONL — one JSON object per line.
 *
 * Consolidate phase: receives lastResults from the orchestrator, parses JSONL
 * from each appraiser, unions and de-duplicates issues, posts feedback, and
 * finalises the stage so the orchestrator can re-sort and determine the next
 * action.
 */

import { getArtefactFiles, computeArtefactVersion } from './lib/artefacts.js';
import { selectAppraisers, getCycleDefinition } from './lib/config.js';
import { openFeedbackStore } from './lib/feedback-store.js';

// ---------------------------------------------------------------------------
// Public API — gather
// ---------------------------------------------------------------------------

/**
 * Gather appraise context: read draft artefacts, select appraisers, build a
 * dispatch_multi action with one task per appraiser. The subagent prompt
 * contains only the appraiser personality and artefact type ID — the subagent
 * discovers artefact files, laws, and file-patterns via tool calls.
 *
 * @param {object} ctx
 * @param {string} ctx.cycleId
 * @param {object} ctx.io
 * @param {string} ctx.foundryDir
 * @param {string} [ctx.baseBranch] - Git base branch for diff comparison,
 *   defaults to 'main'.
 * @param {string} [ctx.defaultModel] - Fallback model when an appraiser has no
 *   explicit model.
 * @returns {Promise<{action: string, tasks: Array, stage: string, cycle: string}>}
 */
export async function gatherAppraiseContext(ctx) {
  const guarded = guardAppraiseGather(ctx);
  if (guarded) return guarded;

  await resolveStaleAppraiseFeedback(ctx);

  const cd = await getCycleDefinition(ctx.foundryDir, ctx.cycleId, ctx.io);
  const outputType = validateOutputType(cd, ctx.cycleId);
  if (typeof outputType !== 'string') return outputType;

  const artefacts = await fetchAppraiseArtefacts(ctx, outputType);
  if (!Array.isArray(artefacts)) return artefacts;

  const appraisers = await selectAppraisers(ctx.foundryDir, outputType, { io: ctx.io });
  if (appraisers.length === 0) {
    return emptyDispatch(ctx.cycleId);
  }

  return buildGatherResponse(appraisers, outputType, ctx);
}

function guardAppraiseGather(ctx) {
  return ctx.cycleId ? null : violation('cycleId is required', []);
}

function validateOutputType(cd, cycleId) {
  const outputType = cd.frontmatter['output-type'];
  return outputType ?? violation(`cycle ${cycleId} missing output-type field`, []);
}

async function fetchAppraiseArtefacts(ctx, outputType) {
  const baseBranch = ctx.baseBranch || 'main';
  const artefacts = await getArtefactFiles(ctx.foundryDir, outputType, ctx.io, { baseBranch });
  if (artefacts.length === 0) return emptyDispatch(ctx.cycleId);
  return artefacts;
}

function buildGatherResponse(appraisers, outputType, ctx) {
  const tasks = appraisers.map(appraiser => ({
    subagent_type: resolveSubagentType(appraiser, ctx),
    prompt: buildAppraiserPrompt({ appraiser, typeId: outputType }),
  }));

  return {
    action: 'dispatch_multi',
    tasks,
    stage: `appraise:${ctx.cycleId}`,
    cycle: ctx.cycleId,
  };
}

/**
 * Map an appraiser's model to a subagent type string.
 */
function resolveSubagentType(appraiser, ctx) {
  const name = appraiser.model || ctx.defaultModel || 'appraise';
  if (name === 'appraise') return 'foundry-appraise';
  return `foundry-${name.replace(/[/.]/g, '-')}`;
}

/**
 * Empty dispatch response when there is nothing to appraise.
 */
function emptyDispatch(cycleId) {
  return {
    action: 'dispatch_multi',
    tasks: [],
    stage: `appraise:${cycleId}`,
    cycle: cycleId,
  };
}

// ---------------------------------------------------------------------------
// Public API — consolidate
// ---------------------------------------------------------------------------

/**
 * Resolve stale feedback items whose artefact version does not match the
 * current on-disk version. Items from this stage's source base with a
 * mismatched artefact_version are auto-resolved as superseded.
 *
 * @param {object[]} items - Feedback items to check
 * @param {string} currentVersion - Current on-disk artefact version
 * @param {string} stageBase - Stage base name (e.g. 'appraise') to filter by source
 * @param {object} feedback - Feedback store instance with autoResolve method
 * @param {string} cycle - Current cycle identifier
 */
export function resolveStaleFeedback(items, currentVersion, stageBase, feedback, cycle) {
  for (const item of items) {
    if (shouldSkipStaleResolve(item, currentVersion, stageBase)) continue;
    const reason = `superseded by forge revision ${currentVersion}`;
    feedback.autoResolve({ id: item.id, reason, cycle });
  }
}

function shouldSkipStaleResolve(item, currentVersion, stageBase) {
  if (item.history[0].state === 'resolved') return true;
  const itemBase = typeof item.source === 'string' ? item.source.split(':')[0] : '';
  if (itemBase !== stageBase) return true;
  if (item.artefact_version === currentVersion) return true;
  return false;
}

/**
 * Resolve stale appraise-sourced feedback. Errors propagate to the caller
 * which must handle them (e.g. by returning a violation).
 */
async function resolveStaleAppraiseFeedback(ctx) {
  try {
    const cycleDef = await getCycleDefinition(ctx.foundryDir, ctx.cycleId, ctx.io);
    const outputType = cycleDef.frontmatter['output-type'];
    if (outputType) {
      const store = openFeedbackStore('WORK.feedback.yaml', ctx.io);
      const currentVersion = await computeArtefactVersion(ctx.foundryDir, outputType, ctx.io, ctx.cwd);
      resolveStaleFeedback(store.list(), currentVersion, 'appraise', store, ctx.cycleId);
    }
  } catch {
    // Graceful degrade — stale resolution is best-effort.
    // The orchestrator handles IO failures at the cycle level.
  }
}

/**
 * Consolidate appraiser results and finalise the appraise stage.
 *
 * Called by orchestrator after all appraisers have completed. Parses JSONL
 * from each appraiser's output, posts combined feedback, resolves prior
 * appraise feedback, and advances the cycle to the next stage via finalize.
 *
 * @param {object} ctx
 * @param {Array<{ok: boolean, output?: string, error?: string}>} lastResults
 * @returns {Promise<{ok: boolean, summary?: string}|violation>}
 */
export async function consolidateAppraise(ctx, lastResults) {
  const baseSha = ctx.activeStage?.baseSha;
  if (!baseSha) {
    return violation('No active stage found', []);
  }

  const results = arrayFrom(lastResults);
  const successful = results.filter(r => r.ok === true);

  if (allAppraisersFailed(results, successful)) {
    return violation('All appraisers failed to evaluate the artefact', []);
  }

  await resolveStaleAppraiseFeedback(ctx);

  const consolidated = parseConsolidated(successful);
  const stageId = `appraise:${ctx.cycleId}`;

  const artefactVersion = await computeAppraiseArtefactVersion(ctx);
  postConsolidatedFeedback(ctx, consolidated, artefactVersion);
  resolvePriorAppraise(ctx, consolidated, stageId);

  const summary = buildConsolidateSummary(consolidated.length);

  return finalizeAndReturn(ctx, stageId, summary, baseSha);
}

async function finalizeAndReturn(ctx, stageId, summary, baseSha) {
  const result = await ctx.finalize({
    lastStage: { stage: stageId, summary, baseSha },
    activeStage: ctx.activeStage,
  });

  if (result && result.action === 'violation') return result;
  return { ok: true, summary };
}

/**
 * Parse JSONL from all successful appraiser outputs and de-duplicate the
 * combined issue list by (file, law-id, issue text).
 */
function parseConsolidated(successful) {
  const all = [];

  for (const result of successful) {
    const issues = parseAppraiserJsonl(result.output || '');
    all.push(...issues);
  }

  return deduplicateIssues(all);
}

/**
 * Parse appraiser JSONL output.
 *
 * Each line must be a JSON object with at least `file` and `text` fields.
 * Extra fields (`law`, `evidence`, `severity`, `location`) are preserved.
 * The `text` field maps to the issue description used for feedback text.
 */
function parseAppraiserJsonl(output) {
  const issues = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    const issue = parseAppraiserLine(line);
    if (issue) issues.push(issue);
  }

  return issues;
}

function parseAppraiserLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const obj = tryJsonParseLine(trimmed);
  if (!obj) return null;

  return validateJsonlIssue(obj);
}

function tryJsonParseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function validateJsonlIssue(obj) {
  if (!hasStringField(obj, 'file')) return null;
  if (!hasStringField(obj, 'text')) return null;

  return {
    file: obj.file,
    law: strOrEmpty(obj.law),
    issue: obj.text,
    evidence: strOrEmpty(obj.evidence),
  };
}

function hasStringField(obj, key) {
  return typeof obj[key] === 'string' && obj[key].length > 0;
}

function strOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * De-duplicate an issue array by (file, law, issue text).
 */
function deduplicateIssues(issues) {
  const seen = new Set();
  const result = [];

  for (const issue of issues) {
    const key = `${issue.file}:${issue.law}:${issue.issue}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }

  return result;
}

/**
 * Compute artefact version for the appraise cycle so feedback items carry
 * a version hash and are not auto-resolved by sort as legacy items.
 */
async function computeAppraiseArtefactVersion(ctx) {
  try {
    const cycleDef = await getCycleDefinition(ctx.foundryDir, ctx.cycleId, ctx.io);
    const outputType = cycleDef.frontmatter['output-type'];
    if (outputType) {
      return await computeArtefactVersion(ctx.foundryDir, outputType, ctx.io, ctx.cwd);
    }
  } catch { /* skip */ }
  return undefined;
}

/**
 * Post one feedback item per consolidated issue.
 */
function postConsolidatedFeedback(ctx, consolidated, artefactVersion) {
  for (const issue of consolidated) {
    ctx.feedback.add({
      file: issue.file,
      text: issue.issue,
      tag: `law:${issue.law}`,
      artefact_version: artefactVersion,
    });
  }
}

/**
 * Resolve prior appraise feedback: items still present stay rejected, stale
 * items are approved.
 */
function resolvePriorAppraise(ctx, consolidated, stageId) {
  const current = new Set(
    consolidated.map(i => `${i.file}:law:${i.law}`)
  );

  const priorItems = ctx.feedback.list({ source: stageId });

  for (const prior of priorItems) {
    if (prior.state === 'resolved') continue;
    const sig = `${prior.file}:${prior.tag}`;
    const decision = current.has(sig) ? 'rejected' : 'approved';
    ctx.feedback.resolve(prior.id, decision);
  }
}

/**
 * Build the summary string for consolidation.
 */
function buildConsolidateSummary(count) {
  if (count === 0) return 'No issues found by appraisers';

  return `${count} issue(s) found by appraisers`;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a subagent prompt for an appraiser.
 *
 * The prompt contains only the appraiser's personality and the artefact type
 * ID. The subagent discovers artefact files, laws, and file-patterns via tool
 * calls and returns JSONL — one JSON object per line.
 */
function buildAppraiserPrompt({ appraiser, typeId }) {
  const lines = [
    'You are an appraiser. Your personality:',
    '',
    appraiser.personality,
    '',
    `Evaluate artefacts of type "${typeId}" against applicable laws.`,
    '',
    'Use tools to discover context:',
    `- foundry_config_artefact_type with typeId "${typeId}" for file-patterns`,
    `- foundry_config_laws with typeId "${typeId}" for applicable laws (prose only)`,
    '- foundry_artefacts_list for changed files',
    '- Read matching files from the worktree',
    '',
    'For each law, evaluate each relevant file. If a violation is found,',
    'output a JSONL line:',
    '',
    '{"file": "<path>", "law": "<law-slug>", "text": "<issue description>", "evidence": "<quote>"}',
    '',
    '`file` and `text` are required. `law` and `evidence` are recommended.',
    'Optional fields `severity` and `location` are passed through unchanged.',
    '',
    'Output ONLY JSONL — one JSON object per line. No markdown, no commentary.',
    'If no issues are found, output nothing.',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function violation(details, affectedFiles) {
  return {
    action: 'violation',
    details,
    recoverable: false,
    affected_files: affectedFiles,
  };
}

/**
 * Safely coerce a value to an array, defaulting to empty array.
 */
function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * True when there were results but none succeeded.
 */
function allAppraisersFailed(results, successful) {
  return results.length > 0 && successful.length === 0;
}
