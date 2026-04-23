import { execSync } from 'child_process';
import { createHash } from 'node:crypto';
import { readActiveStage, writeActiveStage, clearActiveStage, writeLastStage } from '../../../scripts/lib/state.js';
import { verifyToken } from '../../../scripts/lib/token.js';
import { getContext } from '../../../scripts/lib/memory/singleton.js';
import { syncStore } from '../../../scripts/lib/memory/store.js';
import { makeIO, makeMemoryIO } from './helpers.js';

export function createStageTools({ tool, secret, pending }) {
  return {
    foundry_stage_begin: tool({
      description: 'Open a subagent work stage; consumes a dispatch token from foundry_sort.',
      args: {
        stage: tool.schema.string().describe('Stage alias, e.g. "forge:create-haiku"'),
        cycle: tool.schema.string().describe('Cycle name'),
        token: tool.schema.string().describe('Token received from foundry_sort via the dispatch prompt'),
      },
      async execute(args, context) {
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
        // Single-use nonce check.
        const meta = pending.consume(v.payload.nonce);
        if (!meta) return JSON.stringify({ error: `foundry_stage_begin: nonce not pending or already consumed` });

        // Resolve base SHA from git.
        let baseSha;
        try {
          baseSha = execSync('git rev-parse HEAD', { cwd: context.worktree }).toString().trim();
        } catch {
          return JSON.stringify({ error: `foundry_stage_begin: git rev-parse HEAD failed (no commits?)` });
        }

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
      },
    }),

    foundry_stage_end: tool({
      description: 'Close the active subagent work stage; preserves baseSha for finalize.',
      args: {
        summary: tool.schema.string().describe('Short summary of the work done'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const active = readActiveStage(io);
        if (!active) return JSON.stringify({ error: 'foundry_stage_end requires active stage; current: none' });
        writeLastStage(io, { cycle: active.cycle, stage: active.stage, baseSha: active.baseSha, summary: args.summary });
        clearActiveStage(io);
        // End-of-flow memory sync: flush any pending cycle-scoped writes.
        // Non-fatal: flow completion must not fail due to memory sync.
        try {
          const memIo = makeMemoryIO(context.worktree);
          const ctx = getContext(context.worktree);
          if (ctx && ctx.store) {
            await syncStore({ store: ctx.store, io: memIo });
          }
        } catch (err) {
          console.error(`memory sync at flow end failed: ${err.message ?? err}`);
        }
        return JSON.stringify({ ok: true, summary: args.summary });
      },
    }),
  };
}
