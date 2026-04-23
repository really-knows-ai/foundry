import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

const GIT_ENV = { ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'assay-e2e-'));
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, 'foundry/artefacts/doc'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });
  mkdirSync(join(root, '.opencode/agents'), { recursive: true });
  writeFileSync(join(root, '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md'), '# agent\n');

  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\n# class\nA class.\n');
  writeFileSync(join(root, 'foundry/memory/entities/method.md'),
    '---\ntype: method\n---\n\n# method\nA method.\n');
  writeFileSync(join(root, 'foundry/memory/edges/defines.md'),
    '---\ntype: defines\nsources: [class]\ntargets: [method]\n---\n\n# defines\nA class defines a method.\n');
  writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'), '');
  writeFileSync(join(root, 'foundry/memory/relations/method.ndjson'), '');
  writeFileSync(join(root, 'foundry/memory/relations/defines.ndjson'), '');
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify({
    version: 1,
    entities: {
      class: { frontmatterHash: hashFrontmatter({ type: 'class' }) },
      method: { frontmatterHash: hashFrontmatter({ type: 'method' }) },
    },
    edges: {
      defines: { frontmatterHash: hashFrontmatter({ type: 'defines', sources: ['class'], targets: ['method'] }) },
    },
    embeddings: null,
  }, null, 2));

  // A real extractor script.
  const script = `#!/bin/sh
cat <<'EOF'
{"kind":"entity","type":"class","name":"com.Hello","value":"Hello class"}
{"kind":"entity","type":"method","name":"com.Hello.greet","value":"Returns a greeting"}
{"kind":"edge","from":{"type":"class","name":"com.Hello"},"edge":"defines","to":{"type":"method","name":"com.Hello.greet"}}
EOF
`;
  writeFileSync(join(root, 'scripts/extract.sh'), script);
  chmodSync(join(root, 'scripts/extract.sh'), 0o755);

  writeFileSync(join(root, 'foundry/memory/extractors/java-syms.md'),
`---
command: scripts/extract.sh
memory:
  write: [class, method]
---

# java-syms

Emits one class, one method, and a defined-in edge.
`);

  writeFileSync(join(root, 'foundry/artefacts/doc/definition.md'),
    `---\ntype: doc\nfile-patterns: ["out/**"]\n---\n\n# doc\n`);

  writeFileSync(join(root, 'foundry/cycles/doc-java.md'),
`---
output: doc
memory:
  read: [class, method]
  write: [class, method]
assay:
  extractors: [java-syms]
models:
  forge: github-copilot/claude-sonnet-4.6
  appraise: github-copilot/claude-sonnet-4.6
  assay: github-copilot/claude-sonnet-4.6
---

# doc-java

Generates docs from the extracted Java graph.
`);

  writeFileSync(join(root, 'WORK.md'),
`---
flow: test
cycle: doc-java
---

# Goal

Generate docs.

## Artefacts

| File | Type | Cycle | Status |
|------|------|-------|--------|
`);

  execSync('git init -q', { cwd: root, env: GIT_ENV });
  execSync('git add -A && git commit -q -m init', { cwd: root, env: GIT_ENV });
  return root;
}

describe('assay end-to-end: happy path', () => {
  let root, plugin;
  before(async () => { root = setup(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('runs the assay stage, upserts memory, and routes to forge afterwards', async () => {
    const ctx = { worktree: root };

    // 1. First orchestrate call dispatches the assay stage.
    const dispatch1 = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, ctx));
    assert.equal(dispatch1.action, 'dispatch');
    assert.equal(dispatch1.stage, 'assay:doc-java');
    const cycle = 'doc-java';
    const stage = dispatch1.stage;
    const token = dispatch1.prompt.match(/Token: (\S+)/)[1];

    // 2. Sub-agent protocol: begin → run → end.
    const begin = JSON.parse(await plugin.tool.foundry_stage_begin.execute(
      { stage, cycle, token }, ctx));
    assert.equal(begin.ok, true);

    const runRes = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle, extractors: ['java-syms'] }, ctx));
    assert.equal(runRes.ok, true);
    assert.equal(runRes.perExtractor[0].rowsUpserted, 3);

    const end = JSON.parse(await plugin.tool.foundry_stage_end.execute(
      { summary: 'extracted 3 rows' }, ctx));
    assert.equal(end.ok, true);

    // 3. Memory is populated.
    const classGet = JSON.parse(await plugin.tool.foundry_memory_get.execute(
      { type: 'class', name: 'com.Hello' }, ctx));
    assert.equal(classGet.value, 'Hello class');

    const methodGet = JSON.parse(await plugin.tool.foundry_memory_get.execute(
      { type: 'method', name: 'com.Hello.greet' }, ctx));
    assert.equal(methodGet.value, 'Returns a greeting');

    // 4. The next dispatch is forge, not assay.
    const dispatch2 = JSON.parse(await plugin.tool.foundry_orchestrate.execute(
      { lastResult: { ok: true } }, ctx));
    assert.equal(dispatch2.action, 'dispatch');
    assert.equal(dispatch2.stage, 'forge:doc-java');

    // 5. The forge prompt includes the extractor's prose brief so the agent
    // knows what's in memory and where it came from.
    assert.match(dispatch2.prompt, /## Extractors/);
    assert.match(dispatch2.prompt, /extractor: `java-syms`/);
    assert.match(dispatch2.prompt, /Emits one class, one method, and a defined-in edge\./);
  });
});

describe('assay end-to-end: extractor failure', () => {
  let root, plugin;
  before(async () => { root = setup(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('aborts cleanly when an extractor fails', async () => {
    const ctx = { worktree: root };
    // Replace the script with one that exits non-zero.
    writeFileSync(join(root, 'scripts/extract.sh'),
      '#!/bin/sh\necho "no good" >&2\nexit 4\n');
    chmodSync(join(root, 'scripts/extract.sh'), 0o755);

    const dispatch = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, ctx));
    assert.equal(dispatch.stage, 'assay:doc-java');
    const token = dispatch.prompt.match(/Token: (\S+)/)[1];

    await plugin.tool.foundry_stage_begin.execute(
      { stage: dispatch.stage, cycle: 'doc-java', token }, ctx);
    const runRes = JSON.parse(await plugin.tool.foundry_assay_run.execute(
      { cycle: 'doc-java', extractors: ['java-syms'] }, ctx));
    await plugin.tool.foundry_stage_end.execute({ summary: 'aborted' }, ctx);

    assert.equal(runRes.ok, false);
    assert.equal(runRes.aborted, true);
    assert.equal(runRes.failedExtractor, 'java-syms');
    assert.match(runRes.reason, /exit code 4/);

    // #validation feedback was written to WORK.md.
    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    assert.match(work, /#validation/);
    assert.match(work, /java-syms/);
  });
});
