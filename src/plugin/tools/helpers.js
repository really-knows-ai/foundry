// Shared helpers for the Foundry plugin. Pure functions — no plugin deps.

import path from 'path';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync, renameSync, rmSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { getCycleDefinition } from '../../scripts/lib/config.js';
import { getOrOpenStore, getContext } from '../../scripts/lib/memory/singleton.js';
import { resolvePermissions } from '../../scripts/lib/memory/permissions.js';
import { renderMemoryPrompt } from '../../scripts/lib/memory/prompt.js';
import { loadExtractor } from '../../scripts/lib/assay/loader.js';
import { requireOnFlowBranch } from '../../scripts/lib/branch-guard.js';

// Track flow files we've already warned about to avoid spamming stderr
const warnedFlowFiles = new Set();

export function listFlows(foundryDir) {
  const flowsDir = path.join(foundryDir, 'flows');
  if (!existsSync(flowsDir)) return [];
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
    } catch (err) {
      // Include malformed flows with an error field so the caller knows something is wrong.
      const id = entry.replace(/\.md$/, '');
      flows.push({ 
        id, 
        name: id, 
        startingCycles: [], 
        error: err.message 
      });
      if (!warnedFlowFiles.has(entry)) {
        console.warn(`Warning: Skipping malformed flow file ${entry}: ${err.message}`);
        warnedFlowFiles.add(entry);
      }
    }
  }
  return flows;
}

export function getBootstrapContent(directory, packageRoot) {
  const foundryDir = path.join(directory, 'foundry');
  const foundryExists = existsSync(foundryDir) && statSync(foundryDir).isDirectory();

  if (!foundryExists) {
    return `<FOUNDRY_CONTEXT>
Foundry is installed but not initialised in this project. There is no foundry/ directory.

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
The pipeline: assay (populate memory) → forge (produce) → quench (deterministic checks) → appraise (subjective evaluation) → human-appraise (human review) → iterate.

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

- **Pipeline:** assay, forge, quench, appraise, orchestrate, flow, human-appraise
- **Authoring:** add-artefact-type, add-law, add-appraiser, add-cycle, add-flow, add-memory-entity-type, add-memory-edge-type, add-extractor, init-foundry
- **Maintenance:** upgrade-foundry, refresh-agents, list-agents, init-memory, change-embedding-model, dry-run
- **Memory Admin:** drop-memory-entity-type, drop-memory-edge-type, rename-memory-entity-type, rename-memory-edge-type, reset-memory

## Multi-model routing

Foundry uses \`foundry-*\` sub-agents defined as markdown files in \`.opencode/agents/\`.
Run the \`refresh-agents\` skill to regenerate them after adding or removing providers.
Cycle definitions can specify per-stage models via the \`models\` frontmatter map. Appraisers can override with their own \`model\` field.

All user content lives under foundry/.
Scripts are located at: ${path.join(packageRoot, 'scripts')}
</FOUNDRY_CONTEXT>`;
}

/**
 * Factory for creating exec functions used across plugin tools.
 * Returns a function that executes commands via execFileSync.
 * Used by tools that need to run git or other CLI commands.
 */
export function makeExec(cwd) {
  return (argv) => execFileSync(argv[0], argv.slice(1), {
    cwd, encoding: 'utf8', stdio: 'pipe',
  });
}

/**
 * Guard function that ensures a tool is called on a flow branch (work/* or dry-run/*).
 * Used by guarded() to enforce branch requirements for flow-tier mutations.
 * Returns the result of requireOnFlowBranch({ exec }).
 */
export function flowBranchGuard(_args, context) {
  return requireOnFlowBranch({ exec: makeExec(context.worktree) });
}

export function makeIO(directory) {
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(directory, p);
  return {
    exists: (p) => existsSync(resolve(p)),
    readFile: (p) => readFileSync(resolve(p), 'utf-8'),
    writeFile: (p, content) => writeFileSync(resolve(p), content, 'utf-8'),
    readDir: (p) => readdirSync(resolve(p)),
    mkdir: (p) => mkdirSync(resolve(p), { recursive: true }),
    // unlink: succeeds silently when the file is missing.
    unlink: (p) => { if (existsSync(resolve(p))) unlinkSync(resolve(p)); },
    rename: (from, to) => renameSync(resolve(from), resolve(to)),
    // exec: run a command in the worktree and return stdout as a UTF-8 string.
    // Used by sort.js (getDirtyToolManagedFiles, getModifiedFiles) for git enforcement.
    // Takes an array [command, ...args] to prevent shell injection.
    // Throws on non-zero exit; callers already wrap in try/catch.
    exec: (argv) => execFileSync(argv[0], argv.slice(1), { cwd: directory, encoding: 'utf8', stdio: 'pipe' }),
  };
}

/**
 * Factory used by guarded() to resolve the current branch.
 * Returns an object exposing `exec(argv: string[]) => string` (stdout).
 */
export function branchIoFactory(context) {
  const cwd = context.worktree;
  return {
    exec: (argv) => execFileSync(argv[0], argv.slice(1),
      { cwd, encoding: 'utf8', stdio: 'pipe' }),
  };
}

/**
 * Factory used by guarded() for tracing IO. Returns the existing
 * async IO shape (mkdirp/exists/readFile/writeFile) plus an
 * `appendFile` for trace appends.
 */
export function asyncIoFactory(context) {
  const sync = makeIO(context.worktree);
  return {
    exists: async (p) => sync.exists(p),
    readFile: async (p) => sync.readFile(p),
    writeFile: async (p, c) => sync.writeFile(p, c),
    mkdirp: async (p) => sync.mkdir(p),
    appendFile: async (p, c) => {
      const existing = sync.exists(p) ? sync.readFile(p) : '';
      sync.writeFile(p, existing + c);
    },
  };
}

export function makeMemoryIO(directory) {
  // Memory modules use await on every I/O op. Wrap sync fs calls in Promise-returning shims.
  const sync = makeIO(directory);
  return {
    exists: async (p) => sync.exists(p),
    readFile: async (p) => sync.readFile(p),
    writeFile: async (p, c) => sync.writeFile(p, c),
    readDir: async (p) => { try { return sync.readDir(p); } catch { return []; } },
    mkdir: async (p) => sync.mkdir(p),
    unlink: async (p) => sync.unlink(p),
    rename: async (from, to) => sync.rename(from, to),
  };
}

export function errorJson(err) {
  return JSON.stringify({ error: err.message ?? String(err) });
}

/**
 * Async IO contract consumed by the config-creators layer.
 *
 * The creators take an io with `exists, readFile, writeFile, mkdirp,
 * readDir`. We reuse `makeIO`'s sync fs calls and wrap them in
 * Promise-returning shims; `makeIO.mkdir` already passes
 * `{ recursive: true }`, so it satisfies `mkdirp` semantics.
 */
export function makeAsyncIO(directory) {
  const sync = makeIO(directory);
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(directory, p);
  return {
    exists: async (p) => sync.exists(p),
    readFile: async (p) => sync.readFile(p),
    writeFile: async (p, c) => sync.writeFile(p, c),
    mkdirp: async (p) => sync.mkdir(p),
    readDir: async (p) => { try { return sync.readDir(p); } catch { return []; } },
    // `readdir` (lowercase) alias matching the snapshot inspect.js contract.
    readdir: async (p) => { try { return sync.readDir(p); } catch { return []; } },
    rm: async (p, opts = {}) => {
      const full = resolve(p);
      if (existsSync(full)) {
        rmSync(full, { recursive: !!opts.recursive, force: true });
      }
    },
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
    // Forge is the consumer that reads the populated memory; the assay stage
    // only runs commands.
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
        } catch (err) {
          if (process.env.FOUNDRY_DIAGNOSTICS === '1') {
            console.error(`buildCyclePromptExtras: Failed to load extractor '${name}': ${err.message}`);
          }
          // Skip extractors that fail to load; never block prompt rendering.
        }
      }
      if (extractors.length === 0) extractors = undefined;
    }

    return renderMemoryPrompt({ permissions: perms, schema: store?.schema, extractors });
  } catch (err) {
    if (process.env.FOUNDRY_DIAGNOSTICS === '1') {
      console.error(`buildCyclePromptExtras: Memory context failed for cycle '${cycleId}': ${err.message}`);
    }
    return '';
  }
}
