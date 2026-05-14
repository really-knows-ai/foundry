// Shared agent-refresh utility for the Foundry plugin.
// Provides refreshAgents, detectChanges, and writeFoundryGuideAgent
// used by both the config hook and the foundry_refresh_agents tool.

import path from 'path';
import { execFileSync } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { resolveOpenCode } from '../../scripts/lib/tool-paths.js';

const AGENT_FRONTMATTER_TEMPLATE = `---
description: "Foundry stage agent using MODEL_ID"
mode: subagent
model: "MODEL_ID"
hidden: true
---
You are a Foundry stage agent. Follow the skill instructions provided in your task prompt exactly.
`;

function makeSlug(modelId) {
  return modelId.replace(/[/.]/g, '-');
}

function buildAgentContent(modelId) {
  return AGENT_FRONTMATTER_TEMPLATE.replace(/MODEL_ID/g, modelId);
}

function listModels(worktree) {
  const stdout = execFileSync(resolveOpenCode(), ['models'], {
    cwd: worktree,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FOUNDRY_SKIP_BOOTSTRAP: '1' },
  });
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function deleteStaleAgents(agentsDir) {
  let existing;
  try {
    existing = readdirSync(agentsDir);
  } catch {
    existing = [];
  }
  for (const entry of existing) {
    if (entry.startsWith('foundry-') && entry.endsWith('.md')) {
      unlinkSync(path.join(agentsDir, entry));
    }
  }
}

function writeAgentFiles(agentsDir, models) {
  for (const modelId of models) {
    const slug = makeSlug(modelId);
    const filePath = path.join(agentsDir, `foundry-${slug}.md`);
    writeFileSync(filePath, buildAgentContent(modelId), 'utf8');
  }
}

/**
 * Snapshot the current foundry-*.md agent files in the agents directory.
 * Returns a plain object mapping filename → sha256 hex digest.
 * Returns an empty object when the directory does not exist.
 */
function takeSnapshot(agentsDir) {
  const snapshot = {};
  try {
    const entries = readdirSync(agentsDir)
      .filter(e => e.startsWith('foundry-') && e.endsWith('.md'))
      .sort();
    for (const entry of entries) {
      const content = readFileSync(path.join(agentsDir, entry));
      snapshot[entry] = createHash('sha256').update(content).digest('hex');
    }
  } catch {
    // Directory does not exist yet — empty snapshot
  }
  return snapshot;
}

/**
 * Compare two snapshots for equality.
 * Returns true when both have the same files with the same content hashes.
 */
function snapshotsEqual(a, b) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(k => a[k] === b[k]);
}

/**
 * Run `opencode models`, delete stale foundry-*.md agent files,
 * and write new ones for each model returned.
 *
 * @param {string} worktree - Absolute path to the project worktree root.
 * @returns {{ ok: true, count: number } | { ok: false, error: string }}
 */
export function refreshAgents(worktree) {
  try {
    const models = listModels(worktree);
    if (models.length === 0) {
      return { ok: false, error: 'No models returned by `opencode models`. Is the opencode CLI available?' };
    }

    const agentsDir = path.join(worktree, '.opencode', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    deleteStaleAgents(agentsDir);
    writeAgentFiles(agentsDir, models);

    return { ok: true, count: models.length };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Snapshot the current foundry-*.md agent files, run refreshAgents,
 * then compare the before/after file sets to detect changes.
 *
 * When refreshAgents returns { ok: false, error }, the error is
 * propagated immediately without performing a comparison.
 *
 * @param {string} worktree - Absolute path to the project worktree root.
 * @returns {{ ok: true, changed: boolean, count: number } | { ok: false, error: string }}
 */
export function detectChanges(worktree) {
  const agentsDir = path.join(worktree, '.opencode', 'agents');
  const before = takeSnapshot(agentsDir);

  const result = refreshAgents(worktree);
  if (!result.ok) {
    return result;
  }

  const after = takeSnapshot(agentsDir);
  const changed = !snapshotsEqual(before, after);

  return { ok: true, changed, count: result.count };
}

/**
 * Resolve the guide agent source path within the installed package.
 * Prefers dist/agents/foundry.md and falls back to src/agents/foundry.md.
 */
function resolveGuideSource(packageRoot) {
  const distPath = path.join(packageRoot, 'dist', 'agents', 'foundry.md');
  if (existsSync(distPath)) return distPath;
  return path.join(packageRoot, 'src', 'agents', 'foundry.md');
}

/**
 * Copy the Foundry guide agent (foundry.md) from the installed package
 * to the project's .opencode/agents/ directory.
 *
 * Resolves the source from `packageRoot/dist/agents/foundry.md` and
 * falls back to `packageRoot/src/agents/foundry.md` when the dist
 * path does not exist. Skips writing when the target file already
 * exists (uses existsSync check).
 *
 * @param {string} worktree - Absolute path to the project worktree root.
 * @param {string} packageRoot - Absolute path to the installed package root.
 * @returns {{ ok: true, written: boolean } | { ok: false, error: string }}
 */
export function writeFoundryGuideAgent(worktree, packageRoot) {
  const targetDir = path.join(worktree, '.opencode', 'agents');
  const targetPath = path.join(targetDir, 'foundry.md');

  if (existsSync(targetPath)) {
    return { ok: true, written: false };
  }

  const sourcePath = resolveGuideSource(packageRoot);

  try {
    const content = readFileSync(sourcePath, 'utf8');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
    return { ok: true, written: true };
  } catch (err) {
    return { ok: false, error: `Failed to write guide agent: ${err.message ?? String(err)}` };
  }
}
