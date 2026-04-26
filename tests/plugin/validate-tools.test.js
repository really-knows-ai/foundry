import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

function makeCtx(worktree) { return { worktree }; }

function setupFoundry(validationBody) {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-validate-'));
  const typeDir = join(dir, 'foundry', 'artefacts', 'doc');
  mkdirSync(typeDir, { recursive: true });
  writeFileSync(join(typeDir, 'definition.md'), '---\nid: doc\n---\nDoc type.\n');
  writeFileSync(join(typeDir, 'validation.md'), validationBody);
  return dir;
}

test('foundry_validate_run treats file paths with shell metacharacters as literal paths', async () => {
  // Validation command echoes the file path back. If shell injection works,
  // a path of `; echo PWNED #` would cause the shell to execute the injected
  // echo and the marker would appear in the output.
  const dir = setupFoundry(
    '## echo-path\nCommand: `cat {file}`\nFailure means: file unreadable\n',
  );
  try {
    // Create a file with an unusual name. If {file} were interpolated into
    // the shell unquoted, the semicolon would terminate `cat` and run the
    // injected command. With proper quoting, the shell sees one literal arg.
    const evilName = "evil; echo PWNED #.txt";
    writeFileSync(join(dir, evilName), 'literal-content', 'utf-8');

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: evilName }, makeCtx(dir),
    ));

    assert.ok(Array.isArray(out), 'expected array of results');
    assert.equal(out.length, 1);
    const r = out[0];
    // The literal file should have been read; the injected echo must NOT have run.
    assert.equal(r.passed, true, `validator failed: ${r.output}`);
    assert.equal(r.output, 'literal-content');
    assert.ok(!/PWNED/.test(r.output), 'shell injection occurred: PWNED appeared in output');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run handles file paths with single quotes safely', async () => {
  const dir = setupFoundry(
    '## cat-it\nCommand: `cat {file}`\nFailure means: missing\n',
  );
  try {
    const trickyName = "it's a file.txt";
    writeFileSync(join(dir, trickyName), 'quoted-ok', 'utf-8');

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: trickyName }, makeCtx(dir),
    ));

    assert.equal(out[0].passed, true, `validator failed: ${out[0].output}`);
    assert.equal(out[0].output, 'quoted-ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run handles spaces and $() in file paths', async () => {
  const dir = setupFoundry(
    '## cat-it\nCommand: `cat {file}`\nFailure means: missing\n',
  );
  try {
    const trickyName = 'with $(echo INJECTED) space.txt';
    writeFileSync(join(dir, trickyName), 'safe', 'utf-8');

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: trickyName }, makeCtx(dir),
    ));

    assert.equal(out[0].passed, true, `validator failed: ${out[0].output}`);
    assert.equal(out[0].output, 'safe');
    assert.ok(!/INJECTED/.test(out[0].output));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run returns error when no validation defined', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-validate-'));
  try {
    mkdirSync(join(dir, 'foundry', 'artefacts', 'doc'), { recursive: true });
    writeFileSync(join(dir, 'foundry', 'artefacts', 'doc', 'definition.md'), '---\nid: doc\n---\n');
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: 'whatever.txt' }, makeCtx(dir),
    ));
    assert.match(out.error, /No validation defined/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
