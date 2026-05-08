import { requireNotFailed } from './failed-flow.js';
import { appendTraceRecord } from './tracing.js';
import { DRY_RUN_RE } from './branch-guard.js';

const MAX_ARG_STR = 4096;
const HEAD_LEN = 256;
const TAIL_LEN = 256;

function truncateString(v) {
  const elided = v.length - HEAD_LEN - TAIL_LEN;
  return v.slice(0, HEAD_LEN)
    + `...(${elided} chars elided)...`
    + v.slice(v.length - TAIL_LEN);
}

function scrubValue(v) {
  if (typeof v === 'string' && v.length > MAX_ARG_STR) {
    return truncateString(v);
  }
  return v;
}

function scrub(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = scrubValue(v);
  }
  return out;
}

function parseResultMaybeJson(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

function resolveBranch(branchIo, context) {
  try {
    const out = branchIo(context).exec(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = String(out ?? '').trim();
    if (!branch || branch === 'HEAD') return null;
    return branch;
  } catch {
    return null;
  }
}

function shouldTraceBranch(branch, io) {
  return branch !== null && DRY_RUN_RE.test(branch) && typeof io === 'function';
}

async function runGuards(guards, args, context, toolName) {
  for (const g of guards) {
    const r = await g(args, context);
    if (!r.ok) {
      return JSON.stringify({ error: `${toolName}: ${r.error}` });
    }
  }
  return null;
}

function buildTraceRecord(opts) {
  const { ts, toolName, args, result, error, durationMs } = opts;
  const base = { ts, tool: toolName, args: scrub(args), duration_ms: durationMs };
  if (error) {
    return { ...base, error: error.message ?? String(error) };
  }
  return { ...base, result: parseResultMaybeJson(result) };
}

async function writeTraceRecord(opts) {
  const { branch, record, io } = opts;
  try {
    await appendTraceRecord({ branch, record, io });
  } catch (traceErr) {
    if (process.env.FOUNDRY_DEBUG) {
      console.warn(
        `[foundry] ${opts.toolName}: trace write failed (${traceErr.message ?? String(traceErr)})`,
      );
    }
  }
}

async function executeAndTrace(opts) {
  const { branchIo, io, execute, args, context, toolName } = opts;
  const ts = new Date().toISOString();
  const t0 = Date.now();
  const branch = resolveBranch(branchIo, context);
  const trace = shouldTraceBranch(branch, io);

  let result;
  let error;
  try {
    result = await execute(args, context);
  } catch (e) {
    error = e;
  }

  if (trace) {
    const record = buildTraceRecord({ ts, toolName, args, result, error, durationMs: Date.now() - t0 });
    await writeTraceRecord({ branch, record, io: io(context), toolName });
  }

  if (error) throw error;
  return result;
}

export function guarded(toolName, guards, execute, opts = {}) {
  return async (args, context) => {
    const guardError = await runGuards(guards, args, context, toolName);
    if (guardError) return guardError;

    if (!opts.branchIo) {
      return execute(args, context);
    }

    return executeAndTrace({ ...opts, execute, args, context, toolName });
  };
}

// `makeIO` is provided by the caller, since failed-flow lives in a
// different layer than the plugin helpers. We accept an io factory.
export function notFailedGuard(makeSyncIO) {
  return (_args, context) => requireNotFailed(makeSyncIO(context.worktree));
}
