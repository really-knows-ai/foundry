import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, isAbsolute as pathIsAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setupWorkfile } from '../../src/scripts/orchestrate-setup.js';

function makeTestIO(root) {
  const resolve = (p) => pathIsAbsolute(p) ? p : join(root, p);
  return {
    exists: async (p) => existsSync(resolve(p)),
    readFile: async (p) => readFileSync(resolve(p), 'utf-8'),
    writeFile: async (p, c) => writeFileSync(resolve(p), c, 'utf-8'),
    readDir: async (p) => readdirSync(resolve(p)),
  };
}

function joinLines(...lines) {
  return lines.join('\n');
}

describe('setupWorkfile flow validation', () => {
  let tmpDir;
  let io;
  const FD = 'foundry';

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'foundry-test-'));
    io = makeTestIO(tmpDir);

    // Create fixture directories
    mkdirSync(join(tmpDir, FD, 'cycles'), { recursive: true });
    mkdirSync(join(tmpDir, FD, 'flows'), { recursive: true });
    mkdirSync(join(tmpDir, FD, 'artefacts', 'code'), { recursive: true });

    // Initialise git repo (required by some IO internals)
    execFileSync('git', ['init'], { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' });

    // Write shared artefact type definition
    writeFileSync(
      join(tmpDir, FD, 'artefacts', 'code', 'definition.md'),
      joinLines(
        '---',
        'id: code',
        'name: Code',
        'file-patterns:',
        '  - "**/*.js"',
        '---',
        '',
        '## Definition',
        '',
        'Code artefacts.',
      ),
    );
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('passes with valid flow', async () => {
    // Write valid flow
    writeFileSync(
      join(tmpDir, FD, 'flows', 'valid-flow.md'),
      joinLines(
        '---',
        'id: valid-flow',
        'name: Valid Flow',
        'starting-cycles:',
        '  - valid-cycle',
        '---',
        '',
        '## Cycles',
        '',
        'A test flow.',
      ),
    );

    // Write cycle referencing the valid flow
    writeFileSync(
      join(tmpDir, FD, 'cycles', 'valid-cycle.md'),
      joinLines(
        '---',
        'id: valid-cycle',
        'name: Valid Cycle',
        'flow-id: valid-flow',
        'output-type: code',
        '---',
        '',
        'Cycle description.',
      ),
    );

    const result = await setupWorkfile({
      cycleId: 'valid-cycle',
      workContent: '# WORK',
      io,
      git: null,
      foundryDir: join(tmpDir, FD),
    });

    assert.equal(result.ok, true, 'setupWorkfile should succeed with a valid flow');
    assert.ok(result.workContent, 'result should contain workContent');
  });

  test('fails with invalid flow frontmatter', async () => {
    // Write flow with invalid law-groups mode
    writeFileSync(
      join(tmpDir, FD, 'flows', 'invalid-flow.md'),
      joinLines(
        '---',
        'id: invalid-flow',
        'name: Invalid Flow',
        'starting-cycles:',
        '  - invalid-cycle',
        'law-groups:',
        '  default:',
        '    mode: invalid_mode',
        '---',
        '',
        '## Cycles',
        '',
        'A test flow with invalid law-groups.',
      ),
    );

    // Write cycle referencing the invalid flow
    writeFileSync(
      join(tmpDir, FD, 'cycles', 'invalid-cycle.md'),
      joinLines(
        '---',
        'id: invalid-cycle',
        'name: Invalid Cycle',
        'flow-id: invalid-flow',
        'output-type: code',
        '---',
        '',
        'Cycle description.',
      ),
    );

    const result = await setupWorkfile({
      cycleId: 'invalid-cycle',
      workContent: '# WORK',
      io,
      git: null,
      foundryDir: join(tmpDir, FD),
    });

    assert.equal(result.action, 'violation');
    assert.match(result.details, /flow validation failed/);
    assert.match(result.details, /law-groups/);
    assert.deepEqual(result.affected_files, ['WORK.md']);
  });
});
