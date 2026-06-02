/**
 * Appraise module — builds appraiser prompts and consolidates
 * stage-output files from appraiser subagents.
 *
 * Reads .jsonl files from the stage-outputs directory, parses
 * appraiser findings, de-duplicates issues, and builds subagent
 * prompts with personality and type ID.
 *
 * Each appraiser subagent discovers artefacts, laws, and file-patterns via
 * tool calls and reports violations by calling foundry_stage_output.
 */

import path from 'node:path';

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
 * Consolidate appraiser results and finalise the appraise stage.
 *
 * Called by orchestrator after all appraisers have completed. Parses JSONL
 * from each appraiser's output, posts combined feedback, resolves prior
 * appraise feedback, and advances the cycle to the next stage via finalize.
 *
 * @param {object} ctx
 * @param {Array<{ok: boolean, error?: string}>} lastResults
 * @returns {Promise<{ok: boolean, summary?: string}|violation>}
 */
async function readAppraiseStageOutputs(io) {
  try {
    const entries = await io.readDir('.foundry/stage-outputs');
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join('.foundry/stage-outputs', f));
  } catch {
    return [];
  }
}

function cleanupStageOutputFiles(filePaths, io) {
  for (const fp of filePaths) {
    try { io.unlink(fp); } catch (err) {
      if (err.code !== 'ENOENT') console.warn('appraise: failed to delete output file', fp, err.message);
    }
  }
}

/**
 * Read all .jsonl files from .foundry/stage-outputs/ and return parsed issues.
 * Exported for use by the plugin-driven appraise lifecycle.
 */
export async function readConsolidatedOutputs(io) {
  const filePaths = await readAppraiseStageOutputs(io);
  return parseConsolidated(filePaths, io);
}

/**
 * Export parseConsolidated for plugin-driven lifecycle.
 */
export { parseConsolidated, deduplicateIssues, buildAppraiserPrompt };

/**
 * Parse consolidated findings from stage output files and de-duplicate
 * the combined issue list by (file, law-id, issue text).
 *
 * Reads each file as JSONL (one JSON object per line), parses every line,
 * and collects appraiser findings. Invalid lines are skipped with a
 * warning, not a crash.
 *
 * @param {string[]} filePaths - Array of paths to .jsonl files
 * @param {object} io          - IO adapter with readFile
 * @returns {Array<{file: string, law: string, issue: string, evidence: string}>}
 */
function isValidIssue(obj) {
  return Boolean(obj) && typeof obj.file === 'string' && obj.file.length > 0 && typeof obj.text === 'string' && obj.text.length > 0;
}

function parseConsolidatedLine(line) {
  try {
    const obj = JSON.parse(line);
    if (!isValidIssue(obj)) return null;
    return {
      file: obj.file,
      law: typeof obj.law === 'string' ? obj.law : '',
      issue: obj.text,
      evidence: typeof obj.evidence === 'string' ? obj.evidence : '',
    };
  } catch {
    return null;
  }
}

function parseConsolidated(filePaths, io) {
  const all = [];
  for (const fp of filePaths) {
    let content;
    try { content = io.readFile(fp); } catch (err) {
      console.warn(`appraise: failed to read output file ${fp}:`, err.message);
      continue;
    }
    const lines = content.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const item = parseConsolidatedLine(line);
      if (item) all.push(item);
    }
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



// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a subagent prompt for an appraiser.
 *
 * The prompt contains only the appraiser's personality and the artefact type
 * ID. The subagent discovers artefact files, laws, and file-patterns via tool
 * calls and uses foundry_stage_output to report each violation.
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
    'For each violation, call `foundry_stage_output({ data: { file, law, text, evidence } })`.',
    '`file`, `law`, and `text` are required. `evidence` is recommended.',
    'Optional fields `severity` and `location` are passed through unchanged.',
    '',
    'If no issues, call no tool — produce no output. The system collects your findings from stage-output files.',
    'The stage lifecycle is managed by the orchestrator. Do NOT call foundry_stage_begin or foundry_stage_end.',
    'Do NOT write JSONL as text. Call the tool.',
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


