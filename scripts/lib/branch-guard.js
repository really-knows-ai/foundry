const CONFIG_RE   = /^config\/[^/]+$/;
const WORK_RE     = /^work\/.+$/;
const DRY_RUN_RE  = /^dry-run\/[^/]+\/[^/]+$/;

export function currentBranch(io) {
  // `git rev-parse --abbrev-ref HEAD` exits non-zero on a fresh repo with
  // no commits (unborn branch) and on a non-repo directory. Fall back to
  // `git symbolic-ref --short HEAD` which still resolves the unborn
  // branch's name; if that also fails (truly detached or non-repo), treat
   // as "no current branch" so the guard returns a structured refusal
   // envelope rather than throwing.
  let out;
  try {
    out = io.exec(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (out && out !== 'HEAD') return out;
  } catch { /* fall through to symbolic-ref */ }
  try {
    const sym = io.exec(['git', 'symbolic-ref', '--short', 'HEAD']).trim();
    if (sym) return sym;
  } catch { /* truly detached or not a repo */ }
  return null;
}

function describe(branch) {
  return branch === null ? 'detached HEAD' : `'${branch}'`;
}

export function requireOnConfigBranch(io) {
  const b = currentBranch(io);
  if (b && CONFIG_RE.test(b)) return { ok: true };
  return {
    ok: false,
    error:
      `this tool requires a config/<description> branch (strict; ` +
      `dry-run/<x>/<y> does not count); currently on ${describe(b)}. ` +
      `Use foundry_git_branch({ kind: "config", description: "..." }) ` +
      `from main first.`,
  };
}

export function requireOnFlowBranch(io) {
  const b = currentBranch(io);
  if (b && (WORK_RE.test(b) || DRY_RUN_RE.test(b))) return { ok: true };
  return {
    ok: false,
    error:
      `this tool requires a work/<flow>-<desc> or ` +
      `dry-run/<x>/<y> branch; currently on ${describe(b)}. ` +
      `Use foundry_git_branch({ kind: "work", flowId, description }) ` +
      `from main, or { kind: "dry-run", flowId, description } from a config branch.`,
  };
}

export function requireOnConfigOrFlowBranch(io) {
  const b = currentBranch(io);
  if (b && (CONFIG_RE.test(b) || WORK_RE.test(b) || DRY_RUN_RE.test(b))) {
    return { ok: true };
  }
  return {
    ok: false,
    error:
      `this tool requires a config/* or work/* or dry-run/*/* ` +
      `branch; currently on ${describe(b)}.`,
  };
}
