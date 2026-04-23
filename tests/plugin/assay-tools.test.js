import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
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
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'), '---\ntype: class\n---\n\n# class\nA class.\n');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1, entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } }, edges: {}, embeddings: null,
  }, null, 2));
  writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'), '');
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
  before(async () => { root = setupWorktree(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

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

  it('aborts on extractor non-zero exit and writes #validation feedback to WORK.md', async () => {
    writeScript(root, 'scripts/fail.sh', `#!/bin/sh\necho err >&2\nexit 3\n`);
    writeExtractor(root, 'bad', { command: 'scripts/fail.sh', write: ['class'] });

    writeFileSync(join(root, 'WORK.md'), '---\nflow: test\ncycle: c\n---\n\n# Goal\n\ntest\n');

    await beginAssay(plugin, root);
    const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'c', extractors: ['bad'] }, { worktree: root }));
    await endStage(plugin, root);

    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.equal(res.failedExtractor, 'bad');
    assert.match(res.reason, /exit code 3/);

    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    assert.match(work, /#validation/);
    assert.match(work, /assay/);
    assert.match(work, /bad/);
  });

  it('refuses to run outside an assay stage', async () => {
    writeExtractor(root, 'x', { command: 'true', write: ['class'] });
    // No active stage
    const res = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'c', extractors: ['x'] }, { worktree: root }));
    assert.match(res.error, /requires active assay stage/);
  });
});
