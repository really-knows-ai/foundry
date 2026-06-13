/**
 * Assay stage executor — SDK dispatch, extractor execution, issue collection.
 *
 * Called by the run state machine when sort routes to an assay stage.
 * Re-exported via run-executors.js for use by run.js.
 */

import { assayDispatch } from './lib/assay-dispatch.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { appendEntry } from './lib/history.js';
import { getCycleDefinition } from './lib/config.js';
import { appendAssayAttestation } from './lib/attestation/executor-attestation.js';

// ---------------------------------------------------------------------------
// Local utilities (each executor module carries its own copies)
// ---------------------------------------------------------------------------

function cycleIdFrom(cycleId, sort) {
  return sort.cycleId || cycleId || (sort.route ? sort.route.split(':')[1] : null);
}

async function readCfm(cycleId, io) {
  const def = await getCycleDefinition('foundry', cycleId, io);
  return def.frontmatter || {};
}

// ---------------------------------------------------------------------------
// Extractor helpers
// ---------------------------------------------------------------------------

async function loadExtractorByName(name, io) {
  const mod = await import('./lib/assay/loader.js');
  return mod.loadExtractor('foundry', name, io).catch(function() { return null; });
}

function runExtractorAndGetOutput(extractor, io, artefacts) {
  return extractor.run({ io, artefacts }).catch(function() { return null; });
}

const hasValidOutput = o => o && o.issues;

function processExtractorIssues(name, output, store, cycleId, issues) {
  for (const issue of output.issues) {
    store.add({
      file: issue.file || '', tag: 'extractor:' + name,
      text: issue.text || issue.message || 'extractor issue',
      source: 'system:assay-' + cycleId, artefact_version: '', cycle: cycleId,
    });
    issues.push(issue);
  }
}

async function runAllExtractors(extractors, eOpts) {
  for (const ex of extractors) await run1Extractor(ex, eOpts);
}

function getAssayExtractors(cfm) {
  return (cfm.assay && cfm.assay.extractors) || [];
}

function buildAssaySummary(issues, cycleId, stage, historyPath, io) {
  const summary = issues.length > 0 ? 'assay: ' + issues.length + ' issue(s)' : 'assay: completed';
  appendEntry(historyPath, { cycle: cycleId, stage, iteration: 1, comment: summary }, io);
  return { ok: true, summary };
}

// ---------------------------------------------------------------------------
// executeAssay
// ---------------------------------------------------------------------------

async function run1Extractor(name, eOpts) {
  const { io, artefacts, store, cycleId, issues } = eOpts;
  const extractor = await loadExtractorByName(name, io);
  if (!extractor || !extractor.run) return;

  const output = await runExtractorAndGetOutput(extractor, io, artefacts);
  if (!hasValidOutput(output)) return;

  processExtractorIssues(name, output, store, cycleId, issues);
}

function processAssayStageOutput(stageOutputLines, store, cycleId) {
  const issues = [];
  for (const line of stageOutputLines) {
    if (line.extractor && line.issues) {
      processExtractorIssues(line.extractor, line, store, cycleId, issues);
    }
  }
  return issues;
}

/** Execute an assay stage. */
export async function executeAssay(assayOpts) {
  const { sort, io, worktree, historyPath, feedbackPath } = assayOpts;
  const cwd2 = assayOpts.cwd;

  const cycleId = cycleIdFrom(assayOpts.cycleId, sort);
  if (!cycleId) {
    appendAssayAttestation(io, null, [], null, 1);
    return { ok: false, error: 'executeAssay: no cycleId in sort result' };
  }

  const cfm = await readCfm(cycleId, io).catch(function() { return null; });
  if (!cfm) {
    appendAssayAttestation(io, cycleId, [], null, 1);
    return { ok: false, error: 'executeAssay: cycle ' + cycleId + ' not found' };
  }

  const extractors = getAssayExtractors(cfm);

  const promptContext = {
    stage: sort.route, cycle: cycleId, token: sort.token || '',
    cwd: cwd2, extractors,
  };

  const dispatch = await assayDispatch({
    sort, io, worktree, cycleId, dispatchPrompt: promptContext,
  });
  if (dispatch.error) {
    appendAssayAttestation(io, cycleId, [], null, 1);
    return { ok: false, error: dispatch.error };
  }

  const store = openFeedbackStore(feedbackPath, io);
  const issues = processAssayStageOutput(dispatch.stageOutputLines, store, cycleId);

  const result = buildAssaySummary(issues, cycleId, sort.route, historyPath, io);

  appendAssayAttestation(io, cycleId, issues, store);
  return result;
}
