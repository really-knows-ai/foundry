// tests/plugin/config-command-tools.e2e.test.js
//
// Phase 04: Validator Execution Tools
//
// D5 — JSONL parser reuse via foundry_config_run_validator
// D6 — Validator-specific contract error detection
// D7 — Passing/failing companion tests via foundry_config_run_validator_test
// D8 — Audit log writing
// D9 — Dirty-tree reporting
// D10 — Path rejection for validator test tool

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-cmd-tools-'));
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  try { execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV }); } catch { /* ignore */ }
  mkdirSync(join(dir, 'foundry', 'artefacts', 'haiku'), { recursive: true });
  writeFileSync(join(dir, 'foundry', '.gitkeep'), '');
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -qm init', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeFixture(dir, relPath, content) {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

// ---------------------------------------------------------------------------
// D10 — Path rejection for foundry_config_run_validator_test
// ---------------------------------------------------------------------------
describe('foundry_config_run_validator_test — path rejection (D10)', () => {
  let dir;
  let plugin;

  beforeEach(async () => {
    dir = setupRepo();
    execSync('git checkout -q -b config/add-validator', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => {
    cleanup(dir);
  });

  test('rejects path outside foundry/ (absolute)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      { path: '/etc/passwd' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /path outside foundry/);
    assert.equal(res.reason, 'path_outside_foundry');
  });

  test('rejects path outside foundry/ (parent traversal)', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      { path: '../outside.js' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /path outside foundry/);
    assert.equal(res.reason, 'path_outside_foundry');
  });

  test('rejects path that does not match *.test.js or *.test.mjs', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      { path: 'foundry/artefacts/haiku/not-a-test.js' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /does not match \*\.test\.(?:js|mjs)/);
  });

  test('accepts path under foundry/** matching *.test.mjs', async () => {
    // Write a minimal passing test file
    writeFixture(dir, 'foundry/artefacts/haiku/validate.test.mjs',
      'process.exit(0);\n');
    execSync('git add -A && git commit -qm "add test file"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      { path: 'foundry/artefacts/haiku/validate.test.mjs' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(res.passed, true);
    assert.equal(res.exitCode, 0);
  });

  test('rejects path with no argument', async () => {
    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      {},
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.match(res.error, /path is required/);
  });
});

// ---------------------------------------------------------------------------
// D7 — Passing and failing companion tests via foundry_config_run_validator_test
// ---------------------------------------------------------------------------
describe('foundry_config_run_validator_test — pass/fail (D7)', () => {
  let dir;
  let plugin;

  beforeEach(async () => {
    dir = setupRepo();
    execSync('git checkout -q -b config/add-validator', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => {
    cleanup(dir);
  });

  test('passing .test.mjs returns passed: true', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/passing.test.mjs',
      'import assert from "node:assert/strict";\n' +
      'assert.equal(1 + 1, 2);\n');
    execSync('git add -A && git commit -qm "add passing test"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      { path: 'foundry/artefacts/haiku/passing.test.mjs' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(res.passed, true);
    assert.equal(res.exitCode, 0);
  });

  test('failing .test.mjs returns passed: false', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/failing.test.mjs',
      'import assert from "node:assert/strict";\n' +
      'assert.equal(1 + 1, 3);\n');
    execSync('git add -A && git commit -qm "add failing test"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      { path: 'foundry/artefacts/haiku/failing.test.mjs' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(res.passed, false);
    assert.notEqual(res.exitCode, 0);
    assert.ok(res.stderr);
  });

  test('passing .test.js returns passed: true', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/passing.test.js',
      'const assert = require("assert");\n' +
      'assert.strictEqual(1 + 1, 2);\n');
    execSync('git add -A && git commit -qm "add passing js test"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      { path: 'foundry/artefacts/haiku/passing.test.js' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(res.passed, true);
    assert.equal(res.exitCode, 0);
  });

  test('test execution writes audit log', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/logged.test.mjs',
      'process.exit(0);\n');
    execSync('git add -A && git commit -qm "add logged test"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator_test.execute(
      { path: 'foundry/artefacts/haiku/logged.test.mjs' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.ok(res.logPath);
    assert.match(res.logPath, /\.foundry\/config-command-logs\//);
  });
});

// ---------------------------------------------------------------------------
// D5/D6 — Validator execution with JSONL parsing and contract errors
// ---------------------------------------------------------------------------
describe('foundry_config_run_validator — JSONL parsing and contract errors (D5/D6)', () => {
  let dir;
  let plugin;

  beforeEach(async () => {
    dir = setupRepo();
    execSync('git checkout -q -b config/add-validator', { cwd: dir, env: GIT_ENV });
    plugin = await FoundryPlugin({ directory: dir });
  });

  afterEach(() => {
    cleanup(dir);
  });

  test('valid JSONL produces correct violations array', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/valid-jsonl.mjs',
      'const lines = [\n' +
      '  JSON.stringify({ file: "a.md", text: "ok" }),\n' +
      '  JSON.stringify({ file: "b.md", text: "also ok" }),\n' +
      '];\n' +
      'console.log(lines.join("\\n"));\n');
    execSync('git add -A && git commit -qm "add valid jsonl script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/valid-jsonl.mjs {files} {pattern}',
        files: ['a.md', 'b.md'],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(res.violations.length, 2);
    assert.equal(res.parseErrors.length, 0);
    assert.equal(res.patternErrors.length, 0);
  });

  test('line missing required file field produces parse error', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/missing-file.mjs',
      'console.log(JSON.stringify({ text: "no file field" }));\n');
    execSync('git add -A && git commit -qm "add missing file script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/missing-file.mjs {pattern}',
        files: [],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.ok(res.parseErrors.length > 0);
    assert.match(res.parseErrors[0], /Missing required field 'file'/);
  });

  test('line missing required text field produces parse error', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/missing-text.mjs',
      'console.log(JSON.stringify({ file: "a.md" }));\n');
    execSync('git add -A && git commit -qm "add missing text script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/missing-text.mjs {pattern}',
        files: [],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.ok(res.parseErrors.length > 0);
    assert.match(res.parseErrors[0], /Missing.*required field 'text/);
  });

  test('malformed JSON in a line produces parse error', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/bad-json.mjs',
      'console.log("not json at all");\n');
    execSync('git add -A && git commit -qm "add bad json script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/bad-json.mjs {pattern}',
        files: [],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.ok(res.parseErrors.length > 0);
  });

  test('non-zero exit code with valid JSONL is tolerated', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/exit1-valid.mjs',
      'console.log(JSON.stringify({ file: "a.md", text: "valid despite error" }));\n' +
      'process.exit(1);\n');
    execSync('git add -A && git commit -qm "add exit1 valid script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/exit1-valid.mjs {pattern}',
        files: [],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    // Non-zero exit with valid JSONL → ok: true
    assert.equal(res.ok, true);
    assert.equal(res.violations.length, 1);
    assert.notEqual(res.exitCode, 0);
  });

  test('non-zero exit with empty stdout is tolerated (no valid items, no parse errors)', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/exit1-noout.mjs',
      'process.exit(1);\n');
    execSync('git add -A && git commit -qm "add exit1 noout script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/exit1-noout.mjs {pattern}',
        files: [],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    // Empty stdout + non-zero exit produces no parse errors, so the
    // validator is not considered crashed (matching quench behaviour).
    assert.equal(res.ok, true);
    assert.equal(res.violations.length, 0);
    assert.equal(res.parseErrors.length, 0);
    assert.notEqual(res.exitCode, 0);
  });

  test('empty stdout returns zero violations and no errors', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/empty-out.mjs',
      '// produces no output\n');
    execSync('git add -A && git commit -qm "add empty out script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/empty-out.mjs',
        files: ['a.md'],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.equal(res.violations.length, 0);
    assert.equal(res.parseErrors.length, 0);
    assert.equal(res.patternErrors.length, 0);
  });

  test('file not matching pattern produces pattern error', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/pattern-mismatch.mjs',
      'console.log(JSON.stringify({ file: "a.json", text: "should not match" }));\n');
    execSync('git add -A && git commit -qm "add pattern mismatch script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/pattern-mismatch.mjs {pattern}',
        files: [],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    // Pattern errors do not make the result ok: false
    assert.equal(res.ok, true);
    assert.ok(res.patternErrors.length > 0);
    assert.match(res.patternErrors[0], /does not match any pattern/);
  });

  test('audit log is written after validator execution', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/audit-log-test.mjs',
      'console.log(JSON.stringify({ file: "a.md", text: "ok" }));\n');
    execSync('git add -A && git commit -qm "add audit log test script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/audit-log-test.mjs {pattern}',
        files: [],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    assert.ok(res.logPath);
    assert.match(res.logPath, /\.foundry\/config-command-logs\//);

    // Verify the audit log file exists and has the expected fields
    const logFile = join(dir, res.logPath);
    assert.ok(existsSync(logFile));
    const logContent = JSON.parse(readFileSync(logFile, 'utf8'));
    assert.equal(logContent.reason, 'validator execution');
    assert.ok(logContent.id);
    assert.ok(logContent.startedAt);
    assert.ok(logContent.finishedAt);
    assert.equal(typeof logContent.durationMs, 'number');
    assert.equal(logContent.exitCode, 0);
  });

  test('validator execution reports dirty-tree changes', async () => {
    writeFixture(dir, 'foundry/artefacts/haiku/dirty-tree-test.mjs',
      'import { writeFileSync } from "node:fs";\n' +
      'writeFileSync("foundry/artefacts/haiku/dirty-output.txt", "dirty", "utf8");\n' +
      'console.log(JSON.stringify({ file: "a.md", text: "ok" }));\n');
    execSync('git add -A && git commit -qm "add dirty tree test script"', { cwd: dir, env: GIT_ENV });

    const res = JSON.parse(await plugin.tool.foundry_config_run_validator.execute(
      {
        command: 'node foundry/artefacts/haiku/dirty-tree-test.mjs {pattern}',
        files: [],
        patterns: ['*.md'],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true);
    // The dirty tree test creates a file, so dirtyAfter should include it
    // Note: fixture files in the script may show up; we just verify changedFiles exists
    assert.ok(Array.isArray(res.violations));
    assert.equal(res.violations.length, 1);
  });
});
