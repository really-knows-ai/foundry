import { execSync } from 'child_process';
import { createHash } from 'node:crypto';
import { readActiveStage, writeActiveStage, clearActiveStage, writeLastStage, clearLastStage } from '../../scripts/lib/state.js';
import { verifyToken } from '../../scripts/lib/token.js';
import { readOrCreateSecret } from '../../scripts/lib/secret.js';
import { getContext, invalidateStore } from '../../scripts/lib/memory/singleton.js';
import { syncStore } from '../../scripts/lib/memory/store.js';
import { makeIO, makeMemoryIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';
import { markWorkfileFailed, readFailedStatus, clearWorkfileFailed } from '../../scripts/lib/failed-flow.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { initForgeCallLog, verifyAndClearForgeCallLog } from '../../scripts/lib/stage-calls.js';
import { openFeedbackStore } from '../../scripts/lib/feedback-store.js';

const FORGE_REQUIRED_TOOLS = [
  'foundry_config_cycle',
  'foundry_workfile_get',
  'foundry_config_artefact_type',
  'foundry_config_laws',
];

function stageBase(stage) { return stage.split(':')[0]; }

const gateNotFailed = notFailedGuard(makeIO);

// -- Helpers for forge tool call verification --

function verifyAndManageForgeTools(io, active) {
  const verified = verifyAndClearForgeCallLog(io, FORGE_REQUIRED_TOOLS);
  if (!verified.ok) {
    postMissingToolsFeedback(io, active, verified.missing);
    return;
  }
  resolveSystemFeedback(io, active);
}

function resolveBaseSha(worktree) {
  try {
    return execSync('git rev-parse HEAD', { cwd: worktree }).toString().trim();
  } catch {
    return null;
  }
}

function verifyStageToken(token, secret, stage, cycle, agent) {
  const v = verifyToken(token, secret);
  if (!v.ok) return { error: `foundry_stage_begin: token ${v.reason}` };
  if (v.payload.route !== stage || v.payload.cycle !== cycle) {
    return { error: `foundry_stage_begin: token payload mismatch (route=${v.payload.route}, cycle=${v.payload.cycle})` };
  }
  return checkTokenAgentBinding(v.payload, agent);
}

function checkTokenAgentBinding(payload, agent) {
  if (!payload.model || !agent || payload.model === agent) return { payload };
  return { error: `foundry_stage_begin: token is scoped to subagent '${payload.model}', not '${agent}'. Dispatch forge via task(), not inline.` };
}

async function executeStageBegin(args, context, pending) {
  const io = makeIO(context.worktree);
  const secret = readOrCreateSecret(context.worktree);

  const current = readActiveStage(io);
  if (current) {
    return JSON.stringify({ error: `foundry_stage_begin requires no active stage; current: ${current.stage}` });
  }

  const tokenResult = verifyStageToken(args.token, secret, args.stage, args.cycle, context.agent);
  if (tokenResult.error) return JSON.stringify({ error: tokenResult.error });

  const baseSha = resolveBaseSha(context.worktree);
  if (!baseSha) {
    return JSON.stringify({ error: 'foundry_stage_begin: git rev-parse HEAD failed (no commits?)' });
  }

  const meta = pending.consume(tokenResult.payload.nonce);
  if (!meta) return JSON.stringify({ error: 'foundry_stage_begin: nonce not pending or already consumed' });

  const tokenHash = createHash('sha256').update(args.token).digest('hex');
  const active = {
    cycle: args.cycle,
    stage: args.stage,
    tokenHash,
    baseSha,
    startedAt: new Date().toISOString(),
  };
  writeActiveStage(io, active);
  initForgeIfApplicable(io, active.stage);
  return JSON.stringify({ ok: true, active });
}

function initForgeIfApplicable(io, stage) {
  if (stageBase(stage) === 'forge') initForgeCallLog(io);
}

// -- Helpers for foundry_stage_end --

function markWorkfileFailedSilently(io, msg) {
  try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone */ }
}

async function syncMemoryAtStageEnd(worktree) {
  const memIo = makeMemoryIO(worktree);
  const ctx = getContext(worktree);
  if (ctx && ctx.store) {
    await syncStore({ store: ctx.store, io: memIo });
  }
}

async function executeStageEnd(args, context) {
  const io = makeIO(context.worktree);
  const active = readActiveStage(io);
  if (!active) {
    return JSON.stringify({ error: 'foundry_stage_end requires active stage; current: none' });
  }

  if (stageBase(active.stage) === 'forge') {
    verifyAndManageForgeTools(io, active);
  }

  writeLastStage(io, {
    cycle: active.cycle,
    stage: active.stage,
    baseSha: active.baseSha,
    summary: args.summary,
  });
  clearActiveStage(io);

  try {
    await syncMemoryAtStageEnd(context.worktree);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const msg = `memory sync at stage end failed: ${detail}`;
    markWorkfileFailedSilently(io, msg);
    return JSON.stringify({ error: msg, flow_failed: true });
  }
  return JSON.stringify({ ok: true, summary: args.summary });
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

// -- Helpers for foundry_stage_retry --

function checkGitWorkingTreeClean(worktree) {
  try {
    const statusOut = execSync('git status --porcelain', { cwd: worktree }).toString();
    return statusOut.trim() === '' ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function executeStageRetry(_args, context) {
  const io = makeIO(context.worktree);

  const failed = readFailedStatus(io);
  if (!failed) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_stage_retry requires failed flow; current status is not failed',
    });
  }

  const active = readActiveStage(io);
  if (active) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_stage_retry requires no active stage; call foundry_stage_end first',
    });
  }

  const gitCheck = checkGitWorkingTreeClean(context.worktree);
  if (!gitCheck.ok) {
    return JSON.stringify({
      ok: false,
      error: 'foundry_stage_retry requires clean git working tree; commit or stash changes first',
    });
  }

  invalidateStore(context.worktree);

  try { clearLastStage(io); } catch { /* last-stage.json might not exist */ }

  clearWorkfileFailed(io);

  return JSON.stringify({
    ok: true,
    message: 'Flow unlocked. Memory state reset to disk. Stage can be re-run.',
  });
}

export function createStageTools({ tool, pending }) {
  return {
    foundry_stage_begin: tool({
      description: 'Open a subagent work stage; consumes a dispatch token from foundry_orchestrate.',
      args: {
        stage: tool.schema.string().describe('Stage alias, e.g. "forge:create-haiku"'),
        cycle: tool.schema.string().describe('Cycle name'),
        token: tool.schema.string().describe('Token received from foundry_orchestrate via the dispatch prompt'),
      },
      execute: guarded('foundry_stage_begin', [flowBranchGuard, gateNotFailed],
        (args, context) => executeStageBegin(args, context, pending),
        { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),

    foundry_stage_end: tool({
      description: 'Close the active subagent work stage; preserves baseSha for finalize.',
      args: {
        summary: tool.schema.string().describe('Short summary of the work done'),
      },
      execute: guarded('foundry_stage_end', [flowBranchGuard],
        executeStageEnd,
        { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),

    foundry_stage_retry: tool({
      description: 'Retry a failed stage by discarding uncommitted memory changes and clearing the failed state. Requires clean git working tree.',
      args: {},
      execute: guarded('foundry_stage_retry', [flowBranchGuard],
        executeStageRetry,
        { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
