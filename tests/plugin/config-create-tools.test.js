import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function setupRepoWithFoundry() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-cfg-create-'));
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
  // Older gits may not support -b; ensure we're on main.
  try { execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV }); } catch { /* ignore */ }
  mkdirSync(join(dir, 'foundry/artefacts'), { recursive: true });
  mkdirSync(join(dir, 'foundry/laws'), { recursive: true });
  mkdirSync(join(dir, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(dir, 'foundry/flows'), { recursive: true });
  mkdirSync(join(dir, 'foundry/appraisers'), { recursive: true });
  writeFileSync(join(dir, 'foundry/.gitkeep'), '');
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -qm init', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const VALID_LAW_BODY = `## test-law

Passing: the artefact does the thing.

Failing: the artefact does not do the thing.
`;

const VALID_ARTEFACT_BODY = `---
name: widget
output-type: file
file-patterns:
  - "widgets/**/*.md"
---

## Definition

A widget.
`;

const VALID_APPRAISER_BODY = `---
id: critic
name: The Critic
---

A discerning reviewer.
`;

// ---------------------------------------------------------------------------
// foundry_config_create_law
// ---------------------------------------------------------------------------

test('foundry_config_create_law refuses on main branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_law.execute(
      { name: 'rules', body: VALID_LAW_BODY, target: { kind: 'global', file: 'rules.md' } },
      makeCtx(dir),
    ));
    assert.ok(res.error, 'expected error response');
    assert.match(res.error, /requires a config\//);
  } finally { cleanup(dir); }
});

test('foundry_config_create_law happy path on config/* branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-laws', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_law.execute(
      { name: 'rules', body: VALID_LAW_BODY, target: { kind: 'global', file: 'rules.md' } },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.path, 'foundry/laws/rules.md');
    assert.equal(existsSync(join(dir, 'foundry/laws/rules.md')), true);
    assert.equal(readFileSync(join(dir, 'foundry/laws/rules.md'), 'utf-8'), VALID_LAW_BODY);

    const log = execSync('git log --oneline', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim().split('\n');
    assert.equal(log.length, 2, `expected 2 commits, got ${log.length}: ${log.join(' | ')}`);
    const commitMsg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.match(commitMsg, /^config: add law rules\n\nvia foundry_config_create_law$/);
  } finally { cleanup(dir); }
});

test('foundry_config_create_law refuses if target file already exists', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-laws', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/rules.md'), 'pre-existing\n');
    execSync('git add . && git commit -qm preexist', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_law.execute(
      { name: 'rules', body: VALID_LAW_BODY, target: { kind: 'global', file: 'rules.md' } },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errors));
    assert.ok(res.errors.some((e) => /already exists/.test(e)),
      `expected "already exists" error, got: ${JSON.stringify(res.errors)}`);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_create_artefact_type
// ---------------------------------------------------------------------------

test('foundry_config_create_artefact_type happy path on config/* branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-types', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_artefact_type.execute(
      { name: 'widget', body: VALID_ARTEFACT_BODY },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(dir, 'foundry/artefacts/widget/definition.md')), true);
    const commitMsg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.match(commitMsg, /^config: add artefact-type widget\n\nvia foundry_config_create_artefact_type$/);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_create_appraiser
// ---------------------------------------------------------------------------

test('foundry_config_create_appraiser happy path on config/* branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-appraiser', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_appraiser.execute(
      { name: 'critic', body: VALID_APPRAISER_BODY },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(dir, 'foundry/appraisers/critic.md')), true);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_create_flow (needs a starting cycle file in place)
// ---------------------------------------------------------------------------

test('foundry_config_create_flow happy path on config/* branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-flow', { cwd: dir, env: GIT_ENV });
    // Place a cycle file the flow's starting-cycles can reference.
    writeFileSync(join(dir, 'foundry/cycles/start.md'), 'placeholder\n');
    execSync('git add . && git commit -qm cycle', { cwd: dir, env: GIT_ENV });

    const flowBody = `---
id: my-flow
name: My Flow
starting-cycles:
  - start
---

## Cycles

- start
`;
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_flow.execute(
      { name: 'my-flow', body: flowBody },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(dir, 'foundry/flows/my-flow.md')), true);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_create_cycle (needs an artefact-type file in place)
// ---------------------------------------------------------------------------

test('foundry_config_create_cycle happy path on config/* branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-cycle', { cwd: dir, env: GIT_ENV });
    mkdirSync(join(dir, 'foundry/artefacts/widget'), { recursive: true });
    writeFileSync(join(dir, 'foundry/artefacts/widget/definition.md'), 'placeholder\n');
    execSync('git add . && git commit -qm widget', { cwd: dir, env: GIT_ENV });

    const cycleBody = `---
id: build
name: Build
output-type: widget
---

## Cycle

Build a widget.
`;
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_cycle.execute(
      { name: 'build', body: cycleBody },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(dir, 'foundry/cycles/build.md')), true);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// validate tools — read-only, run anywhere (e.g. on main)
// ---------------------------------------------------------------------------

test('foundry_config_validate_law returns ok for a valid body on main', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_validate_law.execute(
      { name: 'rules', body: VALID_LAW_BODY },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
  } finally { cleanup(dir); }
});

test('foundry_config_validate_law returns errors for an invalid body and writes nothing', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_validate_law.execute(
      { name: 'rules', body: 'not a law\n' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errors));
    assert.equal(existsSync(join(dir, 'foundry/laws/rules.md')), false);
  } finally { cleanup(dir); }
});

test('foundry_config_validate_artefact_type works on main', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const ok = JSON.parse(await plugin.tool.foundry_config_validate_artefact_type.execute(
      { name: 'widget', body: VALID_ARTEFACT_BODY },
      makeCtx(dir),
    ));
    assert.equal(ok.ok, true, JSON.stringify(ok));

    const bad = JSON.parse(await plugin.tool.foundry_config_validate_artefact_type.execute(
      { name: 'widget', body: '## no frontmatter\n' },
      makeCtx(dir),
    ));
    assert.equal(bad.ok, false);
  } finally { cleanup(dir); }
});
