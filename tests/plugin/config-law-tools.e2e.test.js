import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, promises as fsPromises } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADD_LAW_SKILL_PATH = join(REPO_ROOT, 'src', 'skills', 'add-law', 'SKILL.md');
const QUENCH_SKILL_PATH = join(REPO_ROOT, 'src', 'skills', 'quench', 'SKILL.md');

import { assembleLawMarkdown } from '../../src/scripts/lib/config-creators/law.js';

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

// ---------------------------------------------------------------------------
// test body helpers — generated via assembleLawMarkdown for consistent format
// ---------------------------------------------------------------------------

const TEST_LAW_BODY = assembleLawMarkdown({
  id: 'test-law',
  name: 'This is a test law.',
  description: 'Test description.',
  passing: 'Validators are optional now.',
  failing: 'Failing criteria.',
});

const TEST_LAW_WITH_VALIDATORS = assembleLawMarkdown({
  id: 'test-law-with-validators',
  name: 'This law has validators.',
  description: 'Law with validators.',
  passing: 'Pass.',
  failing: 'Fail.',
  validators: [{ id: 'check-thing', command: './scripts/check.sh', failureMeans: 'The artefact did not pass the check.' }],
});

// ---------------------------------------------------------------------------
// helper functions for test convenience
// ---------------------------------------------------------------------------

async function setupArtefactType(repo, typeId, options = {}) {
  const typePath = join(repo, 'foundry/artefacts', typeId);
  mkdirSync(typePath, { recursive: true });
  const defContent = options.definition || `# ${typeId} artefact type\n`;
  writeFileSync(join(typePath, 'definition.md'), defContent);
  if (options.filePatterns) {
    const patternLines = options.filePatterns.map(p => `  - ${p}`).join('\n');
    const configContent = `file-patterns:\n${patternLines}\n`;
    writeFileSync(join(typePath, 'config.md'), configContent);
  }
  execSync('git add . && git commit -qm "setup artefact type"', { cwd: repo, env: GIT_ENV });
}

async function callTool(repo, toolName, args) {
  const plugin = await FoundryPlugin({ directory: repo });
  const tool = plugin.tool[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.execute(args, { worktree: repo });
}

async function pathExists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFile(filePath, encoding = 'utf8') {
  return fsPromises.readFile(filePath, encoding);
}

// ---------------------------------------------------------------------------
// foundry_config_read_law
// ---------------------------------------------------------------------------

test('foundry_config_read_law returns full markdown for global law', async () => {
  const dir = setupRepoWithFoundry();
  try {
    // Create a law file in global laws
    writeFileSync(join(dir, 'foundry/laws/test-rules.md'), TEST_LAW_BODY);
    execSync('git add . && git commit -qm "add laws"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.id, 'test-law');
    assert.equal(res.markdown, TEST_LAW_BODY);
  } finally { cleanup(dir); }
});

test('foundry_config_read_law returns full markdown for type-specific law', async () => {
  const dir = setupRepoWithFoundry();
  try {
    // Create artefact type with laws
    mkdirSync(join(dir, 'foundry/artefacts/widget'), { recursive: true });
    writeFileSync(join(dir, 'foundry/artefacts/widget/laws.md'), TEST_LAW_BODY);
    execSync('git add . && git commit -qm "add type laws"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.id, 'test-law');
    assert.equal(res.markdown, TEST_LAW_BODY);
  } finally { cleanup(dir); }
});

test('foundry_config_read_law preserves validators block', async () => {
  const dir = setupRepoWithFoundry();
  try {
    writeFileSync(join(dir, 'foundry/laws/validated-rules.md'), TEST_LAW_WITH_VALIDATORS);
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
      { id: 'test-law', name: 'Test Law', description: 'A test law.', passing: 'Pass.', failing: 'Fail.', target: { kind: 'global', file: 'rules.md' } },
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
      { id: 'test-law', name: 'Test Law', description: 'A test law.', passing: 'Passing criteria.', failing: 'Failing criteria.', target: { kind: 'global', file: 'rules.md' } },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.path, 'foundry/laws/rules.md');
    assert.equal(existsSync(join(dir, 'foundry/laws/rules.md')), true);

    // Verify written content matches assembleLawMarkdown
    const expected = assembleLawMarkdown({ id: 'test-law', name: 'Test Law', description: 'A test law.', passing: 'Passing criteria.', failing: 'Failing criteria.' });
    assert.equal(readFileSync(join(dir, 'foundry/laws/rules.md'), 'utf-8'), expected);

    const log = execSync('git log --oneline', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim().split('\n');
    assert.equal(log.length, 2, `expected 2 commits, got ${log.length}: ${log.join(' | ')}`);
    const commitMsg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.match(commitMsg, /^config: add law Test Law\n\nvia foundry_config_add_law$/);
  } finally { cleanup(dir); }
});

test('foundry_config_add_law rejects missing required id', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-laws', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    // Missing 'id' — Zod rejects at the tool boundary
    const res = JSON.parse(await plugin.tool.foundry_config_add_law.execute(
      { name: 'Test Law', description: 'A test law.', passing: 'Pass.', failing: 'Fail.', target: { kind: 'global', file: 'rules.md' } },
      makeCtx(dir),
    ));
    assert.ok(res.error || res.ok === false, JSON.stringify(res));
  } finally { cleanup(dir); }
});

test('foundry_config_add_law rejects missing required target', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/init-laws', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    // Missing 'target' — Zod rejects at the tool boundary
    const res = JSON.parse(await plugin.tool.foundry_config_add_law.execute(
      { id: 'test-law', name: 'Test Law', description: 'A test law.', passing: 'Pass.', failing: 'Fail.' },
      makeCtx(dir),
    ));
    assert.ok(res.error || res.ok === false, JSON.stringify(res));
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
      { id: 'test-law', name: 'Test Law', description: 'A test law.', passing: 'Pass.', failing: 'Fail.', target: { kind: 'type-specific', typeId: 'widget' } },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.path, 'foundry/artefacts/widget/laws.md');
    assert.equal(existsSync(join(dir, 'foundry/artefacts/widget/laws.md')), true);
  } finally { cleanup(dir); }
});

test('appends a new law to an existing type-specific laws.md', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/append-laws', { cwd: dir, env: GIT_ENV });
    // setup: create artefact type 'demo' and add a first law via the tool
    await setupArtefactType(dir, 'demo', { filePatterns: ['demo/*.md'] });
    const first = await callTool(dir, 'foundry_config_add_law', {
      id: 'first-law',
      name: 'First Law',
      description: 'First law description.',
      passing: 'Pass.',
      failing: 'Fail.',
      target: { kind: 'type-specific', typeId: 'demo' },
    });
    assert.equal(JSON.parse(first).ok, true);

    const second = await callTool(dir, 'foundry_config_add_law', {
      id: 'second-law',
      name: 'Second Law',
      description: 'Second law description.',
      passing: 'Pass.',
      failing: 'Fail.',
      target: { kind: 'type-specific', typeId: 'demo' },
    });
    const parsed = JSON.parse(second);
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.match(parsed.sha, /^[0-9a-f]{7,40}$/);

    const content = await readFile(join(dir, 'foundry/artefacts/demo/laws.md'), 'utf8');
    assert.match(content, /^## first-law$/m);
    assert.match(content, /^## second-law$/m);
  } finally { cleanup(dir); }
});

test('errors when the law-id already exists in the file', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/dup-law', { cwd: dir, env: GIT_ENV });
    await setupArtefactType(dir, 'demo', { filePatterns: ['demo/*.md'] });
    await callTool(dir, 'foundry_config_add_law', {
      id: 'dup-law',
      name: 'Duplicate Law',
      description: 'Original.',
      passing: 'Pass.',
      failing: 'Fail.',
      target: { kind: 'type-specific', typeId: 'demo' },
    });
    const second = await callTool(dir, 'foundry_config_add_law', {
      id: 'dup-law',
      name: 'Duplicate Law',
      description: 'Different.',
      passing: 'Pass.',
      failing: 'Fail.',
      target: { kind: 'type-specific', typeId: 'demo' },
    });
    const parsed = JSON.parse(second);
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors[0], /law id "dup-law" already exists/);
  } finally { cleanup(dir); }
});

test('rolls back the file write when commit fails (e.g. unexpected files)', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/rollback-law', { cwd: dir, env: GIT_ENV });
    await setupArtefactType(dir, 'demo', { filePatterns: ['demo/*.md'] });
    // Stage an unexpected file outside foundry/** so commitWithPolicy throws
    await fsPromises.writeFile(join(dir, 'unexpected.txt'), 'taint\n');

    const result = await callTool(dir, 'foundry_config_add_law', {
      id: 'rollback-law',
      name: 'Rollback Law',
      description: 'Should be rolled back.',
      passing: 'Pass.',
      failing: 'Fail.',
      target: { kind: 'type-specific', typeId: 'demo' },
    });
    const parsed = JSON.parse(result);
    assert.equal(parsed.ok, undefined); // legacy error envelope from UnexpectedFilesError
    assert.match(parsed.error, /unexpected_files/);

    // Critical: the laws.md file must NOT exist on disk after a failed add.
    const lawsPath = join(dir, 'foundry/artefacts/demo/laws.md');
    assert.equal(await pathExists(lawsPath), false,
      'laws.md should be removed after a failed atomic add_law');
  } finally { cleanup(dir); }
});

test('foundry_config_add_law with validators array', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-validators', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_add_law.execute(
      {
        id: 'validated-law',
        name: 'Validated Law',
        description: 'A law with validators.',
        passing: 'Pass.',
        failing: 'Fail.',
        target: { kind: 'global', file: 'rules.md' },
        validators: [{ id: 'check', command: './check.sh', failureMeans: 'Check failed.' }],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));

    const content = readFileSync(join(dir, 'foundry/laws/rules.md'), 'utf-8');
    assert.ok(content.includes('validators:'));
    assert.ok(content.includes('check'));
  } finally { cleanup(dir); }
});

test('foundry_config_add_law with validators omitting failureMeans', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/add-validators-optional', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_add_law.execute(
      {
        id: 'min-validators',
        name: 'Minimal Validators',
        description: 'Validators without failureMeans.',
        passing: 'Pass.',
        failing: 'Fail.',
        target: { kind: 'global', file: 'rules.md' },
        validators: [{ id: 'check', command: './check.sh' }],
      },
      makeCtx(dir),
    ));
    assert.equal(res.ok, true, JSON.stringify(res));

    const content = readFileSync(join(dir, 'foundry/laws/rules.md'), 'utf-8');
    assert.ok(content.includes('validators:'));
    assert.ok(content.includes('check'));
    assert.ok(!content.includes('failure-means'));
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_edit_law
// ---------------------------------------------------------------------------

test('foundry_config_edit_law updates global law description only', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/edit-laws', { cwd: dir, env: GIT_ENV });
    // Create initial law
    writeFileSync(join(dir, 'foundry/laws/rules.md'), TEST_LAW_BODY);
    execSync('git add . && git commit -qm "initial law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law', description: 'Updated description of the law.' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, true, JSON.stringify(res));
    const updated = readFileSync(join(dir, 'foundry/laws/rules.md'), 'utf-8');
    assert.ok(updated.includes('Updated description of the law.'));
    // Other fields should remain unchanged
    assert.ok(updated.includes('Validators are optional now.'));
    assert.ok(updated.includes('Failing criteria.'));

    const commitMsg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
    assert.match(commitMsg, /^config: edit law test-law\n\nvia foundry_config_edit_law$/);
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law round-trip preserves validators block', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/roundtrip', { cwd: dir, env: GIT_ENV });
    // Create law with validators
    writeFileSync(join(dir, 'foundry/laws/validated.md'), TEST_LAW_WITH_VALIDATORS);
    execSync('git add . && git commit -qm "add validated law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });

    // Read the law
    const readRes = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law-with-validators' },
      makeCtx(dir),
    ));
    assert.equal(readRes.ok, true);

    // Edit description via structured args (preserves validators internally)
    const editRes = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law-with-validators', description: 'Updated description of the law.' },
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

test('foundry_config_edit_law rejects no optional fields', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/edit-no-opts', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/rules.md'), TEST_LAW_BODY);
    execSync('git add . && git commit -qm "add law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(res.errors[0].includes('at least one field to update'));
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law returns error for non-existent law', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/edit-missing', { cwd: dir, env: GIT_ENV });
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'non-existent', description: 'Updated description.' },
      makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(Array.isArray(res.errors));
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law updates validators (replaces existing)', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/edit-validators', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/validated.md'), TEST_LAW_WITH_VALIDATORS);
    execSync('git add . && git commit -qm "add validated law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const editRes = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      {
        id: 'test-law-with-validators',
        validators: [{ id: 'new-check', command: './new-check.sh', failureMeans: 'New check failed.' }],
      },
      makeCtx(dir),
    ));
    assert.equal(editRes.ok, true, JSON.stringify(editRes));

    // Re-read to verify validators replaced
    const rereadRes = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law-with-validators' },
      makeCtx(dir),
    ));
    assert.equal(rereadRes.ok, true);
    assert.ok(rereadRes.markdown.includes('new-check'));
    assert.ok(!rereadRes.markdown.includes('check-thing'));
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law removes validators on empty array', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/rm-validators', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/validated.md'), TEST_LAW_WITH_VALIDATORS);
    execSync('git add . && git commit -qm "add validated law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const editRes = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law-with-validators', validators: [] },
      makeCtx(dir),
    ));
    assert.equal(editRes.ok, true, JSON.stringify(editRes));

    const rereadRes = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law-with-validators' },
      makeCtx(dir),
    ));
    assert.equal(rereadRes.ok, true);
    assert.ok(!rereadRes.markdown.includes('validators:'));
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law updates multiple fields simultaneously', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/edit-multi', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/rules.md'), TEST_LAW_BODY);
    execSync('git add . && git commit -qm "add law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const editRes = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law', name: 'Updated Name', passing: 'New passing criteria.', failing: 'New failing criteria.' },
      makeCtx(dir),
    ));
    assert.equal(editRes.ok, true, JSON.stringify(editRes));

    const rereadRes = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law' },
      makeCtx(dir),
    ));
    assert.equal(rereadRes.ok, true);
    assert.ok(rereadRes.markdown.includes('Updated Name'));
    assert.ok(rereadRes.markdown.includes('New passing criteria.'));
    assert.ok(rereadRes.markdown.includes('New failing criteria.'));
  } finally { cleanup(dir); }
});

test('foundry_config_edit_law round-trip: read → edit description → read back', async () => {
  const dir = setupRepoWithFoundry();
  try {
    execSync('git checkout -q -b config/roundtrip-read-edit', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/rules.md'), TEST_LAW_BODY);
    execSync('git add . && git commit -qm "add law"', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });

    // Read
    const readRes = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law' },
      makeCtx(dir),
    ));
    assert.equal(readRes.ok, true);

    // Edit description
    const editRes = JSON.parse(await plugin.tool.foundry_config_edit_law.execute(
      { id: 'test-law', description: 'Round-tripped description.' },
      makeCtx(dir),
    ));
    assert.equal(editRes.ok, true, JSON.stringify(editRes));

    // Read back
    const rereadRes = JSON.parse(await plugin.tool.foundry_config_read_law.execute(
      { id: 'test-law' },
      makeCtx(dir),
    ));
    assert.equal(rereadRes.ok, true);
    assert.ok(rereadRes.markdown.includes('Round-tripped description.'));
  } finally { cleanup(dir); }
});

test('add-law skill has no Passing:/Failing: template', async () => {
  const skillPath = ADD_LAW_SKILL_PATH;
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(!skillContent.includes('foundry_config_create_law'),
    'Skill should reference foundry_config_add_law, not foundry_config_create_law');
  assert.ok(!skillContent.match(/lines? 62-65/),
    'Skill should not reference the removed Passing:/Failing: template');
});

test('add-law skill contains drift-mitigation prompts for prose changes', async () => {
  const skillPath = ADD_LAW_SKILL_PATH;
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(skillContent.includes('Verify that all existing validators on this law still accurately enforce the updated intent'),
    'Skill should contain prose-change drift-mitigation prompt');
  assert.ok(skillContent.includes('Open each validator\'s command and confirm it catches the same class of failure the prose now describes'),
    'Skill should guide checking validators when prose changes');
});

test('add-law skill contains drift-mitigation prompts for validator changes', async () => {
  const skillPath = ADD_LAW_SKILL_PATH;
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(skillContent.includes('Verify that the changed validator still aligns with the law\'s prose'),
    'Skill should contain validator-change drift-mitigation prompt');
  assert.ok(skillContent.includes('If the validator has narrowed or broadened, the prose may need a corresponding update'),
    'Skill should guide updating prose when validator changes');
});

test('add-law skill references law editing tools', async () => {
  const skillPath = ADD_LAW_SKILL_PATH;
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(skillContent.includes('foundry_config_add_law'),
    'Skill should reference foundry_config_add_law tool');
  assert.ok(skillContent.includes('foundry_config_edit_law'),
    'Skill should reference foundry_config_edit_law tool');
  assert.ok(skillContent.includes('foundry_config_read_law'),
    'Skill should reference foundry_config_read_law tool');
});

test('quench skill does not reference validation tag or validation.md', async () => {
  const skillPath = QUENCH_SKILL_PATH;
  const skillContent = readFileSync(skillPath, 'utf-8');
  assert.ok(!skillContent.includes("tag: 'validation'"),
    'Quench skill should not reference validation tag');
  assert.ok(!skillContent.includes('validation.md'),
    'Quench skill should not reference validation.md file');
});
