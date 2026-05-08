import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { disposeStores } from '../../src/scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../src/scripts/lib/memory/schema.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

// Per-test isolation: each test gets its own worktree + plugin so destructive
// admin tools (reset, drop, rename) cannot leak state into siblings.
//
// All schema-mutation admin tools require a config/<x> branch (Phase 4
// branch policy). The default helper inits a git repo and checks out
// such a branch so existing happy-path tests exercise the guard's
// success path. Tests that want to assert the guard's refusal call
// `setupWorktreeOnMain()` instead.

function initRepoAt(root) {
  execSync('git init -q -b main', { cwd: root, env: GIT_ENV });
  try { execSync('git checkout -B main -q', { cwd: root, env: GIT_ENV }); } catch { /* older git */ }
  execSync('git commit -q --allow-empty -m baseline', { cwd: root, env: GIT_ENV });
}

function populateMemoryTree(root, { edges = true } = {}) {
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  // memory enabled; embeddings null in schema.json so no provider needed.
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\n# class\nA class.\n');
  const schema = {
    version: 1,
    entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
    edges: {},
    embeddings: null,
  };
  if (edges) {
    writeFileSync(join(root, 'foundry/memory/edges/calls.md'),
      '---\ntype: calls\nsources: [class]\ntargets: [class]\n---\n\n# calls\n');
    schema.edges.calls = { frontmatterHash: hashFrontmatter({ type: 'calls', sources: ['class'], targets: ['class'] }) };
  }
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  if (edges) writeFileSync(join(root, 'foundry-memory/relations/calls.ndjson'), '');
  writeFileSync(join(root, 'foundry-memory/relations/class.ndjson'), '');
}

function maybeCheckoutBranch(root, branch) {
  if (branch && branch !== 'main') {
    execSync(`git checkout -q -b ${branch}`, { cwd: root, env: GIT_ENV });
  }
}

function resolveSetupOpts(opts) {
  const result = { withMemory: true, edges: true, branch: 'config/test' };
  if (!opts) return result;
  if (opts.withMemory !== undefined) result.withMemory = opts.withMemory;
  if (opts.edges !== undefined) result.edges = opts.edges;
  if (opts.branch !== undefined) result.branch = opts.branch;
  return result;
}

function setupWorktree(opts) {
  const { withMemory, edges, branch } = resolveSetupOpts(opts);
  const root = mkdtempSync(join(tmpdir(), 'plug-mem-adm-'));
  initRepoAt(root);
  if (!withMemory) {
    maybeCheckoutBranch(root, branch);
    return root;
  }
  populateMemoryTree(root, { edges });
  maybeCheckoutBranch(root, branch);
  return root;
}

function setupWorktreeOnMain(opts) {
  return setupWorktree({ ...opts, branch: 'main' });
}

async function boot(root) {
  return await FoundryPlugin({ directory: root });
}

describe('plugin memory admin tools', () => {
  let root, plugin;
  beforeEach(async () => { root = setupWorktree(); plugin = await boot(root); });
  afterEach(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  // --- foundry_memory_create_entity_type ---
  describe('foundry_memory_create_entity_type', () => {
    it('happy path: creates entity type and updates schema', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_create_entity_type.execute(
        { name: 'finding', body: 'A finding entity.' }, { worktree: root }));
      assert.equal(out.type, 'finding');
      assert.ok(existsSync(join(root, 'foundry/memory/entities/finding.md')));
      const sch = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
      assert.ok(sch.entities.finding);
    });
    it('bad identifier returns serialised error (not thrown)', async () => {
      const raw = await plugin.tool.foundry_memory_create_entity_type.execute(
        { name: 'BadName', body: 'x' }, { worktree: root });
      const out = JSON.parse(raw);
      assert.match(out.error, /invalid identifier/);
    });
    it('empty body returns error', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_create_entity_type.execute(
        { name: 'thing', body: '   ' }, { worktree: root }));
      assert.match(out.error, /body must be a non-empty string/);
    });
  });

  // --- foundry_memory_create_edge_type ---
  describe('foundry_memory_create_edge_type', () => {
    it('happy path with array sources/targets', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_create_edge_type.execute(
        { name: 'depends_on', sources: ['class'], targets: ['class'], body: 'dep edge' },
        { worktree: root }));
      assert.equal(out.type, 'depends_on');
      assert.ok(existsSync(join(root, 'foundry/memory/edges/depends_on.md')));
    });
    it('happy path with "any"', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_create_edge_type.execute(
        { name: 'mentions', sources: 'any', targets: 'any', body: 'b' },
        { worktree: root }));
      assert.equal(out.type, 'mentions');
    });
    it('bad identifier returns error', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_create_edge_type.execute(
        { name: 'BAD', sources: ['class'], targets: ['class'], body: 'b' },
        { worktree: root }));
      assert.ok(out.error);
    });
    it('unknown source entity returns error', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_create_edge_type.execute(
        { name: 'rel', sources: ['nonexistent'], targets: ['class'], body: 'b' },
        { worktree: root }));
      assert.ok(out.error);
    });
  });

  // --- foundry_memory_rename_entity_type ---
  describe('foundry_memory_rename_entity_type', () => {
    it('happy path renames type', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_rename_entity_type.execute(
        { from: 'class', to: 'klass' }, { worktree: root }));
      assert.ok(out.from === 'class' || out.renamed || out.to === 'klass' || JSON.stringify(out).includes('klass'));
      assert.ok(existsSync(join(root, 'foundry/memory/entities/klass.md')));
      assert.ok(!existsSync(join(root, 'foundry/memory/entities/class.md')));
    });
    it('unknown from returns error', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_rename_entity_type.execute(
        { from: 'ghost', to: 'klass' }, { worktree: root }));
      assert.match(out.error, /not declared/);
    });
    it('identical from/to returns error', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_rename_entity_type.execute(
        { from: 'class', to: 'class' }, { worktree: root }));
      assert.ok(out.error);
    });
  });

  // --- foundry_memory_rename_edge_type ---
  describe('foundry_memory_rename_edge_type', () => {
    it('happy path renames edge type', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_rename_edge_type.execute(
        { from: 'calls', to: 'invokes' }, { worktree: root }));
      assert.ok(JSON.stringify(out).includes('invokes'));
      assert.ok(existsSync(join(root, 'foundry/memory/edges/invokes.md')));
    });
    it('unknown from returns error', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_rename_edge_type.execute(
        { from: 'ghost', to: 'invokes' }, { worktree: root }));
      assert.match(out.error, /not declared/);
    });
  });

  // --- foundry_memory_drop_entity_type (destructive) ---
  describe('foundry_memory_drop_entity_type', () => {
    it('without confirm returns preview without mutating', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_drop_entity_type.execute(
        { name: 'class' }, { worktree: root }));
      assert.equal(out.requiresConfirm, true);
      assert.ok(out.preview);
      // file still on disk
      assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
      const sch = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
      assert.ok(sch.entities.class);
    });
    it('confirm:false also returns preview (does not mutate)', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_drop_entity_type.execute(
        { name: 'class', confirm: false }, { worktree: root }));
      assert.equal(out.requiresConfirm, true);
      assert.ok(existsSync(join(root, 'foundry/memory/entities/class.md')));
    });
    it('confirm:true performs destructive drop', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_drop_entity_type.execute(
        { name: 'class', confirm: true }, { worktree: root }));
      assert.equal(out.dropped, 'class');
      assert.ok(!existsSync(join(root, 'foundry/memory/entities/class.md')));
    });
    it('unknown name returns error', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_drop_entity_type.execute(
        { name: 'ghost', confirm: true }, { worktree: root }));
      assert.ok(out.error);
    });
  });

  // --- foundry_memory_drop_edge_type (destructive) ---
  describe('foundry_memory_drop_edge_type', () => {
    it('without confirm returns preview without mutating', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_drop_edge_type.execute(
        { name: 'calls' }, { worktree: root }));
      assert.equal(out.requiresConfirm, true);
      assert.ok(out.preview);
      assert.ok(existsSync(join(root, 'foundry/memory/edges/calls.md')));
    });
    it('confirm:true drops the edge type', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_drop_edge_type.execute(
        { name: 'calls', confirm: true }, { worktree: root }));
      assert.equal(out.dropped, 'calls');
      assert.ok(!existsSync(join(root, 'foundry/memory/edges/calls.md')));
    });
    it('unknown name returns error', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_drop_edge_type.execute(
        { name: 'ghost', confirm: true }, { worktree: root }));
      assert.match(out.error, /not declared/);
    });
  });

  // --- foundry_memory_reset (destructive, requires confirm:true) ---
  describe('foundry_memory_reset', () => {
    // Seeding via foundry_memory_put requires a work/<x> branch (flow-tier).
    // The reset itself is config-tier and runs on the existing config/test
    // branch. We swap branches mid-test to satisfy both guards.
    function seedOnWorkBranch() {
      execSync('git checkout -q -b work/reset-seed', { cwd: root, env: GIT_ENV });
    }
    function backToConfigBranch() {
      execSync('git checkout -q config/test', { cwd: root, env: GIT_ENV });
    }
    it('confirm:false returns error (does not reset)', async () => {
      // seed something so we can detect mutation if it happened
      seedOnWorkBranch();
      await plugin.tool.foundry_memory_put.execute(
        { type: 'class', name: 'com.A', value: 'v' }, { worktree: root });
      backToConfigBranch();
      const out = JSON.parse(await plugin.tool.foundry_memory_reset.execute(
        { confirm: false }, { worktree: root }));
      assert.match(out.error, /confirm: true/);
      const got = JSON.parse(await plugin.tool.foundry_memory_get.execute(
        { type: 'class', name: 'com.A' }, { worktree: root }));
      assert.equal(got.value, 'v');
    });
    it('confirm:true resets memory', async () => {
      seedOnWorkBranch();
      await plugin.tool.foundry_memory_put.execute(
        { type: 'class', name: 'com.A', value: 'v' }, { worktree: root });
      backToConfigBranch();
      const out = JSON.parse(await plugin.tool.foundry_memory_reset.execute(
        { confirm: true }, { worktree: root }));
      assert.equal(out.reset, true);
      const got = JSON.parse(await plugin.tool.foundry_memory_get.execute(
        { type: 'class', name: 'com.A' }, { worktree: root }));
      assert.equal(got, null);
    });
  });

  // --- foundry_memory_validate ---
  describe('foundry_memory_validate', () => {
    it('returns ok report on a clean tree', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_validate.execute(
        {}, { worktree: root }));
      assert.equal(out.ok, true);
      assert.ok(Array.isArray(out.issues));
      assert.equal(out.issues.length, 0);
    });
    it('reports drift when schema disagrees with on-disk frontmatter', async () => {
      // mutate schema to a bogus hash to force drift
      const sp = join(root, 'foundry/memory/schema.json');
      const sch = JSON.parse(readFileSync(sp, 'utf-8'));
      sch.entities.class.frontmatterHash = 'deadbeef';
      writeFileSync(sp, JSON.stringify(sch, null, 2));
      const out = JSON.parse(await plugin.tool.foundry_memory_validate.execute(
        {}, { worktree: root }));
      assert.equal(out.ok, false);
      assert.ok(out.issues.length > 0);
    });
  });

  // --- foundry_memory_dump ---
  describe('foundry_memory_dump', () => {
    // Seeding via foundry_memory_put requires a work/<x> branch (flow-tier).
    // Dump itself is read-only and runs on either branch; we swap to work
    // for the seed and back so the dump exercises the same memory state
    // the production cycle would observe.
    function seedAndReturnToConfig(args) {
      execSync('git checkout -q -b work/dump-seed', { cwd: root, env: GIT_ENV });
      const p = plugin.tool.foundry_memory_put.execute(args, { worktree: root });
      return p.then((res) => {
        execSync('git checkout -q config/test', { cwd: root, env: GIT_ENV });
        return res;
      });
    }
    it('returns a summary string when no type/name supplied', async () => {
      await seedAndReturnToConfig({ type: 'class', name: 'com.A', value: 'v' });
      const out = JSON.parse(await plugin.tool.foundry_memory_dump.execute({}, { worktree: root }));
      assert.equal(typeof out.dump, 'string');
      assert.match(out.dump, /memory summary/);
    });
    it('returns entity body when type+name provided', async () => {
      await seedAndReturnToConfig({ type: 'class', name: 'com.B', value: 'body-content' });
      const out = JSON.parse(await plugin.tool.foundry_memory_dump.execute(
        { type: 'class', name: 'com.B' }, { worktree: root }));
      assert.match(out.dump, /com\.B/);
      assert.match(out.dump, /body-content/);
    });
    it('reports missing entity', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_dump.execute(
        { type: 'class', name: 'ghost' }, { worktree: root }));
      assert.match(out.dump, /no entity found/);
    });
  });

  // --- foundry_memory_vacuum ---
  describe('foundry_memory_vacuum', () => {
    it('returns ok:true (compacts or no-ops)', async () => {
      const out = JSON.parse(await plugin.tool.foundry_memory_vacuum.execute(
        {}, { worktree: root }));
      assert.equal(out.ok, true);
    });
  });

  // --- foundry_memory_change_embedding_model ---
  describe('foundry_memory_change_embedding_model', () => {
    it('returns serialised error when embedding probe fails (no provider configured)', async () => {
      // config has embeddings disabled and no live provider; probe should fail
      // and be returned as a JSON error rather than thrown.
      const raw = await plugin.tool.foundry_memory_change_embedding_model.execute(
        { model: 'fake-model', dimensions: 8 }, { worktree: root });
      const out = JSON.parse(raw);
      assert.ok(out.error, `expected error in ${raw}`);
    });
  });
});

// --- foundry_memory_init ---
// init must run on a fresh worktree without a foundry/memory/ dir.
describe('plugin foundry_memory_init', () => {
  let root, plugin;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'plug-mem-init-'));
    initRepoAt(root);
    // foundry/ exists, memory/ does not.
    mkdirSync(join(root, 'foundry'), { recursive: true });
    execSync('git checkout -q -b config/init-memory', { cwd: root, env: GIT_ENV });
    plugin = await boot(root);
  });
  afterEach(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('happy path: scaffolds foundry/memory with embeddings disabled and probe skipped', async () => {
    const out = JSON.parse(await plugin.tool.foundry_memory_init.execute(
      { embeddings_enabled: false, probe: false }, { worktree: root }));
    assert.ok(Array.isArray(out.created));
    assert.ok(existsSync(join(root, 'foundry/memory/config.md')));
    assert.ok(existsSync(join(root, 'foundry/memory/schema.json')));
    assert.ok(existsSync(join(root, 'foundry/memory/entities')));
    assert.ok(existsSync(join(root, 'foundry/memory/edges')));
    assert.ok(existsSync(join(root, 'foundry-memory/relations')));
  });

  it('fails (returns error JSON) when foundry/memory already exists', async () => {
    mkdirSync(join(root, 'foundry/memory'), { recursive: true });
    const out = JSON.parse(await plugin.tool.foundry_memory_init.execute(
      { embeddings_enabled: false, probe: false }, { worktree: root }));
    assert.match(out.error, /already exists/);
  });

  it('fails (returns error JSON) when foundry/ does not exist', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'plug-mem-init-empty-'));
    initRepoAt(empty);
    execSync('git checkout -q -b config/empty', { cwd: empty, env: GIT_ENV });
    try {
      const localPlugin = await boot(empty);
      const out = JSON.parse(await localPlugin.tool.foundry_memory_init.execute(
        { embeddings_enabled: false, probe: false }, { worktree: empty }));
      assert.match(out.error, /foundry\/ does not exist/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// Branch guard: every config-tier admin tool must refuse on main, and the
// meta tool (vacuum) must continue to work everywhere.
describe('plugin memory admin tools: config branch guard', () => {
  let root, plugin;
  afterEach(() => { disposeStores(); if (root) rmSync(root, { recursive: true, force: true }); });

  // Each test invokes one tool; setup is on `main`. The body of the call
  // is irrelevant — the guard fires before reaching it.
  const cases = [
    ['foundry_memory_create_entity_type',     { name: 'finding', body: 'A finding.' }],
    ['foundry_extractor_create',              { name: 'ex', command: 'scripts/x.sh', memoryWrite: ['class'], body: 'b' }],
    ['foundry_memory_create_edge_type',       { name: 'depends_on', sources: ['class'], targets: ['class'], body: 'b' }],
    ['foundry_memory_rename_entity_type',     { from: 'class', to: 'klass' }],
    ['foundry_memory_rename_edge_type',       { from: 'calls', to: 'invokes' }],
    ['foundry_memory_drop_entity_type',       { name: 'class', confirm: true }],
    ['foundry_memory_drop_edge_type',         { name: 'calls', confirm: true }],
    ['foundry_memory_reset',                  { confirm: true }],
    ['foundry_memory_change_embedding_model', { model: 'm', dimensions: 8 }],
  ];

  for (const [tool, args] of cases) {
    it(`${tool}: refuses on main`, async () => {
      root = setupWorktreeOnMain();
      plugin = await boot(root);
      const out = JSON.parse(await plugin.tool[tool].execute(args, { worktree: root }));
      assert.ok(out.error, `expected error, got ${JSON.stringify(out)}`);
      assert.match(out.error, /requires a config\//,
        `${tool}: expected branch-guard error, got: ${out.error}`);
    });
  }

  it('foundry_memory_init: refuses on main', async () => {
    // init has its own setup (no foundry/memory/ pre-existing).
    root = mkdtempSync(join(tmpdir(), 'plug-mem-init-main-'));
    initRepoAt(root);
    mkdirSync(join(root, 'foundry'), { recursive: true });
    plugin = await boot(root);
    const out = JSON.parse(await plugin.tool.foundry_memory_init.execute(
      { embeddings_enabled: false, probe: false }, { worktree: root }));
    assert.ok(out.error);
    assert.match(out.error, /requires a config\//);
  });

  it('foundry_memory_create_entity_type: happy on config/x', async () => {
    // Re-assert that the guard pipeline doesn't break the existing path
    // when on a config branch.
    root = mkdtempSync(join(tmpdir(), 'plug-mem-adm-cfg-'));
    initRepoAt(root);
    populateMemoryTree(root);
    execSync('git checkout -q -b config/init-types', { cwd: root, env: GIT_ENV });
    plugin = await boot(root);
    const out = JSON.parse(await plugin.tool.foundry_memory_create_entity_type.execute(
      { name: 'finding', body: 'A finding.' }, { worktree: root }));
    assert.equal(out.error, undefined, `unexpected error: ${out.error}`);
    assert.equal(out.type, 'finding');
  });

  it('foundry_memory_vacuum: runs on main (meta tool, no branch guard)', async () => {
    root = setupWorktreeOnMain();
    plugin = await boot(root);
    const out = JSON.parse(await plugin.tool.foundry_memory_vacuum.execute(
      {}, { worktree: root }));
    // Vacuum either succeeds or returns some non-branch error; what
    // matters is that the branch guard did not reject it.
    if (out.error) {
      assert.doesNotMatch(out.error, /requires a config\//,
        `vacuum should not be branch-guarded; got: ${out.error}`);
    } else {
      assert.equal(out.ok, true);
    }
  });
});
