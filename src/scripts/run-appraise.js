/**
 * Appraise stage executor — SDK dispatch, stage-output collection, consolidation.
 *
 * Called by the run state machine when sort routes to an appraise stage.
 */

import { getArtefactFiles, computeArtefactVersion } from './lib/artefacts.js';
import { appendEntry } from './lib/history.js';
import { openFeedbackStore } from './lib/feedback-store.js';
import { writeActiveStage, clearActiveStage, writeLastStage } from './lib/state.js';
import { parseConsolidated } from './appraise-module.js';
import { resolveGroupConfig } from './lib/group-config.js';
import { buildDispatch } from './lib/evaluation-units.js';

import { parseModelId } from './lib/parse-model-id.js';
import { getCycleDefinition, getLaws, getAppraisers, getFlow, getArtefactType } from './lib/config.js';

import { writePromptFile as _writePromptFile, spawnDispatch as _spawnDispatch, awaitProcess as _awaitProcess, withCleanup as _withCleanup } from './lib/dispatch-cli.js';
import { dispatchAppraisePrompt, batchAppraiseDispatch, checkAppraiseDispatchFailure } from './lib/appraise-dispatch.js';
import { tryAppraiseAddress, buildAddressDispatchFn } from './appraise-address.js';

function resolveBaseSha(io) {
  try {
    return io.exec(['git', 'rev-parse', 'HEAD']).toString().trim();
  } catch {
    return 'unknown';
  }
}

function resolveAppraiseModel(appraiser, cfm) {
  const modelStr = appraiser.model || (cfm.models && cfm.models.appraise) || null;
  if (!modelStr) return undefined;
  return parseModelId(modelStr);
}

function cleanStageOutputDir(io) {
  const outDir = '.foundry/stage-outputs/';
  if (io.exists(outDir)) {
    for (const f of io.readDir(outDir)) {
      io.unlink(outDir + f);
    }
  }
  io.mkdir(outDir);
}

async function readCfm(cycleId, io) {
  const def = await getCycleDefinition('foundry', cycleId, io);
  return def.frontmatter || {};
}

async function cycleIdFrom(cycleId, sort) {
  return sort.cycleId || cycleId || (sort.route ? sort.route.split(':')[1] : null);
}
export { resolveAppraiseModel, cleanStageOutputDir };

export { partitionLawsByGroup, resolveGroupConfigs, recordToUnitId, buildCompletionCoverage, writeCoverageFile };

export { dispatchAppraisePrompt, batchAppraiseDispatch };

// Catch-only helpers to reduce cyclomatic complexity in executeAppraise
function catchEmptyArray() { return []; }
function catchEmptyFlow() { return { frontmatter: {} }; }

// Extract injectable dispatch helpers from apprOpts with defaults
function extractDispatchHelpers(apprOpts) {
  return {
    writePromptFile: apprOpts.writePromptFile || _writePromptFile,
    spawnDispatch: apprOpts.spawnDispatch || _spawnDispatch,
    awaitProcess: apprOpts.awaitProcess || _awaitProcess,
    withCleanup: apprOpts.withCleanup || _withCleanup,
  };
}

// ---------------------------------------------------------------------------
// Stage lifecycle
// ---------------------------------------------------------------------------

async function setupAppraiseStage(apprOpts) {
  const { io } = apprOpts;
  const sort = apprOpts.sort;
  const cycleId = await cycleIdFrom(apprOpts.cycleId, sort);
  if (!cycleId) return { error: 'executeAppraise: no cycleId in sort result' };

  const cfm = await readCfm(cycleId, io).catch(function() { return null; });
  if (!cfm) return { error: 'executeAppraise: cycle ' + cycleId + ' not found' };

  const outputType = cfm['output-type'];
  if (!outputType) return { error: 'executeAppraise: cycle ' + cycleId + ' has no output-type' };

  const tokenHash = 'plugin-' + Date.now() + '-' + String(Date.now() % 0x1000000).padStart(6, '0');
  const baseSha = resolveBaseSha(io);
  writeActiveStage(io, {
    cycle: cycleId, stage: 'appraise:' + cycleId,
    baseSha: baseSha, tokenHash: tokenHash,
    startedAt: new Date().toISOString(),
  });

  cleanStageOutputDir(io);
  return { tokenHash, baseSha, cycleId, outputType, cfm };
}

function emptyAppraiseResult(io, cycleId, baseSha, historyPath, reason) {
  clearActiveStage(io);
  writeLastStage(io, { cycle: cycleId, stage: 'appraise:' + cycleId, baseSha: baseSha, summary: reason });
  appendEntry(historyPath, { cycle: cycleId, stage: 'appraise:' + cycleId, iteration: 1, comment: 'appraise: ' + reason }, io);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 08 helpers — law-group fan-out
// ---------------------------------------------------------------------------

/**
 * Partition an array of law objects by their group field.
 * Laws without a group are placed under the key "default".
 * @param {{id:string,text:string,group?:string}[]} laws
 * @returns {Map<string,{id:string,text:string,group:string}[]>}
 */
function partitionLawsByGroup(laws) {
  const groups = new Map();
  for (const law of laws) {
    const key = law.group || 'default';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(law);
  }
  return groups;
}

/**
 * Resolve effective config for every distinct law group.
 * Calls resolveGroupConfig for each group and collects warnings.
 * @param {string[]} groupNames
 * @param {object|null} flowGroups
 * @param {object|null} typeAppraisers
 * @param {{id:string}[]} fullAppraiserPool
 * @param {string} [artefactTypeId]
 * @returns {{configs:Map, warnings:string[]}}
 */
function resolveGroupConfigs(groupNames, flowGroups, typeAppraisers, fullAppraiserPool, artefactTypeId) {
  const configs = new Map();
  const warnings = [];
  for (const name of groupNames) {
    const resolved = resolveGroupConfig(name, flowGroups, typeAppraisers, fullAppraiserPool, artefactTypeId);
    warnings.push(...resolved.warnings);
    configs.set(name, { mode: resolved.mode, passes: resolved.passes, appraisers: resolved.appraisers });
  }
  return { configs, warnings };
}


function readAppraiseStageOutputs(io) {
  const outDir = '.foundry/stage-outputs/';
  if (!io.exists(outDir)) return [];
  return io.readDir(outDir)
    .filter(function(f) { return f.endsWith('.jsonl'); })
    .map(function(f) { return outDir + f; });
}

function postConsolidatedFeedback(store, consolidated, av, stage, cycleId) {
  for (const issue of consolidated) {
    store.add({
      file: issue.file, tag: 'law:' + issue.law, text: issue.issue,
      source: stage, cycle: cycleId, artefact_version: av,
    });
  }
}

function isAppraiseItem(prior) {
  if (typeof prior.source !== 'string') return false;
  return prior.source.split(':')[0] === 'appraise';
}

function isNotResolvedFeedback(prior) {
  return !(prior.history && prior.history[0] && prior.history[0].state === 'resolved');
}

function resolveAppraiseStaleFeedback(store, cycleId) {
  for (const item of store.list()) {
    if (!isAppraiseItem(item)) continue;
    if (!isNotResolvedFeedback(item)) continue;
    store.autoResolve({ id: item.id, reason: 'superseded by re-appraisal', cycle: cycleId });
  }
}

function cleanupStageOutputFiles(filePaths, io) {
  for (const fp of filePaths) {
    try { io.unlink(fp); } catch (err) { if (err.code !== 'ENOENT') console.warn('appraise: failed to delete output file', fp, err.message); }
  }
}

function recordAppraiseHistory(opts) {
  const { historyPath, cycleId, summary, rejected, io } = opts;
  const stage = 'appraise:' + cycleId;
  appendEntry(historyPath, { cycle: cycleId, stage, iteration: 1, comment: summary || 'appraise: completed' }, io);
  if (rejected.length > 0) {
    appendEntry(historyPath, {
      cycle: cycleId, stage, iteration: 1,
      comment: 'appraise: ' + rejected.length + ' appraiser(s) failed',
    }, io);
  }
}

/**
 * Find the unit in law-by-law mode whose lawIds include the given law.
 * @param {{lawIds:string[]}[]} units
 * @param {{law:string}} record
 * @returns {string|undefined}
 */
function findLawUnit(units, record) {
  for (const unit of units) {
    if (unit.lawIds && unit.lawIds.includes(record.law)) {
      return unit.unitId;
    }
  }
  return undefined;
}

/**
 * Map a violation record to the unitId of the evaluation unit that produced it.
 * Bundle mode maps all violations to the single bundle unit.
 * Law-by-law mode finds the unit whose lawIds include the record's law.
 * @param {{group:string,law:string}} record
 * @param {Map<string,{unitId:string,mode:string,lawIds:string[]}[]>} unitsByGroup
 * @returns {string|undefined}
 */
function recordToUnitId(record, unitsByGroup) {
  const units = unitsByGroup.get(record.group);
  if (!units || units.length === 0) return undefined;
  if (units.length === 1 && units[0].mode === 'bundle') return units[0].unitId;
  return findLawUnit(units, record);
}

/**
 * Safely parse a JSON line, returning null on failure.
 */
function tryParseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/**
 * Count violations from stage-output file content and attribute to units.
 */
function countViolationsInContent(content, unitsByGroup, coverage) {
  for (const line of content.trim().split('\n').filter(Boolean)) {
    const record = tryParseLine(line);
    if (!record) continue;
    const unitId = recordToUnitId(record, unitsByGroup);
    if (unitId && coverage.has(unitId)) {
      coverage.get(unitId).violations++;
    }
  }
}

/**
 * Count violations from stage-output files, grouping by evaluation unit.
 */
function countViolationsFromFiles(filePaths, io, unitsByGroup, coverage) {
  for (const fp of filePaths) {
    let content;
    try { content = io.readFile(fp); } catch { continue; }
    countViolationsInContent(content, unitsByGroup, coverage);
  }
}

/**
 * Build per-unit completion coverage from dispatch results and stage outputs.
 * The violations-only protocol: the executor records completions, not verdicts.
 * A fulfilled dispatch is a completed evaluation; a rejected dispatch is uncompleted.
 * @param {object[]} dispatchMatrix
 * @param {PromiseSettledResult[]} settled
 * @param {string[]} filePaths
 * @param {object} io
 * @param {Map<string,{unitId:string,mode:string,lawIds:string[]}[]>} unitsByGroup
 * @returns {Map<string,{
 *   unitId:string,group:string,mode:string,law:string|null,
 *   evaluations:object[],violations:number
 * }>}
 */
function buildCompletionCoverage(dispatchMatrix, settled, filePaths, io, unitsByGroup) {
  const coverage = new Map();

  dispatchMatrix.forEach(function(entry, i) {
    const result = settled[i];
    const unitId = entry.unit.unitId;

    if (!coverage.has(unitId)) {
      coverage.set(unitId, {
        unitId: unitId,
        group: entry.group,
        mode: entry.unit.mode,
        law: entry.unit.mode === 'law-by-law' ? (entry.unit.lawIds?.[0] || null) : null,
        evaluations: [],
        violations: 0,
      });
    }

    coverage.get(unitId).evaluations.push({
      appraiser: entry.appraiser.id,
      pass: entry.pass,
      completed: result.status === 'fulfilled',
    });
  });

  countViolationsFromFiles(filePaths, io, unitsByGroup, coverage);

  return coverage;
}

/**
 * Serialise coverage data to a JSON file for the attestation tool.
 * Writes a sorted JSON array of coverage entries to foundry/.stage/.coverage-<cycleId>.json.
 */
function writeCoverageFile(io, coverage, cycleId) {
  const entries = [...coverage.entries()]
    .sort(function(a, b) { return a[0].localeCompare(b[0]); })
    .map(function([unitId, entry]) {
      return { unitId: unitId, ...entry };
    });
  const json = JSON.stringify(entries, null, 2) + '\n';
  io.writeFile('foundry/.stage/.coverage-' + cycleId + '.json', json);
}

/**
 * Extract flow-level groups and artefact-type appraiser config.
 * Flow groups come from the flow definition; appraisers come from the
 * artefact-type definition file.
 */
async function extractGroupsAndAppraisers(flowDef, cfm, outputType, io, foundryDir) {
  let typeAppraisers = null;
  try {
    const artefactType = await getArtefactType(foundryDir, outputType, io);
    typeAppraisers = artefactType.frontmatter?.appraisers || null;
  } catch (err) {
    console.warn('appraise:', err.message);
  }
  return {
    flowGroups: flowDef.frontmatter['law-groups'] || {},
    typeAppraisers,
  };
}

/**
 * Post-process appraise results: consolidate, post feedback, build coverage,
 * persist coverage, close stage, record history.
 */
async function postProcessAppraise(opts) {
  const {
    io, dispatchMatrix, settled, unitsByGroup, feedbackPath, cycleId,
    foundryDir, outputType, worktree, historyPath, baseSha,
  } = opts;
  const filePaths = readAppraiseStageOutputs(io);
  const failures = parseConsolidated(filePaths, io);
  const store = openFeedbackStore(feedbackPath, io);
  const stage = 'appraise:' + cycleId;
  const av = await computeArtefactVersion(foundryDir, outputType, io, worktree)
    .catch(function() { return undefined; });
  postConsolidatedFeedback(store, failures, av, stage, cycleId);
  resolveAppraiseStaleFeedback(store, cycleId);
  const coverage = buildCompletionCoverage(dispatchMatrix, settled, filePaths, io, unitsByGroup);
  writeCoverageFile(io, coverage, cycleId);
  const summary = failures.length === 0 ? 'No issues found' : 'actioned:' + failures.length;
  writeLastStage(io, { cycle: cycleId, stage, baseSha, summary });
  clearActiveStage(io);
  recordAppraiseHistory({
    historyPath, cycleId, summary,
    rejected: settled.filter(function(r) { return r.status === 'rejected'; }), io,
  });
  return coverage;
}

/**
 * Execute an appraise stage.
 *
 * Lifecycle: stage_begin, collect and partition laws, resolve group configs,
 * build dispatch matrix, parallel dispatch via scoped sessions, consolidate,
 * post feedback, build per-unit coverage, persist coverage for attestation,
 * close stage, record history.
 */
async function prepareAppraiseContext(apprOpts) {
  const { io, historyPath } = apprOpts;
  const setup = await setupAppraiseStage(apprOpts);
  if (setup.error) return { error: setup.error };
  const { baseSha, cycleId, outputType, cfm } = setup;
  const foundryDir = 'foundry';

  const laws = await getLaws(foundryDir, io, { typeId: outputType }).catch(catchEmptyArray);
  if (laws.length === 0) return emptyAppraiseResult(io, cycleId, baseSha, historyPath, 'no laws');

  const lawGroups = partitionLawsByGroup(laws);
  const fullAppraiserPool = await getAppraisers(foundryDir, io).catch(catchEmptyArray);
  const flowDef = await getFlow(foundryDir, cfm['flow-id'], io).catch(catchEmptyFlow);

  const artefacts = await getArtefactFiles(foundryDir, outputType, io, { baseBranch: 'main' }).catch(catchEmptyArray);
  if (artefacts.length === 0) return emptyAppraiseResult(io, cycleId, baseSha, historyPath, 'no artefacts');

  const { flowGroups, typeAppraisers } = await extractGroupsAndAppraisers(flowDef, cfm, outputType, io, foundryDir);
  const { configs, warnings } = resolveGroupConfigs(
    [...lawGroups.keys()], flowGroups, typeAppraisers, fullAppraiserPool, outputType
  );
  warnings.forEach(function(w) { console.warn('appraise:', w); });

  const { unitsByGroup, dispatchMatrix } = buildDispatch(lawGroups, configs);
  if (dispatchMatrix.length === 0) return emptyAppraiseResult(io, cycleId, baseSha, historyPath, 'no dispatch entries');

  return { baseSha, cycleId, outputType, foundryDir, io, unitsByGroup, dispatchMatrix, lawGroups };
}

/**
 * Run the standard artefact-evaluation appraise pipeline.
 * Called when there are no addressed feedback items to process.
 */
async function executeStandardAppraise(apprOpts) {
  const { writePromptFile, spawnDispatch, awaitProcess, withCleanup } = extractDispatchHelpers(apprOpts);
  const { io, worktree, historyPath, feedbackPath } = apprOpts;

  const ctx = await prepareAppraiseContext(apprOpts);
  if (ctx.ok) return ctx;
  if (ctx.error) return { ok: false, error: ctx.error };
  const { baseSha, cycleId, outputType, foundryDir, unitsByGroup, dispatchMatrix } = ctx;

  const dispatchOpts = {
    io, worktree, lawGroups: ctx.lawGroups, outputType,
    writePromptFile, spawnDispatch, awaitProcess, withCleanup,
  };
  const settled = await batchAppraiseDispatch(dispatchMatrix, dispatchOpts);
  const dispatchError = checkAppraiseDispatchFailure(settled);
  if (dispatchError) return dispatchError;

  const coverage = await postProcessAppraise({
    io, dispatchMatrix, settled, unitsByGroup, feedbackPath, cycleId,
    foundryDir, outputType, worktree, historyPath, baseSha,
  });
  return { ok: true, coverage };
}

export async function executeAppraise(apprOpts) {
  const { io, feedbackPath } = apprOpts;

  const sort = apprOpts.sort;
  const earlyCycleId = await cycleIdFrom(apprOpts.cycleId, sort);
  if (!earlyCycleId) return { ok: false, error: 'executeAppraise: no cycleId in sort result' };

  const appraisers = await getAppraisers('foundry', io).catch(function() { return []; });
  const dispatchHelpers = extractDispatchHelpers(apprOpts);
  const addressDispatchFn = buildAddressDispatchFn(appraisers, dispatchHelpers, io, apprOpts.worktree);

  const addressResult = await tryAppraiseAddress(apprOpts, io, feedbackPath, earlyCycleId, addressDispatchFn);
  if (addressResult !== null) return addressResult;

  return await executeStandardAppraise(apprOpts);
}
