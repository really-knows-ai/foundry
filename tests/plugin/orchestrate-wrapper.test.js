// Wrapper-level tests for the foundry_orchestrate plugin tool.
//
// The lower-level orchestration logic in scripts/orchestrate.js is exercised
// by tests/orchestrate*.test.js. This file targets the bridge that lives in
// .opencode/plugins/foundry-tools/orchestrate-tool.js — specifically:
//
//   - the `finalize` closure (registerArtefact callback wiring artefact rows
//     into WORK.md, plus its handling of missing cycle/artefact-type defs)
//   - dispatch-prompt enrichment with memory extras
//   - the catch-to-violation behaviour around runOrchestrate
//   - lastResult.error preservation through the wrapper
//
// Each test stands up a real worktree + git repo so the wrapper's git commit
// path and finalize bridge (which shells out via execFileSync) run end-to-end.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';
import { writeActiveStage, writeLastStage, clearActiveStage } from '../../scripts/lib/state.js';
import { parseArtefactsTable } from '../../scripts/lib/artefacts.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function makeIO(directory) {
  return {
    exists: (p) => existsSync(join(directory, p)),
    readFile: (p) => readFileSync(join(directory, p), 'utf-8'),
    writeFile: (p, c) => writeFileSync(join(directory, p), c, 'utf-8'),
    mkdir: (p) => mkdirSync(join(directory, p), { recursive: true }),
    unlink: (p) => { const f = join(directory, p); if (existsSync(f)) unlinkSync(f); },
  };
}

function setupBasicCycle({ withMemoryRead = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orch-wrapper-'));
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, 'foundry/artefacts/haiku'), { recursive: true });
  mkdirSync(join(root, '.opencode/agents'), { recursive: true });
  mkdirSync(join(root, 'haikus'), { recursive: true });
  writeFileSync(
    join(root, '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md'),
    '# agent\n',
  );
  const memBlock = withMemoryRead
    ? `\nmemory:\n  read: [class]\n`
    : '';
  writeFileSync(
    join(root, 'foundry/cycles/c.md'),
    `---\noutput-type: haiku\nstages: [forge, appraise]\nmax-iterations: 3${memBlock}\nmodels:\n  forge: github-copilot/claude-sonnet-4.6\n  appraise: github-copilot/claude-sonnet-4.6\n---\n# c\n`,
  );
  writeFileSync(
    join(root, 'foundry/artefacts/haiku/definition.md'),
    `---\ntype: haiku\nfile-patterns: ["haikus/*.md"]\n---\n`,
  );
  writeFileSync(
    join(root, 'WORK.md'),
    `---\nflow: f\ncycle: c\n---\n\n# Goal\n\ntest\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n`,
  );
  execSync('git init -q -b main', { cwd: root, env: GIT_ENV });
  execSync('git add -A && git commit -q -m init', { cwd: root, env: GIT_ENV });
  // Branch guard: foundry_orchestrate is flow-tier; need work/<x>.
  execSync('git checkout -q -b work/orch-wrapper-test', { cwd: root, env: GIT_ENV });
  return root;
}

function setupMemoryWorktree() {
  const root = setupBasicCycle({ withMemoryRead: true });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(
    join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\nA class entity.\n',
  );
  const schema = {
    version: 1,
    entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
    edges: {},
    embeddings: null,
  };
  writeFileSync(
    join(root, 'foundry/memory/schema.json'),
    JSON.stringify(schema, null, 2) + '\n',
  );
  execSync('git add -A && git commit -q -m memory', { cwd: root, env: GIT_ENV });
  return root;
}

function cleanup(root) {
  disposeStores();
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 1. finalize success: forge artefact rows registered in WORK.md
// ---------------------------------------------------------------------------

describe('foundry_orchestrate wrapper: finalize registers artefact rows', () => {
  let root;
  beforeEach(() => { root = setupBasicCycle(); });
  afterEach(() => { cleanup(root); });

  it('writes a draft artefact row to WORK.md after a successful forge stage', async () => {
    const plugin = await FoundryPlugin({ directory: root });

    // Call 1: needs setup -> stages written, setup commit made, dispatch forge
    const r1 = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, makeCtx(root)));
    assert.equal(r1.action, 'dispatch', `expected dispatch, got ${JSON.stringify(r1)}`);
    assert.equal(r1.stage, 'forge:c');

    // Capture the post-setup HEAD as the forge stage's baseSha.
    const baseSha = execSync('git rev-parse HEAD', { cwd: root, env: GIT_ENV })
      .toString().trim();

    // Simulate the forge subagent: write the artefact file, record stage_end.
    writeFileSync(join(root, 'haikus/a.md'), 'one\ntwo\nthree\n');
    const io = makeIO(root);
    writeActiveStage(io, { cycle: 'c', stage: 'forge:c', token: 'tok', baseSha });
    writeLastStage(io, { cycle: 'c', stage: 'forge:c', baseSha, summary: 'wrote first haiku' });
    clearActiveStage(io);

    // Call 2: wrapper.finalize bridge runs lib/finalize.finalizeStage; on
    // success runOrchestrate then dispatches the next stage (appraise).
    const r2 = JSON.parse(await plugin.tool.foundry_orchestrate.execute(
      { lastResult: { ok: true } }, makeCtx(root),
    ));
    assert.notEqual(r2.action, 'violation', `unexpected violation: ${JSON.stringify(r2)}`);

    // The artefact row must now be present in WORK.md.
    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    const rows = parseArtefactsTable(work);
    const row = rows.find(r => r.file === 'haikus/a.md');
    assert.ok(row, `expected haikus/a.md row in WORK.md, got: ${work}`);
    assert.equal(row.type, 'haiku');
    assert.equal(row.cycle, 'c');
    assert.equal(row.status, 'draft');
  });
});

// ---------------------------------------------------------------------------
// 2. Missing cycle definition during finalize -> violation (not throw)
// ---------------------------------------------------------------------------

describe('foundry_orchestrate wrapper: missing cycle definition during finalize', () => {
  let root;
  beforeEach(() => { root = setupBasicCycle(); });
  afterEach(() => { cleanup(root); });

  it('returns a violation (not a thrown exception) when finalize cannot load the cycle', async () => {
    const plugin = await FoundryPlugin({ directory: root });

    // Run setup + first dispatch so WORK.md has stages: configured.
    const r1 = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, makeCtx(root)));
    assert.equal(r1.action, 'dispatch');
    const baseSha = execSync('git rev-parse HEAD', { cwd: root, env: GIT_ENV })
      .toString().trim();

    // Simulate forge subagent producing an artefact and ending the stage.
    writeFileSync(join(root, 'haikus/a.md'), 'one\ntwo\nthree\n');
    const io = makeIO(root);
    writeActiveStage(io, { cycle: 'c', stage: 'forge:c', token: 'tok', baseSha });
    writeLastStage(io, { cycle: 'c', stage: 'forge:c', baseSha, summary: 'forge done' });
    clearActiveStage(io);

    // Now remove the cycle file so the wrapper's finalize bridge cannot load it.
    rmSync(join(root, 'foundry/cycles/c.md'));

    const r2 = JSON.parse(await plugin.tool.foundry_orchestrate.execute(
      { lastResult: { ok: true } }, makeCtx(root),
    ));
    assert.equal(r2.action, 'violation', `expected violation, got ${JSON.stringify(r2)}`);
    assert.match(r2.details, /stage_finalize error/);
  });
});

// ---------------------------------------------------------------------------
// 3. Missing artefact-type definition during finalize: wrapper falls back to
//    empty filePatterns. forge stage that wrote a file -> unexpected_files
//    violation (since nothing matches). This documents wrapper behaviour:
//    the wrapper does NOT explicitly violation-out on missing artefact-type;
//    finalizeStage then surfaces the consequence as unexpected_files.
// ---------------------------------------------------------------------------

describe('foundry_orchestrate wrapper: missing artefact-type during finalize', () => {
  let root;
  beforeEach(() => { root = setupBasicCycle(); });
  afterEach(() => { cleanup(root); });

  it('produces a typed missing_artefact_type violation (not unexpected_files) when artefact type is missing', async () => {
    const plugin = await FoundryPlugin({ directory: root });
    const r1 = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, makeCtx(root)));
    assert.equal(r1.action, 'dispatch');
    const baseSha = execSync('git rev-parse HEAD', { cwd: root, env: GIT_ENV })
      .toString().trim();

    writeFileSync(join(root, 'haikus/a.md'), 'one\ntwo\nthree\n');
    const io = makeIO(root);
    writeActiveStage(io, { cycle: 'c', stage: 'forge:c', token: 'tok', baseSha });
    writeLastStage(io, { cycle: 'c', stage: 'forge:c', baseSha, summary: 'forge done' });
    clearActiveStage(io);

    // Remove the artefact type definition. The finalize bridge must surface
    // this as a typed `missing_artefact_type` error rather than falling back
    // to empty filePatterns (which would re-surface the forge-written file
    // as a misleading `unexpected_files` violation).
    rmSync(join(root, 'foundry/artefacts/haiku/definition.md'));

    const r2 = JSON.parse(await plugin.tool.foundry_orchestrate.execute(
      { lastResult: { ok: true } }, makeCtx(root),
    ));
    assert.equal(r2.action, 'violation', `expected violation, got ${JSON.stringify(r2)}`);
    assert.match(r2.details, /stage_finalize error: missing_artefact_type/);
    assert.match(r2.details, /haiku/);
    // Must NOT be reported as unexpected_files — the file was the expected
    // forge output; the type definition is what's missing.
    assert.doesNotMatch(r2.details, /unexpected files/);
  });
});

// ---------------------------------------------------------------------------
// 4. Dispatch prompt enrichment with memory vocabulary
// ---------------------------------------------------------------------------

describe('foundry_orchestrate wrapper: dispatch prompt receives memory extras', () => {
  let root;
  beforeEach(() => { root = setupMemoryWorktree(); });
  afterEach(() => { cleanup(root); });

  it('appends a memory vocabulary block to the dispatch prompt when the cycle declares memory.read', async () => {
    const plugin = await FoundryPlugin({ directory: root });
    const res = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, makeCtx(root)));
    assert.equal(res.action, 'dispatch');
    assert.ok(typeof res.prompt === 'string');
    // Base prompt fields remain present.
    assert.match(res.prompt, /Stage: forge:c/);
    // Memory block injected by buildCyclePromptExtras.
    assert.match(res.prompt, /## Flow memory/);
    assert.match(res.prompt, /class.*\(read-only\)/);
  });
});

// ---------------------------------------------------------------------------
// 5. Thrown error inside runOrchestrate becomes a violation action
// ---------------------------------------------------------------------------

describe('foundry_orchestrate wrapper: catches thrown errors as violations', () => {
  let root;
  beforeEach(() => { root = setupBasicCycle(); });
  afterEach(() => { cleanup(root); });

  it('returns { action: "violation", details: "orchestrate threw: ..." } when runOrchestrate throws', async () => {
    const plugin = await FoundryPlugin({ directory: root });

    // Drive setup + first dispatch so we reach the lastResult branch where
    // runOrchestrate parses WORK.history.yaml.
    const r1 = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, makeCtx(root)));
    assert.equal(r1.action, 'dispatch');

    const baseSha = execSync('git rev-parse HEAD', { cwd: root, env: GIT_ENV })
      .toString().trim();
    const io = makeIO(root);
    writeFileSync(join(root, 'haikus/a.md'), 'one\ntwo\nthree\n');
    writeActiveStage(io, { cycle: 'c', stage: 'forge:c', token: 'tok', baseSha });
    writeLastStage(io, { cycle: 'c', stage: 'forge:c', baseSha, summary: 'forge done' });
    clearActiveStage(io);

    // Plant a malformed history file. After finalize succeeds, runOrchestrate
    // calls getIteration -> loadHistory -> yaml.load, which throws "WORK.history.yaml
    // malformed: ...". The wrapper's catch must convert that into a violation.
    writeFileSync(join(root, 'WORK.history.yaml'), '!!! not valid yaml [\n');

    const res = JSON.parse(await plugin.tool.foundry_orchestrate.execute(
      { lastResult: { ok: true } }, makeCtx(root),
    ));
    assert.equal(res.action, 'violation', `expected violation, got ${JSON.stringify(res)}`);
    assert.match(res.details, /orchestrate threw:/);
    assert.equal(res.recoverable, false);
    assert.deepEqual(res.affected_files, []);
  });
});

// ---------------------------------------------------------------------------
// 6. lastResult.error preserved into the violation output
// ---------------------------------------------------------------------------

describe('foundry_orchestrate wrapper: preserves lastResult.error', () => {
  let root;
  beforeEach(() => { root = setupBasicCycle(); });
  afterEach(() => { cleanup(root); });

  it('includes lastResult.error verbatim in the resulting violation details', async () => {
    const plugin = await FoundryPlugin({ directory: root });

    // First call: setup + dispatch forge (so a stage is recorded).
    const r1 = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, makeCtx(root)));
    assert.equal(r1.action, 'dispatch');

    const baseSha = execSync('git rev-parse HEAD', { cwd: root, env: GIT_ENV })
      .toString().trim();
    const io = makeIO(root);
    writeActiveStage(io, { cycle: 'c', stage: 'forge:c', token: 'tok', baseSha });

    // Second call: report subagent failure with a distinctive error string.
    const distinctive = 'subagent-blew-up-xyzzy';
    const r2 = JSON.parse(await plugin.tool.foundry_orchestrate.execute(
      { lastResult: { ok: false, error: distinctive } }, makeCtx(root),
    ));
    assert.equal(r2.action, 'violation');
    assert.ok(r2.details.includes(distinctive),
      `expected lastResult.error to surface in violation details, got: ${r2.details}`);
  });
});

// ---------------------------------------------------------------------------
// 7. requireNotFailed runs inside the wrapper's try/catch
// ---------------------------------------------------------------------------

describe('foundry_orchestrate wrapper: failed-flow guard inside try/catch', () => {
  let root;
  beforeEach(() => { root = setupBasicCycle(); });
  afterEach(() => { cleanup(root); });

  it('returns a violation (not an uncaught throw) when WORK.md frontmatter is malformed', async () => {
    const plugin = await FoundryPlugin({ directory: root });

    // Plant a malformed YAML frontmatter in WORK.md. requireNotFailed parses
    // this on every invocation; a malformed frontmatter throws from
    // js-yaml, which previously bypassed the wrapper's try/catch.
    writeFileSync(
      join(root, 'WORK.md'),
      `---\nflow: f\ncycle: c\nmodels: {forge: [unterminated\n---\n\n# Goal\n\ntest\n`,
    );

    // Must not throw; must return a violation envelope.
    const res = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, makeCtx(root)));
    assert.equal(res.action, 'violation', `expected violation, got ${JSON.stringify(res)}`);
    assert.match(res.details, /orchestrate threw:/);
    assert.equal(res.recoverable, false);
    assert.deepEqual(res.affected_files, []);
  });
});
