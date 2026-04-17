---
name: list-agents
description: Use when you need to see which foundry-* sub-agents are available for multi-model routing.
---

# List Agents

Output all available `foundry-*` sub-agents.

## Protocol

1. List all files matching `.opencode/agents/foundry-*.md`
2. For each file, read the `model` field from its YAML frontmatter
3. Output each agent name and its model, one per line

## Output format

```
foundry-<provider>-<model>  →  <provider>/<model>
```

If no `foundry-*.md` files are found, output:

> No foundry agent files found. Run the `refresh-agents` skill to generate them.
