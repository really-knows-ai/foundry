import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function setupFoundryWithLaw(lawBody, artefactType = 'doc') {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-phase3-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['checkout', '-q', '-b', 'work/validate-test'], { cwd: dir, env: GIT_ENV });

  // Create artefact type with file-patterns
  const typeDir = join(dir, 'foundry', 'artefacts', artefactType);
  mkdirSync(typeDir, { recursive: true });
  writeFileSync(
    join(typeDir, 'definition.md'),
    `---
id: ${artefactType}
name: ${artefactType}
output-type: md
file-patterns:
  - "*.md"
  - "docs/**/*.md"
---
Type definition.
`,
  );

  // Create law with validators
  const lawDir = join(dir, 'foundry', 'laws');
  mkdirSync(lawDir, { recursive: true });
  writeFileSync(join(lawDir, 'test.md'), lawBody);

  return dir;
}

describe('foundry_validate_run — Phase 3 law-based validators', () => {
  test('returns empty items and errors when no laws exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-nolaws-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
      execFileSync('git', ['checkout', '-q', '-b', 'work/nolaws'], { cwd: dir, env: GIT_ENV });

      const typeDir = join(dir, 'foundry', 'artefacts', 'doc');
      mkdirSync(typeDir, { recursive: true });
      writeFileSync(
        join(typeDir, 'definition.md'),
        `---
id: doc
name: doc
output-type: md
file-patterns:
  - "*.md"
---
Type definition.
`,
      );

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'doc' }, makeCtx(dir),
      ));

      assert.equal(out.ok, true);
      assert.equal(out.validatorsRun, 0);
      assert.deepEqual(out.items, []);
      assert.deepEqual(out.errors, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('runs validators and returns items annotated with lawId and validatorId', async () => {
    const dir = setupFoundryWithLaw(`## title-check
Check for title.

validators:
  - id: check-title
    command: printf '%s\\n' '{"file":"README.md","text":"missing title"}'
    failure-means: missing title
`);
    try {
      // Create files matching the pattern
      writeFileSync(join(dir, 'README.md'), '# README\n\nContent.\n');
      mkdirSync(join(dir, 'docs'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'guide.md'), 'No title here!\n');

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'doc' }, makeCtx(dir),
      ));

      assert.equal(out.ok, true);
      assert.equal(out.validatorsRun, 1);
      assert.equal(out.items.length, 1, 'should have one feedback item');
      const item = out.items[0];
      assert.equal(item.lawId, 'title-check');
      assert.equal(item.validatorId, 'check-title');
      assert.equal(item.file, 'README.md');
      assert.equal(item.text, 'missing title');
      assert.deepEqual(out.errors, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('expands {pattern} to multiple files and passes to validator', async () => {
    const dir = setupFoundryWithLaw(`## check-files
Validate files.

validators:
  - id: list-files
    command: printf '%s\\n' '{"file":"README.md","text":"ok"}'
    failure-means: cannot list files
`);
    try {
      writeFileSync(join(dir, 'README.md'), 'content');
      mkdirSync(join(dir, 'docs'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'guide.md'), 'more content');

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'doc' }, makeCtx(dir),
      ));

      assert.ok(out.ok !== undefined);
      assert.equal(typeof out.validatorsRun, 'number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('handles multiple validators in a single law', async () => {
    const dir = setupFoundryWithLaw(`## multi-check
Multiple validators.

validators:
  - id: check-title
    command: printf '%s\\n' '{"file":"README.md","text":"has title"}'
    failure-means: missing title
  - id: check-length
    command: printf '%s\\n' '{"file":"README.md","text":"has content"}'
    failure-means: empty file
`);
    try {
      writeFileSync(join(dir, 'README.md'), '# Title\n\nContent.\n');

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'doc' }, makeCtx(dir),
      ));

      assert.ok(out.ok !== undefined);
      assert.equal(out.validatorsRun, 2, 'should have run both validators');
      assert.equal(out.items.length, 2);
      const ids = out.items.map(i => i.validatorId).sort();
      assert.deepEqual(ids, ['check-length', 'check-title']);
      // Each item carries the law id of its parent law
      for (const item of out.items) {
        assert.equal(item.lawId, 'multi-check');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('handles multiple laws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-multilaws-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
      execFileSync('git', ['checkout', '-q', '-b', 'work/multilaws'], { cwd: dir, env: GIT_ENV });

      const typeDir = join(dir, 'foundry', 'artefacts', 'doc');
      mkdirSync(typeDir, { recursive: true });
      writeFileSync(
        join(typeDir, 'definition.md'),
        `---
id: doc
name: doc
output-type: md
file-patterns:
  - "*.md"
---
Type definition.
`,
      );

      const lawDir = join(dir, 'foundry', 'laws');
      mkdirSync(lawDir, { recursive: true });
      writeFileSync(join(lawDir, 'test.md'), `## law-one
First law.

validators:
  - id: v1
    command: \`true\`
    failure-means: always passes

## law-two
Second law.

validators:
  - id: v2
    command: \`true\`
    failure-means: always passes
`);

      writeFileSync(join(dir, 'README.md'), 'Content');

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'doc' }, makeCtx(dir),
      ));

      assert.equal(out.validatorsRun, 2, 'should have run validators from both laws');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns error when artefact type has no file-patterns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-nopatterns-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
      execFileSync('git', ['checkout', '-q', '-b', 'work/nopatterns'], { cwd: dir, env: GIT_ENV });

      const typeDir = join(dir, 'foundry', 'artefacts', 'doc');
      mkdirSync(typeDir, { recursive: true });
      writeFileSync(
        join(typeDir, 'definition.md'),
        `---
id: doc
name: doc
output-type: md
---
Type definition with no file-patterns.
`,
      );

      const lawDir = join(dir, 'foundry', 'laws');
      mkdirSync(lawDir, { recursive: true });
      writeFileSync(join(lawDir, 'test.md'), `## law
Law with validator.

validators:
  - id: v1
    command: \`true\`
    failure-means: fail
`);

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'doc' }, makeCtx(dir),
      ));

      assert.equal(out.ok, false);
      assert.match(out.error, /file-patterns/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns error when artefact type not found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-notype-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
      execFileSync('git', ['checkout', '-q', '-b', 'work/notype'], { cwd: dir, env: GIT_ENV });

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'nonexistent' }, makeCtx(dir),
      ));

      assert.equal(out.ok, false);
      assert.match(out.error, /not found|nonexistent/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('surfaces pattern-mismatch errors distinctly from parse errors', async () => {
    const dir = setupFoundryWithLaw(`## file-check
Check files.

validators:
  - id: emit-bad-file
    command: printf '%s\\n' '{"file":"outside.txt","text":"oops"}'
    failure-means: validator emitted a file outside the artefact patterns
`);
    try {
      writeFileSync(join(dir, 'README.md'), '# README\n');

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'doc' }, makeCtx(dir),
      ));

      assert.equal(out.ok, false);
      assert.equal(out.validatorsRun, 1);
      assert.equal(out.items.length, 0);
      assert.equal(out.errors.length, 1);
      const err = out.errors[0];
      assert.equal(err.lawId, 'file-check');
      assert.equal(err.validatorId, 'emit-bad-file');
      assert.equal(err.type, 'pattern-mismatch');
      assert.match(err.message, /outside\.txt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('surfaces parse errors distinctly with type "parse"', async () => {
    const dir = setupFoundryWithLaw(`## json-check
Check JSON.

validators:
  - id: emit-bad-json
    command: printf '%s\\n' 'not valid json'
    failure-means: validator did not emit JSONL
`);
    try {
      writeFileSync(join(dir, 'README.md'), '# README\n');

      const plugin = await FoundryPlugin({ directory: dir });
      const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
        { typeId: 'doc' }, makeCtx(dir),
      ));

      assert.equal(out.ok, false);
      assert.equal(out.errors.length, 1);
      const err = out.errors[0];
      assert.equal(err.lawId, 'json-check');
      assert.equal(err.validatorId, 'emit-bad-json');
      assert.equal(err.type, 'parse');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
