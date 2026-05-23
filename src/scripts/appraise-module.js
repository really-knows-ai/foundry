/**
 * Appraise module — gathers context for parallel appraiser dispatch and
 * consolidates results after all appraisers have run.
 *
 * Gather phase: reads artefacts, laws, and appraiser personalities, builds
 * subagent prompts, and returns a dispatch_multi action so the orchestrator's
 * LLM dispatches appraisers in parallel.
 *
 * Consolidate phase: receives lastResults from the orchestrator, unions and
 * de-duplicates appraiser issues, posts feedback, and finalises the stage
 * so the orchestrator can re-sort and determine the next action.
 */

import { getArtefactFiles } from './lib/artefacts.js';
import { selectAppraisers, getLaws, getCycleDefinition } from './lib/config.js';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Public API — gather
// ---------------------------------------------------------------------------

/**
 * Gather appraise context: read draft artefacts, select appraisers, read laws
 * and artefact content, then build a dispatch_multi action with one task per
 * (artefact, appraiser) pair.
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
  if (!ctx.cycleId) {
    return violation('cycleId is required', []);
  }

  const cd = await getCycleDefinition(ctx.foundryDir, ctx.cycleId, ctx.io);
  const outputType = cd.frontmatter['output-type'];
  if (!outputType) {
    return violation(`cycle ${ctx.cycleId} missing output-type field`, []);
  }
  const baseBranch = ctx.baseBranch || 'main';
  const artefacts = await getArtefactFiles(ctx.foundryDir, outputType, ctx.io, { baseBranch });
  if (artefacts.length === 0) {
    return emptyDispatch(ctx.cycleId);
  }

  const typedArtefacts = artefacts.map(artefact => ({ ...artefact, type: outputType }));
  const tasks = await collectTasks(typedArtefacts, ctx);

  return {
    action: 'dispatch_multi',
    tasks,
    stage: `appraise:${ctx.cycleId}`,
    cycle: ctx.cycleId,
  };
}

/**
 * Build all appraiser tasks across artefacts, caching per type.
 */
async function collectTasks(artefacts, ctx) {
  const tasks = [];
  const typeCache = new Map();

  for (const artefact of artefacts) {
    const entry = await resolveTypeEntry(artefact.type, typeCache, ctx);
    if (!entry) continue;

    addTasksForArtefact(tasks, artefact, entry, ctx);
  }

  return tasks;
}

/**
 * Get or create a cached (appraisers, laws) entry for an artefact type.
 * Returns null when no appraisers are available for the type.
 */
async function resolveTypeEntry(typeId, cache, ctx) {
  if (cache.has(typeId)) {
    return cache.get(typeId);
  }

  const [appraisers, laws] = await Promise.all([
    selectAppraisers(ctx.foundryDir, typeId, { io: ctx.io }),
    getLaws(ctx.foundryDir, ctx.io, { typeId }),
  ]);

  const entry = appraisers.length === 0 ? null : { appraisers, laws };
  cache.set(typeId, entry);
  return entry;
}

/**
 * Build and append appraiser tasks for a single artefact.
 */
function addTasksForArtefact(tasks, artefact, entry, ctx) {
  let content = '';
  if (artefact.state !== 'deleted') {
    content = ctx.io.readFile(artefact.file);
  }

  for (const appraiser of entry.appraisers) {
    const prompt = buildAppraiserPrompt({
      appraiser,
      artefact: { file: artefact.file, content },
      laws: entry.laws,
    });

    tasks.push({
      subagent_type: resolveSubagentType(appraiser, ctx),
      prompt,
    });
  }
}

/**
 * Map an appraiser's model to a subagent type string.
 */
function resolveSubagentType(appraiser, ctx) {
  const name = appraiser.model || ctx.defaultModel || 'general';
  if (name === 'general') return 'general';

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
 * Consolidate appraiser results after all subagents have run.
 *
 * Parses each successful output for structured issues, unions across
 * appraisers, de-duplicates by (file, law-id, issue text), posts feedback,
 * resolves stale prior appraise feedback, and finalises the stage.
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

  const consolidated = parseConsolidated(successful);
  const stageId = `appraise:${ctx.cycleId}`;

  postConsolidatedFeedback(ctx, consolidated);
  resolvePriorAppraise(ctx, consolidated, stageId);

  const summary = buildConsolidateSummary(consolidated.length);

  await ctx.finalize({
    lastStage: { stage: stageId, summary, baseSha },
    activeStage: ctx.activeStage,
  });

  return { ok: true, summary };
}

/**
 * Parse all successful appraiser outputs and de-duplicate the combined issue
 * list by (file, law-id, issue text).
 */
function parseConsolidated(successful) {
  const all = [];

  for (const result of successful) {
    const issues = parseAppraiserOutput(result.output || '');
    all.push(...issues);
  }

  return deduplicateIssues(all);
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
 * Post one feedback item per consolidated issue.
 */
function postConsolidatedFeedback(ctx, consolidated) {
  for (const issue of consolidated) {
    ctx.feedback.add({
      file: issue.file,
      text: issue.issue,
      tag: `law:${issue.law}`,
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
 * Build a subagent prompt for a single (appraiser, artefact) pair.
 *
 * Follows the template from the appraise skill (src/skills/appraise/SKILL.md)
 * extended to include the file path for deterministic result parsing.
 */
function buildAppraiserPrompt({ appraiser, artefact, laws }) {
  const lawSections = laws
    .map(law => `## ${law.id}\n\n${law.text}`)
    .join('\n\n');

  const lines = [
    'You are an appraiser. Your personality:',
    '',
    appraiser.personality,
    '',
    'Evaluate the following artefact against each law below. For each law,',
    'either:',
    '- Note no issues (pass)',
    '- Describe the issue, quoting evidence from the artefact',
    '',
    '## Artefact',
    '',
    artefact.content,
    '',
    '## Laws',
    '',
    lawSections,
    '',
    '## Output',
    '',
    'Return a list of issues. For each issue:',
    `- file: ${artefact.file}`,
    '  law: <law-id>',
    '  issue: <description>',
    '  evidence: <quote from artefact>',
    '',
    'If there are no issues, return an empty list.',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/**
 * Parse a structured issue list from an appraiser subagent output.
 *
 * LLM output is free-form text that may contain a YAML list of issues.
 * Tries js-yaml first; falls back to line-scanning when the output is
 * not clean YAML (LLMs may include surrounding text, quotes in bare
 * strings, or other quirks that trip up a strict YAML parser).
 *
 * Returns an array of { file, law, issue, evidence } objects.
 */
function parseAppraiserOutput(output) {
  const text = output || '';
  const yamlBlock = extractYamlBlock(text);
  const issues = tryYamlParse(yamlBlock);
  if (issues) return issues;

  return parseFallback(text);
}

function extractYamlBlock(text) {
  if (text.startsWith('- file:')) return text;
  const afterNewline = text.indexOf('\n- file:');
  if (afterNewline >= 0) return text.slice(afterNewline + 1);
  return text;
}

function tryYamlParse(yamlBlock) {
  try {
    const parsed = yaml.load(yamlBlock);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(e => e && typeof e === 'object' && e.file && e.law && e.issue)
        .map(e => ({ file: e.file, law: e.law, issue: e.issue, evidence: e.evidence || '' }));
    }
  } catch { /* fall through to fallback */ }
  return null;
}

const FALLBACK_FIELDS = new Set(['law', 'issue', 'evidence']);

function isCompleteIssue(obj) {
  return obj && obj.file && obj.law && obj.issue;
}

function applyFallbackField(kv, entry, issues) {
  if (kv.key === 'file') {
    const e = { file: kv.value, law: '', issue: '', evidence: '' };
    issues.push(e);
    return e;
  }
  if (entry && FALLBACK_FIELDS.has(kv.key)) {
    entry[kv.key] = kv.value;
  }
  return entry;
}

function parseFallback(text) {
  const issues = [];
  let entry = null;

  for (const line of text.split('\n')) {
    const kv = parseFallbackLine(line);
    if (kv) entry = applyFallbackField(kv, entry, issues);
  }

  return issues.filter(isCompleteIssue);
}

function parseFallbackLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const colon = trimmed.indexOf(':');
  if (colon < 1) return null;

  const key = stripDash(trimmed.slice(0, colon));
  return {
    key: key.trim(),
    value: trimmed.slice(colon + 1).trim(),
  };
}

function stripDash(s) {
  return s.startsWith('- ') ? s.slice(2) : s;
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
