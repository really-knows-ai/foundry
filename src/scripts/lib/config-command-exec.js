// scripts/lib/config-command-exec.js
//
// Low-level exec/spawn functions for the config command runner.
// Extracted from config-command-runner.js to keep each module under the
// 300-line limit.

import { spawnSync } from 'child_process';

export const MAX_CAPTURE_BYTES = 65536;

const DEFAULT_TIMEOUT = 30000;
const MAX_TIMEOUT = 120000;

export function resolveTimeout(timeout) {
  if (timeout === undefined || timeout === null) return DEFAULT_TIMEOUT;
  if (timeout < 0) return DEFAULT_TIMEOUT;
  if (timeout > MAX_TIMEOUT) return MAX_TIMEOUT;
  return timeout;
}

export function boundOutput(str) {
  const buffer = Buffer.from(str, 'utf8');
  if (buffer.length <= MAX_CAPTURE_BYTES) return str;
  return buffer.subarray(0, MAX_CAPTURE_BYTES).toString('utf8');
}

function isTruncated(bytes, bufferExceeded) {
  return bytes > MAX_CAPTURE_BYTES || (bufferExceeded && bytes >= MAX_CAPTURE_BYTES);
}

function spawnWithTimeout(argv, cwd, timeout) {
  return spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout,
    maxBuffer: MAX_CAPTURE_BYTES * 4,
    shell: false,
  });
}

function extractStdout(result) {
  return result.stdout || '';
}

function extractStderr(result) {
  const stderr = result.stderr || '';
  if (result.error) {
    return result.error.message || stderr;
  }
  return stderr;
}

function hasTimedOut(result) {
  if (result.error) return result.error.code === 'ETIMEDOUT';
  return false;
}

function hasBufferExceeded(result) {
  if (result.error) return result.error.code === 'ENOBUFS';
  return false;
}

/**
 * Execute a command via spawnSync with no shell, bounded output, and timeout
 * support.
 *
 * @param {string[]} argv - Command and arguments
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Working directory
 * @param {number} [opts.timeout] - Timeout in milliseconds
 * @returns {{ stdout, stderr, exitCode, signal, timedOut, stdoutTruncated, stderrTruncated }}
 */
function execCommand(argv, { cwd, timeout } = {}) {
  const wd = cwd || process.cwd();
  const to = resolveTimeout(timeout);
  const result = spawnWithTimeout(argv, wd, to);

  const stdout = extractStdout(result);
  const stderr = extractStderr(result);
  const bufferExceeded = hasBufferExceeded(result);
  const stdoutBytes = Buffer.byteLength(stdout);
  const stderrBytes = Buffer.byteLength(stderr);

  return {
    stdout: boundOutput(stdout),
    stderr: boundOutput(stderr),
    exitCode: result.status,
    signal: result.signal,
    timedOut: hasTimedOut(result),
    stdoutTruncated: isTruncated(stdoutBytes, bufferExceeded),
    stderrTruncated: isTruncated(stderrBytes, bufferExceeded),
  };
}

/**
 * Create a configured execution function compliant with the runCommand exec
 * contract.
 *
 * @param {string} cwd - Working directory for spawned processes
 * @param {number} [defaultTimeout] - Default timeout in milliseconds
 * @returns {Function} (argv, opts) => execution result
 */
export function createExec(cwd, defaultTimeout) {
  return (argv, opts = {}) => execCommand(argv, {
    cwd,
    timeout: opts.timeout ?? defaultTimeout,
  });
}
