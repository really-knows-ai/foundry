import { requireNotFailed } from './failed-flow.js';
import { appendTraceRecord } from './tracing.js';

const DRY_RUN_RE = /^dry-run\/[^/]+\/[^/]+$/;

const MAX_ARG_STR = 4096;
const HEAD_LEN = 256;
const TAIL_LEN = 256;

function scrub(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > MAX_ARG_STR) {
      const elided = v.length - HEAD_LEN - TAIL_LEN;
      out[k] = v.slice(0, HEAD_LEN)
        + `...(${elided} chars elided)...`
        + v.slice(v.length - TAIL_LEN);
    } else {
      out[k] = v;
    }
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

export function guarded(toolName, guards, execute, opts = {}) {
  return async (args, context) => {
    for (const g of guards) {
      const r = await g(args, context);
      if (!r.ok) {
        return JSON.stringify({ error: `${toolName}: ${r.error}` });
      }
    }

    // Test-only path. Every production tool plugin passes
    // `{ branchIo: branchIoFactory, io: asyncIoFactory }`, so this branch
    // exists for unit tests in `tests/lib/guards.test.js` that exercise
    // guard composition without spinning up the tracing IO factories.
    if (!opts.branchIo) {
      return execute(args, context);
    }

    const ts = new Date().toISOString();
    const t0 = Date.now();
    const branch = resolveBranch(opts.branchIo, context);
    const shouldTrace = branch !== null
      && DRY_RUN_RE.test(branch)
      && typeof opts.io === 'function';

    let result;
    let error;
    try {
      result = await execute(args, context);
    } catch (e) {
      error = e;
    }

    if (shouldTrace) {
      try {
        const record = {
          ts,
          tool: toolName,
          args: scrub(args),
          ...(error
            ? { error: error?.message ?? String(error) }
            : { result: parseResultMaybeJson(result) }),
          duration_ms: Date.now() - t0,
        };
        await appendTraceRecord({ branch, record, io: opts.io(context) });
      } catch (traceErr) {
        // Tracing must never break the tool call. Stay silent by default;
        // surface via console.warn when FOUNDRY_DEBUG is set so operators
        // can diagnose programmer errors (bad JSON, misconfigured io)
        // without polluting normal stderr.
        if (process.env.FOUNDRY_DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(
            `[foundry] ${toolName}: trace write failed (${traceErr?.message ?? String(traceErr)})`,
          );
        }
      }
    }

    if (error) throw error;
    return result;
  };
}

// `makeIO` is provided by the caller, since failed-flow lives in a
// different layer than the plugin helpers. We accept an io factory.
export function notFailedGuard(makeSyncIO) {
  return (_args, context) => requireNotFailed(makeSyncIO(context.worktree));
}
