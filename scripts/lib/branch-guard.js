const CONFIG_RE   = /^config\/[^/]+$/;
const WORK_RE     = /^work\/.+$/;
const DRY_RUN_RE  = /^config\/[^/]+\/dry-run\/[^/]+$/;

export function currentBranch(io) {
  const out = io.exec(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (!out || out === 'HEAD') return null;
  return out;
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
      `config/<x>/dry-run/<y> does not count); currently on ${describe(b)}. ` +
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
      `config/<x>/dry-run/<y> branch; currently on ${describe(b)}. ` +
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
      `this tool requires a config/* or work/* or config/*/dry-run/* ` +
      `branch; currently on ${describe(b)}.`,
  };
}
