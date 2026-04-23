import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { requireNoActiveStage } from '../../../scripts/lib/stage-guard.js';
import { parseArtefactsTable, setArtefactStatus } from '../../../scripts/lib/artefacts.js';
import { makeIO } from './helpers.js';

export function createArtefactTools({ tool }) {
  return {
    // NOTE: `foundry_artefacts_add` was removed in v2.2.0. Artefacts are now
    // registered automatically by `foundry_stage_finalize` as drafts, then
    // promoted to done|blocked via `foundry_artefacts_set_status`.
    foundry_artefacts_set_status: tool({
      description: 'Update the status of an artefact in WORK.md (done|blocked only)',
      args: {
        file: tool.schema.string().describe('Artefact file path'),
        status: tool.schema.string().describe('New status (done|blocked)'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireNoActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_artefacts_set_status ${guard.error}` });
        const workPath = path.join(context.worktree, 'WORK.md');
        const text = readFileSync(workPath, 'utf-8');
        try {
          const updated = setArtefactStatus(text, args.file, args.status);
          writeFileSync(workPath, updated, 'utf-8');
          return JSON.stringify({ ok: true });
        } catch (e) {
          return JSON.stringify({ error: e.message });
        }
      },
    }),

    foundry_artefacts_list: tool({
      description: 'List artefacts from the WORK.md table. Optionally filter by cycle — callers should always pass the current cycle to avoid picking up stale rows from prior sessions.',
      args: {
        cycle: tool.schema.string().optional().describe('Only return rows whose Cycle column matches this value'),
      },
      async execute(args, context) {
        const workPath = path.join(context.worktree, 'WORK.md');
        if (!existsSync(workPath)) {
          return JSON.stringify({ error: 'WORK.md not found' });
        }
        const text = readFileSync(workPath, 'utf-8');
        const rows = parseArtefactsTable(text);
        const filtered = args.cycle ? rows.filter(r => r.cycle === args.cycle) : rows;
        return JSON.stringify(filtered);
      },
    }),
  };
}
