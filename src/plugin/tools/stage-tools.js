import { execSync } from 'child_process';
import { createHash } from 'node:crypto';
import { readActiveStage, writeActiveStage, clearActiveStage, writeLastStage, clearLastStage } from '../../../scripts/lib/state.js';
import { verifyToken } from '../../../scripts/lib/token.js';
import { getContext, invalidateStore } from '../../../scripts/lib/memory/singleton.js';
import { syncStore } from '../../../scripts/lib/memory/store.js';
import { makeIO, makeMemoryIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';
import { markWorkfileFailed, readFailedStatus, clearWorkfileFailed } from '../../../scripts/lib/failed-flow.js';
import { guarded, notFailedGuard } from '../../../scripts/lib/guards.js';

const gateNotFailed = notFailedGuard(makeIO);

export function createStageTools({ tool, secret, pending }) {
  return {
    foundry_stage_begin: tool({
      description: 'Open a subagent work stage; consumes a dispatch token from foundry_orchestrate.',
      args: {
        stage: tool.schema.string().describe('Stage alias, e.g. "forge:create-haiku"'),
        cycle: tool.schema.string().describe('Cycle name'),
        token: tool.schema.string().describe('Token received from foundry_orchestrate via the dispatch prompt'),
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
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),

    foundry_stage_end: tool({
      description: 'Close the active subagent work stage; preserves baseSha for finalize.',
      args: {
        summary: tool.schema.string().describe('Short summary of the work done'),
      },
      // Branch guard only: stage_end must remain callable even when the
      // workfile has flipped to failed (it flushes memory state, clears
      // active-stage, and completes cleanup paths).
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
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),

    foundry_stage_retry: tool({
      description: 'Retry a failed stage by discarding uncommitted memory changes and clearing the failed state. Requires clean git working tree.',
      args: {},
      // Branch guard only: retry is a recovery tool for failed flows.
      execute: guarded('foundry_stage_retry', [flowBranchGuard], async (_args, context) => {
        const io = makeIO(context.worktree);
        
        // Precondition 1: flow must be in failed state
        const failed = readFailedStatus(io);
        if (!failed) {
          return JSON.stringify({ 
            ok: false, 
            error: 'foundry_stage_retry requires failed flow; current status is not failed' 
          });
        }
        
        // Precondition 2: no active stage (stage_end should have cleared it)
        const active = readActiveStage(io);
        if (active) {
          return JSON.stringify({ 
            ok: false, 
            error: 'foundry_stage_retry requires no active stage; call foundry_stage_end first' 
          });
        }
        
        // Precondition 3: git working tree must be clean
        try {
          const statusOut = execSync('git status --porcelain', { cwd: context.worktree }).toString();
          if (statusOut.trim() !== '') {
            return JSON.stringify({
              ok: false,
              error: 'foundry_stage_retry requires clean git working tree; commit or stash changes first'
            });
          }
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: `foundry_stage_retry: git status check failed: ${err?.message ?? err}`
          });
        }
        
        // Operation 1: Invalidate memory singleton to discard uncommitted changes.
        // This resets to the on-disk NDJSON state (before the failed sync).
        invalidateStore(context.worktree);
        
        // Operation 2: Clear last-stage.json so the stage can be re-run
        try {
          clearLastStage(io);
        } catch {
          // last-stage.json might not exist; that's fine
        }
        
        // Operation 3: Clear the failed status from WORK.md
        clearWorkfileFailed(io);
        
        return JSON.stringify({ 
          ok: true,
          message: 'Flow unlocked. Memory state reset to disk. Stage can be re-run.'
        });
      }, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
