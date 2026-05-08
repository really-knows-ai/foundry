import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// Output byte limits
const MAX_STDOUT = 50 * 1024 * 1024; // 50MB
const MAX_STDERR = 1 * 1024 * 1024;  // 1MB

function killGroup(child, signal) {
  // G25: Guard against undefined pid (spawn failure)
  if (child.pid === null || child.pid === undefined) return;
  // Negative pid targets the process group. Wrap in try/catch because
  // the group may already be gone (ESRCH) by the time we signal.
  try { process.kill(-child.pid, signal); } catch {}
}

function createStreamHandler(decoder, state, prop, maxBytes, onOverflow) {
  return (b) => {
    // G28: Check output limit
    if (state[prop].length >= maxBytes) {
      if (!state.tooMuchOutput) {
        state.tooMuchOutput = true;
        onOverflow();
      }
      return;
    }
    const decoded = decoder.write(b);
    // Check again after decoding
    if (state[prop].length + decoded.length >= maxBytes) {
      const remaining = maxBytes - state[prop].length;
      state[prop] += decoded.slice(0, remaining);
      state.tooMuchOutput = true;
      onOverflow();
      return;
    }
    state[prop] += decoded;
  };
}

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
// to terminate all descendants in the process group tree, ensuring
// shell-spawned subprocesses (e.g. a `sleep` launched by a shell script)
// release the inherited stdout/stderr pipes promptly and Node can emit the
// `close` event as soon as the group exits.
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

    const state = { stdout: '', stderr: '', timedOut: false, tooMuchOutput: false, settled: false, hardTimer: null };
    const stdoutDecoder = new StringDecoder('utf-8');
    const stderrDecoder = new StringDecoder('utf-8');

    child.stdout.on('data', createStreamHandler(stdoutDecoder, state, 'stdout', MAX_STDOUT, () => killGroup(child, 'SIGKILL')));
    child.stderr.on('data', createStreamHandler(stderrDecoder, state, 'stderr', MAX_STDERR, () => killGroup(child, 'SIGKILL')));

    const softTimer = setTimeout(() => {
      state.timedOut = true;
      killGroup(child, 'SIGTERM');
      // G24: Capture the hard timer so we can clear it on natural exit
      state.hardTimer = setTimeout(() => {
        if (!state.settled) { killGroup(child, 'SIGKILL'); }
      }, 500);
    }, timeoutMs);

    child.on('error', makeErrorHandler(state, softTimer, resolve));
    child.on('close', makeCloseHandler(state, softTimer, stdoutDecoder, stderrDecoder, resolve));
  });
}

function makeErrorHandler(state, softTimer, resolve) {
  return (err) => {
    if (state.settled) return;
    state.settled = true;
    clearTimeout(softTimer);
    // G24: Clear hard timer if it was set
    if (state.hardTimer) clearTimeout(state.hardTimer);

    // G26: Spawn error should never set timedOut to true.
    // The error handler fires when spawn fails (ENOENT, EMFILE, etc.),
    // which happens before the child even starts. timedOut requires
    // the timeout to have actually elapsed AND a child to have existed.
    const errDetail = (state.stderr.endsWith('\n') || state.stderr === '' ? '' : '\n') + `spawn error: ${err.message}`;
    resolve({
      ok: false,
      exitCode: null,
      signal: null,
      stdout: state.stdout,
      stderr: state.stderr + errDetail,
      timedOut: false, // G26: Explicitly false, not inheriting timedOut flag
      tooMuchOutput: false,
    });
  };
}

function makeCloseHandler(state, softTimer, stdoutDecoder, stderrDecoder, resolve) {
  return (code, signal) => {
    if (state.settled) return;
    state.settled = true;
    clearTimeout(softTimer);
    // G24: Clear the SIGKILL timer to prevent event loop from hanging
    if (state.hardTimer) clearTimeout(state.hardTimer);

    // Flush any remaining bytes in the decoders
    state.stdout += stdoutDecoder.end();
    state.stderr += stderrDecoder.end();

    const ok = !state.timedOut && !state.tooMuchOutput && code === 0;
    resolve({
      ok,
      exitCode: code,
      signal,
      stdout: state.stdout,
      stderr: state.stderr,
      timedOut: state.timedOut,
      tooMuchOutput: state.tooMuchOutput,
    });
  };
}
