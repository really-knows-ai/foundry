/**
 * Foundry plugin for OpenCode.ai
 *
 * All skills are always registered. Individual skills check for foundry/ dir.
 * - If foundry/ exists: pipeline context injected into first message
 * - If foundry/ does not exist: minimal prompt guiding user to init-foundry
 * Multi-model agents are managed as .opencode/agents/foundry-*.md files via the refresh-agents skill.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../..');
const allSkillsDir = path.join(packageRoot, 'skills');

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

Multi-model routing: Foundry uses \`foundry-*\` sub-agents defined as markdown files in \`.opencode/agents/\`.
Run the \`refresh-agents\` skill to regenerate them after adding or removing providers.
Cycle definitions can specify per-stage models via the \`models\` frontmatter map. Appraisers can override with their own \`model\` field.

To start a flow, use the \`flow\` skill. All user content lives under foundry/.
Scripts are located at: ${path.join(packageRoot, 'scripts')}
</FOUNDRY_CONTEXT>`;
}

export const FoundryPlugin = async ({ directory }) => {
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];

      // Always register all skills — individual skills check for foundry/ dir
      if (!config.skills.paths.includes(allSkillsDir)) {
        config.skills.paths.push(allSkillsDir);
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
