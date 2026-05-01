import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// Runs a command (via /bin/sh -c) with a hard timeout. Never throws.
// Returns:
//   { ok, exitCode, signal, stdout, stderr, timedOut, tooMuchOutput }
//
// On timeout: sends SIGTERM to the child's process group immediately; if the
// process is still alive 500ms later, sends SIGKILL to the group. `timedOut:
// true` in the result.
//
// Output limits: stdout capped at 50MB, stderr at 1MB. On overflow, kills the
// process group and returns `tooMuchOutput: true`.
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

    // G27: Use StringDecoder to handle multi-byte UTF-8 correctly
    const stdoutDecoder = new StringDecoder('utf-8');
    const stderrDecoder = new StringDecoder('utf-8');
    
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let tooMuchOutput = false;
    let settled = false;
    let hardTimer = null; // G24: Capture the SIGKILL timer to clear it

    // G28: Output byte limits
    const MAX_STDOUT = 50 * 1024 * 1024; // 50MB
    const MAX_STDERR = 1 * 1024 * 1024;  // 1MB

    const killGroup = (signal) => {
      // G25: Guard against undefined pid (spawn failure)
      if (child.pid == null) return;
      // Negative pid targets the process group. Wrap in try/catch because
      // the group may already be gone (ESRCH) by the time we signal.
      try { process.kill(-child.pid, signal); } catch {}
    };

    // G27: Decode with StringDecoder to preserve multi-byte codepoints
    child.stdout.on('data', (b) => {
      // G28: Check output limit
      if (stdout.length >= MAX_STDOUT) {
        if (!tooMuchOutput) {
          tooMuchOutput = true;
          killGroup('SIGKILL'); // Kill immediately, don't wait for SIGTERM
        }
        return;
      }
      const decoded = stdoutDecoder.write(b);
      // Check again after decoding
      if (stdout.length + decoded.length >= MAX_STDOUT) {
        const remaining = MAX_STDOUT - stdout.length;
        stdout += decoded.slice(0, remaining);
        tooMuchOutput = true;
        killGroup('SIGKILL');
        return;
      }
      stdout += decoded;
    });

    child.stderr.on('data', (b) => {
      // G28: Check output limit
      if (stderr.length >= MAX_STDERR) {
        if (!tooMuchOutput) {
          tooMuchOutput = true;
          killGroup('SIGKILL'); // Kill immediately, don't wait for SIGTERM
        }
        return;
      }
      const decoded = stderrDecoder.write(b);
      // Check again after decoding
      if (stderr.length + decoded.length >= MAX_STDERR) {
        const remaining = MAX_STDERR - stderr.length;
        stderr += decoded.slice(0, remaining);
        tooMuchOutput = true;
        killGroup('SIGKILL');
        return;
      }
      stderr += decoded;
    });

    const softTimer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      // G24: Capture the hard timer so we can clear it on natural exit
      hardTimer = setTimeout(() => {
        if (!settled) { killGroup('SIGKILL'); }
      }, 500);
    }, timeoutMs);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      // G24: Clear hard timer if it was set
      if (hardTimer) clearTimeout(hardTimer);
      
      // G26: Spawn error should never set timedOut to true.
      // The error handler fires when spawn fails (ENOENT, EMFILE, etc.),
      // which happens before the child even starts. timedOut requires
      // the timeout to have actually elapsed AND a child to have existed.
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr + (stderr.endsWith('\n') || stderr === '' ? '' : '\n') + `spawn error: ${err.message}`,
        timedOut: false, // G26: Explicitly false, not inheriting timedOut flag
        tooMuchOutput: false,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      // G24: Clear the SIGKILL timer to prevent event loop from hanging
      if (hardTimer) clearTimeout(hardTimer);
      
      // Flush any remaining bytes in the decoders
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      
      const ok = !timedOut && !tooMuchOutput && code === 0;
      resolve({ ok, exitCode: code, signal, stdout, stderr, timedOut, tooMuchOutput });
    });
  });
}
