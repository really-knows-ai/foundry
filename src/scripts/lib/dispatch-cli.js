import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

let _execFile = execFile;

const PROMPTS_DIR = '.foundry/dispatch-prompts';
const DEFAULT_TIMEOUT_MS = 300_000;

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

export function spawnDispatch(worktree, promptPath, agentName) {
  return _execFile('opencode', [
    'run', '--attach', '--agent', agentName,
    '--dir', worktree,
    '--file', promptPath,
  ], {
    cwd: worktree,
    stdio: 'pipe',
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
