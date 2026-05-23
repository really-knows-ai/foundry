import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { assembleLawMarkdown } from '../../src/scripts/lib/config-creators/law.js';

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

const VALID_ARTEFACT_BODY = `---
name: widget
output-type: file
file-patterns:
  - "widgets/**/*.md"
---

## Definition

A widget.
`;

// ---------------------------------------------------------------------------
// foundry_config_create_artefact_type
// ---------------------------------------------------------------------------

test('foundry_config_create_artefact_type happy path on config/* branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-types', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_artefact_type.execute(
      { id: 'widget', name: 'Widget', filePatterns: ['widgets/**/*.md'], description: 'A widget.' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(dir, 'foundry/artefacts/widget/definition.md')), true);
    const commitMsg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.match(commitMsg, /^config: add artefact-type widget\n\nvia foundry_config_create_artefact_type$/);
    // Verify the written file matches assemble function output
    const written = execSync('git show HEAD:foundry/artefacts/widget/definition.md', { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
    const { assembleArtefactTypeMarkdown } = await import('../../src/scripts/lib/config-creators/artefact-type.js');
    const expected = assembleArtefactTypeMarkdown({ id: 'widget', name: 'Widget', filePatterns: ['widgets/**/*.md'], description: 'A widget.' });
    assert.equal(written, expected);
  } finally { cleanup(dir); }
});

test('foundry_config_create_artefact_type rejects missing required fields', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-types', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_artefact_type.execute(
      { id: 'widget', name: 'Widget', description: 'A widget.' },
      makeCtx(dir),
    ));
    // Missing filePatterns is rejected by Zod at the tool boundary
    assert.ok(res.error || res.ok === false, JSON.stringify(res));
  } finally { cleanup(dir); }
});

test('foundry_config_create_artefact_type rejects wrong types for filePatterns', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-types', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_artefact_type.execute(
      { id: 'widget', name: 'Widget', filePatterns: 'not-an-array', description: 'A widget.' },
      makeCtx(dir),
    ));
    // Wrong type (string vs array) is rejected by Zod at the tool boundary
    assert.ok(res.error || res.ok === false, JSON.stringify(res));
  } finally { cleanup(dir); }
});

test('foundry_config_create_artefact_type with optional appraisers', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-types', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_artefact_type.execute(
      { id: 'essay', name: 'Essay', filePatterns: ['essays/**/*.md'], description: 'An essay.', appraisers: { count: 3, allowed: ['skeptic'] } },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    const { assembleArtefactTypeMarkdown } = await import('../../src/scripts/lib/config-creators/artefact-type.js');
    const expected = assembleArtefactTypeMarkdown({ id: 'essay', name: 'Essay', filePatterns: ['essays/**/*.md'], description: 'An essay.', appraisers: { count: 3, allowed: ['skeptic'] } });
    const written = execSync('git show HEAD:foundry/artefacts/essay/definition.md', { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
    assert.equal(written, expected);
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
      { id: 'critic', name: 'The Critic', description: 'A discerning reviewer.' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(dir, 'foundry/appraisers/critic.md')), true);
  } finally { cleanup(dir); }
});

test('foundry_config_create_appraiser with optional model', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-appraiser', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_appraiser.execute(
      { id: 'gpt-reviewer', name: 'GPT Reviewer', description: 'An AI reviewer.', model: 'openai/gpt-4o' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    const { assembleAppraiserMarkdown } = await import('../../src/scripts/lib/config-creators/appraiser.js');
    const expected = assembleAppraiserMarkdown({ id: 'gpt-reviewer', name: 'GPT Reviewer', description: 'An AI reviewer.', model: 'openai/gpt-4o' });
    const written = execSync('git show HEAD:foundry/appraisers/gpt-reviewer.md', { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
    assert.equal(written, expected);
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

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_flow.execute(
      { id: 'my-flow', name: 'My Flow', startingCycles: ['start'], description: '- start' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(dir, 'foundry/flows/my-flow.md')), true);
  } finally { cleanup(dir); }
});

test('foundry_config_create_flow rejects missing startingCycles', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-flow', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/cycles/start.md'), 'placeholder\n');
    execSync('git add . && git commit -qm cycle', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_flow.execute(
      { id: 'my-flow', name: 'My Flow', description: '- start' },
      makeCtx(dir),
    ));
    // Missing startingCycles is rejected by Zod at the tool boundary
    assert.ok(res.error || res.ok === false, JSON.stringify(res));
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

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_cycle.execute(
      { id: 'build', name: 'Build', outputType: 'widget', description: 'Build a widget.' },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(dir, 'foundry/cycles/build.md')), true);
  } finally { cleanup(dir); }
});

test('foundry_config_create_cycle with all optional fields', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-cycle', { cwd: dir, env: GIT_ENV });
    mkdirSync(join(dir, 'foundry/artefacts/widget'), { recursive: true });
    writeFileSync(join(dir, 'foundry/artefacts/widget/definition.md'), 'placeholder\n');
    // Place a cycle file for targets reference
    writeFileSync(join(dir, 'foundry/cycles/revise.md'), 'placeholder\n');
    execSync('git add . && git commit -qm base', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_create_cycle.execute(
      {
        id: 'build',
        name: 'Build',
        outputType: 'widget',
        inputs: { type: 'any-of', artefacts: ['widget'] },
        targets: ['revise'],
        alwaysHumanAppraise: true,
        deadlockHumanAppraise: false,
        maxIterations: 20,
        assay: { extractors: ['quality'] },
        memory: { read: ['ctx'], write: ['result'] },
        models: { forge: 'gpt-4' },
        description: 'Full cycle.',
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    const { assembleCycleMarkdown } = await import('../../src/scripts/lib/config-creators/cycle.js');
    const expected = assembleCycleMarkdown({
      id: 'build',
      name: 'Build',
      outputType: 'widget',
      inputs: { type: 'any-of', artefacts: ['widget'] },
      targets: ['revise'],
      alwaysHumanAppraise: true,
      deadlockHumanAppraise: false,
      maxIterations: 20,
      assay: { extractors: ['quality'] },
      memory: { read: ['ctx'], write: ['result'] },
      models: { forge: 'gpt-4' },
      description: 'Full cycle.',
    });
    const written = execSync('git show HEAD:foundry/cycles/build.md', { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
    assert.equal(written, expected);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// validate tools — read-only, run anywhere (e.g. on main)
// ---------------------------------------------------------------------------

test('foundry_config_validate_law returns ok for a valid body on main', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const validLawBody = assembleLawMarkdown({ id: 'test-law', name: 'Test Law', description: 'A test law.', passing: 'Passing criteria.', failing: 'Failing criteria.' });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_validate_law.execute(
      { name: 'rules', body: validLawBody },
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
