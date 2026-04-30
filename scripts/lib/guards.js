import { requireNotFailed } from './failed-flow.js';

export function guarded(toolName, guards, execute) {
  return async (args, context) => {
    for (const g of guards) {
      const r = await g(args, context);
      if (!r.ok) {
        return JSON.stringify({ error: `${toolName}: ${r.error}` });
      }
    }
    return execute(args, context);
  };
}

// `makeIO` is provided by the caller, since failed-flow lives in a
// different layer than the plugin helpers. We accept an io factory.
export function notFailedGuard(makeSyncIO) {
  return (_args, context) => requireNotFailed(makeSyncIO(context.worktree));
}
