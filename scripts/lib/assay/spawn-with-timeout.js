import { spawn } from 'node:child_process';

// Runs a command (via /bin/sh -c) with a hard timeout. Never throws.
// Returns:
//   { ok, exitCode, signal, stdout, stderr, timedOut }
//
// On timeout: sends SIGTERM immediately; if the process is still alive 500ms
// later, sends SIGKILL. `timedOut: true` in the result.
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
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    child.stdout.on('data', (b) => { stdout += b.toString('utf-8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf-8'); });

    const softTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        if (!settled) { try { child.kill('SIGKILL'); } catch {} }
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
