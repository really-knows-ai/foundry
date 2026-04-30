import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { signToken } from '../../scripts/lib/token.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

const GIT_ENV = { ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function setupWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'assay-tool-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  // Cycle definition for the active stage. Without this, the memory helper's
  // active-stage fallback would fail closed when withStore is called with
  // only { worktree } during an active assay stage.
  writeFileSync(join(root, 'foundry/cycles/c.md'), '---\noutput-type: report\n---\n\nCycle body.\n');
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'), '---\ntype: class\n---\n\n# class\nA class.\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1, entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } }, edges: {}, embeddings: null,
  }, null, 2));
  writeFileSync(join(root, 'foundry-memory/relations/class.ndjson'), '');
  // Git init so stage_begin can resolve baseSha.
  execSync('git init -q', { cwd: root, env: GIT_ENV });
  execSync('git add -A && git commit -q -m init', { cwd: root, env: GIT_ENV });
  return root;
}

function writeExtractor(root, name, { command, write }) {
  writeFileSync(join(root, `foundry/memory/extractors/${name}.md`),
`---
command: ${command}
memory:
  write: [${write.join(', ')}]
---

# ${name}
`);
}

function writeScript(root, rel, body) {
  const p = join(root, rel);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
}

async function beginAssay(plugin, root, cycleId = 'c') {
  const pending = plugin[Symbol.for('foundry.test.pending')];
  const secret = plugin[Symbol.for('foundry.test.secret')];
  const payload = { route: `assay:${cycleId}`, cycle: cycleId, nonce: 'n-assay', exp: Date.now() + 60_000 };
  pending.add(payload.nonce, payload);
  const token = signToken(payload, secret);
  const r = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
    { stage: `assay:${cycleId}`, cycle: cycleId, token }, { worktree: root }));
  if (!r.ok) throw new Error(`begin failed: ${JSON.stringify(r)}`);
}

async function endStage(plugin, root, summary = 'ok') {
  await plugin.tool.foundry_stage_end.execute({ summary }, { worktree: root });
}

describe('foundry_assay_run', () => {
  let root, plugin;
  beforeEach(async () => { root = setupWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  afterEach(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('executes a simple extractor and upserts entities into memory', async () => {
    writeScript(root, 'scripts/emit-one.sh', `#!/bin/sh
echo '{"kind":"entity","type":"class","name":"com.Hello","value":"hi"}'
`);
    writeExtractor(root, 'one', { command: 'scripts/emit-one.sh', write: ['class'] });

    // WORK.md must exist for feedback-writing; stage_begin does not create it,
    // so lay down a minimal one.
    writeFileSync(join(root, 'WORK.md'), '---\nflow: test\ncycle: c\n---\n\n# Goal\n\ntest\n');

    await beginAssay(plugin, root);
    const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'c', extractors: ['one'] }, { worktree: root }));
    await endStage(plugin, root);

    assert.equal(res.ok, true);
    assert.equal(res.perExtractor.length, 1);
    assert.equal(res.perExtractor[0].name, 'one');
    assert.equal(res.perExtractor[0].rowsUpserted, 1);

    // Confirm the row is readable via the get tool.
    const got = JSON.parse(await plugin.tool.foundry_memory_get.execute(
      { type: 'class', name: 'com.Hello' }, { worktree: root }));
    assert.equal(got.value, 'hi');
  });

  it('aborts on extractor non-zero exit, marks WORK.md failed, returns flow_failed, writes no feedback', async () => {
    writeScript(root, 'scripts/fail.sh', `#!/bin/sh\necho err >&2\nexit 3\n`);
    writeExtractor(root, 'bad', { command: 'scripts/fail.sh', write: ['class'] });

    writeFileSync(join(root, 'WORK.md'), '---\nflow: test\ncycle: c\n---\n\n# Goal\n\ntest\n');

    await beginAssay(plugin, root);
    let res;
    try {
      res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
        { cycle: 'c', extractors: ['bad'] }, { worktree: root }));
    } finally {
      try { await endStage(plugin, root); } catch {}
    }

    // Result must surface the failure with the abort detail still visible
    // (failedExtractor / reason / stderr / perExtractor) AND with the
    // failed-flow envelope (error + flow_failed).
    assert.notEqual(res.ok, true, `expected non-ok; got ${JSON.stringify(res)}`);
    assert.equal(res.aborted, true);
    assert.equal(res.failedExtractor, 'bad');
    assert.match(res.reason, /exit code 3/);
    assert.equal(res.flow_failed, true);
    assert.ok(res.error, `expected error message; got ${JSON.stringify(res)}`);
    assert.match(res.error, /bad/);

    // WORK.md must be marked failed with a reason.
    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    assert.match(work, /status: failed/);
    assert.match(work, /reason: /);

    // No feedback file must be written for an assay-sourced abort.
    assert.equal(existsSync(join(root, 'WORK.feedback.yaml')), false,
      'assay must not write WORK.feedback.yaml on extractor abort');
  });

  it('refuses subsequent mutating tools after extractor abort (failed-flow guard)', async () => {
    writeScript(root, 'scripts/fail-guard.sh', `#!/bin/sh\necho boom >&2\nexit 4\n`);
    writeExtractor(root, 'bad-guard', { command: 'scripts/fail-guard.sh', write: ['class'] });

    writeFileSync(join(root, 'WORK.md'), '---\nflow: test\ncycle: c\n---\n\n# Goal\n\ntest\n');

    await beginAssay(plugin, root);
    try {
      const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
        { cycle: 'c', extractors: ['bad-guard'] }, { worktree: root }));
      assert.equal(res.flow_failed, true);
    } finally {
      try { await endStage(plugin, root); } catch {}
    }

    // A subsequent mutating tool (foundry_memory_put) must refuse.
    const blocked = JSON.parse(await plugin.tool.foundry_memory_put.execute(
      { type: 'class', name: 'com.AfterFail', value: 'should not write' },
      { worktree: root }));
    assert.ok(blocked.error, `expected error; got ${JSON.stringify(blocked)}`);
    assert.match(blocked.error, /failed/i);
  });

  it('flushes NDJSON immediately after a successful assay run (defence-in-depth, before stage_end)', async () => {
    writeScript(root, 'scripts/emit-flush.sh', `#!/bin/sh
echo '{"kind":"entity","type":"class","name":"com.Flushed","value":"durable"}'
`);
    writeExtractor(root, 'flush-ext', { command: 'scripts/emit-flush.sh', write: ['class'] });
    writeFileSync(join(root, 'WORK.md'), '---\nflow: test\ncycle: c\n---\n\n# Goal\n\ntest\n');

    const ndPath = join(root, 'foundry-memory/relations/class.ndjson');
    // Baseline: the relation file must not already contain the marker.
    const before = existsSync(ndPath) ? readFileSync(ndPath, 'utf-8') : '';
    assert.doesNotMatch(before, /com\.Flushed/);

    await beginAssay(plugin, root);
    try {
      const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
        { cycle: 'c', extractors: ['flush-ext'] }, { worktree: root }));
      assert.equal(res.ok, true);

      // Assert BEFORE stage_end: NDJSON must already contain the row.
      // Without the post-assay flush, this only happens at stage_end. Extractor
      // writes would be unrecoverable if the stage is killed before end.
      assert.ok(existsSync(ndPath), 'class.ndjson should exist after assay');
      const after = readFileSync(ndPath, 'utf-8');
      assert.match(after, /com\.Flushed/,
        'assay must flush extractor writes to NDJSON immediately, not defer to stage_end');
    } finally {
      await endStage(plugin, root);
    }
  });

  it('refuses to run outside an assay stage', async () => {
    writeExtractor(root, 'x', { command: 'true', write: ['class'] });
    // No active stage
    const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'c', extractors: ['x'] }, { worktree: root }));
    assert.match(res.error, /requires active assay stage/);
  });

  it('marks WORK.md failed and returns flow_failed when post-assay syncStore fails', async () => {
    // Deterministic injection: the extractor emits a valid entity (so runAssay
    // succeeds) and then replaces the relation NDJSON file with a directory of
    // the same name. The subsequent syncStore call hits writeFileSync against
    // a directory path → EISDIR, mirroring the failure-injection style used by
    // the validation-feedback test above (which mkdirs WORK.feedback.yaml.tmp).
    // No chmod required.
    writeScript(root, 'scripts/emit-then-poison.sh', `#!/bin/sh
echo '{"kind":"entity","type":"class","name":"com.Poisoned","value":"v"}'
rm -f foundry-memory/relations/class.ndjson
mkdir foundry-memory/relations/class.ndjson
`);
    writeExtractor(root, 'poison-sync', { command: 'scripts/emit-then-poison.sh', write: ['class'] });
    writeFileSync(join(root, 'WORK.md'), '---\nflow: test\ncycle: c\n---\n\n# Goal\n\ntest\n');

    await beginAssay(plugin, root);
    let res;
    try {
      res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
        { cycle: 'c', extractors: ['poison-sync'] }, { worktree: root }));
    } finally {
      try { await endStage(plugin, root); } catch {}
    }

    // Result must surface the failure: not ok, with an error and flow_failed.
    assert.notEqual(res.ok, true, `expected non-ok result; got ${JSON.stringify(res)}`);
    assert.ok(res.error, `expected error message; got ${JSON.stringify(res)}`);
    assert.match(res.error, /memory sync/i);
    assert.equal(res.flow_failed, true,
      `expected flow_failed:true; got ${JSON.stringify(res)}`);

    // WORK.md must be marked failed so subsequent mutating tools refuse to run.
    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    assert.match(work, /status: failed/);
    assert.match(work, /reason: /);
  });
});

describe('foundry_extractor_create', () => {
  let root, plugin;
  beforeEach(async () => { root = setupWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  afterEach(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('creates an extractor file via the admin helper', async () => {
    const out = JSON.parse(await plugin.tool.foundry_extractor_create.execute({
      name: 'java-symbols',
      command: 'scripts/x.sh',
      memoryWrite: ['class'],
      body: 'brief',
    }, { worktree: root }));
    assert.equal(out.path, 'foundry/memory/extractors/java-symbols.md');
    const text = readFileSync(join(root, out.path), 'utf-8');
    assert.match(text, /command: scripts\/x\.sh/);
  });

  it('returns a structured error for bad input', async () => {
    const out = JSON.parse(await plugin.tool.foundry_extractor_create.execute({
      name: 'Bad',
      command: 'x',
      memoryWrite: ['class'],
      body: 'b',
    }, { worktree: root }));
    assert.match(out.error, /invalid identifier/);
  });
});
