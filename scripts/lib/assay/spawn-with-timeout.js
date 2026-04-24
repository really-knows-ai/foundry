import { spawn } from 'node:child_process';

// Runs a command (via /bin/sh -c) with a hard timeout. Never throws.
// Returns:
//   { ok, exitCode, signal, stdout, stderr, timedOut }
//
// On timeout: sends SIGTERM to the child's process group immediately; if the
// process is still alive 500ms later, sends SIGKILL to the group. `timedOut:
// true` in the result.
//
// The child is spawned with `detached: true` so it becomes the leader of its
// own process group. We signal the whole group (via `process.kill(-pid, ...)`)
// rather than just the direct child, otherwise orphaned descendants (e.g. a
// `sleep` spawned by a shell script) keep the inherited stdout/stderr pipes
// open and defer Node's `close` event until they exit naturally.
//
// Security: this intentionally uses a shell, matching how `foundry_validate_run`
// expands validation commands today. Extractors are project-authored and
// committed to the repo; they are trusted code paths, not untrusted input.
export async function spawnWithTimeout({ command, cwd, timeoutMs, env }) {
  return await new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const killGroup = (signal) => {
      // Negative pid targets the process group. Wrap in try/catch because
      // the group may already be gone (ESRCH) by the time we signal.
      try { process.kill(-child.pid, signal); } catch {}
    };

    child.stdout.on('data', (b) => { stdout += b.toString('utf-8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf-8'); });

    const softTimer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => {
        if (!settled) { killGroup('SIGKILL'); }
      }, 500);
    }, timeoutMs);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr + (stderr.endsWith('\n') || stderr === '' ? '' : '\n') + `spawn error: ${err.message}`,
        timedOut,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      const ok = !timedOut && code === 0;
      resolve({ ok, exitCode: code, signal, stdout, stderr, timedOut });
    });
  });
}
