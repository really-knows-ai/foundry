/**
 * Foundry plugin for OpenCode.ai
 *
 * All skills are always registered. Individual skills check for foundry/ dir.
 * - If foundry/ exists: pipeline context injected into first message
 * - If foundry/ does not exist: minimal prompt guiding user to init-foundry
 * Multi-model agents are managed as .opencode/agents/foundry-*.md files via the refresh-agents skill.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { tool } from '@opencode-ai/plugin';
import { createPendingStore } from '../scripts/lib/pending.js';
import { getBootstrapContent } from './tools/helpers.js';
import { createHistoryTools } from './tools/history-tools.js';
import { createStageTools } from './tools/stage-tools.js';
import { createWorkfileTools } from './tools/workfile-tools.js';
import { createOrchestrateTool } from './tools/orchestrate-tool.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../..');
const allSkillsDir = path.join(packageRoot, 'skills');

export { buildCyclePromptExtras } from './tools/helpers.js';

function buildTools(createTool, pending) {
  return {
    ...createHistoryTools({ tool: createTool }),
    ...createStageTools({ tool: createTool, pending }),
    ...createWorkfileTools({ tool: createTool }),
    ...createOrchestrateTool({ tool: createTool, pending }),
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

export const FoundryPlugin = async ({ directory }) => {
  // Pending store is per-plugin-instance (shared across all tool invocations).
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
      const bootstrap = getBootstrapContent(directory, packageRoot);
      if (!bootstrap) return;

      const firstUser = getFirstUserWithParts(output);
      if (!firstUser) return;

      if (hasFoundryContext(firstUser.parts)) return;

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap });
    },

    tool: buildTools(tool, pending),
  };

  Object.defineProperty(plugin, Symbol.for('foundry.test.pending'), { value: pending });
  return plugin;
};
