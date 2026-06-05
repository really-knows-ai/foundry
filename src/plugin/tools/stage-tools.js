import { execSync } from 'child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readActiveStage, writeActiveStage, clearActiveStage, writeLastStage, clearLastStage } from '../../scripts/lib/state.js';
import { readOrCreateSecret } from '../../scripts/lib/secret.js';
import { getContext, invalidateStore } from '../../scripts/lib/memory/singleton.js';
import { syncStore } from '../../scripts/lib/memory/store.js';
import { makeIO, makeMemoryIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';
import { markWorkfileFailed, readFailedStatus, clearWorkfileFailed } from '../../scripts/lib/failed-flow.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { initForgeCallLog } from '../../scripts/lib/stage-calls.js';
import { verifyStageToken, readDispatchToken, verifyAndManageForgeTools } from './stage-forge-helpers.js';
import { stageBaseOf } from '../../scripts/lib/stage-guard.js';

function ensureDir(io, outDir) {
  io.mkdir(outDir);
}

function contractError(stage, expected, got) {
  return `${stage} stage_end: expected exactly ${expected} stage_output call${expected === 1 ? '' : 's'}, got ${got}`;
}

function stageBase(stage) { return stage.split(':')[0]; }

const gateNotFailed = notFailedGuard(makeIO);

function resolveBaseSha(worktree) {
  try {
    return execSync('git rev-parse HEAD', { cwd: worktree }).toString().trim();
  } catch {
    return null;
  }
}

function deleteDispatchToken(io, tokenFile) {
  const p = tokenFile ? `.foundry/tokens/${tokenFile}` : '.foundry/dispatch-token';
  if (io.exists(p)) io.unlink(p);
}

function beginTokenStage({ token, secret, stage, cycle, agent, worktree, io, pending, tokenFile }) {
  const tokenResult = verifyStageToken(token, secret, stage, cycle, agent);
  if (tokenResult.error) {
    if (tokenResult.fatal) deleteDispatchToken(io, tokenFile);
    return { error: tokenResult.error };
  }

  const baseSha = resolveBaseSha(worktree);
  if (!baseSha) {
    return { error: 'foundry_stage_begin: git rev-parse HEAD failed (no commits?)' };
  }

  const meta = pending.consume(tokenResult.payload.nonce);
  if (!meta) {
    deleteDispatchToken(io, tokenFile);
    return { error: 'foundry_stage_begin: this token was already used, expired, or was not minted by foundry_run. Use the exact token from the most recent orchestrate dispatch — previous dispatches cannot be reused' };
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const active = {
    cycle,
    stage,
    tokenHash,
    baseSha,
    startedAt: new Date().toISOString(),
    tokenFile,
  };
  writeActiveStage(io, active);
  initForgeIfApplicable(io, active.stage);
  cleanStageOutputDir(io);

  return { active };
}

function resolveTokenForStageBegin(args, io) {
  if (args.tokenFile) {
    if (args.tokenFile.includes('/') || args.tokenFile.includes('..')) {
      return { error: 'foundry_stage_begin: tokenFile must not contain "/" or ".." — use the filename from the dispatch prompt verbatim' };
    }
    const tokenPath = `.foundry/tokens/${args.tokenFile}`;
    if (!io.exists(tokenPath)) {
      return { error: `foundry_stage_begin: no dispatch token found at .foundry/tokens/${args.tokenFile}` };
    }
    return { token: io.readFile(tokenPath).trim() };
  }
  return readDispatchToken(io);
}

async function executeStageBegin(args, context, pending) {
  const io = makeIO(context.worktree);
  const secret = readOrCreateSecret(context.worktree);

  const current = readActiveStage(io);
  if (current) {
    return JSON.stringify({ error: `foundry_stage_begin: stage "${current.stage}" is already active — it was set up by the orchestrator and does not need stage_begin. Proceed with the stage work directly` });
  }

  const tokenResult = resolveTokenForStageBegin(args, io);
  if (tokenResult.error) return JSON.stringify({ error: tokenResult.error });

  const opts = {
    token: tokenResult.token, secret, stage: args.stage, cycle: args.cycle,
    agent: context.agent, worktree: context.worktree, io, pending,
    tokenFile: args.tokenFile,
  };
  const beginResult = beginTokenStage(opts);
  if (beginResult.error) return JSON.stringify({ error: beginResult.error });

  return JSON.stringify({ ok: true, active: beginResult.active });
}

function initForgeIfApplicable(io, stage) {
  if (stageBase(stage) === 'forge') initForgeCallLog(io);
}

// -- Stage output directory helpers --

function cleanStageOutputDir(io) {
  const outDir = '.foundry/stage-outputs/';
  if (io.exists(outDir)) {
    for (const f of io.readDir(outDir)) {
      io.unlink(join(outDir, f));
    }
  }
  io.mkdir(outDir);
}

function checkContractViolation(outputs, base) {
  if (base === 'forge' || base === 'human-appraise') {
    if (outputs.length !== 1) {
      return contractError(base, 1, outputs.length);
    }
  }
  return null;
}

function readOutputLinesFrom(io, filePath) {
  if (!io.exists(filePath)) return [];
  const content = io.readFile(filePath);
  return content.trim().split('\n').filter(Boolean).map(function(l) {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function writeAtomicOutputFile(io, outputs, id) {
  const outDir = '.foundry/stage-outputs/';
  ensureDir(io, outDir);
  if (outputs.length === 0) {
    io.writeFile(outDir + '.tmp-' + id, '');
  } else {
    const content = outputs.map(o => JSON.stringify(o)).join('\n') + '\n';
    io.writeFile(outDir + '.tmp-' + id, content);
  }
  io.rename(outDir + '.tmp-' + id, outDir + id + '.jsonl');
}

function trySyncMemory(worktree) {
  try {
    return syncMemoryAtStageEnd(worktree);
  } catch {
    return { error: 'memory sync at stage end failed' };
  }
}

function activeStageOrError(io) {
  const active = readActiveStage(io);
  if (!active) return null;
  return active;
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

async function finishStageAndSync(io, active, context) {
  writeLastStage(io, { cycle: active.cycle, stage: active.stage, baseSha: active.baseSha, summary: '' });
  clearActiveStage(io);

  try {
    await syncMemoryAtStageEnd(context.worktree);
    return {};
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const msg = `memory sync at stage end failed: ${detail}`;
    markWorkfileFailedSilently(io, msg);
    return { error: msg, flow_failed: true };
  }
}

function collectStageOutputFromDir(io) {
  const dir = '.foundry/stage-outputs/';
  let files;
  try {
    files = io.readDir(dir);
  } catch {
    return [];
  }
  const outputs = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const parsed = readOutputLinesFrom(io, dir + f);
    for (const item of parsed) outputs.push(item);
  }
  return outputs;
}

async function executeStageEnd(args, context) {
  const io = makeIO(context.worktree);

  const active = readActiveStage(io);
  if (!active) {
    return JSON.stringify({ error: 'foundry_stage_end: no active stage to close. If you are trying to recover from a tangled state, call foundry_run() without arguments — it will sort and route to the next stage' });
  }

  verifyForgeToolsIfApplicable(io, active);

  const outputs = collectStageOutputFromDir(io);
  const base = stageBaseOf(active.stage);
  const violation = checkContractViolation(outputs, base);
  if (violation) {
    return JSON.stringify({ error: violation });
  }

  const result = await finishStageAndSync(io, active, context);
  if (result.error) return JSON.stringify(result);

  return JSON.stringify({ ok: true });
}

function verifyForgeToolsIfApplicable(io, active) {
  if (stageBase(active.stage) === 'forge') {
    verifyAndManageForgeTools(io, active);
  }
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
      description: 'Open a subagent work stage. The orchestrator provides the dispatch token via a tokenFile or .foundry/dispatch-token — this tool reads it automatically.',
      args: {
        stage: tool.schema.string().describe('Stage alias, e.g. "forge:create-haiku"'),
        cycle: tool.schema.string().describe('Cycle name'),
        tokenFile: tool.schema.string().optional().describe('Filename of the dispatch token under .foundry/tokens/. Pass the filename verbatim from the dispatch prompt.'),
      },
      execute: guarded('foundry_stage_begin', [flowBranchGuard, gateNotFailed],
        (args, context) => executeStageBegin(args, context, pending),
        { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),

    foundry_stage_end: tool({
      description: 'Close the active subagent work stage. Output must be provided via foundry_stage_output before calling this tool. Validates the output contract for the active stage, writes accumulated outputs to a JSONL file, and clears the stage.',
      args: {},
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
