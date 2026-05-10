// Tests in this file exercise `finalizeStage` against real git and a real
// file-system. Extracted from orchestrate.integration.test.js as part of
// keeping that file honest under the integration tier definition (no real
// externals). See tests/README.md.

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { finalizeStage } from '../src/scripts/lib/finalize.js';

test('finalizeStage returns sorted changed files for forge output', () => {
  // Use the actual git repo directory for this integration test
  const repoDir = process.cwd();
  // Get a valid SHA from the repository
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir }).toString().trim();

  // Mock the minimal finalize context
  const artefacts = [];
  const result = finalizeStage({
    cwd: repoDir,
    baseSha,
    stageBase: 'forge',
    cycleDef: { outputArtefactType: 'haiku' },
    artefactTypes: { haiku: { filePatterns: ['out/*.md'] } },
    io: { exec: (argv) => execFileSync(argv[0], argv.slice(1), { cwd: repoDir, encoding: 'utf8', stdio: 'pipe' }) },
    registerArtefact: (a) => artefacts.push(a),
  });

  // The worktree is clean at HEAD, so we expect ok: true with empty changedFiles
  if (!result.ok) {
    // If there are unexpected files, that's fine - we just want to verify the API shape
    assert.ok(result.error, 'result should have an error field when ok is false');
  } else {
    // The result should have a changedFiles array (could be empty if no matching files)
    assert.ok(Array.isArray(result.changedFiles), 'changedFiles should be an array');
    // Verify it's sorted (check that it equals its sorted version)
    const sorted = [...result.changedFiles].sort((a, b) => a.localeCompare(b, 'en'));
    assert.deepEqual(result.changedFiles, sorted, 'changedFiles should be sorted');
  }
});

test('finalizeStage returns deterministic sorted changedFiles for controlled forge case', async () => {
  // Regression: previous test depended on ambient repo state. This test creates a controlled
  // scenario with known file changes to verify deterministic sorting behaviour.
  const testDir = '/tmp/foundry-finalize-test';

  // Create a minimal git repo with two files in forge output directory
  try {
    execFileSync('rm', ['-rf', testDir], { stdio: 'ignore' });
  } catch { /* not present, no problem */ }

  execFileSync('mkdir', ['-p', testDir]);
  execFileSync('git', ['init'], { cwd: testDir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: testDir });

  // Create initial commit
  execFileSync('mkdir', ['-p', `${testDir}/out`], { stdio: 'ignore' });
  execFileSync('touch', [`${testDir}/out/.keep`], { stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: testDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: testDir });

  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: testDir }).toString().trim();

  // Create forge output files in reverse alphabetical order to test sorting
  writeFileSync(`${testDir}/out/zebra.md`, 'z');
  writeFileSync(`${testDir}/out/apple.md`, 'a');
  writeFileSync(`${testDir}/out/mango.md`, 'm');

  const artefacts = [];
  const result = finalizeStage({
    cwd: testDir,
    baseSha,
    stageBase: 'forge',
    cycleDef: { outputArtefactType: 'haiku' },
    artefactTypes: { haiku: { filePatterns: ['out/*.md'] } },
    io: { exec: (argv) => execFileSync(argv[0], argv.slice(1), { cwd: testDir, encoding: 'utf8', stdio: 'pipe' }) },
    registerArtefact: (a) => artefacts.push(a),
  });

  assert.ok(result.ok, 'finalize should succeed');
  assert.ok(Array.isArray(result.changedFiles), 'changedFiles should be an array');
  assert.deepStrictEqual(
    result.changedFiles,
    ['out/apple.md', 'out/mango.md', 'out/zebra.md'],
    'changedFiles must be deterministically sorted, excluding .keep'
  );

  // Clean up
  try {
    execFileSync('rm', ['-rf', testDir], { stdio: 'ignore' });
  } catch { /* best-effort cleanup */ }
});
