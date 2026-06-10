import { openFeedbackStore } from '../../scripts/lib/feedback-store.js';
import { readForgeCallSet } from '../../scripts/lib/stage-calls.js';
import { verifyToken } from '../../scripts/lib/token.js';

export const FORGE_REQUIRED_TOOLS = [
  'foundry_config_read_cycle',
  'foundry_workfile_get',
  'foundry_config_read_artefact_type',
  'foundry_config_read_laws',
];

function describeTokenError(reason) {
  if (reason === 'bad_signature') return `token was copied incorrectly — re-read it from the dispatch prompt exactly, character-by-character. The token must match what foundry_cycle_run gave you`;
  if (reason === 'malformed') return `token is garbled — re-read it from the dispatch prompt. The token is the long string after "Token: " in the orchestrate dispatch`;
  if (reason === 'expired') return `token expired — this dispatch is stale. Call foundry_cycle_run({lastResult: {ok: false, error: "timed out"}}) to get a fresh dispatch`;
  return `token ${reason}`;
}

export function verifyStageToken(token, secret, stage, cycle, agent) {
  const v = verifyToken(token, secret);
  if (!v.ok) return { error: `foundry_stage_begin: ${describeTokenError(v.reason)}`, fatal: true };
  if (v.payload.route !== stage || v.payload.cycle !== cycle) {
    return { error: `foundry_stage_begin: token is for stage "${v.payload.route}" cycle "${v.payload.cycle}", but you called it with stage "${stage}" cycle "${cycle}". Use the token from the dispatch prompt — it already matches the right stage`, fatal: false };
  }
  return checkTokenAgentBinding(v.payload, agent);
}

function checkTokenAgentBinding(payload, agent) {
  if (!payload.model) return { payload };
  if (!agent) return { payload };
  if (agent === 'foundry') {
    return { error: `foundry_stage_begin: this token is meant for a task subagent (${payload.model}), not for you to call directly. Create a child session via the SDK and prompt it with the dispatch instructions, and let the subagent call foundry_stage_begin`, fatal: false };
  }
  return { payload };
}

export function readDispatchToken(io) {
  const tokenPath = '.foundry/dispatch-token';
  if (!io.exists(tokenPath)) {
    return { error: 'foundry_stage_begin: no dispatch token found.' };
  }
  return { token: io.readFile(tokenPath).trim() };
}

export function verifyAndManageForgeTools(io, active) {
  const callSet = readForgeCallSet(io);
  const missing = FORGE_REQUIRED_TOOLS.filter(t => !callSet.has(t));
  io.unlink('.foundry/.forge-tool-calls.jsonl');
  if (missing.length) {
    postMissingToolsFeedback(io, active, missing);
    return;
  }
  resolveSystemFeedback(io, active);
}

function postForbiddenToolsFeedback(io, active, forbidden) {
  try {
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    store.add({
      file: '(forge)',
      tag: 'system:forbidden-tool-calls',
      text: `Forbidden forge tool calls: ${forbidden.join(', ')}. Forge subagents do not manage feedback — the orchestrator handles transitions.`,
      source: active.stage,
      cycle: active.cycle,
    });
  } catch { /* feedback file not initialised yet; non-critical */ }
}

function postMissingToolsFeedback(io, active, missing) {
  try {
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    store.add({
      file: '(forge)',
      tag: 'system:missing-tool-calls',
      text: `Missing required forge tools: ${missing.join(', ')}`,
      source: active.stage,
      cycle: active.cycle,
    });
  } catch { /* feedback file not initialised yet; non-critical */ }
}

function resolveSystemFeedback(io, active) {
  try {
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    store.resolveSystemItems(active.stage, active.cycle);
  } catch { /* non-critical */ }
}
