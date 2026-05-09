import { openFeedbackStore } from '../../scripts/lib/feedback-store.js';
import { parseFrontmatter } from '../../scripts/lib/workfile.js';
import { requireActiveStage, stageBaseOf } from '../../scripts/lib/stage-guard.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { makeIO, branchIoFactory, asyncIoFactory, flowBranchGuard } from './helpers.js';

const gateNotFailed = notFailedGuard(makeIO);

function readCycle(io) {
  if (!io.exists('WORK.md')) return null;
  const fm = parseFrontmatter(io.readFile('WORK.md'));
  return fm.cycle || null;
}

// Shared guard preamble for stage-bound feedback tools.
// Returns {ok:true, activeStage, stageBase, cycle} or {ok:false, error}.
// Caller is responsible for any tool-specific stage-base / tag checks.
function preflight(io, toolName) {
  const guard = requireActiveStage(io);
  if (!guard.ok) return { ok: false, error: `${toolName} requires active stage; ${guard.error}` };
  const activeStage = guard.active.stage;
  const stageBase = stageBaseOf(activeStage);
  const cycle = readCycle(io);
  if (!cycle) return { ok: false, error: `${toolName}: WORK.md cycle not found` };
  return { ok: true, activeStage, stageBase, cycle };
}

// Stages that are forbidden from adding feedback entirely.
const FEEDBACK_ADD_FORBIDDEN = {
  forge: 'foundry_feedback_add: forge stages do not add feedback',
  assay: 'foundry_feedback_add: assay stages do not add feedback (extractor failure marks the workfile failed)',
};

// Per-stage tag validators for stages that allow feedback with restrictions.
const FEEDBACK_ADD_TAG_VALIDATORS = {
  quench: {
    test: tag => tag.startsWith('law:'),
    message: tag => `foundry_feedback_add: quench may only add tags starting with "law:"; got "${tag}"`,
  },
  appraise: {
    test: tag => tag.startsWith('law:'),
    message: tag => `foundry_feedback_add: appraise tag must start with "law:"; got "${tag}"`,
  },
  'human-appraise': {
    test: tag => tag === 'human',
    message: tag => `foundry_feedback_add: human-appraise may only add tag "human"; got "${tag}"`,
  },
};

// Validate that the given tag is allowed for the current stage base.
// Returns {ok: true} or {ok: false, error}.
function validateFeedbackAddTag(stageBase, tag) {
  const forbiddenMsg = FEEDBACK_ADD_FORBIDDEN[stageBase];
  if (forbiddenMsg) return { ok: false, error: forbiddenMsg };
  const rule = FEEDBACK_ADD_TAG_VALIDATORS[stageBase];
  if (!rule) return { ok: true };
  if (rule.test(tag)) return { ok: true };
  return { ok: false, error: rule.message(tag) };
}

async function executeFeedbackAdd(args, context) {
  const io = makeIO(context.worktree);
  const pre = preflight(io, 'foundry_feedback_add');
  if (!pre.ok) return JSON.stringify({ error: pre.error });
  const { activeStage, stageBase, cycle } = pre;

  const tagCheck = validateFeedbackAddTag(stageBase, args.tag);
  if (!tagCheck.ok) return JSON.stringify({ error: tagCheck.error });

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
}

async function executeFeedbackAction(args, context) {
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
}

async function executeFeedbackWontfix(args, context) {
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
}

function resolveTargetFromResolution(resolution) {
  return resolution === 'approved' ? 'resolved' : 'rejected';
}

async function executeFeedbackResolve(args, context) {
  const io = makeIO(context.worktree);
  const pre = preflight(io, 'foundry_feedback_resolve');
  if (!pre.ok) return JSON.stringify({ error: pre.error });
  const { activeStage, stageBase, cycle } = pre;
  const allowedStages = ['quench', 'appraise', 'human-appraise'];
  if (!allowedStages.includes(stageBase)) {
    return JSON.stringify({ error: `foundry_feedback_resolve requires active quench|appraise|human-appraise stage; current: ${activeStage}` });
  }

  const target = resolveTargetFromResolution(args.resolution);

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
}

async function executeFeedbackList(args, context) {
  const io = makeIO(context.worktree);
  if (!io.exists('WORK.md')) {
    return JSON.stringify({ error: 'foundry_feedback_list: WORK.md cycle not found' });
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
          depth: it.history.length,
        };
        if (head.reason) base.reason = head.reason;
        return base;
      });
    return JSON.stringify(items);
  } catch (err) {
    return JSON.stringify({ error: `foundry_feedback_list: ${err.message}` });
  }
}

export function createFeedbackTools({ tool }) {
  return {
    foundry_feedback_add: tool({ description: 'Add a feedback item to WORK.feedback.yaml',
      args: {
        file: tool.schema.string().describe('Artefact file path'),
        text: tool.schema.string().describe('Feedback text'),
        tag: tool.schema.string().describe('Tag for the feedback item'),
      },
      execute: guarded('foundry_feedback_add', [flowBranchGuard, gateNotFailed], executeFeedbackAdd, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
    foundry_feedback_action: tool({ description: 'Mark a feedback item as actioned (forge stages only)',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
      },
      execute: guarded('foundry_feedback_action', [flowBranchGuard, gateNotFailed], executeFeedbackAction, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
    foundry_feedback_wontfix: tool({ description: 'Mark a feedback item as wont-fix with reason (forge stages only)',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
        reason: tool.schema.string().describe('Reason for wont-fix'),
      },
      execute: guarded('foundry_feedback_wontfix', [flowBranchGuard, gateNotFailed], executeFeedbackWontfix, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
    foundry_feedback_resolve: tool({
      description: 'Resolve a feedback item (approved or rejected). In human-appraise stages, this tool can override deadlocked items by providing a reason.',
      args: {
        id: tool.schema.string().describe('Feedback item id (ULID)'),
        resolution: tool.schema.enum(['approved', 'rejected']).describe('Resolution type'),
        reason: tool.schema.string().optional().describe('Reason (required if rejected, or for deadlock override)'),
      },
      execute: guarded('foundry_feedback_resolve', [flowBranchGuard, gateNotFailed], executeFeedbackResolve, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
    foundry_feedback_list: tool({ description: 'List feedback items, optionally filtered by file',
      args: {
        file: tool.schema.string().optional().describe('Filter by artefact file path'),
      },
      execute: executeFeedbackList,
    }),
  };
}
