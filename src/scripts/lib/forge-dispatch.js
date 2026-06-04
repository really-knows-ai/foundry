/**
 * Forge dispatch — CLI spawn dispatch for forge stages.
 *
 * Exports: forgeDispatch
 * Uses the Phase 1 CLI spawn infrastructure to dispatch forge stages.
 */

import { renderDispatchPrompt } from '../orchestrate-cycle.js';
import { spawnDispatch, awaitProcess, writePromptFile, withCleanup } from './dispatch-cli.js';

function writeTokenFile(io, sort, cycleId, paths) {
  const tokenFileName = cycleId + '.token';
  const tokenPath = '.foundry/tokens/' + tokenFileName;
  io.mkdir('.foundry/tokens');
  io.writeFile(tokenPath, sort.token || '');
  paths.push(tokenPath);
  return tokenFileName;
}

function cleanStageOutputDir(io) {
  const dir = '.foundry/stage-outputs/';
  let files;
  try {
    files = io.readDir(dir);
  } catch {
    return;
  }
  for (const f of files) {
    try { io.unlink(dir + f); } catch { /* ignore */ }
  }
}

function parseJsonlFile(io, path) {
  let raw;
  try { raw = io.readFile(path); } catch { return []; }
  return raw.trim().split('\n').filter(Boolean).map(function(l) {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function collectStageOutputLines(io) {
  const dir = '.foundry/stage-outputs/';
  let files;
  try {
    files = io.readDir(dir);
  } catch {
    return [];
  }
  const lines = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const parsed = parseJsonlFile(io, dir + f);
    for (const item of parsed) lines.push(item);
  }
  return lines;
}

/**
 * Dispatch a forge stage by spawning `opencode run --attach` as a child
 * process. Writes the sort token to `.foundry/tokens/<cycleId>.token`,
 * renders the dispatch prompt with `{tokenFile}` set, writes the prompt
 * to a temp file, cleans stale stage output, spawns the child, waits
 * for it to exit (with configurable timeout), collects stage output
 * from `.foundry/stage-outputs/*.jsonl`, and cleans up temp files.
 *
 * Returns `{ stageOutputLines }` on success or `{ error: <message> }`
 * on failure.
 */
export async function forgeDispatch({ sort, io, worktree, cycleId, dispatchPrompt, modelParam, timeoutMs }) {
  try {
    return await withCleanup(io, async (paths) => {
      const tokenFileName = writeTokenFile(io, sort, cycleId, paths);

      const prompt = renderDispatchPrompt({ ...dispatchPrompt, tokenFile: tokenFileName });
      const promptPath = writePromptFile(io, prompt);
      paths.push(promptPath);

      cleanStageOutputDir(io);

      const child = spawnDispatch(worktree, promptPath);
      await awaitProcess(child, timeoutMs);

      const stageOutputLines = collectStageOutputLines(io);
      return { stageOutputLines };
    });
  } catch (err) {
    return { error: err.message || String(err) };
  }
}
