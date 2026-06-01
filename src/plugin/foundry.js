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
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { tool } from '@opencode-ai/plugin';
import { createPendingStore } from '../scripts/lib/pending.js';
import { getBootstrapContent } from './tools/helpers.js';
import { refreshAgents, detectChanges, writeFoundryGuideAgent, writeFoundrySkills } from './tools/agent-refresh.js';
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
import { createAppraiserTools } from './tools/appraiser-tools.js';
import { createMemoryTools } from './tools/memory-tools.js';
import { createMemoryAdminTools } from './tools/memory-admin-tools.js';
import { createSnapshotTools } from './tools/snapshot-tools.js';
import { createAttestationTools } from './tools/attestation-tools.js';
import { createRefreshAgentsTool } from './tools/refresh-agents-tool.js';
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

// Map of child session IDs to roles, used by the tool.execute.before lockdown hook.
const childSessions = new Map();

// ── Role-based tool deny lists (R4) ──────────────────────────────────
// These lists define which tools are denied to subagent sessions based on
// their role. The forge deny list is enforced in Phase 2; appraise is
// defined here for test access but enforced in Phase 3.

const FORGE_DENIED = [
  'foundry_orchestrate', 'foundry_feedback_', 'foundry_config_create_',
  'foundry_workfile_', 'foundry_git_branch', 'foundry_git_finish',
  'foundry_stage_retry', 'foundry_stage_begin', 'foundry_stage_end',
  'foundry_assay_run', 'foundry_refresh_agents',
];

// APPRAISE_DENIED is added in Phase 3 when appraise dispatch is introduced.

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
  refreshAgents(worktree);
  writeFoundryGuideAgent(worktree, pkgRoot);
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

function ensureGuideAgent(worktree, pkgRoot) {
  const guideAgentPath = path.join(worktree, '.opencode', 'agents', 'foundry.md');
  if (!existsSync(guideAgentPath)) {
    writeFoundryGuideAgent(worktree, pkgRoot);
    return true;
  }
  return false;
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

  const result = detectChanges(worktree);
  const changed = result.ok && result.changed;
  const guideWritten = ensureGuideAgent(worktree, pkgRoot);
  return changed || guideWritten;
}

function runPluginBootstrap(worktree, pkgRoot) {
  // Skip if FOUNDRY_SKIP_BOOTSTRAP is set to prevent infinite recursion
  // when this plugin spawns `opencode models` as a child process.
  if (process.env.FOUNDRY_SKIP_BOOTSTRAP === '1') return false;
  try {
    return runConfigBootstrap(worktree, pkgRoot);
  } catch (err) {
    console.error('Foundry bootstrap error:', err.message);
    return false;
  }
}

export { buildCyclePromptExtras } from './tools/helpers.js';

async function configurePlugin(config, directory) {
  config.skills = config.skills || {};
  config.skills.paths = config.skills.paths || [];
  if (!config.skills.paths.includes(allSkillsDir)) {
    config.skills.paths.push(allSkillsDir);
  }
  ensureGuideAgent(directory, packageRoot);
  writeFoundrySkills(directory, packageRoot);
  restartNeeded = runPluginBootstrap(directory, packageRoot);
}

function isToolDeniedForForge(toolCall) {
  if (!toolCall || !toolCall.name) return false;
  return FORGE_DENIED.some(p => toolCall.name.startsWith(p));
}

function attachTestSymbols(plugin, pending, client, sessions, denied) {
  Object.defineProperty(plugin, Symbol.for('foundry.test.pending'), { value: pending });
  Object.defineProperty(plugin, Symbol.for('foundry.test.restartNeeded'), {
    get: () => restartNeeded, configurable: true,
  });
  Object.defineProperty(plugin, Symbol.for('foundry.test.client'), { value: client });
  Object.defineProperty(plugin, Symbol.for('foundry.test.childSessions'), { value: sessions });
  Object.defineProperty(plugin, Symbol.for('foundry.test.forgeDenied'), { value: denied });
}

function buildTools(createTool, pending, client, sessions) {
  return {
    ...createHistoryTools({ tool: createTool }),
    ...createStageTools({ tool: createTool, pending }),
    ...createWorkfileTools({ tool: createTool }),
    ...createRunTool({ tool: createTool, client, childSessions: sessions }),
    ...createContinueTool({ tool: createTool, client, childSessions: sessions }),
    ...createListModelsTool({ tool: createTool, client }),
    ...createArtefactTools({ tool: createTool }),
    ...createFeedbackTools({ tool: createTool }),
    ...createGitTools({ tool: createTool }),
    ...createConfigTools({ tool: createTool }),
    ...createConfigCreateTools({ tool: createTool }),
    ...createConfigLawTools({ tool: createTool }),
    ...createValidateTools({ tool: createTool }),
    ...createAssayTools({ tool: createTool }),
    ...createAppraiserTools({ tool: createTool }),
    ...createMemoryTools({ tool: createTool }),
    ...createMemoryAdminTools({ tool: createTool }),
    ...createSnapshotTools({ tool: createTool }),
    ...createAttestationTools({ tool: createTool }),
    ...createRefreshAgentsTool({ tool: createTool }),
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

    'tool.execute.before': async (toolCall, context) => {
      if (!context || !context.sessionID) return;
      if (childSessions.get(context.sessionID) !== 'forge') return;
      if (isToolDeniedForForge(toolCall)) {
        throw new Error('Tool ' + toolCall.name + ' is not available to forge subagents');
      }
    },

    tool: buildTools(tool, pending, pluginClient, childSessions),
  };

  attachTestSymbols(plugin, pending, pluginClient, childSessions, FORGE_DENIED);
  return plugin;
};
