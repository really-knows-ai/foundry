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
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { tool } from '@opencode-ai/plugin';
import { loadHistory } from '../../scripts/lib/history.js';
import { parseFrontmatter, createWorkfile, enrichStages, parseModelsValue } from '../../scripts/lib/workfile.js';
import { parseArtefactsTable, addArtefactRow, setArtefactStatus } from '../../scripts/lib/artefacts.js';
import { addFeedbackItem, actionFeedbackItem, wontfixFeedbackItem, resolveFeedbackItem, listFeedback } from '../../scripts/lib/feedback.js';
import { getCycleDefinition, getArtefactType, getLaws, getValidation, getAppraisers, getFlow, selectAppraisers } from '../../scripts/lib/config.js';
import { slugify } from '../../scripts/lib/slug.js';
import { execSync, execFileSync } from 'child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readOrCreateSecret } from '../../scripts/lib/secret.js';
import { createPendingStore } from '../../scripts/lib/pending.js';
import { signToken, verifyToken } from '../../scripts/lib/token.js';
import {
  ensureFoundryDir, readActiveStage, writeActiveStage, clearActiveStage,
  readLastStage, writeLastStage,
} from '../../scripts/lib/state.js';
import { requireNoActiveStage, requireActiveStage, stageBaseOf } from '../../scripts/lib/stage-guard.js';
import { finalizeStage } from '../../scripts/lib/finalize.js';
// Memory tools (Plan 02)
import { getOrOpenStore, getContext } from '../../scripts/lib/memory/singleton.js';
import { loadMemoryConfig, writeMemoryConfig } from '../../scripts/lib/memory/config.js';
import { syncStore } from '../../scripts/lib/memory/store.js';
import { putEntity, relate as memRelate, unrelate as memUnrelate } from '../../scripts/lib/memory/writes.js';
import { getEntity, listEntities, neighbours as memNeighbours } from '../../scripts/lib/memory/reads.js';
import { runQuery } from '../../scripts/lib/memory/query.js';
import { resolvePermissions, checkEntityRead, checkEntityWrite, checkEdgeRead, checkEdgeWrite } from '../../scripts/lib/memory/permissions.js';
import { renderMemoryPrompt } from '../../scripts/lib/memory/prompt.js';
import { createEntityType as admCreateEntity } from '../../scripts/lib/memory/admin/create-entity-type.js';
import { createExtractor as admCreateExtractor } from '../../scripts/lib/memory/admin/create-extractor.js';
import { createEdgeType as admCreateEdge } from '../../scripts/lib/memory/admin/create-edge-type.js';
import { renameEntityType as admRenameEntity } from '../../scripts/lib/memory/admin/rename-entity-type.js';
import { renameEdgeType as admRenameEdge } from '../../scripts/lib/memory/admin/rename-edge-type.js';
import { dropEntityType as admDropEntity } from '../../scripts/lib/memory/admin/drop-entity-type.js';
import { dropEdgeType as admDropEdge } from '../../scripts/lib/memory/admin/drop-edge-type.js';
import { resetMemory as admReset } from '../../scripts/lib/memory/admin/reset.js';
import { validateMemory as admValidate } from '../../scripts/lib/memory/admin/validate.js';
import { dumpMemory as admDump } from '../../scripts/lib/memory/admin/dump.js';
import { vacuumMemory as admVacuum } from '../../scripts/lib/memory/admin/vacuum.js';
import { embed as memEmbed, probeEmbeddings as memProbeEmbeddings } from '../../scripts/lib/memory/embeddings.js';
import { search as memSearch } from '../../scripts/lib/memory/search.js';
import { reembed as admReembed } from '../../scripts/lib/memory/admin/reembed.js';
import { initMemory as admInitMemory } from '../../scripts/lib/memory/admin/init.js';
import { runAssay } from '../../scripts/lib/assay/run.js';
import { loadExtractor } from '../../scripts/lib/assay/loader.js';

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

- **Pipeline:** forge, quench, appraise, orchestrate, flow, human-appraise
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
    mkdir: (p) => mkdirSync(resolve(p), { recursive: true }),
    unlink: (p) => { if (existsSync(resolve(p))) unlinkSync(resolve(p)); },
    // exec: run a shell command in the worktree and return stdout as a UTF-8 string.
    // Used by sort.js (getDirtyToolManagedFiles, getModifiedFiles) for git enforcement.
    // Call sites pass full shell strings (e.g. 'git status --porcelain ...'), so we
    // must use execSync rather than execFileSync. Throws on non-zero exit; callers
    // already wrap in try/catch.
    exec: (cmd) => execSync(cmd, { cwd: directory, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }),
  };
}

function makeMemoryIO(directory) {
  // Memory modules use await on every I/O op. Wrap sync fs calls in Promise-returning shims.
  const sync = makeIO(directory);
  return {
    exists: async (p) => sync.exists(p),
    readFile: async (p) => sync.readFile(p),
    writeFile: async (p, c) => sync.writeFile(p, c),
    readDir: async (p) => { try { return sync.readDir(p); } catch { return []; } },
    mkdir: async (p) => sync.mkdir(p),
    unlink: async (p) => sync.unlink(p),
  };
}

function errorJson(err) {
  return JSON.stringify({ error: err.message ?? String(err) });
}

async function withStore(context) {
  const io = makeMemoryIO(context.worktree);
  const store = await getOrOpenStore({ worktreeRoot: context.worktree, io });
  const ctx = getContext(context.worktree);
  const embeddingsCfg = ctx?.config?.embeddings;
  const schemaEmbeddings = ctx?.schema?.embeddings;
  // `embedder` follows the provider config (enabled → available for queries
  // like search/probe). `writeEmbedder` additionally requires that the schema
  // declare vector dimensions (i.e. init-memory has provisioned the typed
  // column); otherwise put paths stay embedding-free to keep the relation
  // compatible with the non-HNSW column type.
  const embedder = embeddingsCfg && embeddingsCfg.enabled
    ? (inputs) => memEmbed({ config: embeddingsCfg, inputs })
    : null;
  const writeEmbedder = embedder && schemaEmbeddings && schemaEmbeddings.dimensions
    ? embedder
    : null;
  let permissions = null;
  if (context.cycle) {
    try {
      const cycleDef = await getCycleDefinition('foundry', context.cycle, io);
      permissions = resolvePermissions({ cycleFrontmatter: cycleDef.frontmatter, vocabulary: ctx.vocabulary });
    } catch {
      permissions = null;
    }
  }
  return {
    io,
    store,
    vocabulary: ctx.vocabulary,
    permissions,
    embedder,
    writeEmbedder,
    syncIfOutOfCycle: async () => { if (!context.cycle) await syncStore({ store, io }); },
  };
}

/**
 * Build the memory-vocabulary block for a cycle's dispatch prompt.
 * Returns '' on any error (memory not initialised, drifted, etc.) so that
 * flow dispatch never fails due to memory.
 */
export async function buildCyclePromptExtras({ worktree, cycleId, stage }) {
  if (!cycleId) return '';
  try {
    const io = makeMemoryIO(worktree);
    const store = await getOrOpenStore({ worktreeRoot: worktree, io });
    const ctx = getContext(worktree);
    if (!ctx) return '';
    const cycleDef = await getCycleDefinition('foundry', cycleId, io);
    const perms = resolvePermissions({ cycleFrontmatter: cycleDef.frontmatter, vocabulary: ctx.vocabulary });

    // Load extractor prose briefs only for the forge stage of assay-enabled cycles.
    // Forge is the consumer that reads the populated memory; the assay stage itself
    // doesn't need the briefs (it just runs commands).
    let extractors;
    const stageBase = typeof stage === 'string' ? stage.split(':')[0] : '';
    const assayBlock = cycleDef?.frontmatter?.assay;
    const extractorNames = Array.isArray(assayBlock?.extractors) ? assayBlock.extractors : [];
    if (stageBase === 'forge' && extractorNames.length > 0) {
      extractors = [];
      const foundryDir = path.join(worktree, 'foundry');
      for (const name of extractorNames) {
        try {
          const ex = await loadExtractor(foundryDir, name, io);
          extractors.push({ name: ex.name, body: ex.body });
        } catch {
          // Skip extractors that fail to load; never block prompt rendering.
        }
      }
      if (extractors.length === 0) extractors = undefined;
    }

    return renderMemoryPrompt({ permissions: perms, schema: store?.schema, extractors });
  } catch {
    return '';
  }
}

export const FoundryPlugin = async ({ directory }) => {
  // Bootstrap per-worktree HMAC secret (created on first boot, persisted to .foundry/secret).
  // Note: `directory` is the worktree root at plugin-boot time. Per-invocation `context.worktree`
  // may differ in multi-worktree setups — we still use `context.worktree` inside tool `execute`
  // bodies to locate `.foundry/` on disk, and use the plugin-boot `secret` only for
  // signing/verifying. A worktree change mid-session would mismatch; deferred out of v2.2.0 scope.
  const secret = readOrCreateSecret(directory);
  const pending = createPendingStore();

  const plugin = {
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

      // ── Stage lifecycle tools ──
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

      // ── Workfile tools ──
      foundry_workfile_create: tool({
        description: 'Create WORK.md with frontmatter and goal',
        args: {
          flow: tool.schema.string().describe('Flow name'),
          cycle: tool.schema.string().describe('Cycle name'),
          stages: tool.schema.array(tool.schema.string()).optional().describe('Ordered stage names'),
          maxIterations: tool.schema.number().optional().describe('Maximum iterations'),
          goal: tool.schema.string().describe('Goal text'),
          models: tool.schema.string().optional().describe('Per-stage model overrides as JSON object, e.g. \'{"forge":"openai/gpt-4o"}\''),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const guard = requireNoActiveStage(io);
          if (!guard.ok) return JSON.stringify({ error: `foundry_workfile_create ${guard.error}` });
          const workPath = path.join(context.worktree, 'WORK.md');
          if (existsSync(workPath)) {
            return JSON.stringify({ error: 'foundry_workfile_create requires no WORK.md; current: exists' });
          }
          const fm = { flow: args.flow, cycle: args.cycle };
          if (args.stages) {
            fm.stages = enrichStages(args.stages, args.cycle);
          }
          if (args.maxIterations !== undefined) {
            fm['max-iterations'] = args.maxIterations;
          }
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

      foundry_workfile_delete: tool({
        description: 'Delete WORK.md and WORK.history.yaml (requires confirm:true)',
        args: {
          confirm: tool.schema.boolean().describe('Must be true to confirm deletion'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const guard = requireNoActiveStage(io);
          if (!guard.ok) return JSON.stringify({ error: `foundry_workfile_delete ${guard.error}` });
          if (args.confirm !== true) {
            return JSON.stringify({ error: 'foundry_workfile_delete requires {confirm: true}' });
          }
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

      // ── Orchestrate tool ──
      foundry_orchestrate: tool({
        description: 'Run the next step of the current cycle. Call with no args on first invocation; call with lastResult={ok,error?} after a dispatch/human_appraise completes. Returns {action, ...} describing what the caller should do next.',
        args: {
          lastResult: tool.schema.object({
            ok: tool.schema.boolean(),
            error: tool.schema.string().optional(),
          }).optional(),
          cycleDef: tool.schema.string().optional().describe('Test-mode cycle definition override (path to cycle file)'),
        },
        async execute(args, context) {
          const { runOrchestrate } = await import('../../scripts/orchestrate.js');
          const io = makeIO(context.worktree);
          const cwd = context.worktree;

          // Mint: same pattern as removed foundry_sort.
          const mint = ({ route, cycle, exp }) => {
            const nonce = randomUUID();
            const payload = { route, cycle, nonce, exp };
            pending.add(nonce, payload);
            return signToken(payload, secret);
          };

          // Git bridge: commit staged changes with a cycle-prefixed message.
          const git = {
            commit: (msg) => {
              execFileSync('git', ['add', '.'], { cwd, encoding: 'utf8' });
              execFileSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf8' });
              return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
            },
            status: () => {
              const out = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim();
              return { clean: out === '', dirty: out.split('\n').filter(Boolean) };
            },
          };

          // Finalize bridge: mimics the deleted foundry_stage_finalize body.
          const finalize = async ({ cycleId, stage, baseSha }) => {
            let cycleDoc;
            try {
              cycleDoc = await getCycleDefinition('foundry', cycleId, io);
            } catch (e) {
              return { ok: false, error: e.message };
            }
            const outputType = cycleDoc.frontmatter.output;
            const cycleDef = { outputArtefactType: outputType };
            const artefactTypes = {};
            if (outputType) {
              try {
                const artDoc = await getArtefactType('foundry', outputType, io);
                artefactTypes[outputType] = { filePatterns: artDoc.frontmatter['file-patterns'] || [] };
              } catch {
                artefactTypes[outputType] = { filePatterns: [] };
              }
            }
            const workPath = path.join(cwd, 'WORK.md');
            const result = finalizeStage({
              cwd,
              baseSha,
              stageBase: stageBaseOf(stage),
              cycleDef,
              artefactTypes,
              registerArtefact: ({ file, type, status }) => {
                const text = readFileSync(workPath, 'utf-8');
                const updated = addArtefactRow(text, { file, type, cycle: cycleId, status });
                writeFileSync(workPath, updated, 'utf-8');
              },
            });
            return result;
          };

          try {
            const result = await runOrchestrate({
              cwd, cycleDef: args.cycleDef, git, mint, finalize,
              now: () => Date.now(),
              lastResult: args.lastResult ?? null,
            }, io);
            // Inject memory vocabulary block into dispatch prompt, if any.
            if (result && result.action === 'dispatch' && typeof result.prompt === 'string') {
              const cycleId = result.cycle ?? (typeof result.stage === 'string' ? result.stage.split(':')[1] : null);
              const extras = await buildCyclePromptExtras({ worktree: cwd, cycleId, stage: result.stage });
              if (extras) {
                result.prompt = `${result.prompt}\n\n${extras}`;
              }
            }
            return JSON.stringify(result);
          } catch (e) {
            return JSON.stringify({ action: 'violation', details: `orchestrate threw: ${e.message}`, recoverable: false, affected_files: [] });
          }
        },
      }),

      // ── Artefacts tools ──
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

      // ── Feedback tools ──
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

      // ── Git tools ──
      foundry_git_branch: tool({
        description: 'Create and checkout a work branch for a flow',
        args: {
          flowId: tool.schema.string().describe('Flow ID'),
          description: tool.schema.string().describe('Branch description suffix'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const guard = requireNoActiveStage(io);
          if (!guard.ok) return JSON.stringify({ error: `foundry_git_branch ${guard.error}` });
          const flowSlug = slugify(args.flowId);
          const descSlug = slugify(args.description);
          const branch = `work/${flowSlug}-${descSlug}`;
          execFileSync('git', ['checkout', '-b', branch], { cwd: context.worktree, encoding: 'utf8', stdio: 'pipe' });
          return JSON.stringify({ ok: true, branch });
        },
      }),

      foundry_git_finish: tool({
        description: 'Clean up work files, squash merge to base branch, and delete the work branch',
        args: {
          message: tool.schema.string().describe('Squash merge commit message'),
          baseBranch: tool.schema.string().optional().describe('Target branch (default: main)'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const guard = requireNoActiveStage(io);
          if (!guard.ok) return JSON.stringify({ error: `foundry_git_finish ${guard.error}` });
          const base = args.baseBranch || 'main';
          const cwd = context.worktree;
          const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

          // Get current branch name
          const workBranch = execFileSync('git', ['branch', '--show-current'], opts).trim();
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
            execFileSync('git', ['add', '-A'], opts);
            const status = execFileSync('git', ['status', '--porcelain'], opts).trim();
            if (status) {
              const cleanupMsg = `[${workBranch.replace('work/', '')}] cleanup: remove work files`;
              execFileSync('git', ['commit', '-m', cleanupMsg], opts);
            }
          } catch { /* no changes to commit */ }

          // Switch to base and squash merge
          execFileSync('git', ['checkout', base], opts);
          execFileSync('git', ['merge', '--squash', workBranch], opts);
          execFileSync('git', ['commit', '-m', args.message], opts);
          const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();

          // Force-delete work branch (required after squash)
          execFileSync('git', ['branch', '-D', workBranch], opts);

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

      foundry_assay_run: tool({
        description: 'Run extractors to populate flow memory. Only callable during an active assay stage. Aborts on first failure; writes #validation feedback against WORK.md on abort.',
        args: {
          cycle: tool.schema.string().describe('Cycle name'),
          extractors: tool.schema.array(tool.schema.string()).describe('Extractor names, executed in order'),
        },
        async execute(args, context) {
          const io = makeIO(context.worktree);
          const guard = requireActiveStage(io, { stageBase: 'assay', cycle: args.cycle });
          if (!guard.ok) return JSON.stringify({ error: `foundry_assay_run requires active assay stage for cycle '${args.cycle}'; ${guard.error}` });
          try {
            const memIo = makeMemoryIO(context.worktree);
            const store = await getOrOpenStore({ worktreeRoot: context.worktree, io: memIo });
            const ctx = getContext(context.worktree);
            const res = await runAssay({
              foundryDir: 'foundry',
              cwd: context.worktree,
              io: memIo,
              extractors: args.extractors,
              store,
              vocabulary: ctx.vocabulary,
              putEntity,
              relate: memRelate,
            });
            if (!res.ok) {
              try {
                const workPath = 'WORK.md';
                if (await memIo.exists(workPath)) {
                  const text = await memIo.readFile(workPath);
                  const msg = `assay aborted on extractor \`${res.failedExtractor}\`: ${res.reason}` +
                    (res.stderr ? ` (stderr: ${res.stderr.trim().slice(0, 500)})` : '');
                  const out = addFeedbackItem(text, 'WORK.md', msg, 'validation');
                  await memIo.writeFile(workPath, out.text);
                }
              } catch (_err) { /* best effort */ }
            }
            return JSON.stringify(res);
          } catch (err) {
            return errorJson(err);
          }
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
          return JSON.stringify(result);
        },
      }),

      // ── Memory tools ──
      foundry_memory_put: tool({
        description: 'Upsert an entity into flow memory. Value must be ≤4KB.',
        args: {
          type: tool.schema.string().describe('Entity type (must be declared)'),
          name: tool.schema.string().describe('Entity name (unique within type)'),
          value: tool.schema.string().describe('Free-text intrinsic description (≤4KB)'),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary, permissions, writeEmbedder, syncIfOutOfCycle } = await withStore(context);
            if (permissions && !checkEntityWrite(permissions, args.type)) {
              return errorJson(new Error(`cycle '${context.cycle}' does not have write permission on entity type '${args.type}'`));
            }
            await putEntity(store, args, vocabulary, { embedder: writeEmbedder });
            await syncIfOutOfCycle();
            return JSON.stringify({ ok: true });
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_relate: tool({
        description: 'Upsert an edge between two entities.',
        args: {
          from_type: tool.schema.string(),
          from_name: tool.schema.string(),
          edge_type: tool.schema.string(),
          to_type: tool.schema.string(),
          to_name: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary, permissions, syncIfOutOfCycle } = await withStore(context);
            if (permissions && !checkEdgeWrite(permissions, args.edge_type)) {
              return errorJson(new Error(`cycle '${context.cycle}' does not have write permission on edge type '${args.edge_type}'`));
            }
            await memRelate(store, args, vocabulary);
            await syncIfOutOfCycle();
            return JSON.stringify({ ok: true });
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_unrelate: tool({
        description: 'Delete an edge between two entities.',
        args: {
          from_type: tool.schema.string(),
          from_name: tool.schema.string(),
          edge_type: tool.schema.string(),
          to_type: tool.schema.string(),
          to_name: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary, permissions, syncIfOutOfCycle } = await withStore(context);
            if (permissions && !checkEdgeWrite(permissions, args.edge_type)) {
              return errorJson(new Error(`cycle '${context.cycle}' does not have write permission on edge type '${args.edge_type}'`));
            }
            await memUnrelate(store, args, vocabulary);
            await syncIfOutOfCycle();
            return JSON.stringify({ ok: true });
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_get: tool({
        description: 'Fetch a single entity by composite key (type, name).',
        args: {
          type: tool.schema.string(),
          name: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const { store, permissions } = await withStore(context);
            if (permissions && !checkEntityRead(permissions, args.type)) {
              return JSON.stringify(null);
            }
            const ent = await getEntity(store, args);
            return JSON.stringify(ent);
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_list: tool({
        description: 'List all entities of a given type.',
        args: {
          type: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const { store, permissions } = await withStore(context);
            if (permissions && !checkEntityRead(permissions, args.type)) {
              return JSON.stringify([]);
            }
            const out = await listEntities(store, args);
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_neighbours: tool({
        description: 'Bounded graph traversal from an entity. Returns entities and edges within `depth` hops.',
        args: {
          type: tool.schema.string(),
          name: tool.schema.string(),
          depth: tool.schema.number().optional().describe('Default 1'),
          edge_types: tool.schema.array(tool.schema.string()).optional().describe('Restrict traversal to named edges'),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary, permissions } = await withStore(context);
            if (permissions && !checkEntityRead(permissions, args.type)) {
              return JSON.stringify({ entities: [], edges: [] });
            }
            const edgeTypesInput = args.edge_types ?? Object.keys(vocabulary.edges);
            const filteredEdgeTypes = permissions
              ? edgeTypesInput.filter((e) => checkEdgeRead(permissions, e))
              : edgeTypesInput;
            const result = await memNeighbours(store, { ...args, edge_types: filteredEdgeTypes }, vocabulary);
            const filtered = permissions
              ? {
                  entities: result.entities.filter((e) => checkEntityRead(permissions, e.type)),
                  edges: result.edges.filter((e) =>
                    checkEntityRead(permissions, e.from_type) && checkEntityRead(permissions, e.to_type),
                  ),
                }
              : result;
            return JSON.stringify(filtered);
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_query: tool({
        description: 'Arbitrary read-only Cozo Datalog query. Rejects :put, :rm, :create, ::remove. Returns {headers, rows}.',
        args: {
          datalog: tool.schema.string().describe('Cozo Datalog query (read-only)'),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary, permissions } = await withStore(context);
            if (permissions) {
              const allowed = new Set([
                ...[...permissions.readTypes].map((t) => `ent_${t}`),
                ...Object.keys(vocabulary.edges).filter((e) => checkEdgeRead(permissions, e)).map((e) => `edge_${e}`),
              ]);
              const referenced = Array.from(args.datalog.matchAll(/\bent_[a-z0-9_]+\b|\bedge_[a-z0-9_]+\b/g)).map((m) => m[0]);
              for (const r of referenced) {
                if (!allowed.has(r)) {
                  return errorJson(new Error(`cycle '${context.cycle}' cannot query relation '${r}' (not in read permissions)`));
                }
              }
            }
            const out = await runQuery(store, args.datalog);
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),

      foundry_memory_create_entity_type: tool({
        description: 'Create a new entity type with a prose body brief.',
        args: {
          name: tool.schema.string(),
          body: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admCreateEntity({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_extractor_create: tool({
        description: 'Create a new extractor definition under foundry/memory/extractors/.',
        args: {
          name: tool.schema.string(),
          command: tool.schema.string(),
          memoryWrite: tool.schema.array(tool.schema.string()),
          body: tool.schema.string(),
          timeout: tool.schema.string().optional(),
        },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admCreateExtractor({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_create_edge_type: tool({
        description: 'Create a new edge type.',
        args: {
          name: tool.schema.string(),
          sources: tool.schema.union([tool.schema.literal('any'), tool.schema.array(tool.schema.string())]),
          targets: tool.schema.union([tool.schema.literal('any'), tool.schema.array(tool.schema.string())]),
          body: tool.schema.string(),
        },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admCreateEdge({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_rename_entity_type: tool({
        description: 'Rename an entity type and cascade updates to edges and rows.',
        args: { from: tool.schema.string(), to: tool.schema.string() },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admRenameEntity({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_rename_edge_type: tool({
        description: 'Rename an edge type.',
        args: { from: tool.schema.string(), to: tool.schema.string() },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admRenameEdge({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_drop_entity_type: tool({
        description:
          'Destructive. Delete an entity type and cascade to affected edges. Call without confirm (or confirm:false) to get a preview of what would be deleted. Pass confirm:true to actually drop.',
        args: { name: tool.schema.string(), confirm: tool.schema.boolean().optional() },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admDropEntity({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_drop_edge_type: tool({
        description:
          'Destructive. Delete an edge type. Call without confirm (or confirm:false) to preview row count. Pass confirm:true to actually drop.',
        args: { name: tool.schema.string(), confirm: tool.schema.boolean().optional() },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admDropEdge({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_reset: tool({
        description: 'Destructive. Purge all memory data (keeps type definitions). Requires confirm: true.',
        args: { confirm: tool.schema.boolean() },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admReset({ worktreeRoot: context.worktree, io, ...args });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_validate: tool({
        description: 'Run load-time and drift checks; returns a report.',
        args: {},
        async execute(_args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            return JSON.stringify(await admValidate({ io }));
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_init: tool({
        description:
          'Scaffold foundry/memory/: creates entities/edges/relations dirs with .gitkeep, writes config.md and schema.json, appends .gitignore entries, and optionally probes the embedding provider. Fails if foundry/memory/ already exists.',
        args: {
          embeddings_enabled: tool.schema.boolean().optional(),
          probe: tool.schema.boolean().optional(),
        },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            const out = await admInitMemory({
              io,
              embeddingsEnabled: args.embeddings_enabled ?? true,
              probe: args.probe ?? true,
            });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_dump: tool({
        description: 'Human-readable snapshot of memory. Optional type + name.',
        args: {
          type: tool.schema.string().optional(),
          name: tool.schema.string().optional(),
          depth: tool.schema.number().optional(),
        },
        async execute(args, context) {
          try {
            const { store, vocabulary } = await withStore(context);
            return await admDump({ store, vocabulary, ...args });
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_vacuum: tool({
        description: 'Compact the Cozo database.',
        args: {},
        async execute(_args, context) {
          try {
            const { store } = await withStore(context);
            return JSON.stringify(await admVacuum({ store }));
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_search: tool({
        description: 'Semantic nearest-neighbour search over entity values. Requires embeddings enabled.',
        args: {
          query_text: tool.schema.string(),
          k: tool.schema.number().optional().describe('Default 5'),
          type_filter: tool.schema.array(tool.schema.string()).optional(),
        },
        async execute(args, context) {
          try {
            const { store, permissions, embedder, vocabulary } = await withStore(context);
            if (!embedder) return errorJson(new Error('embeddings are disabled in memory config'));

            let types = args.type_filter && args.type_filter.length > 0
              ? args.type_filter
              : Object.keys(vocabulary.entities);
            if (permissions) types = types.filter((t) => checkEntityRead(permissions, t));

            const out = await memSearch({
              store,
              query_text: args.query_text,
              k: args.k ?? 5,
              type_filter: types,
              embedder,
            });
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
      foundry_memory_change_embedding_model: tool({
        description: 'Swap the embedding model and re-embed all existing entities.',
        args: {
          model: tool.schema.string(),
          dimensions: tool.schema.number(),
          baseURL: tool.schema.string().optional(),
          apiKey: tool.schema.string().optional(),
        },
        async execute(args, context) {
          try {
            const io = makeMemoryIO(context.worktree);
            // Load config fresh from disk: the singleton context is only
            // populated once a store is opened, which isn't guaranteed here.
            const currentConfig = await loadMemoryConfig('foundry', io);
            const baseConfig = currentConfig.embeddings;
            const newConfig = {
              ...baseConfig,
              enabled: true,
              model: args.model,
              dimensions: args.dimensions,
              baseURL: args.baseURL ?? baseConfig.baseURL,
              apiKey: args.apiKey ?? baseConfig.apiKey,
            };
            const probe = await memProbeEmbeddings({ config: newConfig });
            if (!probe.ok) return errorJson(new Error(`probe failed: ${probe.error}`));
            if (probe.dimensions !== args.dimensions) {
              return errorJson(new Error(`provider returned ${probe.dimensions}-dim vectors, config declares ${args.dimensions}`));
            }
            const dbAbsolutePath = path.join(context.worktree, 'foundry/memory/memory.db');
            const embedder = (inputs) => memEmbed({ config: newConfig, inputs });
            const out = await admReembed({
              worktreeRoot: context.worktree,
              io, dbAbsolutePath,
              newModel: args.model,
              newDimensions: args.dimensions,
              embedder,
            });
            // Persist the new embeddings block to config.md so a subsequent
            // session (which re-reads config from disk) stays in sync with
            // schema.json. Only runs on successful reembed.
            await writeMemoryConfig('foundry', { embeddings: newConfig }, io);
            return JSON.stringify(out);
          } catch (err) { return errorJson(err); }
        },
      }),
    },
  };

  Object.defineProperty(plugin, Symbol.for('foundry.test.pending'), { value: pending });
  Object.defineProperty(plugin, Symbol.for('foundry.test.secret'), { value: secret });
  return plugin;
};
