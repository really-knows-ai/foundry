---
name: refresh-agents
description: Use when initialising Foundry or after adding/removing providers to regenerate foundry-* agent files for multi-model routing.
---

# Refresh Agents

Regenerate `.opencode/agents/foundry-*.md` files from the currently available models.

## Protocol

Call the `foundry_refresh_agents` tool. It runs `opencode models`, deletes stale agent files, and generates fresh ones.

## Output

The tool returns `{ ok: true, count: <n> }` on success.

After the tool completes, tell the user:

> Generated `<count>` foundry agent files in `.opencode/agents/`.
> **Restart OpenCode** for the new agents to take effect.
