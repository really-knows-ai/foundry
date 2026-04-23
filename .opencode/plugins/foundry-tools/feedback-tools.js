import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { addFeedbackItem, actionFeedbackItem, wontfixFeedbackItem, resolveFeedbackItem, listFeedback } from '../../../scripts/lib/feedback.js';
import { parseFrontmatter } from '../../../scripts/lib/workfile.js';
import { parseArtefactsTable } from '../../../scripts/lib/artefacts.js';
import { requireActiveStage, stageBaseOf } from '../../../scripts/lib/stage-guard.js';
import { makeIO } from './helpers.js';

export function createFeedbackTools({ tool }) {
  return {
    foundry_feedback_add: tool({
      description: 'Add a feedback item to WORK.md under a file heading',
      args: {
        file: tool.schema.string().describe('Artefact file path'),
        text: tool.schema.string().describe('Feedback text'),
        tag: tool.schema.string().describe('Tag for the feedback item'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_feedback_add requires active stage; ${guard.error}` });
        const stageBase = stageBaseOf(guard.active.stage);
        // Per-stage tag allow-list.
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
        const workPath = path.join(context.worktree, 'WORK.md');
        const content = readFileSync(workPath, 'utf-8');
        const r = addFeedbackItem(content, args.file, args.text, args.tag);
        if (!r.deduped) writeFileSync(workPath, r.text, 'utf-8');
        return JSON.stringify({ ok: true, deduped: r.deduped });
      },
    }),

    foundry_feedback_action: tool({
      description: 'Mark a feedback item as actioned [x]',
      args: {
        file: tool.schema.string().describe('Artefact file path'),
        index: tool.schema.number().describe('Zero-based index of the feedback item'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_feedback_action requires active stage; ${guard.error}` });
        const stageBase = stageBaseOf(guard.active.stage);
        if (stageBase !== 'forge') {
          return JSON.stringify({ error: `foundry_feedback_action requires active forge stage; current: ${guard.active.stage}` });
        }
        const workPath = path.join(context.worktree, 'WORK.md');
        const content = readFileSync(workPath, 'utf-8');
        const r = actionFeedbackItem(content, args.file, args.index, stageBase);
        if (!r.ok) return JSON.stringify({ error: r.error });
        writeFileSync(workPath, r.text, 'utf-8');
        return JSON.stringify({ ok: true });
      },
    }),

    foundry_feedback_wontfix: tool({
      description: 'Mark a feedback item as wont-fix [~] with reason',
      args: {
        file: tool.schema.string().describe('Artefact file path'),
        index: tool.schema.number().describe('Zero-based index of the feedback item'),
        reason: tool.schema.string().describe('Reason for wont-fix'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_feedback_wontfix requires active stage; ${guard.error}` });
        const stageBase = stageBaseOf(guard.active.stage);
        if (stageBase !== 'forge') {
          return JSON.stringify({ error: `foundry_feedback_wontfix requires active forge stage; current: ${guard.active.stage}` });
        }
        const workPath = path.join(context.worktree, 'WORK.md');
        const content = readFileSync(workPath, 'utf-8');
        const r = wontfixFeedbackItem(content, args.file, args.index, args.reason, stageBase);
        if (!r.ok) return JSON.stringify({ error: r.error });
        writeFileSync(workPath, r.text, 'utf-8');
        return JSON.stringify({ ok: true });
      },
    }),

    foundry_feedback_resolve: tool({
      description: 'Resolve a feedback item (approved or rejected)',
      args: {
        file: tool.schema.string().describe('Artefact file path'),
        index: tool.schema.number().describe('Zero-based index of the feedback item'),
        resolution: tool.schema.enum(['approved', 'rejected']).describe('Resolution type'),
        reason: tool.schema.string().optional().describe('Reason (required if rejected)'),
      },
      async execute(args, context) {
        const io = makeIO(context.worktree);
        const guard = requireActiveStage(io);
        if (!guard.ok) return JSON.stringify({ error: `foundry_feedback_resolve requires active stage; ${guard.error}` });
        const stageBase = stageBaseOf(guard.active.stage);
        if (!['quench', 'appraise', 'human-appraise'].includes(stageBase)) {
          return JSON.stringify({ error: `foundry_feedback_resolve requires active quench|appraise|human-appraise stage; current: ${guard.active.stage}` });
        }
        const workPath = path.join(context.worktree, 'WORK.md');
        const content = readFileSync(workPath, 'utf-8');
        const r = resolveFeedbackItem(content, args.file, args.index, args.resolution, args.reason, stageBase);
        if (!r.ok) return JSON.stringify({ error: r.error });
        writeFileSync(workPath, r.text, 'utf-8');
        return JSON.stringify({ ok: true });
      },
    }),

    foundry_feedback_list: tool({
      description: 'List feedback items, optionally filtered by file',
      args: {
        file: tool.schema.string().optional().describe('Filter by artefact file path'),
      },
      async execute(args, context) {
        const workPath = path.join(context.worktree, 'WORK.md');
        if (!existsSync(workPath)) {
          return JSON.stringify({ error: 'WORK.md not found' });
        }
        const text = readFileSync(workPath, 'utf-8');
        const fm = parseFrontmatter(text);
        const artefacts = parseArtefactsTable(text);
        const cycle = fm.cycle || '';
        return JSON.stringify(listFeedback(text, cycle, artefacts, args.file));
      },
    }),
  };
}
