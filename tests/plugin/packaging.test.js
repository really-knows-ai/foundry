import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_DIR = join(REPO_ROOT, 'dist');

function readJSON(filename) {
  const raw = readFileSync(join(REPO_ROOT, filename), 'utf8');
  return JSON.parse(raw);
}

const AGENT_NAMES = [
  'foundry-guide',
  'foundry-admin',
  'foundry-forge',
  'foundry-appraise',
  'foundry-assay',
];

test('package.json files includes dist/agents/', () => {
  const pkg = readJSON('package.json');
  assert.ok(
    pkg.files && Array.isArray(pkg.files),
    'package.json must have a files array'
  );
  assert.ok(
    pkg.files.includes('dist/agents/'),
    'package.json files must include dist/agents/ to ship agent files'
  );
});

test('T2.1 — build produces all five agent files in dist/agents/', () => {
  for (const name of AGENT_NAMES) {
    const filePath = join(REPO_ROOT, 'dist', 'agents', `${name}.md`);
    let found;
    try {
      readFileSync(filePath, 'utf8');
      found = true;
    } catch {
      found = false;
    }
    assert.ok(found, `dist/agents/${name}.md must exist after build — run pnpm run build first`);
  }
});

test('T2.2 — build does not produce old foundry.md in dist/agents/', () => {
  const oldPath = join(REPO_ROOT, 'dist', 'agents', 'foundry.md');
  assert.equal(
    existsSync(oldPath),
    false,
    'dist/agents/foundry.md must not exist — the old single-agent file is replaced by the five new agent files'
  );
});

test('T2.3 — old payload.js and attest.js modules are deleted from the source tree', () => {
  const oldPayloadPath = join(REPO_ROOT, 'src/scripts/lib/attestation/payload.js');
  const oldAttestPath = join(REPO_ROOT, 'src/scripts/lib/attestation/attest.js');
  assert.equal(
    existsSync(oldPayloadPath),
    false,
    'src/scripts/lib/attestation/payload.js must not exist — the module is superseded by stage-payload.js'
  );
  assert.equal(
    existsSync(oldAttestPath),
    false,
    'src/scripts/lib/attestation/attest.js must not exist — the module is superseded by executor-attestation.js'
  );
});

// Walk .js files in dist/ and collect all relative import paths
function collectRelativeImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const imports = [];
  // Static: from '...'
  for (const m of content.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
    imports.push(m[1]);
  }
  // Dynamic: import('...')
  for (const m of content.matchAll(/import\(['"](\.[^'"]+)['"]\)/g)) {
    imports.push(m[1]);
  }
  return imports;
}

function walkJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

function resolveImport(distFile, relativePath) {
  const resolved = resolve(dirname(distFile), relativePath);
  return existsSync(resolved) || existsSync(resolved + '.js') ? null : resolved;
}

test('all relative imports in dist resolve to existing files', () => {
  const jsFiles = walkJsFiles(DIST_DIR);
  assert.ok(jsFiles.length > 0, 'No .js files found in dist/ — run pnpm run build first');

  const broken = [];
  for (const file of jsFiles) {
    for (const imp of collectRelativeImports(file)) {
      const missing = resolveImport(file, imp);
      if (missing) {
        broken.push(`${relative(REPO_ROOT, file)} imports '${imp}' → not found at ${relative(REPO_ROOT, missing)}`);
      }
    }
  }

  if (broken.length > 0) {
    assert.fail(`Broken import paths in dist (${broken.length}):\n${broken.join('\n')}`);
  }
});
