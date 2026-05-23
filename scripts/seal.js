import { writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const timestamp = new Date().toISOString();
const checksum = hashDist('dist');

writeFileSync('dist/.quality-gate', JSON.stringify({ commit, timestamp, checksum }) + '\n');
console.log(`Sealed dist/ with commit ${commit.slice(0, 7)} at ${timestamp}`);
