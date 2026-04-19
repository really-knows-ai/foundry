---
name: refresh-agents
description: Use when initializing Foundry or after adding/removing providers to regenerate foundry-* agent files for multi-model routing.
---

# Refresh Agents

Regenerate `.opencode/agents/foundry-*.md` files from the currently available models.

## Protocol

1. Run `opencode models` to get all available `provider/model` IDs
2. Create `.opencode/agents/` directory if it does not exist
3. Delete all existing `.opencode/agents/foundry-*.md` files (stale agents from removed providers)
4. For each model line in the output, generate a markdown agent file

### Agent file format

Filename: `.opencode/agents/foundry-<slug>.md`

Where `<slug>` is the model ID with **both** `/` and `.` replaced by `-`. This keeps filenames shell-safe and unambiguous.

Examples:
- `opencode/claude-sonnet-4` → `.opencode/agents/foundry-opencode-claude-sonnet-4.md`
- `github-copilot/claude-sonnet-4.6` → `.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md`
- `github-copilot/gpt-5.4` → `.opencode/agents/foundry-github-copilot-gpt-5-4.md`

Content:

```markdown
---
description: "Foundry stage agent using <provider>/<model-key>"
mode: subagent
model: "<provider>/<model-key>"
hidden: true
---
You are a Foundry stage agent. Follow the skill instructions provided in your task prompt exactly.
```

5. After writing all files, output:

> Generated `<count>` foundry agent files in `.opencode/agents/`.
> **Restart OpenCode** for the new agents to take effect.
