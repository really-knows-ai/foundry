import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

function hashDist(dir) {
  const hash = createHash('sha256');
  walk(dir, dir, hash);
  return hash.digest('hex');
}

function walk(base, dir, hash) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(base, full);
    if (entry === '.quality-gate') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(base, full, hash);
    } else {
      hash.update(rel + '\0');
      hash.update(readFileSync(full));
      hash.update('\0');
    }
  }
}

const sealPath = 'dist/.quality-gate';

let seal;
try {
  seal = JSON.parse(readFileSync(sealPath, 'utf8'));
} catch {
  console.error('dist/.quality-gate missing or invalid — run pnpm run build:all first');
  process.exit(1);
}

const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
if (seal.commit !== head) {
  console.error(`Seal commit ${seal.commit.slice(0, 7)} does not match HEAD ${head.slice(0, 7)} — re-run pnpm run build:all`);
  process.exit(1);
}

const checksum = hashDist('dist');
if (seal.checksum !== checksum) {
  console.error('dist/ content does not match seal — re-run pnpm run build:all');
  process.exit(1);
}

console.log(`dist/ verified — sealed at commit ${seal.commit.slice(0, 7)} (${seal.timestamp})`);
