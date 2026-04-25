import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
// Legacy imports — used by action/wontfix/resolve/list tools, removed in tasks 3.5/3.7/3.8/3.9.
import { actionFeedbackItem, wontfixFeedbackItem, resolveFeedbackItem, listFeedback } from '../../../scripts/lib/feedback.js';
// New feedback-store, used by foundry_feedback_add and (subsequently) the rewritten tools.
import { openFeedbackStore } from '../../../scripts/lib/feedback-store.js';
import { parseFrontmatter } from '../../../scripts/lib/workfile.js';
import { parseArtefactsTable } from '../../../scripts/lib/artefacts.js';
import { requireActiveStage, stageBaseOf } from '../../../scripts/lib/stage-guard.js';
import { requireNotFailed } from '../../../scripts/lib/failed-flow.js';
import { makeIO } from './helpers.js';

function readCycle(io) {
  if (!io.exists('WORK.md')) return null;
  const fm = parseFrontmatter(io.readFile('WORK.md'));
  return fm.cycle || null;
}

// Shared guard preamble for stage-bound feedback tools.
// Returns {ok:true, activeStage, stageBase, cycle} or {ok:false, error}.
// Caller is responsible for any tool-specific stage-base / tag checks.
function preflight(io, toolName) {
  const failedGuard = requireNotFailed(io);
  if (!failedGuard.ok) return { ok: false, error: `${toolName}: ${failedGuard.error}` };
  const guard = requireActiveStage(io);
  if (!guard.ok) return { ok: false, error: `${toolName} requires active stage; ${guard.error}` };
  const activeStage = guard.active.stage;
  const stageBase = stageBaseOf(activeStage);
  const cycle = readCycle(io);
  if (!cycle) return { ok: false, error: `${toolName}: WORK.md cycle not found` };
  return { ok: true, activeStage, stageBase, cycle };
}

export function createFeedbackTools({ tool }) {
  return {
    foundry_feedback_add: tool({
      description: 'Add a feedback item to WORK.feedback.yaml',
      args: {
        file: tool.schema.string().describe('Artefact file path'),
        text: tool.schema.string().describe('Feedback text'),
        tag: tool.schema.string().describe('Tag for the feedback item'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const pre = preflight(io, 'foundry_feedback_add');
        if (!pre.ok) return JSON.stringify({ error: pre.error });
        const { activeStage, stageBase, cycle } = pre;

        // Per-stage tag allow-list (unchanged from the markdown era).
        if (stageBase === 'forge') {
          return JSON.stringify({ error: 'foundry_feedback_add: forge stages do not add feedback' });
        }
        if (stageBase === 'quench' && args.tag !== 'validation') {
          return JSON.stringify({ error: `foundry_feedback_add: quench may only add tag "validation"; got "${args.tag}"` });
        }
        if (stageBase === 'appraise' && !args.tag.startsWith('law:')) {
          return JSON.stringify({ error: `foundry_feedback_add: appraise tag must start with "law:"; got "${args.tag}"` });
        }
        if (stageBase === 'human-appraise' && args.tag !== 'human') {
          return JSON.stringify({ error: `foundry_feedback_add: human-appraise may only add tag "human"; got "${args.tag}"` });
        }
        if (stageBase === 'assay' && args.tag !== 'validation') {
          return JSON.stringify({ error: `foundry_feedback_add: assay may only add tag "validation"; got "${args.tag}"` });
        }

        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const { id, deduped } = store.add({
            file: args.file,
            tag: args.tag,
            text: args.text,
            source: activeStage,
            cycle,
          });
          return JSON.stringify({ ok: true, id, deduped });
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_add: ${err.message}` });
        }
      },
    }),

    foundry_feedback_action: tool({
      description: 'Mark a feedback item as actioned (forge stages only)',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const pre = preflight(io, 'foundry_feedback_action');
        if (!pre.ok) return JSON.stringify({ error: pre.error });
        const { activeStage, stageBase, cycle } = pre;
        if (stageBase !== 'forge') {
          return JSON.stringify({ error: `foundry_feedback_action requires active forge stage; current: ${activeStage}` });
        }

        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const r = store.transition({
            id: args.id,
            target: 'actioned',
            stage: activeStage,
            cycle,
          });
          if (!r.ok) return JSON.stringify({ error: r.error });
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_action: ${err.message}` });
        }
      },
    }),

    foundry_feedback_wontfix: tool({
      description: 'Mark a feedback item as wont-fix with reason (forge stages only)',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
        reason: tool.schema.string().describe('Reason for wont-fix'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const pre = preflight(io, 'foundry_feedback_wontfix');
        if (!pre.ok) return JSON.stringify({ error: pre.error });
        const { activeStage, stageBase, cycle } = pre;
        if (stageBase !== 'forge') {
          return JSON.stringify({ error: `foundry_feedback_wontfix requires active forge stage; current: ${activeStage}` });
        }

        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const r = store.transition({
            id: args.id,
            target: 'wont-fix',
            stage: activeStage,
            cycle,
            reason: args.reason,
          });
          if (!r.ok) return JSON.stringify({ error: r.error });
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_wontfix: ${err.message}` });
        }
      },
    }),

    foundry_feedback_resolve: tool({
      description: 'Resolve a feedback item (approved or rejected)',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
        resolution: tool.schema.enum(['approved', 'rejected']).describe('Resolution type'),
        reason: tool.schema.string().optional().describe('Reason (required if rejected, or for deadlock override)'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const pre = preflight(io, 'foundry_feedback_resolve');
        if (!pre.ok) return JSON.stringify({ error: pre.error });
        const { activeStage, stageBase, cycle } = pre;
        if (!['quench', 'appraise', 'human-appraise'].includes(stageBase)) {
          return JSON.stringify({ error: `foundry_feedback_resolve requires active quench|appraise|human-appraise stage; current: ${activeStage}` });
        }

        // Public API uses 'approved' for prompt-surface clarity; the state machine's
        // terminal name is 'resolved' (REVISION-CONTRACT §A1, spec §4.3). 'rejected'
        // is identity in both vocabularies.
        const target = args.resolution === 'approved' ? 'resolved' : 'rejected';

        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const r = store.transition({
            id: args.id,
            target,
            stage: activeStage,
            cycle,
            reason: args.reason,
          });
          if (!r.ok) return JSON.stringify({ error: r.error });
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_resolve: ${err.message}` });
        }
      },
    }),

    foundry_feedback_list: tool({
      description: 'List feedback items, optionally filtered by file',
      args: {
        file: tool.schema.string().optional().describe('Filter by artefact file path'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        if (!io.exists('WORK.md')) {
          return JSON.stringify({ error: 'WORK.md not found' });
        }
        try {
          const store = openFeedbackStore('WORK.feedback.yaml', io);
          const items = store.list()
            .filter(it => !args.file || it.file === args.file)
            .map(it => {
              const head = it.history[0];
              const base = {
                id: it.id,
                file: it.file,
                tag: it.tag,
                text: it.text,
                source: it.source,
                state: head.state,
                depth: head.state === 'resolved' ? 0 : it.history.length,
              };
              if (head.reason) base.reason = head.reason;
              return base;
            });
          return JSON.stringify(items);
        } catch (err) {
          return JSON.stringify({ error: `foundry_feedback_list: ${err.message}` });
        }
      },
    }),
  };
}
