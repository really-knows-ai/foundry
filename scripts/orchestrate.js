// Foundry v2.3.0 orchestrate: deterministic cycle orchestration.
// Composes internal functions (sort, finalize, history, commit, configure)
// into a single entry point the LLM drives via a 3-line loop.

export function renderDispatchPrompt({ stage, cycle, token, cwd, filePatterns }) {
  const lines = [
    `You are a Foundry stage agent. Invoke the ${stage.split(':')[0]} skill and follow its instructions exactly.`,
    ``,
    `Stage: ${stage}`,
    `Cycle: ${cycle}`,
    `Token: ${token}`,
    `Working directory: ${cwd}`,
  ];
  if (filePatterns && filePatterns.length) {
    lines.push(`File patterns (forge only): ${JSON.stringify(filePatterns)}`);
  }
  lines.push(
    ``,
    `Your FIRST tool call MUST be foundry_stage_begin({stage, cycle, token}) using the values above.`,
    `Your LAST tool call MUST be foundry_stage_end({summary}).`,
    ``,
    `When done, report back a brief summary. Do NOT call foundry_history_append, foundry_git_commit, or foundry_artefacts_add — the orchestrator handles all of those.`
  );
  return lines.join('\n');
}
