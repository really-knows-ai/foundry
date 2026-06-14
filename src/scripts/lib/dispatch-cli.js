import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

let _execFile = execFile;

const PROMPTS_DIR = '.foundry/dispatch-prompts';
const DEFAULT_TIMEOUT_MS = 300_000;

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
  return _execFile('opencode', dispatchArgs(worktree, promptPath, agentName, modelParam), {
    cwd: worktree,
  });
}

export function awaitProcess(child, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('child process timed out'));
    }, timeoutMs);

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`child process exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
