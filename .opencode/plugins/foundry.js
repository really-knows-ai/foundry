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
import { readOrCreateSecret } from '../../scripts/lib/secret.js';
import { createPendingStore } from '../../scripts/lib/pending.js';
import { getBootstrapContent } from './foundry-tools/helpers.js';
import { createHistoryTools } from './foundry-tools/history-tools.js';
import { createStageTools } from './foundry-tools/stage-tools.js';
import { createWorkfileTools } from './foundry-tools/workfile-tools.js';
import { createOrchestrateTool } from './foundry-tools/orchestrate-tool.js';
import { createArtefactTools } from './foundry-tools/artefact-tools.js';
import { createFeedbackTools } from './foundry-tools/feedback-tools.js';
import { createGitTools } from './foundry-tools/git-tools.js';
import { createConfigTools } from './foundry-tools/config-tools.js';
import { createValidateTools } from './foundry-tools/validate-tools.js';
import { createAssayTools } from './foundry-tools/assay-tools.js';
import { createAppraiserTools } from './foundry-tools/appraiser-tools.js';
import { createMemoryTools } from './foundry-tools/memory-tools.js';
import { createMemoryAdminTools } from './foundry-tools/memory-admin-tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../..');
const allSkillsDir = path.join(packageRoot, 'skills');

export { buildCyclePromptExtras } from './foundry-tools/helpers.js';

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
      ...createStageTools({ tool, secret, pending }),
      ...createWorkfileTools({ tool }),
      ...createOrchestrateTool({ tool, secret, pending }),
      ...createArtefactTools({ tool }),
      ...createFeedbackTools({ tool }),
      ...createGitTools({ tool }),
      ...createConfigTools({ tool }),
      ...createValidateTools({ tool }),
      ...createAssayTools({ tool }),
      ...createAppraiserTools({ tool }),
      ...createMemoryTools({ tool }),
      ...createMemoryAdminTools({ tool }),
    },
  };

  Object.defineProperty(plugin, Symbol.for('foundry.test.pending'), { value: pending });
  Object.defineProperty(plugin, Symbol.for('foundry.test.secret'), { value: secret });
  return plugin;
};
