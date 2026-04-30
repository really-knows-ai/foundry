import { execSync, execFileSync } from 'child_process';
import { createHash } from 'node:crypto';
import { readActiveStage, writeActiveStage, clearActiveStage, writeLastStage } from '../../../scripts/lib/state.js';
import { verifyToken } from '../../../scripts/lib/token.js';
import { getContext } from '../../../scripts/lib/memory/singleton.js';
import { syncStore } from '../../../scripts/lib/memory/store.js';
import { makeIO, makeMemoryIO } from './helpers.js';
import { markWorkfileFailed } from '../../../scripts/lib/failed-flow.js';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';
import { requireOnFlowBranch } from '../../../scripts/lib/branch-guard.js';

const gateNotFailed = notFailedGuard(makeIO);

function makeBranchExec(cwd) {
  return (argv) => execFileSync(argv[0], argv.slice(1), {
    cwd, encoding: 'utf8', stdio: 'pipe',
  });
}
function flowBranchGuard(_args, context) {
  return requireOnFlowBranch({ exec: makeBranchExec(context.worktree) });
}

export function createStageTools({ tool, secret, pending }) {
  return {
    foundry_stage_begin: tool({
      description: 'Open a subagent work stage; consumes a dispatch token from foundry_sort.',
      args: {
        stage: tool.schema.string().describe('Stage alias, e.g. "forge:create-haiku"'),
        cycle: tool.schema.string().describe('Cycle name'),
        token: tool.schema.string().describe('Token received from foundry_sort via the dispatch prompt'),
      },
      execute: guarded('foundry_stage_begin', [flowBranchGuard, gateNotFailed], async (args, context) => {
        const io = makeIO(context.worktree);
        // Precondition: no active stage.
        const current = readActiveStage(io);
        if (current) {
          return JSON.stringify({ error: `foundry_stage_begin requires no active stage; current: ${current.stage}` });
        }
        // Verify token signature + expiry.
        const v = verifyToken(args.token, secret);
        if (!v.ok) return JSON.stringify({ error: `foundry_stage_begin: token ${v.reason}` });
        // Payload must match args.
        if (v.payload.route !== args.stage || v.payload.cycle !== args.cycle) {
          return JSON.stringify({ error: `foundry_stage_begin: token payload mismatch (route=${v.payload.route}, cycle=${v.payload.cycle})` });
        }

        // Resolve base SHA from git. Done BEFORE consuming the nonce so a
        // transient git failure (e.g. no-commit repo) does not burn the
        // single-use dispatch token; the caller can retry with the same token.
        let baseSha;
        try {
          baseSha = execSync('git rev-parse HEAD', { cwd: context.worktree }).toString().trim();
        } catch {
          return JSON.stringify({ error: `foundry_stage_begin: git rev-parse HEAD failed (no commits?)` });
        }

        // Single-use nonce check. This MUTATES the pending store, so it must
        // be the last precondition — anything after this that fails would
        // strand the nonce.
        const meta = pending.consume(v.payload.nonce);
        if (!meta) return JSON.stringify({ error: `foundry_stage_begin: nonce not pending or already consumed` });

        const tokenHash = createHash('sha256').update(args.token).digest('hex');
        const active = {
          cycle: args.cycle,
          stage: args.stage,
          tokenHash,
          baseSha,
          startedAt: new Date().toISOString(),
        };
        writeActiveStage(io, active);
        return JSON.stringify({ ok: true, active });
      }),
    }),

    foundry_stage_end: tool({
      description: 'Close the active subagent work stage; preserves baseSha for finalize.',
      args: {
        summary: tool.schema.string().describe('Short summary of the work done'),
      },
      // Branch guard only: stage_end must remain callable even when the
      // workfile has flipped to failed (it flushes memory state and clears
      // active-stage; not gating on failed lets cleanup paths complete).
      execute: guarded('foundry_stage_end', [flowBranchGuard], async (args, context) => {
        const io = makeIO(context.worktree);
        const active = readActiveStage(io);
        if (!active) return JSON.stringify({ error: 'foundry_stage_end requires active stage; current: none' });
        writeLastStage(io, { cycle: active.cycle, stage: active.stage, baseSha: active.baseSha, summary: args.summary });
        clearActiveStage(io);
        // End-of-flow memory sync: flush any pending cycle-scoped writes.
        // If this fails, the in-memory DB is ahead of the on-disk NDJSON
        // source of truth — a data-loss risk. Mark the flow failed so no
        // further mutating tool will run until the user abandons the cycle
        // (foundry_workfile_delete) or manually resolves the divergence.
        try {
          const memIo = makeMemoryIO(context.worktree);
          const ctx = getContext(context.worktree);
          if (ctx && ctx.store) {
            await syncStore({ store: ctx.store, io: memIo });
          }
        } catch (err) {
          const msg = `memory sync at stage end failed: ${err?.message ?? err}`;
          try { markWorkfileFailed(io, msg); } catch { /* WORK.md gone? nothing we can do */ }
          return JSON.stringify({ error: msg, flow_failed: true });
        }
        return JSON.stringify({ ok: true, summary: args.summary });
      }),
    }),
  };
}
