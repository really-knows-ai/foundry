/**
 * Quench stage executor — validator dispatch, violation collection.
 *
 * Called by the run state machine when sort routes to a quench stage.
 * Re-exported via run-executors.js for use by run.js.
 */

import { getArtefactFiles, computeArtefactVersion } from './lib/artefacts.js';
import { appendEntry, getIteration } from './lib/history.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { resolveStaleFeedback } from './quench-module.js';
import { spawnWithTimeout } from './lib/assay/spawn-with-timeout.js';
import { readActiveStage } from './lib/state.js';
import { getCycleDefinition, getLawsForQuench } from './lib/config.js';
import { appendQuenchAttestation } from './lib/attestation/executor-attestation.js';

const QUILL_TIMEOUT_MS = 60_000;
const MAX_QUILL_TIMEOUT_MS = 600_000;

function cycleIdFrom(cycleId, sort) {
  return sort.cycleId || cycleId || (sort.route ? sort.route.split(':')[1] : null);
}

async function readCfm(cycleId, io) {
  const def = await getCycleDefinition('foundry', cycleId, io);
  return def.frontmatter || {};
}

async function makeArtefactVersion(io, outputType, cwd) {
  const result = await computeArtefactVersion('foundry', outputType, io, cwd).catch(function() { return undefined; });
  return result;
}

function tryParseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function buildValidatorCommand(validator, artefact) {
  const path = typeof artefact === 'string' ? artefact : (artefact.file || '');
  return validator.command + ' ' + path;
}

function computeValidatorTimeout(validator) {
  return Math.min((validator.timeout || QUILL_TIMEOUT_MS), MAX_QUILL_TIMEOUT_MS);
}

const isValidatorFailure = r => !r.ok || r.timedOut || r.tooMuchOutput;

function failText(validator, result, timeoutMs) {
  if (result.timedOut) return 'validator ' + validator.id + ' timed out after ' + timeoutMs + 'ms';
  if (result.tooMuchOutput) return 'validator ' + validator.id + ' exceeded output limit';
  return 'validator ' + validator.id + ' failed (exit code: ' + result.exitCode + ')';
}

function handleValidatorFailure(result, validator, timeoutMs, opts) {
  const text = failText(validator, result, timeoutMs);
  pushQuenchFeedback({ ...opts, validator, text, cId: opts.cycleId });
  opts.feedbackList.push(text);
}

function processParsedLine(parsed, opts) {
  if (!parsed) return;
  const text = parsed.text || parsed.message || 'violation';
  pushQuenchFeedback({ ...opts, text, cId: opts.cycleId });
  opts.feedbackList.push(text);
}

function processValidatorOutputs(result, opts) {
  if (!result.stdout || !result.stdout.trim()) return;
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  for (let li = 0; li < lines.length; li++) {
    processParsedLine(tryParseJson(lines[li]), opts);
  }
}

function pushQuenchFeedback(opts) {
  const { store, validator, artefact, text, aVersion, cId } = opts;
  store.add({
    file: typeof artefact === 'string' ? artefact : (artefact.file || ''),
    tag: 'validator:' + validator.id,
    text: text,
    source: 'quench:' + cId,
    artefact_version: aVersion || '',
    cycle: cId,
  });
}

async function run1Validator(validator, artefact, vOpts) {
  const { store, cycleId, aVersion, cwd, worktree, feedbackList } = vOpts;
  const command = buildValidatorCommand(validator, artefact);
  const timeoutMs = computeValidatorTimeout(validator);
  const result = await spawnWithTimeout({ command, cwd: worktree || cwd, timeoutMs, env: process.env })
    .catch(function() {
      return { ok: false, timedOut: false, stdout: '', stderr: 'internal error', tooMuchOutput: false };
    });

  if (isValidatorFailure(result)) {
    handleValidatorFailure(result, validator, timeoutMs, {
      store, artefact, aVersion, cycleId, feedbackList,
    });
    return;
  }

  processValidatorOutputs(result, { store, validator, artefact, aVersion, cycleId, feedbackList });
}

async function discoverQuenchArtefacts(io, outputType) {
  return getArtefactFiles('foundry', outputType, io, { baseBranch: 'main' }).catch(function(err) {
    return null;
  });
}

async function resolveQuenchCycle(cycleId, io) {
  const cfm = await readCfm(cycleId, io).catch(function() { return null; });
  if (!cfm) return { error: { ok: false, error: 'executeQuench: cycle ' + cycleId + ' not found' } };
  const outputType = cfm['output-type'];
  if (!outputType) return { error: { ok: false, error: 'executeQuench: cycle ' + cycleId + ' has no output-type' } };
  return { cfm, outputType };
}

async function resolveQuenchFeedbackStore(io, outputType, cwd, feedbackPath, cycleId) {
  const store = openFeedbackStore(feedbackPath, io);
  const aVersion = await makeArtefactVersion(io, outputType, cwd);
  if (aVersion) {
    resolveStaleFeedback(store.list(), aVersion, 'quench', store, cycleId).catch(() => undefined);
  }
  return { store, aVersion };
}

async function resolveQuenchValidators(io, outputType) {
  const laws = await getLawsForQuench('foundry', io, { typeId: outputType }).catch(function() { return []; });
  return laws.flatMap(l => l.validators || []);
}

async function resolveQuenchArtefacts(io, outputType) {
  return (await discoverQuenchArtefacts(io, outputType)) || [];
}

async function runValidatorsForArtefacts(validators, artefacts, vOpts) {
  for (let vi = 0; vi < validators.length; vi++) {
    for (let ai = 0; ai < artefacts.length; ai++) {
      await run1Validator(validators[vi], artefacts[ai], vOpts);
    }
  }
}

function buildQuenchSummary(feedbackList, cycleId, stage, historyPath, io) {
  const summary = feedbackList.length > 0 ? 'quench: ' + feedbackList.length + ' violation(s)' : 'quench: passed';
  appendEntry(historyPath, { cycle: cycleId, stage, iteration: 1, comment: summary }, io);
  return { ok: true, summary };
}

/** Early-return helper: no artefacts found. */
function quenchNoArtefacts(io, cycleId, historyPath, stage) {
  appendEntry(historyPath, { cycle: cycleId, stage, iteration: 1, comment: 'quench: no artefacts' }, io);
  appendQuenchAttestation(io, cycleId, getIteration(historyPath, cycleId, io) || 1, { artefact_hashes: [] });
  return { ok: true, summary: 'SKIP: no artefacts' };
}

/** Early-return helper: no validators found. */
function quenchNoValidators(io, cycleId, opts) {
  const { aVersion, outputType, historyPath, stage } = opts;
  appendEntry(historyPath, { cycle: cycleId, stage, iteration: 1, comment: 'quench: no validators' }, io);
  appendQuenchAttestation(io, cycleId, getIteration(historyPath, cycleId, io) || 1, {
    artefact_hashes: aVersion ? [{ path: outputType, hash: aVersion }] : [],
  });
  return { ok: true, summary: 'SKIP: no validators' };
}

/**
 * Resolve quench context: validate cycleId, resolve cycle definition.
 * Returns the resolved context or calls appendQuenchAttestation and returns an error result.
 */
async function resolveQuenchContext(quenchOpts) {
  const { sort, io, historyPath } = quenchOpts;
  const cycleId = cycleIdFrom(quenchOpts.cycleId, sort);

  if (!cycleId) {
    appendQuenchAttestation(io, cycleId, getIteration(historyPath, cycleId, io) || 1, {}, 1);
    return { error: { ok: false, error: 'executeQuench: no cycleId in sort result' } };
  }

  readActiveStage(io);

  const cycleResolved = await resolveQuenchCycle(cycleId, io);
  if (cycleResolved.error) {
    appendQuenchAttestation(io, cycleId, getIteration(historyPath, cycleId, io) || 1, {}, 1);
    return { error: cycleResolved.error };
  }

  return { cycleId, cycleResolved };
}

/** Execute a quench stage. */
export async function executeQuench(quenchOpts) {
  const { sort, io, worktree, historyPath, feedbackPath } = quenchOpts;
  const cwd = quenchOpts.cwd;

  const resolved = await resolveQuenchContext(quenchOpts);
  if (resolved.error) return resolved.error;
  const { cycleId, cycleResolved } = resolved;

  const fbResult = await resolveQuenchFeedbackStore(
    io, cycleResolved.outputType, cwd, feedbackPath, cycleId,
  );
  const { store, aVersion } = fbResult;
  const artefacts = await resolveQuenchArtefacts(io, cycleResolved.outputType);
  if (artefacts.length === 0) {
    return quenchNoArtefacts(io, cycleId, historyPath, sort.route);
  }

  const validators = await resolveQuenchValidators(io, cycleResolved.outputType);
  if (validators.length === 0) {
    return quenchNoValidators(io, cycleId, {
      aVersion, outputType: cycleResolved.outputType,
      historyPath, stage: sort.route,
    });
  }

  const feedbackList = [];
  const vOpts = { store, cycleId, aVersion, cwd, worktree, feedbackList };
  await runValidatorsForArtefacts(validators, artefacts, vOpts);

  const result = buildQuenchSummary(feedbackList, cycleId, sort.route, historyPath, io);

  const quenchIteration = getIteration(historyPath, cycleId, io) || 1;
  appendQuenchAttestation(io, cycleId, quenchIteration, {
    aVersion, outputType: cycleResolved.outputType, store, feedbackList,
  });
  return result;
}
