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
      if (!bootstrap || !output.messages.length) return;

      const firstUser = output.messages.find(m => m.info.role === 'user');
      if (!firstUser || !firstUser.parts.length) return;

      if (firstUser.parts.some(p => p.type === 'text' && p.text.includes('FOUNDRY_CONTEXT'))) return;

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap });
    },

    tool: {
      ...createHistoryTools({ tool }),
      ...createStageTools({ tool, pending }),
      ...createWorkfileTools({ tool }),
      ...createOrchestrateTool({ tool, pending }),
      ...createArtefactTools({ tool }),
      ...createFeedbackTools({ tool }),
      ...createGitTools({ tool }),
      ...createConfigTools({ tool }),
      ...createConfigCreateTools({ tool }),
      ...createValidateTools({ tool }),
      ...createAssayTools({ tool }),
      ...createAppraiserTools({ tool }),
      ...createMemoryTools({ tool }),
      ...createMemoryAdminTools({ tool }),
      ...createSnapshotTools({ tool }),
      ...createAttestationTools({ tool }),
    },
  };

  Object.defineProperty(plugin, Symbol.for('foundry.test.pending'), { value: pending });
  return plugin;
};
