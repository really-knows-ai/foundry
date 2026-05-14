import { existsSync } from 'fs';
import path from 'path';

function resolveFromPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

function resolveGit() {
  return process.env.FOUNDRY_GIT_PATH || resolveFromPath('git');
}

function resolveOpenCode() {
  return process.env.FOUNDRY_OPENCODE_PATH || resolveFromPath('opencode');
}

export { resolveGit, resolveOpenCode };
