/**
 * Foundry plugin for OpenCode.ai
 *
 * All skills are always registered. Individual skills check for foundry/ dir.
 * - If foundry/ exists: pipeline context injected into first message
 * - If foundry/ does not exist: minimal prompt guiding user to init-foundry
 * Multi-model agents are managed as .opencode/agents/foundry-*.md files via the refresh-agents skill.
 */

import path from 'path';
import fs from 'fs';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { tool } from '@opencode-ai/plugin';
import { loadHistory, appendEntry, getIteration } from '../../scripts/lib/history.js';
import { parseFrontmatter, createWorkfile, setFrontmatterField, getFrontmatterField, enrichStages, parseStagesValue, parseModelsValue } from '../../scripts/lib/workfile.js';
import { parseArtefactsTable, addArtefactRow, setArtefactStatus } from '../../scripts/lib/artefacts.js';
import { addFeedbackItem, actionFeedbackItem, wontfixFeedbackItem, resolveFeedbackItem, listFeedback } from '../../scripts/lib/feedback.js';
import { getCycleDefinition, getArtefactType, getLaws, getValidation, getAppraisers, getFlow, selectAppraisers } from '../../scripts/lib/config.js';
import { slugify } from '../../scripts/lib/slug.js';
import { runSort } from '../../scripts/sort.js';
import { execSync, execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../..');
const allSkillsDir = path.join(packageRoot, 'skills');

function listFlows(foundryDir) {
  const flowsDir = path.join(foundryDir, 'flows');
  if (!fs.existsSync(flowsDir)) return [];
  const flows = [];
  for (const entry of readdirSync(flowsDir)) {
    if (!entry.endsWith('.md') || entry === '.gitkeep') continue;
    try {
      const text = readFileSync(path.join(flowsDir, entry), 'utf-8');
      const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      const idMatch = fm.match(/^id:\s*(.+)$/m);
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const startingMatch = fm.match(/^starting-cycles:\s*\n((?:\s*-\s*.+\n?)+)/m);
      const id = idMatch ? idMatch[1].trim() : entry.replace(/\.md$/, '');
      const name = nameMatch ? nameMatch[1].trim() : id;
      const startingCycles = startingMatch
        ? startingMatch[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
        : [];
      flows.push({ id, name, startingCycles });
    } catch { /* skip bad files */ }
  }
  return flows;
}

function getBootstrapContent(directory) {
  const foundryDir = path.join(directory, 'foundry');
  const foundryExists = fs.existsSync(foundryDir) && fs.statSync(foundryDir).isDirectory();

  if (!foundryExists) {
    return `<FOUNDRY_CONTEXT>
Foundry is installed but not initialized in this project. There is no foundry/ directory.

To set up Foundry, use the \`init-foundry\` skill. This will create the foundry/ directory structure
and guide you through defining artefact types, laws, appraisers, cycles, and flows.
</FOUNDRY_CONTEXT>`;
  }

  const flows = listFlows(foundryDir);
  const flowList = flows.length > 0
    ? flows.map(f => {
        const sc = f.startingCycles.length > 0 ? ` — starting cycles: ${f.startingCycles.join(', ')}` : '';
        return `- \`${f.id}\` — ${f.name}${sc}`;
      }).join('\n')
    : '- (no flows defined yet — use the `add-flow` skill to create one)';

  return `<FOUNDRY_CONTEXT>
Foundry is active in this project. The foundry/ directory contains the project's artefact definitions,
laws, appraisers, cycles, and flows.

Foundry is a skill-driven framework for governed artefact generation and evaluation.
The pipeline: forge (produce) → quench (deterministic checks) → appraise (subjective evaluation) → iterate.

## Defined flows

${flowList}

**CRITICAL ROUTING RULE:** When the user references any flow above — by id (e.g. "creative-flow"),
by name (e.g. "Creative Flow"), or by clear paraphrase (e.g. "the creative flow", "use the creative pipeline") —
invoke the \`flow\` skill DIRECTLY with that flow's id. Do NOT invoke brainstorming, do NOT explore the
codebase, do NOT ask clarifying questions about what to build. The flow's cycles already define the
work. The user's request text (e.g. "make a haiku about X") is the goal to pass to the flow.

Brainstorming applies to NEW features being added to foundry itself (new cycles, new artefact types,
new skills). It does NOT apply to running an existing, defined flow.

## Available skills

- **Pipeline:** forge, quench, appraise, cycle, flow, sort, human-appraise
- **Authoring:** add-artefact-type, add-law, add-appraiser, add-cycle, add-flow, init-foundry
- **Maintenance:** upgrade-foundry, refresh-agents, list-agents

## Multi-model routing

Foundry uses \`foundry-*\` sub-agents defined as markdown files in \`.opencode/agents/\`.
Run the \`refresh-agents\` skill to regenerate them after adding or removing providers.
Cycle definitions can specify per-stage models via the \`models\` frontmatter map. Appraisers can override with their own \`model\` field.

All user content lives under foundry/.
Scripts are located at: ${path.join(packageRoot, 'scripts')}
</FOUNDRY_CONTEXT>`;
}

function makeIO(directory) {
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(directory, p);
  return {
    exists: (p) => existsSync(resolve(p)),
    readFile: (p) => readFileSync(resolve(p), 'utf-8'),
    writeFile: (p, content) => writeFileSync(resolve(p), content, 'utf-8'),
    readDir: (p) => readdirSync(resolve(p)),
  };
}

export const FoundryPlugin = async ({ directory }) => {
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];

      // Always register all skills — individual skills check for foundry/ dir
      if (!config.skills.paths.includes(allSkillsDir)) {
        config.skills.paths.push(allSkillsDir);
      }
    },

    'experimental.chat.messages.transform': async (_input, output) => {
      const bootstrap = getBootstrapContent(directory);
      if (!bootstrap || !output.messages.length) return;

      const firstUser = output.messages.find(m => m.info.role === 'user');
      if (!firstUser || !firstUser.parts.length) return;

      if (firstUser.parts.some(p => p.type === 'text' && p.text.includes('FOUNDRY_CONTEXT'))) return;

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap });
    },

    tool: {
      // ── History tools ──
      foundry_history_append: tool({
        description: 'Append an entry to the cycle history (WORK.history.yaml)',
        args: {
          cycle: tool.schema.string().describe('Cycle name'),
          stage: tool.schema.string().describe('Stage name'),
          comment: tool.schema.string().describe('Comment for this entry'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const historyPath = path.join(context.worktree, 'WORK.history.yaml');
          const iteration = getIteration(historyPath, args.cycle, io);
          appendEntry(historyPath, { cycle: args.cycle, stage: args.stage, iteration, comment: args.comment }, io);
          return JSON.stringify({ ok: true, iteration });
        },
      }),

      foundry_history_list: tool({
        description: 'List history entries for a cycle',
        args: {
          cycle: tool.schema.string().describe('Cycle name'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const historyPath = path.join(context.worktree, 'WORK.history.yaml');
          const entries = loadHistory(historyPath, args.cycle, io);
          return JSON.stringify(entries);
        },
      }),

      // ── Workfile tools ──
      foundry_workfile_create: tool({
        description: 'Create WORK.md with frontmatter and goal',
        args: {
          flow: tool.schema.string().describe('Flow name'),
          cycle: tool.schema.string().describe('Cycle name'),
          stages: tool.schema.array(tool.schema.string()).describe('Ordered stage names'),
          maxIterations: tool.schema.number().describe('Maximum iterations'),
          goal: tool.schema.string().describe('Goal text'),
          models: tool.schema.string().optional().describe('Per-stage model overrides as JSON object, e.g. \'{"forge":"openai/gpt-4o"}\''),
        },
        async execute(args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          if (existsSync(workPath)) {
            return JSON.stringify({ error: 'WORK.md already exists' });
          }
          const fm = { flow: args.flow, cycle: args.cycle, stages: enrichStages(args.stages, args.cycle), maxIterations: args.maxIterations };
          if (args.models) {
            fm.models = parseModelsValue(args.models);
          }
          const content = createWorkfile(fm, args.goal);
          writeFileSync(workPath, content, 'utf-8');
          return JSON.stringify({ ok: true });
        },
      }),

      foundry_workfile_get: tool({
        description: 'Read WORK.md and return frontmatter + goal',
        args: {},
        async execute(_args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          if (!existsSync(workPath)) {
            return JSON.stringify({ error: 'WORK.md not found' });
          }
          const text = readFileSync(workPath, 'utf-8');
          const fm = parseFrontmatter(text);
          const goalMatch = text.match(/# Goal\n\n([\s\S]*?)(?=\n\||\n##|$)/);
          const goal = goalMatch ? goalMatch[1].trim() : '';
          return JSON.stringify({ ...fm, goal });
        },
      }),

      foundry_workfile_set: tool({
        description: 'Update a single frontmatter field in WORK.md',
        args: {
          key: tool.schema.string().describe('Frontmatter key'),
          value: tool.schema.string().describe('Value to set (use JSON for arrays/objects, e.g. \'["forge:a","quench:b"]\' or \'{"forge":"openai/gpt-4o"}\')'),
        },
        async execute(args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          if (!existsSync(workPath)) {
            return JSON.stringify({ error: 'WORK.md not found' });
          }
          const text = readFileSync(workPath, 'utf-8');
          // Parse JSON values for arrays/objects, keep strings as-is
          let value = args.value;
          if (args.key === 'stages') {
            // Always parse stages into an array (handles JSON arrays and comma-separated strings)
            value = parseStagesValue(args.value);
          } else if (args.key === 'models') {
            // Always parse models into an object (handles JSON objects and "key: value" strings)
            value = parseModelsValue(args.value);
          } else {
            try {
              const parsed = JSON.parse(args.value);
              if (typeof parsed === 'object' || Array.isArray(parsed) || typeof parsed === 'number') {
                value = parsed;
              }
            } catch {
              // Not JSON, use as plain string
            }
          }
          // Auto-enrich bare stage names with cycle ID alias
          if (args.key === 'stages' && Array.isArray(value)) {
            const fm = parseFrontmatter(text);
            if (fm.cycle) {
              value = enrichStages(value, fm.cycle);
            }
          }
          const updated = setFrontmatterField(text, args.key, value);
          writeFileSync(workPath, updated, 'utf-8');
          return JSON.stringify({ ok: true });
        },
      }),

      foundry_workfile_delete: tool({
        description: 'Delete WORK.md and WORK.history.yaml',
        args: {},
        async execute(_args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          const historyPath = path.join(context.worktree, 'WORK.history.yaml');
          if (existsSync(workPath)) {
            unlinkSync(workPath);
          }
          if (existsSync(historyPath)) {
            unlinkSync(historyPath);
          }
          return JSON.stringify({ ok: true });
        },
      }),

      // ── Artefacts tools ──
      foundry_artefacts_add: tool({
        description: 'Add an artefact row to the WORK.md table',
        args: {
          file: tool.schema.string().describe('Artefact file path'),
          type: tool.schema.string().describe('Artefact type'),
          cycle: tool.schema.string().describe('Cycle name'),
          status: tool.schema.string().optional().describe('Status (default: draft)'),
        },
        async execute(args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          const text = readFileSync(workPath, 'utf-8');
          const updated = addArtefactRow(text, { file: args.file, type: args.type, cycle: args.cycle, status: args.status || 'draft' });
          writeFileSync(workPath, updated, 'utf-8');
          return JSON.stringify({ ok: true });
        },
      }),

      foundry_artefacts_set_status: tool({
        description: 'Update the status of an artefact in WORK.md',
        args: {
          file: tool.schema.string().describe('Artefact file path'),
          status: tool.schema.string().describe('New status'),
        },
        async execute(args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          const text = readFileSync(workPath, 'utf-8');
          const updated = setArtefactStatus(text, args.file, args.status);
          writeFileSync(workPath, updated, 'utf-8');
          return JSON.stringify({ ok: true });
        },
      }),

      foundry_artefacts_list: tool({
        description: 'List all artefacts from the WORK.md table',
        args: {},
        async execute(_args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          if (!existsSync(workPath)) {
            return JSON.stringify({ error: 'WORK.md not found' });
          }
          const text = readFileSync(workPath, 'utf-8');
          return JSON.stringify(parseArtefactsTable(text));
        },
      }),

      // ── Feedback tools ──
      foundry_feedback_add: tool({
        description: 'Add a feedback item to WORK.md under a file heading',
        args: {
          file: tool.schema.string().describe('Artefact file path'),
          text: tool.schema.string().describe('Feedback text'),
          tag: tool.schema.string().describe('Tag for the feedback item'),
        },
        async execute(args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          const content = readFileSync(workPath, 'utf-8');
          const updated = addFeedbackItem(content, args.file, args.text, args.tag);
          writeFileSync(workPath, updated, 'utf-8');
          return JSON.stringify({ ok: true });
        },
      }),

      foundry_feedback_action: tool({
        description: 'Mark a feedback item as actioned [x]',
        args: {
          file: tool.schema.string().describe('Artefact file path'),
          index: tool.schema.number().describe('Zero-based index of the feedback item'),
        },
        async execute(args, context) {
          const workPath = path.join(context.worktree, 'WORK.md');
          const content = readFileSync(workPath, 'utf-8');
          const updated = actionFeedbackItem(content, args.file, args.index);
          writeFileSync(workPath, updated, 'utf-8');
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
          const workPath = path.join(context.worktree, 'WORK.md');
          const content = readFileSync(workPath, 'utf-8');
          const updated = wontfixFeedbackItem(content, args.file, args.index, args.reason);
          writeFileSync(workPath, updated, 'utf-8');
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
          const workPath = path.join(context.worktree, 'WORK.md');
          const content = readFileSync(workPath, 'utf-8');
          const updated = resolveFeedbackItem(content, args.file, args.index, args.resolution, args.reason);
          writeFileSync(workPath, updated, 'utf-8');
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

      // ── Sort tool ──
      foundry_sort: tool({
        description: 'Run sort routing to determine the next stage',
        args: {
          cycleDef: tool.schema.string().optional().describe('Path to cycle definition file'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const result = runSort({ cycleDef: args.cycleDef }, io);
          return JSON.stringify(result);
        },
      }),

      // ── Git tools ──
      foundry_git_branch: tool({
        description: 'Create and checkout a work branch for a flow',
        args: {
          flowId: tool.schema.string().describe('Flow ID'),
          description: tool.schema.string().describe('Branch description suffix'),
        },
        async execute(args, context) {
          const flowSlug = slugify(args.flowId);
          const descSlug = slugify(args.description);
          const branch = `work/${flowSlug}-${descSlug}`;
          execFileSync('git', ['checkout', '-b', branch], { cwd: context.worktree, encoding: 'utf8', stdio: 'pipe' });
          return JSON.stringify({ ok: true, branch });
        },
      }),

      foundry_git_commit: tool({
        description: 'Stage all changes and commit with a cycle-prefixed message',
        args: {
          cycle: tool.schema.string().describe('Cycle name'),
          stage: tool.schema.string().describe('Stage name'),
          description: tool.schema.string().describe('Commit description'),
        },
        async execute(args, context) {
          execSync('git add .', { cwd: context.worktree, encoding: 'utf8' });
          const msg = `[${args.cycle}] ${args.stage}: ${args.description}`;
          execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: context.worktree, encoding: 'utf8' });
          const hash = execSync('git rev-parse --short HEAD', { cwd: context.worktree, encoding: 'utf8' }).trim();
          return JSON.stringify({ ok: true, hash });
        },
      }),

      foundry_git_finish: tool({
        description: 'Clean up work files, squash merge to base branch, and delete the work branch',
        args: {
          message: tool.schema.string().describe('Squash merge commit message'),
          baseBranch: tool.schema.string().optional().describe('Target branch (default: main)'),
        },
        async execute(args, context) {
          const base = args.baseBranch || 'main';
          const cwd = context.worktree;
          const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

          // Get current branch name
          const workBranch = execSync('git branch --show-current', opts).trim();
          if (workBranch === base) {
            return JSON.stringify({ error: `Already on ${base} — nothing to merge` });
          }

          // Delete work files
          const workPath = path.join(cwd, 'WORK.md');
          const historyPath = path.join(cwd, 'WORK.history.yaml');
          if (existsSync(workPath)) unlinkSync(workPath);
          if (existsSync(historyPath)) unlinkSync(historyPath);

          // Commit cleanup if there are changes
          try {
            execSync('git add -A', opts);
            const status = execSync('git status --porcelain', opts).trim();
            if (status) {
              const cleanupMsg = `[${workBranch.replace('work/', '')}] cleanup: remove work files`;
              execSync(`git commit -m "${cleanupMsg.replace(/"/g, '\\"')}"`, opts);
            }
          } catch { /* no changes to commit */ }

          // Switch to base and squash merge
          execSync(`git checkout ${base}`, opts);
          execSync(`git merge --squash ${workBranch}`, opts);
          const msg = args.message.replace(/"/g, '\\"');
          execSync(`git commit -m "${msg}"`, opts);
          const hash = execSync('git rev-parse --short HEAD', opts).trim();

          // Force-delete work branch (required after squash)
          execSync(`git branch -D ${workBranch}`, opts);

          return JSON.stringify({ ok: true, hash, branch: base });
        },
      }),

      // ── Config tools ──
      foundry_config_cycle: tool({
        description: 'Get a cycle definition from foundry config',
        args: {
          cycleId: tool.schema.string().describe('Cycle ID'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const result = await getCycleDefinition('foundry', args.cycleId, io);
          return JSON.stringify(result);
        },
      }),

      foundry_config_artefact_type: tool({
        description: 'Get an artefact type definition',
        args: {
          typeId: tool.schema.string().describe('Artefact type ID'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const result = await getArtefactType('foundry', args.typeId, io);
          return JSON.stringify(result);
        },
      }),

      foundry_config_laws: tool({
        description: 'Get laws, optionally filtered by artefact type',
        args: {
          typeId: tool.schema.string().optional().describe('Artefact type ID'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const result = args.typeId
            ? await getLaws('foundry', args.typeId, io)
            : await getLaws('foundry', io);
          return JSON.stringify(result);
        },
      }),

      foundry_config_validation: tool({
        description: 'Get validation commands for an artefact type',
        args: {
          typeId: tool.schema.string().describe('Artefact type ID'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const result = await getValidation('foundry', args.typeId, io);
          return JSON.stringify(result);
        },
      }),

      foundry_config_appraisers: tool({
        description: 'List all appraisers',
        args: {},
        async execute(_args, context) {
          const io = makeIO(context.worktree);
          const result = await getAppraisers('foundry', io);
          return JSON.stringify(result);
        },
      }),

      foundry_config_flow: tool({
        description: 'Get a flow definition',
        args: {
          flowId: tool.schema.string().describe('Flow ID'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const result = await getFlow('foundry', args.flowId, io);
          return JSON.stringify(result);
        },
      }),

      // ── Validate tool ──
      foundry_validate_run: tool({
        description: 'Run validation commands for an artefact type against a file',
        args: {
          typeId: tool.schema.string().describe('Artefact type ID'),
          file: tool.schema.string().describe('File path to validate'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const commands = await getValidation('foundry', args.typeId, io);
          if (!commands || commands.length === 0) return JSON.stringify({ error: 'No validation defined for type: ' + args.typeId });
          const results = [];
          for (const entry of commands) {
            const expanded = entry.command.replace(/\{file\}/g, args.file);
            try {
              const output = execSync(expanded, { cwd: context.worktree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
              results.push({ id: entry.id, command: expanded, passed: true, output: output.trim() });
            } catch (err) {
              results.push({ id: entry.id, command: expanded, passed: false, output: (err.stderr || err.stdout || err.message || '').trim(), failureMeans: entry.failureMeans });
            }
          }
          return JSON.stringify(results);
        },
      }),

      // ── Appraiser selection tool ──
      foundry_appraisers_select: tool({
        description: 'Select appraisers for an artefact type',
        args: {
          typeId: tool.schema.string().describe('Artefact type ID'),
          count: tool.schema.number().optional().describe('Number of appraisers to select'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const result = args.count
            ? await selectAppraisers('foundry', args.typeId, args.count, io)
            : await selectAppraisers('foundry', args.typeId, io);
          return JSON.stringify(result);
        },
      }),
    },
  };
};
