// Shared helpers for the Foundry plugin. Pure functions — no plugin deps.

import path from 'path';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync, renameSync, rmSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import matter from 'gray-matter';
import { getCycleDefinition } from '../../scripts/lib/config.js';
import { getOrOpenStore, getContext } from '../../scripts/lib/memory/singleton.js';
import { resolvePermissions } from '../../scripts/lib/memory/permissions.js';
import { renderMemoryPrompt } from '../../scripts/lib/memory/prompt.js';
import { loadExtractor } from '../../scripts/lib/assay/loader.js';
import { requireOnFlowBranch } from '../../scripts/lib/branch-guard.js';

// Track flow files we've already warned about to avoid spamming stderr
const warnedFlowFiles = new Set();

function parseFlowFrontmatter(text, entry) {
  const fm = extractFrontmatter(text);
  if (!fm) return null;
  const id = fm.id || entry.replace(/\.md$/, '');
  return {
    id,
    name: fm.name || id,
    startingCycles: resolveStartingCycles(fm),
  };
}

function extractFrontmatter(text) {
  const parsed = matter(text);
  return parsed.data && typeof parsed.data === 'object' && Object.keys(parsed.data).length > 0
    ? parsed.data
    : null;
}

function resolveStartingCycles(fm) {
  const sc = fm['starting-cycles'];
  return Array.isArray(sc) ? sc : [];
}

function parseFlowFile(entry, flowsDir) {
  try {
    const text = readFileSync(path.join(flowsDir, entry), 'utf-8');
    return parseFlowFrontmatter(text, entry);
  } catch (err) {
    if (!warnedFlowFiles.has(entry)) {
      console.warn(`Warning: Skipping malformed flow file ${entry}: ${err.message}`);
      warnedFlowFiles.add(entry);
    }
    const id = entry.replace(/\.md$/, '');
    return { id, name: id, startingCycles: [], error: err.message };
  }
}

function isFlowFile(entry) {
  return entry.endsWith('.md') && entry !== '.gitkeep';
}

export function listFlows(foundryDir) {
  const flowsDir = path.join(foundryDir, 'flows');
  if (!existsSync(flowsDir)) return [];
  const flows = [];
  for (const entry of readdirSync(flowsDir)) {
    if (!isFlowFile(entry)) continue;
    const parsed = parseFlowFile(entry, flowsDir);
    if (parsed) flows.push(parsed);
  }
  return flows;
}

// -- Bootstrap content helpers --

function buildFoundryNotInitializedMessage() {
  return `<FOUNDRY_CONTEXT>
Foundry is installed but not yet initialised in this project — there is no foundry/ directory.
The plugin will bootstrap the directory structure, generate stage agents, and install the
Foundry guide agent automatically on the next startup. The user may just need to restart
OpenCode for this to happen. Once initialised, direct the user to restart again so the new
agents register, then switch to the Foundry agent.
</FOUNDRY_CONTEXT>`;
}

function buildFlowList(flows) {
  if (flows.length === 0) {
    return '- (no flows defined yet — ask the Foundry agent to set one up)';
  }
  return flows.map(f => {
    const sc = f.startingCycles.length > 0 ? ` — starting cycles: ${f.startingCycles.join(', ')}` : '';
    return `- \`${f.id}\` — ${f.name}${sc}`;
  }).join('\n');
}

function buildFoundryInitializedMessage(flowList, packageRoot) {
  return `<FOUNDRY_CONTEXT>
Foundry is active in this project. The foundry/ directory contains the project's artefact
definitions, laws, appraisers, cycles, and flows. The user should switch to the Foundry agent
to author and run workflows.

Foundry is a skill-driven framework for governed artefact generation and evaluation.
The pipeline: assay (populate memory) → forge (produce) → quench (deterministic checks) → appraise (subjective evaluation) → human-appraise (human review) → iterate.

## Defined flows

${flowList}

When the user references any flow above — by id (e.g. "creative-flow"),
by name (e.g. "Creative Flow"), or by clear paraphrase (e.g. "the creative flow",
"use the creative pipeline") — ask the Foundry agent to run that flow with the user's
request as the goal. The Foundry agent handles cycle selection, work-branch creation, and
orchestration automatically.

## Foundry agent capabilities

The Foundry agent has internal workflows for pipeline execution, authoring, maintenance, memory administration, and dry-run trials. Present these capabilities as Foundry outcomes instead of naming internal skills.

## Multi-model routing

Foundry uses generated \`foundry-*\` stage agents for cycle stage dispatch. The user-facing \`Foundry\` agent is installed as \`.opencode/agents/foundry.md\` and should be used for authoring and running Foundry workflows.

All user content lives under foundry/.
Scripts are located at: ${path.join(packageRoot, 'scripts')}
</FOUNDRY_CONTEXT>`;
}

export function getBootstrapContent(directory, packageRoot, restartNeeded = false) {
  if (restartNeeded) {
    return `<FOUNDRY_CONTEXT>
Foundry has just been initialised in this project. The directory structure, stage agent files,
and Foundry guide agent have all been created. Tell the user to restart OpenCode now so the new
agents register. After restarting, the user should switch to the Foundry agent to author and
run workflows.
</FOUNDRY_CONTEXT>`;
  }

  const foundryDir = path.join(directory, 'foundry');
  const foundryExists = existsSync(foundryDir) && statSync(foundryDir).isDirectory();

  if (!foundryExists) {
    return buildFoundryNotInitializedMessage();
  }

  const flows = listFlows(foundryDir);
  const flowList = buildFlowList(flows);
  return buildFoundryInitializedMessage(flowList, packageRoot);
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
 * Factory for creating git-specific exec functions.
 * Returns a function that runs `git` with the supplied argv (no `git` prefix),
 * matching the contract expected by commitWithPolicy and other git-bridge helpers.
 */
export function makeExecGit(cwd) {
  return (argv) => execFileSync('git', argv, {
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

// -- buildCyclePromptExtras helpers --

function getExtractorNames(cycleDef) {
  const assayBlock = cycleDef?.frontmatter?.assay;
  return Array.isArray(assayBlock?.extractors) ? assayBlock.extractors : [];
}

function shouldLoadExtractors(cycleDef, stage) {
  const stageBase = typeof stage === 'string' ? stage.split(':')[0] : '';
  return stageBase === 'forge' && getExtractorNames(cycleDef).length > 0;
}

async function loadExtractors(worktree, cycleDef, io) {
  const extractorNames = getExtractorNames(cycleDef);
  const foundryDir = path.join(worktree, 'foundry');
  const extractors = [];
  for (const name of extractorNames) {
    try {
      const ex = await loadExtractor(foundryDir, name, io);
      extractors.push({ name: ex.name, body: ex.body });
    } catch (err) {
      if (process.env.FOUNDRY_DIAGNOSTICS === '1') {
        console.error(`buildCyclePromptExtras: Failed to load extractor '${name}': ${err.message}`);
      }
    }
  }
  return extractors.length > 0 ? extractors : undefined;
}

async function buildCyclePromptInternal({ worktree, cycleId, stage }) {
  const io = makeMemoryIO(worktree);
  const store = await getOrOpenStore({ worktreeRoot: worktree, io });
  const ctx = getContext(worktree);
  if (!ctx) return '';
  const cycleDef = await getCycleDefinition('foundry', cycleId, io);
  const perms = resolvePermissions({ cycleFrontmatter: cycleDef.frontmatter, vocabulary: ctx.vocabulary });

  let extractors;
  if (shouldLoadExtractors(cycleDef, stage)) {
    extractors = await loadExtractors(worktree, cycleDef, io);
  }

  return renderMemoryPrompt({ permissions: perms, schema: store?.schema, extractors });
}

/**
 * Build the memory-vocabulary block for a cycle's dispatch prompt.
 * Returns '' on any error (memory not initialised, drifted, etc.) so that
 * flow dispatch never fails due to memory.
 */
export async function buildCyclePromptExtras({ worktree, cycleId, stage }) {
  if (!cycleId) return '';
  try {
    return await buildCyclePromptInternal({ worktree, cycleId, stage });
  } catch (err) {
    if (process.env.FOUNDRY_DIAGNOSTICS === '1') {
      console.error(`buildCyclePromptExtras: Memory context failed for cycle '${cycleId}': ${err.message}`);
    }
    return '';
  }
}
