import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../../..');
const GUIDE_AGENT_TEMPLATE_PATHS = [
  path.join(packageRoot, 'agents', 'foundry.md'),
  path.join(packageRoot, 'src', 'agents', 'foundry.md'),
];

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
  const stdout = execFileSync('opencode', ['models'], {
    cwd: worktree,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
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

function writeGuideAgent(agentsDir) {
  const templatePath = GUIDE_AGENT_TEMPLATE_PATHS.find(candidate => existsSync(candidate));
  if (!templatePath) {
    throw new Error('Foundry guide agent template not found');
  }
  const template = readFileSync(templatePath, 'utf8');
  writeFileSync(path.join(agentsDir, 'foundry.md'), template, 'utf8');
}

function refreshAgents(worktree) {
  const models = listModels(worktree);
  if (models.length === 0) {
    return { ok: false, error: 'No models returned by `opencode models`. Is the opencode CLI available?' };
  }

  const agentsDir = path.join(worktree, '.opencode', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  deleteStaleAgents(agentsDir);
  writeAgentFiles(agentsDir, models);
  writeGuideAgent(agentsDir);

  return { ok: true, count: models.length, guideAgent: true };
}

export function createRefreshAgentsTool({ tool }) {
  return {
    foundry_refresh_agents: tool({
      description: 'Regenerate .opencode/agents/foundry-*.md agent files from the currently available models. Deletes stale agents and creates one file per model returned by `opencode models`.',
      args: {},
      async execute(_args, context) {
        try {
          const result = refreshAgents(context.worktree);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({
            ok: false,
            error: `foundry_refresh_agents: ${err.message ?? String(err)}`,
          });
        }
      },
    }),
  };
}
