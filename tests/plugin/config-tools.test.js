import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

function makeCtx(worktree) { return { worktree }; }

function makeFoundry() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-config-'));
  mkdirSync(join(dir, 'foundry'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// foundry_config_cycle
// ---------------------------------------------------------------------------

test('foundry_config_cycle returns parsed cycle definition when present', async () => {
  const dir = makeFoundry();
  try {
    mkdirSync(join(dir, 'foundry', 'cycles'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'cycles', 'creative.md'),
      '---\nid: creative\nname: Creative Cycle\n---\nBody text here.\n',
    );

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_cycle.execute(
      { cycleId: 'creative' }, makeCtx(dir),
    ));

    assert.equal(out.frontmatter.id, 'creative');
    assert.equal(out.frontmatter.name, 'Creative Cycle');
    assert.equal(out.body, 'Body text here.');
  } finally { cleanup(dir); }
});

test('foundry_config_cycle surfaces a clear error when cycle missing', async () => {
  const dir = makeFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    await assert.rejects(
      () => plugin.tool.foundry_config_cycle.execute({ cycleId: 'nope' }, makeCtx(dir)),
      /Cycle not found: nope/,
    );
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_artefact_type
// ---------------------------------------------------------------------------

test('foundry_config_artefact_type returns parsed type definition when present', async () => {
  const dir = makeFoundry();
  try {
    mkdirSync(join(dir, 'foundry', 'artefacts', 'haiku'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'artefacts', 'haiku', 'definition.md'),
      '---\nid: haiku\n---\nA short poem.\n',
    );

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_artefact_type.execute(
      { typeId: 'haiku' }, makeCtx(dir),
    ));

    assert.equal(out.frontmatter.id, 'haiku');
    assert.equal(out.body, 'A short poem.');
  } finally { cleanup(dir); }
});

test('foundry_config_artefact_type surfaces a clear error when type missing', async () => {
  const dir = makeFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    await assert.rejects(
      () => plugin.tool.foundry_config_artefact_type.execute({ typeId: 'ghost' }, makeCtx(dir)),
      /Artefact type not found: ghost/,
    );
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_laws
// ---------------------------------------------------------------------------

test('foundry_config_laws returns global laws when present', async () => {
  const dir = makeFoundry();
  try {
    mkdirSync(join(dir, 'foundry', 'laws'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'laws', 'general.md'),
      '## clarity\nBe clear.\n\n## brevity\nBe brief.\n',
    );

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_laws.execute(
      {}, makeCtx(dir),
    ));

    assert.ok(Array.isArray(out));
    assert.equal(out.length, 2);
    const ids = out.map(l => l.id);
    assert.deepEqual(ids.sort(), ['brevity', 'clarity']);
    assert.ok(out.every(l => !l.source));
  } finally { cleanup(dir); }
});

test('foundry_config_laws includes type-specific laws when typeId provided', async () => {
  const dir = makeFoundry();
  try {
    mkdirSync(join(dir, 'foundry', 'laws'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'laws', 'general.md'),
      '## global-rule\nApplies everywhere.\n',
    );
    mkdirSync(join(dir, 'foundry', 'artefacts', 'haiku'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'artefacts', 'haiku', 'laws.md'),
      '## five-seven-five\nMust be 5-7-5.\n',
    );

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_laws.execute(
      { typeId: 'haiku' }, makeCtx(dir),
    ));

    assert.equal(out.length, 2);
    const ids = out.map(l => l.id).sort();
    assert.deepEqual(ids, ['five-seven-five', 'global-rule']);
    const typeLaw = out.find(l => l.id === 'five-seven-five');
    assert.equal(typeLaw.source, undefined);
  } finally { cleanup(dir); }
});

test('foundry_config_laws returns empty array when no laws defined', async () => {
  const dir = makeFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_laws.execute(
      {}, makeCtx(dir),
    ));
    assert.deepEqual(out, []);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_validation
// ---------------------------------------------------------------------------

test('foundry_config_validation returns parsed validation entries', async () => {
  const dir = makeFoundry();
  try {
    mkdirSync(join(dir, 'foundry', 'artefacts', 'doc'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'artefacts', 'doc', 'validation.md'),
      '## syntax\nCommand: `echo ok`\nFailure means: bad syntax\n\n## lint\nCommand: `echo lint`\nFailure means: lint fail\n',
    );

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_validation.execute(
      { typeId: 'doc' }, makeCtx(dir),
    ));

    assert.ok(Array.isArray(out));
    assert.equal(out.length, 2);
    assert.equal(out[0].id, 'syntax');
    assert.equal(out[0].command, 'echo ok');
    assert.equal(out[0].failureMeans, 'bad syntax');
    assert.equal(out[1].id, 'lint');
  } finally { cleanup(dir); }
});

test('foundry_config_validation returns null when no validation file exists', async () => {
  const dir = makeFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_validation.execute(
      { typeId: 'absent' }, makeCtx(dir),
    ));
    assert.equal(out, null);
  } finally { cleanup(dir); }
});

test('foundry_config_validation returns empty array when validation file has no entries', async () => {
  const dir = makeFoundry();
  try {
    mkdirSync(join(dir, 'foundry', 'artefacts', 'doc'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'artefacts', 'doc', 'validation.md'),
      'No validations yet.\n',
    );

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_validation.execute(
      { typeId: 'doc' }, makeCtx(dir),
    ));
    assert.deepEqual(out, []);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_appraisers
// ---------------------------------------------------------------------------

test('foundry_config_appraisers returns list of appraisers', async () => {
  const dir = makeFoundry();
  try {
    mkdirSync(join(dir, 'foundry', 'appraisers'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'appraisers', 'critic.md'),
      '---\nid: critic\nmodel: gpt-4\n---\nA harsh critic.\n',
    );
    writeFileSync(
      join(dir, 'foundry', 'appraisers', 'cheerleader.md'),
      '---\nid: cheerleader\n---\nAlways supportive.\n',
    );

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_appraisers.execute(
      {}, makeCtx(dir),
    ));

    assert.ok(Array.isArray(out));
    assert.equal(out.length, 2);
    const critic = out.find(a => a.id === 'critic');
    assert.equal(critic.model, 'gpt-4');
    assert.equal(critic.personality, 'A harsh critic.');
    const cheer = out.find(a => a.id === 'cheerleader');
    assert.equal(cheer.model, undefined);
    assert.equal(cheer.personality, 'Always supportive.');
  } finally { cleanup(dir); }
});

test('foundry_config_appraisers returns empty array when none defined', async () => {
  const dir = makeFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_appraisers.execute(
      {}, makeCtx(dir),
    ));
    assert.deepEqual(out, []);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// foundry_config_flow
// ---------------------------------------------------------------------------

test('foundry_config_flow returns parsed flow definition when present', async () => {
  const dir = makeFoundry();
  try {
    mkdirSync(join(dir, 'foundry', 'flows'), { recursive: true });
    writeFileSync(
      join(dir, 'foundry', 'flows', 'creative-flow.md'),
      '---\nid: creative-flow\nname: Creative Flow\n---\nFlow body.\n',
    );

    const plugin = await FoundryPlugin({ directory: dir });
    const out = JSON.parse(await plugin.tool.foundry_config_flow.execute(
      { flowId: 'creative-flow' }, makeCtx(dir),
    ));

    assert.equal(out.frontmatter.id, 'creative-flow');
    assert.equal(out.frontmatter.name, 'Creative Flow');
    assert.equal(out.body, 'Flow body.');
  } finally { cleanup(dir); }
});

test('foundry_config_flow surfaces a clear error when flow missing', async () => {
  const dir = makeFoundry();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    await assert.rejects(
      () => plugin.tool.foundry_config_flow.execute({ flowId: 'missing' }, makeCtx(dir)),
      /Flow not found: missing/,
    );
  } finally { cleanup(dir); }
});
