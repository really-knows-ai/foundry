/**
 * Foundry plugin for OpenCode.ai
 *
 * All skills are always registered. Individual skills check for foundry/ dir.
 * - If foundry/ exists: pipeline context + multi-model agent registration
 * - If foundry/ does not exist: minimal prompt guiding user to init-foundry
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../..');
const allSkillsDir = path.join(packageRoot, 'skills');
const initSkillDir = path.join(allSkillsDir, 'init-foundry');

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

  return `<FOUNDRY_CONTEXT>
Foundry is active in this project. The foundry/ directory contains the project's artefact definitions,
laws, appraisers, cycles, and flows.

Foundry is a skill-driven framework for governed artefact generation and evaluation.
The pipeline: forge (produce) → quench (deterministic checks) → appraise (subjective evaluation) → iterate.

Available skills:
- **Pipeline:** forge, quench, appraise, cycle, flow, sort, hitl
- **Helpers:** add-artefact-type, add-law, add-appraiser, add-cycle, add-flow, init-foundry

Multi-model routing: The Foundry plugin has auto-registered \`foundry-*\` sub-agents for each available model.
Cycle definitions can specify per-stage models via the \`models\` frontmatter map. Appraisers can override with their own \`model\` field.

To start a flow, use the \`flow\` skill. All user content lives under foundry/.
Scripts are located at: ${path.join(packageRoot, 'scripts')}
</FOUNDRY_CONTEXT>`;
}

export const FoundryPlugin = async ({ client, directory }) => {
  const foundryDir = path.join(directory, 'foundry');
  const foundryExists = fs.existsSync(foundryDir) && fs.statSync(foundryDir).isDirectory();

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];

      // Always register all skills — individual skills check for foundry/ dir
      if (!config.skills.paths.includes(allSkillsDir)) {
        config.skills.paths.push(allSkillsDir);
      }

      if (foundryExists) {
        // Register per-model subagents for multi-model stage routing
        try {
          const providers = await client.provider.list();
          config.agent = config.agent || {};
          for (const provider of providers) {
            if (!provider.models) continue;
            const modelKeys = Array.isArray(provider.models)
              ? provider.models
              : Object.keys(provider.models);
            for (const modelKey of modelKeys) {
              const agentName = `foundry-${provider.id}-${modelKey}`;
              config.agent[agentName] = {
                model: `${provider.id}/${modelKey}`,
                mode: 'subagent',
                hidden: true,
                description: `Foundry stage agent using ${provider.id}/${modelKey}`,
              };
            }
          }
        } catch (err) {
          console.warn('[foundry] Failed to discover models for agent registration:', err.message);
        }
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
    }
  };
};
