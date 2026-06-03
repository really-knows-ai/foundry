/**
 * Quench timeout integration test.
 *
 * Verifies that a validator failure (non-zero exit) is handled through the
 * executeQuench logic (the "underlying path" used by foundry_run): a feedback
 * item is written to WORK.feedback.yaml, the run continues rather than
 * throwing a violation, and the spawnWithTimeout failure is correctly
 * transformed into a feedback item.
 *
 * D3.4 and D3.5 exercise the raw spawnWithTimeout to verify the event loop
 * is not blocked during concurrent timeouts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnWithTimeout } from '../../src/scripts/lib/assay/spawn-with-timeout.js';
import { executeQuench } from '../../src/scripts/run-executors.js';
import { makeIO } from '../../src/plugin/tools/helpers.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

// ── Fixture helpers ──────────────────────────────────────────────────

function writeFlowDef(root, flowId) {
  const dir = join(root, 'foundry/flows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, flowId + '.md'),
    '---\nstarting-cycles: write-haiku\n---\n# Haiku Flow\n');
}

function writeCycleDef(root, cycleId) {
  const dir = join(root, 'foundry/cycles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, cycleId + '.md'),
    '---\n' +
    'output-type: haiku\n' +
    'stages: [forge, quench, appraise]\n' +
    'max-iterations: 3\n' +
    'always-human-appraise: false\n' +
    'models:\n' +
    '  forge: opencode-go/deepseek-v4-flash\n' +
    '  appraise: opencode-go/deepseek-v4-flash\n' +
    '---\n# Write Haiku\n');
}

function writeArtefactDef(root) {
  const dir = join(root, 'foundry/artefacts/haiku');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'definition.md'),
    '---\ntype: haiku\nfile-patterns: ["haikus/*.md"]\n---\n');
}

function writeFailingValidator(root, name) {
  const dir = join(root, 'foundry/artefacts/haiku');
  writeFileSync(join(dir, name),
    '#!/usr/bin/env bash\nexit 1\n');
  execSync('chmod +x ' + join(dir, name));
}

function writeSlowScript(root, name, sleepMs) {
  const dir = join(root, 'foundry/artefacts/haiku');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name),
    '#!/usr/bin/env node\n' +
    'setTimeout(function() {\n' +
    '  process.stdout.write(JSON.stringify({ file: "test.md", lawId: "shape", text: "too slow" }) + "\\n");\n' +
    '  process.exit(0);\n' +
    '}, ' + sleepMs + ');\n');
  execSync('chmod +x ' + join(dir, name));
}

function writeLawWithValidator(root, validatorCmd) {
  const dir = join(root, 'foundry/laws');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'shape.md'),
    '## shape\n\nHaikus must follow 5-7-5 syllable structure.\n\n' +
    'validators:\n' +
    '  - id: shape-checker\n' +
    '    command: ' + validatorCmd + '\n');
}

function initRepo(root) {
  execSync('git init -q', { cwd: root, env: GIT_ENV });
  execSync('git checkout -B main -q', { cwd: root, env: GIT_ENV });
  writeFileSync(join(root, '.gitignore'), '.foundry/\n.snapshots/\n');
  writeFileSync(join(root, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -m init -q', { cwd: root, env: GIT_ENV });
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'quench-timeout-'));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function createAppraiseMockClient(root) {
  const sessions = [];
  return {
    session: {
      create: async function({ parentID, title, directory }) {
        const id = 'mock-session-' + (sessions.length + 1);
        sessions.push(id);
        return { id };
      },
      prompt: async function({ sessionID, parts, system, directory }) {
        // Simulate appraiser writing a stage-output file
        const sessionId = sessionID;
        const outDir = join(root, '.foundry/stage-outputs');
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, sessionId + '.jsonl'),
          '{"file":"haikus/test.md","text":"needs work","law":"shape","evidence":"line 1"}\n');
        return { ok: true };
      },
      messages: async function() { return []; },
    },
    config: { providers: async function() { return []; } },
    provider: { list: function() { return { connected: [] }; } },
    _sessionIds: sessions,
  };
}

// ── D3.1: Quench failure writes feedback item ────────────────────────

test('D3.1: quench validator failure writes feedback item to WORK.feedback.yaml', async () => {
  const root = tmpDir();
  try {
    initRepo(root);
    writeFlowDef(root, 'haiku');
    writeCycleDef(root, 'write-haiku');
    writeArtefactDef(root);

    const validatorPath = 'foundry/artefacts/haiku/validate-fail.sh';
    writeFailingValidator(root, 'validate-fail.sh');
    writeLawWithValidator(root, './' + validatorPath);

    execSync('git checkout -q -b work/haiku-quench-fail', { cwd: root, env: GIT_ENV });
    execSync('git add . && git commit -m "add haiku flow with failing validator" -q', { cwd: root, env: GIT_ENV });

    // Create an artefact file so quench has something to validate
    mkdirSync(join(root, 'haikus'), { recursive: true });
    writeFileSync(join(root, 'haikus/test.md'), 'sausages and eggs\nsizzling in the morning sun\na perfect breakfast\n');
    execSync('git add . && git commit -m "add haiku artefact" -q', { cwd: root, env: GIT_ENV });

    // Run quench directly (the "underlying path" used by foundry_run)
    const io = makeIO(root);
    const feedbackPath = 'WORK.feedback.yaml';
    const historyPath = 'WORK.history.yaml';

    const quenchResult = await executeQuench({
      sort: { route: 'quench:write-haiku', cycleId: 'write-haiku' },
      cwd: root, io, worktree: root,
      historyPath, feedbackPath, cycleId: 'write-haiku',
    });

    // Quench should succeed at the stage level (failures are recorded as feedback)
    assert.ok(quenchResult.ok, 'executeQuench should return ok: ' + JSON.stringify(quenchResult));

    // Feedback item should exist in WORK.feedback.yaml for the validator failure
    const feedbackPathAbs = join(root, feedbackPath);
    assert.ok(existsSync(feedbackPathAbs), 'WORK.feedback.yaml should exist');
    const feedbackContent = readFileSync(feedbackPathAbs, 'utf8');
    assert.ok(feedbackContent.includes('validator:'),
      'feedback item should reference a validator, got: ' + feedbackContent);
    assert.ok(feedbackContent.includes('failed'),
      'feedback item should mention failure, got: ' + feedbackContent);
  } finally {
    cleanup(root);
  }
});

// ── D3.2: Quench failure routes back (no violation from quench) ──────

test('D3.2: quench failure does not throw — routes back to forge via feedback cycle', async () => {
  const root = tmpDir();
  try {
    initRepo(root);
    writeFlowDef(root, 'haiku');
    writeCycleDef(root, 'write-haiku');
    writeArtefactDef(root);

    const validatorPath = 'foundry/artefacts/haiku/validate-fail.sh';
    writeFailingValidator(root, 'validate-fail.sh');
    writeLawWithValidator(root, './' + validatorPath);

    execSync('git checkout -q -b work/haiku-quench-fail-2', { cwd: root, env: GIT_ENV });
    execSync('git add . && git commit -m "add haiku flow" -q', { cwd: root, env: GIT_ENV });

    mkdirSync(join(root, 'haikus'), { recursive: true });
    writeFileSync(join(root, 'haikus/test.md'), 'sausages and eggs\n');
    execSync('git add . && git commit -m "add haiku" -q', { cwd: root, env: GIT_ENV });

    const io = makeIO(root);
    const feedbackPath = 'WORK.feedback.yaml';
    const historyPath = 'WORK.history.yaml';

    // executeQuench should not throw — it handles failures internally
    const quenchResult = await executeQuench({
      sort: { route: 'quench:write-haiku', cycleId: 'write-haiku' },
      cwd: root, io, worktree: root,
      historyPath, feedbackPath, cycleId: 'write-haiku',
    });

    // quench returns ok even with failures (failures become feedback items)
    assert.ok(quenchResult.ok, 'executeQuench should not return error');
    assert.ok(typeof quenchResult.summary === 'string',
      'quench should return a summary');
  } finally {
    cleanup(root);
  }
});

// ── D3.3: spawnWithTimeout failure → feedback item (Issue 4) ─────────

test('D3.3: validator non-zero exit produces feedback item via executeQuench', async () => {
  const root = tmpDir();
  try {
    initRepo(root);
    writeFlowDef(root, 'haiku');
    writeCycleDef(root, 'write-haiku');
    writeArtefactDef(root);

    // Write a validator with exit code 2
    const validatorScript = join(root, 'foundry/artefacts/haiku/validate-code2.sh');
    writeFileSync(validatorScript, '#!/usr/bin/env bash\nexit 2\n');
    execSync('chmod +x ' + validatorScript);

    const validatorPath = 'foundry/artefacts/haiku/validate-code2.sh';
    writeLawWithValidator(root, './' + validatorPath);

    execSync('git checkout -q -b work/haiku-quench-code2', { cwd: root, env: GIT_ENV });
    execSync('git add . && git commit -m "add haiku flow" -q', { cwd: root, env: GIT_ENV });

    mkdirSync(join(root, 'haikus'), { recursive: true });
    writeFileSync(join(root, 'haikus/test.md'), 'test haiku\n');
    execSync('git add . && git commit -m "add haiku" -q', { cwd: root, env: GIT_ENV });

    const io = makeIO(root);
    const feedbackPath = 'WORK.feedback.yaml';
    const historyPath = 'WORK.history.yaml';

    await executeQuench({
      sort: { route: 'quench:write-haiku', cycleId: 'write-haiku' },
      cwd: root, io, worktree: root,
      historyPath, feedbackPath, cycleId: 'write-haiku',
    });

    // The failing validator should have written a feedback item
    const feedbackPathAbs = join(root, feedbackPath);
    assert.ok(existsSync(feedbackPathAbs), 'WORK.feedback.yaml should exist');
    const feedbackContent = readFileSync(feedbackPathAbs, 'utf8');
    assert.ok(feedbackContent.includes('failed (exit code: 2)'),
      'feedback should report exit code 2, got: ' + feedbackContent);
    assert.ok(feedbackContent.includes('source: quench:write-haiku'),
      'feedback should have quench source, got: ' + feedbackContent);
  } finally {
    cleanup(root);
  }
});

// ── D3.4: host event loop is not blocked during validator timeout ────

test('D3.4: host event loop is not blocked during validator timeout', async () => {
  const root = tmpDir();
  try {
    writeSlowScript(root, 'validate-slow.js', 3000);

    const timerPromise = new Promise(function(resolve) {
      setTimeout(function() { resolve('timer-resolved'); }, 50);
    });

    const command = ['node', join(root, 'foundry/artefacts/haiku/validate-slow.js')];
    const spawnPromise = spawnWithTimeout({
      command: command.join(' '),
      cwd: root,
      timeoutMs: 2000,
      env: process.env,
    });

    const first = await Promise.race([timerPromise, spawnPromise]);
    assert.equal(first, 'timer-resolved',
      'timer should resolve before spawn completes, proving event loop is not blocked');
  } finally {
    cleanup(root);
  }
});

// ── D3.5: multiple slow validators all time out independently ─────────

test('D3.5: multiple slow validators all time out independently', async () => {
  const root = tmpDir();
  try {
    writeSlowScript(root, 'validate-slow-1.js', 5000);
    writeSlowScript(root, 'validate-slow-2.js', 5000);

    const cmd1 = ['node', join(root, 'foundry/artefacts/haiku/validate-slow-1.js')];
    const cmd2 = ['node', join(root, 'foundry/artefacts/haiku/validate-slow-2.js')];

    const [result1, result2] = await Promise.all([
      spawnWithTimeout({ command: cmd1.join(' '), cwd: root, timeoutMs: 300, env: process.env }),
      spawnWithTimeout({ command: cmd2.join(' '), cwd: root, timeoutMs: 400, env: process.env }),
    ]);

    assert.ok(result1.timedOut || !result1.ok,
      'first validator should have failed or timed out');
    assert.ok(result2.timedOut || !result2.ok,
      'second validator should have failed or timed out');
  } finally {
    cleanup(root);
  }
});
