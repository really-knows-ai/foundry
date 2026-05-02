import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function setupFoundry(validationBody) {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-validate-'));
  // Branch guard: foundry_validate_run is flow-tier (it shells out).
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['checkout', '-q', '-b', 'work/validate-test'], { cwd: dir, env: GIT_ENV });
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

test('foundry_validate_run reports passed:true when validation command succeeds', async () => {
  const dir = setupFoundry(
    '## ok-check\nCommand: `cat {file}`\nFailure means: file unreadable\n',
  );
  try {
    writeFileSync(join(dir, 'good.txt'), 'hello-world', 'utf-8');
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: 'good.txt' }, makeCtx(dir),
    ));
    assert.ok(Array.isArray(out));
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'ok-check');
    assert.equal(out[0].passed, true);
    assert.equal(out[0].output, 'hello-world');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run reports passed:false with output and failureMeans on failure', async () => {
  const dir = setupFoundry(
    '## must-have-foo\nCommand: `grep foo {file}`\nFailure means: missing foo marker\n',
  );
  try {
    writeFileSync(join(dir, 'bad.txt'), 'no-marker-here\n', 'utf-8');
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: 'bad.txt' }, makeCtx(dir),
    ));
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'must-have-foo');
    assert.equal(out[0].passed, false);
    assert.equal(out[0].failureMeans, 'missing foo marker');
    // output is a string (possibly empty for grep), not undefined
    assert.equal(typeof out[0].output, 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run runs multiple validations and reports each independently', async () => {
  const dir = setupFoundry(
    '## first-pass\nCommand: `cat {file}`\nFailure means: missing\n\n## second-fail\nCommand: `grep nonexistent-token {file}`\nFailure means: token absent\n',
  );
  try {
    writeFileSync(join(dir, 'thing.txt'), 'plain', 'utf-8');
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: 'thing.txt' }, makeCtx(dir),
    ));
    assert.equal(out.length, 2);
    const first = out.find(r => r.id === 'first-pass');
    const second = out.find(r => r.id === 'second-fail');
    assert.equal(first.passed, true);
    assert.equal(second.passed, false);
    assert.equal(second.failureMeans, 'token absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run returns error when no validation defined', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-validate-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: dir, env: GIT_ENV });
    execFileSync('git', ['checkout', '-q', '-b', 'work/validate-novalidation'], { cwd: dir, env: GIT_ENV });
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

test('foundry_validate_run strips double quotes around {file} placeholder', async () => {
  // When validation command uses "{file}", the quotes should be stripped
  // before substitution so we don't get nested quotes like "'path'"
  const dir = setupFoundry(
    '## quoted-file\nCommand: `cat "{file}"`\nFailure means: file unreadable\n',
  );
  try {
    const spacedName = 'file with spaces.txt';
    writeFileSync(join(dir, spacedName), 'content-here', 'utf-8');

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: spacedName }, makeCtx(dir),
    ));

    assert.equal(out.length, 1);
    assert.equal(out[0].passed, true, `validator failed: ${out[0].output}`);
    assert.equal(out[0].output, 'content-here');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run strips single quotes around {file} placeholder', async () => {
  // When validation command uses '{file}', the quotes should be stripped
  const dir = setupFoundry(
    "## single-quoted\nCommand: `cat '{file}'`\nFailure means: file unreadable\n",
  );
  try {
    const spacedName = 'another file.txt';
    writeFileSync(join(dir, spacedName), 'single-quoted-ok', 'utf-8');

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: spacedName }, makeCtx(dir),
    ));

    assert.equal(out.length, 1);
    assert.equal(out[0].passed, true, `validator failed: ${out[0].output}`);
    assert.equal(out[0].output, 'single-quoted-ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run does not strip quotes from partial quoted strings', async () => {
  // "prefix-{file}-suffix" should keep quotes and only substitute {file}
  const dir = setupFoundry(
    '## partial-quote\nCommand: `echo "prefix-{file}-suffix"`\nFailure means: echo failed\n',
  );
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: 'test.txt' }, makeCtx(dir),
    ));

    assert.equal(out.length, 1);
    assert.equal(out[0].passed, true, `validator failed: ${out[0].output}`);
    // Should see: prefix-'test.txt'-suffix (quotes NOT stripped because {file} wasn't standalone)
    assert.match(out[0].output, /prefix-'test\.txt'-suffix/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foundry_validate_run handles multiple {file} occurrences with different quoting', async () => {
  // Mix of unquoted {file} and quoted "{file}" in same command
  const dir = setupFoundry(
    '## multi-file\nCommand: `echo {file} && cat "{file}"`\nFailure means: failed\n',
  );
  try {
    const spacedName = 'my file.txt';
    writeFileSync(join(dir, spacedName), 'multi-ok', 'utf-8');

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_validate_run.execute(
      { typeId: 'doc', file: spacedName }, makeCtx(dir),
    ));

    assert.equal(out.length, 1);
    assert.equal(out[0].passed, true, `validator failed: ${out[0].output}`);
    assert.match(out[0].output, /multi-ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
