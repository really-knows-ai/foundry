import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

let _execFile = execFile;

const PROMPTS_DIR = '.foundry/dispatch-prompts';
const LOGS_DIR = '.foundry/dispatch-logs';
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 200_000;

function outputBuffer() {
  let text = '';
  let truncated = false;
  return {
    push(chunk) {
      if (truncated) return;
      text += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (text.length <= MAX_OUTPUT_CHARS) return;
      text = text.slice(0, MAX_OUTPUT_CHARS);
      truncated = true;
    },
    snapshot() { return { text, truncated }; },
  };
}

function attachOutputCapture(child) {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('data', stdout.push);
  if (child.stderr && typeof child.stderr.on === 'function') child.stderr.on('data', stderr.push);
  return { stdout, stderr };
}

function writeLog(io, logPath, payload) {
  io.mkdir(LOGS_DIR);
  io.writeFile(logPath, JSON.stringify(payload, null, 2) + '\n');
}

function objectModelArg(modelParam) {
  if (!modelParam.modelID) return null;
  if (modelParam.providerID) return modelParam.providerID + '/' + modelParam.modelID;
  return modelParam.modelID;
}

function modelArg(modelParam) {
  if (!modelParam) return null;
  if (typeof modelParam === 'string') return modelParam;
  return objectModelArg(modelParam);
}

function appendModelArg(args, modelParam) {
  const model = modelArg(modelParam);
  if (!model) return;
  args.push('--model', model);
}

function dispatchArgs(worktree, promptPath, agentName, modelParam) {
  const args = ['run', 'Follow the attached prompt file.', '--attach', '--agent', agentName];
  appendModelArg(args, modelParam);
  args.push('--dir', worktree, '--file', promptPath);
  return args;
}

export function writePromptFile(io, prompt) {
  const id = randomUUID();
  const filePath = `${PROMPTS_DIR}/${id}.txt`;
  io.mkdir(PROMPTS_DIR);
  io.writeFile(filePath, prompt);
  return filePath;
}

export function _setExecFile(fn) {
  _execFile = fn;
}

export function spawnDispatch(worktree, promptPath, agentName, modelParam) {
  const args = dispatchArgs(worktree, promptPath, agentName, modelParam);
  const child = _execFile('opencode', args, {
    cwd: worktree,
    stdio: 'pipe',
  });
  child.foundryDispatch = { command: 'opencode', args, cwd: worktree, agentName, promptPath };
  return child;
}

export function createDispatchLog(io, metadata = {}) {
  const logPath = `${LOGS_DIR}/${randomUUID()}.json`;
  return {
    path: logPath,
    finish(outcome) {
      writeLog(io, logPath, { ...metadata, ...outcome });
    },
  };
}

function dispatchError(message, dispatchLog) {
  if (!dispatchLog) return new Error(message);
  return new Error(`${message} (dispatch log: ${dispatchLog.path})`);
}

function outputSnapshot(buffers) {
  const stdout = buffers.stdout.snapshot();
  const stderr = buffers.stderr.snapshot();
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  };
}

function finishLog(dispatchLog, buffers, startedAt, outcome) {
  if (!dispatchLog) return;
  dispatchLog.finish({
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(startedAt),
    ...outcome,
    ...outputSnapshot(buffers),
  });
}

export function awaitProcess(child, timeoutMs = DEFAULT_TIMEOUT_MS, dispatchLog = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const startedAt = new Date().toISOString();
    const buffers = attachOutputCapture(child);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      finishLog(dispatchLog, buffers, startedAt, { status: 'timeout', signal: 'SIGKILL' });
      reject(dispatchError('child process timed out', dispatchLog));
    }, timeoutMs);

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finishLog(dispatchLog, buffers, startedAt, { status: code === 0 ? 'ok' : 'exit', code, signal });
      if (code === 0) {
        resolve();
      } else {
        reject(dispatchError(`child process exited with code ${code}`, dispatchLog));
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finishLog(dispatchLog, buffers, startedAt, { status: 'error', error: err.message ?? String(err) });
      reject(err);
    });
  });
}

export function cleanupFiles(io, ...paths) {
  for (const p of paths) {
    if (io.exists(p)) io.unlink(p);
  }
}

export async function withCleanup(io, fn) {
  const paths = [];
  try {
    return await fn(paths);
  } finally {
    cleanupFiles(io, ...paths);
  }
}
