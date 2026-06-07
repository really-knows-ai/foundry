/**
 * Foundry plugin for OpenCode.ai
 *
 * The config hook runs a boot decision tree on every plugin load: if foundry/
 * is missing or its VERSION mismatches, it bootstraps the directory structure,
 * agent files, and guide agent, then sets a restartNeeded flag. If VERSION
 * matches but the agent file set changed, only agents are refreshed. The
 * message-transform hook injects either a restart prompt or the full Foundry
 * context based on the restartNeeded flag. All skills are always registered;
 * individual skills check for foundry/ dir.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tool } from '@opencode-ai/plugin';
import { createPendingStore } from '../scripts/lib/pending.js';
import { getBootstrapContent } from './tools/helpers.js';
import { writeFoundrySkills } from './tools/skill-deploy.js';
import { createHistoryTools } from './tools/history-tools.js';
import { createStageTools } from './tools/stage-tools.js';
import { createWorkfileTools } from './tools/workfile-tools.js';
import { createRunTool } from './tools/run-tool.js';
import { createContinueTool } from './tools/continue-tool.js';
import { createListModelsTool } from './tools/list-models-tool.js';
import { createArtefactTools } from './tools/artefact-tools.js';
import { createFeedbackTools } from './tools/feedback-tools.js';
import { createGitTools } from './tools/git-tools.js';
import { createConfigTools } from './tools/config-tools.js';
import { createConfigCreateTools } from './tools/config-create-tools.js';
import { createConfigLawTools } from './tools/config-law-tools.js';
import { createValidateTools } from './tools/validate-tools.js';
import { createAssayTools } from './tools/assay-tools.js';
import { createMemoryTools } from './tools/memory-tools.js';
import { createMemoryAdminTools } from './tools/memory-admin-tools.js';
import { createSnapshotTools } from './tools/snapshot-tools.js';
import { createAttestationTools } from './tools/attestation-tools.js';
import { createStageOutputTool } from './tools/stage-output-tool.js';
import { resolveGit, resolvePnpm } from '../scripts/lib/tool-paths.js';

function findPackageRoot(startDir) {
  let dir = startDir;
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = findPackageRoot(__dirname);
const allSkillsDir = path.join(packageRoot, 'skills');

// Module-level flag shared between config and message-transform hooks.
let restartNeeded = false;

// SDK client captured from plugin input, used by tool handlers.
let pluginClient = null;

// -- Bootstrap helpers --

function bootstrapDirectories(worktree) {
  const foundryDir = path.join(worktree, 'foundry');
  mkdirSync(foundryDir, { recursive: true });
  for (const sub of ['artefacts', 'flows', 'cycles', 'laws', 'appraisers']) {
    const subDir = path.join(foundryDir, sub);
    mkdirSync(subDir, { recursive: true });
    const gitkeep = path.join(subDir, '.gitkeep');
    if (!existsSync(gitkeep)) {
      writeFileSync(gitkeep, '', 'utf8');
    }
  }
}

function ensureNewlineSuffix(str) {
  if (str !== '' && !str.endsWith('\n')) return str + '\n';
  return str;
}

function bootstrapGitignore(worktree) {
  const gitignorePath = path.join(worktree, '.gitignore');
  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf8');
  }
  content = ensureNewlineSuffix(content);
  const existingLines = content.split('\n').map(l => l.trim());
  const lines = ['.snapshots/', '.foundry/', 'node_modules/', '.DS_Store'];
  for (const line of lines) {
    if (existingLines.includes(line)) continue;
    content += `${line}\n`;
  }
  writeFileSync(gitignorePath, content, 'utf8');
}

function initGitRepo(worktree) {
  if (existsSync(path.join(worktree, '.git'))) return;
  try {
    const git = resolveGit();
    execFileSync(git, ['init'], { cwd: worktree, stdio: 'pipe' });
    execFileSync(git, ['add', '.'], { cwd: worktree, stdio: 'pipe' });
    execFileSync(git, ['commit', '-m', 'chore: initialise Foundry'], { cwd: worktree, stdio: 'pipe' });
  } catch (err) {
    console.error('Foundry git init error:', err.message);
  }
}

function ensurePackageJson(worktree) {
  if (existsSync(path.join(worktree, 'package.json'))) return;
  try {
    execFileSync(resolvePnpm(), ['init'], { cwd: worktree, stdio: 'pipe' });
  } catch (err) {
    console.error('Foundry pnpm init error:', err.message);
  }
}

function runBootstrapSequence(worktree, pkgRoot) {
  ensurePackageJson(worktree);
  bootstrapDirectories(worktree);
  bootstrapGitignore(worktree);
  writeAllFoundryAgents(worktree, pkgRoot);
  writeFoundrySkills(worktree, pkgRoot);
  const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  writeFileSync(path.join(worktree, 'foundry', 'VERSION'), pkg.version, 'utf8');
  initGitRepo(worktree);
}

function checkVersionMatch(foundryDir, pkgRoot) {
  try {
    const installedVersion = readFileSync(path.join(foundryDir, 'VERSION'), 'utf8').trim();
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    return installedVersion === pkg.version;
  } catch {
    return false;
  }
}

function isFoundryPopulated(worktree) {
  const foundryDir = path.join(worktree, 'foundry');
  if (!existsSync(foundryDir)) return false;
  return readdirSync(foundryDir).some(e => e !== '.gitkeep');
}

const AGENT_NAMES = [
  'foundry-guide',
  'foundry-admin',
  'foundry-forge',
  'foundry-appraise',
  'foundry-assay',
];

function resolveAgentSources(pkgRoot) {
  const sources = new Map();
  for (const name of AGENT_NAMES) {
    const distPath = path.join(pkgRoot, 'dist', 'agents', `${name}.md`);
    if (existsSync(distPath)) {
      sources.set(name, distPath);
    } else {
      const srcPath = path.join(pkgRoot, 'src', 'agents', `${name}.md`);
      sources.set(name, existsSync(srcPath) ? srcPath : null);
    }
  }
  return sources;
}

function writeAllFoundryAgents(worktree, pkgRoot) {
  const targetDir = path.join(worktree, '.opencode', 'agents');
  const sources = resolveAgentSources(pkgRoot);
  let written = 0;

  for (const [name, sourcePath] of sources) {
    if (!sourcePath) {
      console.warn(`Warning: Agent source not found for '${name}' — skipping`);
      continue;
    }
    try {
      const content = readFileSync(sourcePath, 'utf8');
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(path.join(targetDir, `${name}.md`), content, 'utf8');
      written++;
    } catch (err) {
      return { ok: false, error: `Failed to write agent '${name}': ${err.message ?? String(err)}` };
    }
  }

  return { ok: true, written };
}

function migrateOldAgent(worktree) {
  const oldPath = path.join(worktree, '.opencode', 'agents', 'foundry.md');
  if (existsSync(oldPath)) {
    try {
      rmSync(oldPath, { force: true });
    } catch (err) {
      console.warn(`Warning: Could not remove old agent file ${oldPath}: ${err.message}`);
    }
  }
}

function runConfigBootstrap(worktree, pkgRoot) {
  if (!isFoundryPopulated(worktree)) {
    runBootstrapSequence(worktree, pkgRoot);
    return true;
  }

  const foundryDir = path.join(worktree, 'foundry');
  if (!checkVersionMatch(foundryDir, pkgRoot)) {
    runBootstrapSequence(worktree, pkgRoot);
    return true;
  }

  return false;
}

export { buildCyclePromptExtras } from './tools/helpers.js';
export { resolveAgentSources, writeAllFoundryAgents, migrateOldAgent, AGENT_NAMES };

async function configurePlugin(config, directory) {
  config.skills = config.skills || {};
  config.skills.paths = config.skills.paths || [];
  if (!config.skills.paths.includes(allSkillsDir)) {
    config.skills.paths.push(allSkillsDir);
  }
  migrateOldAgent(directory);
  writeAllFoundryAgents(directory, packageRoot);
  writeFoundrySkills(directory, packageRoot);
  try {
    restartNeeded = runConfigBootstrap(directory, packageRoot);
  } catch (err) {
    console.error('Foundry bootstrap error:', err.message);
    restartNeeded = false;
  }
}

function buildTools(createTool, pending, client) {
  return {
    ...createHistoryTools({ tool: createTool }),
    ...createStageTools({ tool: createTool, pending }),
    ...createWorkfileTools({ tool: createTool }),
    ...createRunTool({ tool: createTool, client, pending }),
    ...createContinueTool({ tool: createTool, client }),
    ...createListModelsTool({ tool: createTool, client }),
    ...createArtefactTools({ tool: createTool }),
    ...createFeedbackTools({ tool: createTool }),
    ...createGitTools({ tool: createTool }),
    ...createConfigTools({ tool: createTool }),
    ...createConfigCreateTools({ tool: createTool }),
    ...createConfigLawTools({ tool: createTool }),
    ...createValidateTools({ tool: createTool }),
    ...createAssayTools({ tool: createTool }),
    ...createMemoryTools({ tool: createTool }),
    ...createMemoryAdminTools({ tool: createTool }),
    ...createSnapshotTools({ tool: createTool }),
    ...createAttestationTools({ tool: createTool }),
    ...createStageOutputTool({ tool: createTool }),
  };
}

function hasFoundryContext(parts) {
  return parts.some(p => p.type === 'text' && p.text.includes('FOUNDRY_CONTEXT'));
}

function getFirstUserWithParts(output) {
  if (!output.messages.length) return null;
  const firstUser = output.messages.find(m => m.info.role === 'user');
  if (!firstUser || !firstUser.parts.length) return null;
  return firstUser;
}

export const FoundryPlugin = async ({ directory, client }) => {
  // Pending store is per-plugin-instance (shared across all tool invocations).
  const pending = createPendingStore();

  // Capture the SDK client at module scope so tool handlers can close over it.
  pluginClient = client || null;

  const plugin = {
    config: (config) => configurePlugin(config, directory),

    'experimental.chat.messages.transform': async (_input, output) => {
      const bootstrap = getBootstrapContent(directory, packageRoot, restartNeeded);
      if (!bootstrap) return;

      const firstUser = getFirstUserWithParts(output);
      if (!firstUser) return;

      if (hasFoundryContext(firstUser.parts)) return;

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap });
    },

    tool: buildTools(tool, pending, pluginClient),
  };

  return plugin;
};
