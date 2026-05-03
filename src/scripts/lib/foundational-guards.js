export function requireGitRepo(io) {
  if (io.exists('.git')) return { ok: true };
  return { ok: false, error: 'not a git repository (no .git directory at worktree root)' };
}

export function requireFoundryRoot(io) {
  // Probe the bare directory name — matches requireGitRepo's '.git'.
  if (io.exists('foundry')) return { ok: true };
  return {
    ok: false,
    error: 'foundry/ directory not found at worktree root. Run the init-foundry skill to scaffold it.',
  };
}
