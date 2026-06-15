// scripts/lib/config-command-runner.js
//
// Scoped, no-shell command runner for Foundry config commands.
//
// Provides: parseCommand, checkCommandPolicy, writeAuditLog,
// detectDirtyTree, runCommand.

import path from 'path';
import { spawnSync } from 'child_process';
import { ulid } from './ulid.js';
import { parsePorcelainZ } from './git-policy.js';

// -- Low-level exec / spawn helpers ------------------------------------------

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

const SINGLE_CHAR_SHELL = {
  '|': 'pipe |',
  ';': 'semicolon ;',
  '`': 'backtick',
  '*': 'glob pattern',
  '?': 'glob pattern',
  '[': 'glob bracket expression',
  ']': 'glob bracket expression',
  '>': 'redirect >',
  '<': 'redirect <',
};

const TWO_CHAR_FEATURES = {
  '$(': 'command substitution $(',
  '&&': '&&',
};

// ---------------------------------------------------------------------------
// D1 — parseCommand helpers
// ---------------------------------------------------------------------------

function shellError(feature) {
  return { ok: false, error: `shell feature not allowed: ${feature}`, reason: 'shell_feature_denied' };
}

function isEmptyCommand(command) {
  return !command || command.trim() === '';
}

function checkFeature(ch, next) {
  const msg = SINGLE_CHAR_SHELL[ch];
  if (msg) return msg;
  if (next === undefined) return null;
  return TWO_CHAR_FEATURES[ch + next] || null;
}

function isRedirectToken(token) {
  return /^>|^<|^\d+>|^\d+<|^&>|^&</.test(token);
}

function rejectRedirects(argv) {
  for (const token of argv) {
    if (isRedirectToken(token)) return shellError(`redirect '${token}'`);
  }
  return null;
}

function rejectFirstEnvAssign(argv) {
  if (argv.length > 0) {
    if (/^[A-Za-z_]\w*=/.test(argv[0])) return shellError('environment assignment');
  }
  return null;
}

function handleInSingle(ch, state) {
  if (ch === "'") { state.inSingle = false; return; }
  state.current += ch;
}

function handleInDouble(ch, state) {
  if (ch === '"') { state.inDouble = false; }
  else if (ch === '\\') { state.escaped = true; }
  else { state.current += ch; }
}

function handleStatefulChar(ch, state) {
  if (state.escaped) { state.current += ch; state.escaped = false; return true; }
  if (state.inSingle) { handleInSingle(ch, state); return true; }
  if (state.inDouble) { handleInDouble(ch, state); return true; }
  return false;
}

function handleQuoteChar(ch, state) {
  if (ch === '\\') { state.escaped = true; return true; }
  if (ch === "'") { state.inSingle = true; return true; }
  if (ch === '"') { state.inDouble = true; return true; }
  return false;
}

function handleWhitespace(ch, state) {
  if (!/\s/.test(ch)) return false;
  if (state.current) { state.argv.push(state.current); state.current = ''; }
  return true;
}

function advanceChar(ch, next, state) {
  if (handleStatefulChar(ch, state)) return null;
  if (handleQuoteChar(ch, state)) return null;

  const feature = checkFeature(ch, next);
  if (feature) return shellError(feature);

  if (handleWhitespace(ch, state)) return null;

  state.current += ch;
  return null;
}

function scanTokens(command) {
  const state = { argv: [], current: '', inSingle: false, inDouble: false, escaped: false };

  for (let i = 0; i < command.length; i++) {
    const err = advanceChar(command[i], command[i + 1], state);
    if (err) return err;
  }

  if (state.current) state.argv.push(state.current);
  return state.argv;
}

/**
 * Parse a command string into an argv array using shell-like quoting rules.
 * Rejects shell features with a structured error reason.
 *
 * @param {string} command - Raw command string
 * @returns {{ ok: true, argv: string[] } | { ok: false, error: string, reason: string }}
 */
export function parseCommand(command) {
  if (isEmptyCommand(command)) {
    return { ok: false, error: 'command string is empty', reason: 'empty_command' };
  }

  const argv = scanTokens(command);
  if (!Array.isArray(argv)) return argv;

  const bad = rejectRedirects(argv);
  if (bad) return bad;

  const envBad = rejectFirstEnvAssign(argv);
  return envBad || { ok: true, argv };
}

// ---------------------------------------------------------------------------
// D2 — checkCommandPolicy helpers
// ---------------------------------------------------------------------------

function checkNodePath(argv, baseDir) {
  if (argv.length < 2) {
    return { ok: false, error: 'missing script path', reason: 'missing_path' };
  }
  const dir = baseDir || process.cwd();
  const scriptPath = argv[1];
  const resolved = path.resolve(dir, scriptPath);
  const foundryResolved = path.resolve(dir, 'foundry');
  const underFoundry = resolved === foundryResolved || resolved.startsWith(foundryResolved + path.sep);
  if (!underFoundry) {
    return { ok: false, error: `path outside foundry/: ${scriptPath}`, reason: 'path_outside_foundry' };
  }
  return { ok: true, argv, mode: 'node-foundry-script' };
}

function checkPnpmArgv(argv) {
  if (argv.length < 2) {
    return { ok: false, error: 'missing pnpm subcommand', reason: 'missing_subcommand' };
  }
  if (argv[1] !== 'run') {
    return { ok: false, error: `command not allowed: pnpm ${argv[1]}`, reason: 'command_not_allowed' };
  }
  if (argv.length < 3) {
    return { ok: false, error: 'missing script name', reason: 'missing_script_name' };
  }
  return null;
}

function checkPnpmCwd(baseDir, cwd) {
  if (!baseDir || !cwd) return { ok: false, error: 'cwd is required for pnpm, must be foundry/', reason: 'missing_cwd' };
  const foundryDir = path.resolve(baseDir, 'foundry');
  if (path.resolve(cwd) !== foundryDir) {
    return { ok: false, error: 'cwd must be foundry/ for pnpm run', reason: 'cwd_not_foundry' };
  }
  return null;
}

function checkPnpm(argv, baseDir, cwd) {
  const argvResult = checkPnpmArgv(argv);
  if (argvResult) return argvResult;
  const cwdResult = checkPnpmCwd(baseDir, cwd);
  if (cwdResult) return cwdResult;
  return { ok: true, argv, mode: 'pnpm-run' };
}

/**
 * Validate parsed argv against the config command allow-list.
 *
 * @param {string[]} argv - Parsed command tokens
 * @param {string} [baseDir] - Worktree root path. Required for pnpm commands;
 *   used to resolve foundry/ paths for node commands.
 * @param {string} [cwd] - Working directory for the command. Required for
 *   pnpm commands; must resolve to the foundry/ directory under baseDir.
 * @returns {{ ok: true, argv: string[], mode: string } | { ok: false, error: string, reason: string }}
 */
export function checkCommandPolicy(argv, baseDir, cwd) {
  if (!argv || argv.length === 0) {
    return { ok: false, error: 'no command tokens', reason: 'empty_argv' };
  }

  const first = argv[0];
  if (first === 'node') return checkNodePath(argv, baseDir);
  if (first === 'pnpm') return checkPnpm(argv, baseDir, cwd);

  return { ok: false, error: `command not allowed: ${first}`, reason: 'command_not_allowed' };
}

// ---------------------------------------------------------------------------
// D3 — writeAuditLog
// ---------------------------------------------------------------------------

/**
 * Write a structured audit log under .foundry/config-command-logs/.
 *
 * @param {object} io - IO interface with mkdir(dir) and writeFile(path, content)
 * @param {object} logData - The audit record
 * @returns {{ ok: true, logPath: string } | { ok: false, error: string }}
 */
export function writeAuditLog(io, logData) {
  try {
    const logDir = '.foundry/config-command-logs';
    io.mkdir(logDir);
    const id = ulid();
    const logPath = `${logDir}/${id}.json`;
    const fullLog = { ...logData, id };
    io.writeFile(logPath, JSON.stringify(fullLog, null, 2));
    return { ok: true, logPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// D4 — detectDirtyTree
// ---------------------------------------------------------------------------

/**
 * Detect dirty files in the working tree using git status.
 *
 * @param {Function} exec - Function that runs argv and returns either a stdout
 *   string or an object with a stdout string property.
 * @returns {string[]} - Array of file paths that are dirty.
 */
export function detectDirtyTree(exec) {
  try {
    const result = exec(['git', 'status', '--porcelain=v1', '-z']);
    const out = typeof result === 'string' ? result : (result.stdout ?? '');
    return parsePorcelainZ(out);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// D5 — runCommand helpers
// ---------------------------------------------------------------------------

function isEmptyReason(reason) {
  return !reason || reason.trim() === '';
}

function buildLogData(args) {
  const { reason, command, argv, t0, execResult, dirtyBefore, dirtyAfter, cwd } = args;
  const stdoutB = execResult.stdout || '';
  const stderrB = execResult.stderr || '';
  const stdoutBytes = Buffer.byteLength(stdoutB);
  const stderrBytes = Buffer.byteLength(stderrB);
  const sTrunc = stdoutBytes > MAX_CAPTURE_BYTES;
  const eTrunc = stderrBytes > MAX_CAPTURE_BYTES;

  return {
    reason, command, argv,
    cwd: cwd || process.cwd(),
    startedAt: new Date(t0).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    exitCode: execResult.exitCode,
    signal: execResult.signal,
    timedOut: execResult.timedOut === true,
    stdout: boundOutput(stdoutB),
    stderr: boundOutput(stderrB),
    stdoutTruncated: sTrunc,
    stderrTruncated: eTrunc,
    dirtyBefore, dirtyAfter,
    changedFiles: dirtyAfter.filter((f) => !dirtyBefore.includes(f)),
  };
}

function successFromLogData(logData, logPath) {
  return {
    ok: true,
    exitCode: logData.exitCode,
    timedOut: logData.timedOut,
    durationMs: logData.durationMs,
    stdout: logData.stdout,
    stderr: logData.stderr,
    stdoutTruncated: logData.stdoutTruncated,
    stderrTruncated: logData.stderrTruncated,
    dirtyBefore: logData.dirtyBefore,
    dirtyAfter: logData.dirtyAfter,
    changedFiles: logData.changedFiles,
    logPath,
  };
}

function logFailure(logData) {
  return {
    ok: false,
    error: 'failed to write audit log',
    reason: 'audit_log_failed',
    exitCode: logData.exitCode,
    timedOut: logData.timedOut,
    stdout: logData.stdout,
    stderr: logData.stderr,
  };
}

function validateCommandInput(command, reason, worktree, cwd) {
  if (isEmptyReason(reason)) {
    return { ok: false, error: 'reason is required', reason: 'missing_reason' };
  }

  const parsed = parseCommand(command);
  if (!parsed.ok) return parsed;

  const policy = checkCommandPolicy(parsed.argv, worktree, cwd);
  if (!policy.ok) return policy;

  return null;
}

/**
 * Execute a config command with full policy enforcement, output capture,
 * timeout, dirty-tree tracking, and audit logging.
 *
 * @param {object} options
 * @param {object} options.io - IO interface with mkdir, writeFile
 * @param {Function} options.exec - Execution function (argv, opts) =>
 *   { stdout, stderr, exitCode, signal, timedOut, stdoutTruncated, stderrTruncated }
 * @param {string} options.command - Raw command string
 * @param {string} options.reason - Non-empty reason for audit log
 * @param {number} [options.timeout] - Timeout in milliseconds
 * @param {Function} [options.dirtyExec] - Separate exec for dirty-tree
 *   detection. Defaults to `exec` when not provided. Use when the command exec
 *   runs from a subdirectory (e.g. `foundry/` for pnpm) but dirty-tree
 *   detection must run from the repository root.
 * @returns {object} - Execution result
 */
export function runCommand({ io, exec, command, reason, timeout, worktree, cwd, dirtyExec }) {
  const inputValid = validateCommandInput(command, reason, worktree, cwd);
  if (inputValid) return inputValid;

  const effectiveTimeout = resolveTimeout(timeout);
  const parsed = parseCommand(command);

  const dirtyCheck = dirtyExec || exec;
  const dirtyBefore = detectDirtyTree(dirtyCheck);
  const t0 = Date.now();
  const execResult = exec(parsed.argv, { timeout: effectiveTimeout });
  const dirtyAfter = detectDirtyTree(dirtyCheck);

  const logData = buildLogData({
    reason, command, argv: parsed.argv, t0, execResult, dirtyBefore, dirtyAfter, cwd,
  });

  const logResult = writeAuditLog(io, logData);
  if (!logResult.ok) return logFailure(logData);

  return successFromLogData(logData, logResult.logPath);
}
