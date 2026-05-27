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
    if (isModelledAgent(entry)) unlinkSync(path.join(agentsDir, entry));
  }
}

function isModelledAgent(entry) {
  return entry.startsWith('foundry-') && entry.endsWith('.md')
    && entry !== 'foundry-forge.md' && entry !== 'foundry-appraise.md';
}

function writeAgentFiles(agentsDir, models) {
  for (const modelId of models) {
    const slug = makeSlug(modelId);
    const filePath = path.join(agentsDir, `foundry-${slug}.md`);
    writeFileSync(filePath, buildAgentContent(modelId), 'utf8');
  }
}

const DEFAULT_AGENT = `---
description: "Default Foundry STAGE stage agent"
mode: subagent
hidden: true
---
You are a Foundry stage agent. Follow the skill instructions provided in your task prompt exactly.
`;

function writeDefaultAgents(agentsDir) {
  for (const stage of ['forge', 'appraise']) {
    const filePath = path.join(agentsDir, `foundry-${stage}.md`);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, DEFAULT_AGENT.replace('STAGE', stage), 'utf8');
    }
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
    writeDefaultAgents(agentsDir);

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

export function writeFoundryGuideAgent(worktree, packageRoot) {
  const targetDir = path.join(worktree, '.opencode', 'agents');
  const targetPath = path.join(targetDir, 'foundry.md');
  let written = false;

  if (!existsSync(targetPath)) {
    const sourcePath = resolveGuideSource(packageRoot);
    try {
      const content = readFileSync(sourcePath, 'utf8');
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(targetPath, content, 'utf8');
      written = true;
    } catch (err) {
      return { ok: false, error: `Failed to write guide agent: ${err.message ?? String(err)}` };
    }
  }

  writeDefaultAgents(targetDir);

  return { ok: true, written };
}

function resolveSkillsSource(packageRoot) {
  const distSkillsDir = path.join(packageRoot, 'dist', 'skills');
  if (existsSync(distSkillsDir)) return distSkillsDir;
  const srcSkillsDir = path.join(packageRoot, 'src', 'skills');
  if (existsSync(srcSkillsDir)) return srcSkillsDir;
  return null;
}

function copySkillFile(worktree, name, sourcePath) {
  const targetDir = path.join(worktree, '.opencode', 'skills', name);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(path.join(targetDir, 'SKILL.md'), readFileSync(sourcePath, 'utf8'));
}

export function writeFoundrySkills(worktree, packageRoot) {
  const sourceDir = resolveSkillsSource(packageRoot);
  if (!sourceDir) {
    return { ok: false, error: 'Skills directory not found in dist/skills or src/skills' };
  }

  const skillDirs = readdirSync(sourceDir, { withFileTypes: true })
    .filter(e => e.isDirectory());

  let count = 0;
  for (const dir of skillDirs) {
    const sourceSkill = path.join(sourceDir, dir.name, 'SKILL.md');
    if (!existsSync(sourceSkill)) continue;
    copySkillFile(worktree, dir.name, sourceSkill);
    count++;
  }

  return { ok: true, count };
}

