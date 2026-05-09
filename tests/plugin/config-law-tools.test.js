import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
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

function setupRepoWithFoundry() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-law-tools-'));
  execSync('git init -q -b main', { cwd: dir, env: GIT_ENV });
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

This is a test law.

Validators are optional now.
`;

const VALID_LAW_WITH_VALIDATORS = `## test-law-with-validators

This law has validators.

validators:
  - id: check-thing
    command: ./scripts/check.sh
    failure-means: The artefact did not pass the check.
`;

// ---------------------------------------------------------------------------
// foundry_config_read_law
// ---------------------------------------------------------------------------

test('foundry_config_read_law returns full markdown for global law', async () => {
  const dir = setupRepoWithFoundry();
  try {
    // Create a law file in global laws
    writeFileSync(join(dir, 'foundry/laws/test-rules.md'), VALID_LAW_BODY);
    execSync('git add . && git commit -qm "add laws"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.id, 'test-law');
    assert.equal(res.markdown, VALID_LAW_BODY);
  } finally { cleanup(dir); }
});

test('foundry_config_read_law returns full markdown for type-specific law', async () => {
  const dir = setupRepoWithFoundry();
  try {
    // Create artefact type with laws
    mkdirSync(join(dir, 'foundry/artefacts/widget'), { recursive: true });
    writeFileSync(join(dir, 'foundry/artefacts/widget/laws.md'), VALID_LAW_BODY);
    execSync('git add . && git commit -qm "add type laws"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.id, 'test-law');
    assert.equal(res.markdown, VALID_LAW_BODY);
  } finally { cleanup(dir); }
});

test('foundry_config_read_law preserves validators block', async () => {
  const dir = setupRepoWithFoundry();
  try {
    writeFileSync(join(dir, 'foundry/laws/validated-rules.md'), VALID_LAW_WITH_VALIDATORS);
    execSync('git add . && git commit -qm "add validated laws"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law-with-validators' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.markdown.includes('validators:'));
    assert.ok(res.markdown.includes('check-thing'));
  } finally { cleanup(dir); }
});

test('foundry_config_read_law returns error for non-existent law', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'non-existent' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errors));
    assert.ok(res.errors.some((e) => /not found|does not exist/.test(e.toLowerCase())));
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_add_law
// ---------------------------------------------------------------------------

test('foundry_config_add_law refuses on main branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_add_law.execute(
      { name: 'rules', body: VALID_LAW_BODY, target: { kind: 'global', file: 'rules.md' } },
      makeCtx(dir),
    ));
    assert.ok(res.error, 'expected error response');
    assert.match(res.error, /requires a config\//);
  } finally { cleanup(dir); }
});

test('foundry_config_add_law happy path on config/* branch', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-laws', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_add_law.execute(
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
    assert.match(commitMsg, /^config: add law rules\n\nvia foundry_config_add_law$/);
  } finally { cleanup(dir); }
});

test('foundry_config_add_law rejects invalid body', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-laws', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    // Body with no law blocks
    const invalidBody = 'This is not a law block.';
    const res = JSON.parse(await plugin.tool.foundry_config_add_law.execute(
      { name: 'rules', body: invalidBody, target: { kind: 'global', file: 'rules.md' } },
      makeCtx(dir),
    ));
    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errors));
    assert.ok(res.errors.some((e) => /law block/.test(e)));
  } finally { cleanup(dir); }
});

test('foundry_config_add_law for type-specific target', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-type-law', { cwd: dir, env: GIT_ENV });
    // Create the artefact type
    mkdirSync(join(dir, 'foundry/artefacts/widget'), { recursive: true });
    writeFileSync(join(dir, 'foundry/artefacts/widget/definition.md'), 'widget def\n');
    execSync('git add . && git commit -qm "add widget type"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_add_law.execute(
      { name: 'widget-laws', body: VALID_LAW_BODY, target: { kind: 'type-specific', typeId: 'widget' } },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.path, 'foundry/artefacts/widget/laws.md');
    assert.equal(existsSync(join(dir, 'foundry/artefacts/widget/laws.md')), true);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_edit_law
// ---------------------------------------------------------------------------

test('foundry_config_edit_law updates global law and commits', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/edit-laws', { cwd: dir, env: GIT_ENV });
    // Create initial law
    writeFileSync(join(dir, 'foundry/laws/rules.md'), VALID_LAW_BODY);
    execSync('git add . && git commit -qm "initial law"', { cwd: dir, env: GIT_ENV });

    const updatedBody = `## test-law

This is an updated test law.

More details here.
`;

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law', body: updatedBody },
      makeCtx(dir),
    ));

    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(readFileSync(join(dir, 'foundry/laws/rules.md'), 'utf-8'), updatedBody);
    const commitMsg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.match(commitMsg, /^config: edit law test-law\n\nvia foundry_config_edit_law$/);
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law round-trip preserves validators block', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/roundtrip', { cwd: dir, env: GIT_ENV });
    // Create law with validators
    writeFileSync(join(dir, 'foundry/laws/validated.md'), VALID_LAW_WITH_VALIDATORS);
    execSync('git add . && git commit -qm "add validated law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });

    // Read the law
    const readRes = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law-with-validators' },
      makeCtx(dir),
    ));
    assert.equal(readRes.ok, true);

    // Edit the prose (but keep validators)
    const updatedBody = readRes.markdown.replace('This law has validators.', 'Updated description of the law.');

    // Write it back
    const editRes = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law-with-validators', body: updatedBody },
      makeCtx(dir),
    ));
    assert.equal(editRes.ok, true, JSON.stringify(editRes));

    // Re-read to verify validators persisted
    const rereadRes = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law-with-validators' },
      makeCtx(dir),
    ));
    assert.equal(rereadRes.ok, true);
    assert.ok(rereadRes.markdown.includes('validators:'));
    assert.ok(rereadRes.markdown.includes('Updated description'));
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law rejects invalid body', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/edit-invalid', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/rules.md'), VALID_LAW_BODY);
    execSync('git add . && git commit -qm "add law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const invalidBody = 'no law blocks here';
    const res = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law', body: invalidBody },
      makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errors));
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law returns error for non-existent law', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/edit-missing', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'non-existent', body: VALID_LAW_BODY },
      makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errors));
  } finally { cleanup(dir); }
});

test('add-law skill has no Passing:/Failing: template', async () => {
  const skillPath = '/Users/jledrew/foundry/src/skills/add-law/SKILL.md';
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(!skillContent.includes('foundry_config_create_law'),
    'Skill should reference foundry_config_add_law, not foundry_config_create_law');
  assert.ok(!skillContent.match(/lines? 62-65/),
    'Skill should not reference the removed Passing:/Failing: template');
});

test('add-law skill contains drift-mitigation prompts for prose changes', async () => {
  const skillPath = '/Users/jledrew/foundry/src/skills/add-law/SKILL.md';
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(skillContent.includes('Verify that all existing validators on this law still accurately enforce the updated intent'),
    'Skill should contain prose-change drift-mitigation prompt');
  assert.ok(skillContent.includes('Open each validator\'s command and confirm it catches the same class of failure the prose now describes'),
    'Skill should guide checking validators when prose changes');
});

test('add-law skill contains drift-mitigation prompts for validator changes', async () => {
  const skillPath = '/Users/jledrew/foundry/src/skills/add-law/SKILL.md';
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(skillContent.includes('Verify that the changed validator still aligns with the law\'s prose'),
    'Skill should contain validator-change drift-mitigation prompt');
  assert.ok(skillContent.includes('If the validator has narrowed or broadened, the prose may need a corresponding update'),
    'Skill should guide updating prose when validator changes');
});

test('add-law skill references law editing tools', async () => {
  const skillPath = '/Users/jledrew/foundry/src/skills/add-law/SKILL.md';
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(skillContent.includes('foundry_config_add_law'),
    'Skill should reference foundry_config_add_law tool');
  assert.ok(skillContent.includes('foundry_config_edit_law'),
    'Skill should reference foundry_config_edit_law tool');
  assert.ok(skillContent.includes('foundry_config_read_law'),
    'Skill should reference foundry_config_read_law tool');
});

test('quench skill does not reference validation tag or validation.md', async () => {
  const skillPath = '/Users/jledrew/foundry/src/skills/quench/SKILL.md';
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(!skillContent.includes("tag: 'validation'"),
    'Quench skill should not reference validation tag');
  assert.ok(!skillContent.includes('validation.md'),
    'Quench skill should not reference validation.md file');
});
