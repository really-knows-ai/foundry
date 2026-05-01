import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

async function bootPlugin(worktree) {
  return await FoundryPlugin({ directory: worktree });
}

function setupWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'plug-mem-'));
  // Flow-tier branch guard: memory mutation tools require a work/<x> branch.
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: root, env: GIT_ENV });
  execFileSync('git', ['checkout', '-q', '-b', 'work/memory-tools-test'], { cwd: root, env: GIT_ENV });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'),
    '---\ntype: class\n---\n\n# class\nA class.\n');
  writeFileSync(join(root, 'foundry/memory/edges/calls.md'),
    '---\ntype: calls\nsources: [class]\ntargets: [class]\n---\n\n# calls\nCall edge.\n');
  const schema = {
    version: 1,
    entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } },
    edges: { calls: { frontmatterHash: hashFrontmatter({ type: 'calls', sources: ['class'], targets: ['class'] }) } },
    embeddings: null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  return root;
}

describe('plugin memory tools', () => {
  let root, plugin;
  before(async () => {
    root = setupWorktree();
    plugin = await bootPlugin(root);
  });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('registers all eight memory tools', () => {
    for (const name of [
      'foundry_memory_put', 'foundry_memory_relate', 'foundry_memory_unrelate',
      'foundry_memory_get', 'foundry_memory_list', 'foundry_memory_neighbours', 'foundry_memory_query',
      'foundry_memory_search',
    ]) {
      assert.ok(plugin.tool[name], `missing tool: ${name}`);
    }
  });

  it('put + get round-trips through the plugin, and syncs NDJSON when no cycle is active', async () => {
    const ctx = { worktree: root };
    await plugin.tool.foundry_memory_put.execute({ type: 'class', name: 'com.Foo', value: 'hello' }, ctx);
    const got = JSON.parse(await plugin.tool.foundry_memory_get.execute({ type: 'class', name: 'com.Foo' }, ctx));
    assert.equal(got.value, 'hello');

    const nd = readFileSync(join(root, 'foundry-memory/relations/class.ndjson'), 'utf-8');
    assert.match(nd, /com\.Foo/);
  });

  it('relate + neighbours work via the plugin', async () => {
    const ctx = { worktree: root };
    await plugin.tool.foundry_memory_put.execute({ type: 'class', name: 'com.Src', value: 'src' }, ctx);
    await plugin.tool.foundry_memory_put.execute({ type: 'class', name: 'com.Dst', value: 'dst' }, ctx);
    await plugin.tool.foundry_memory_relate.execute({
      from_type: 'class', from_name: 'com.Src', edge_type: 'calls', to_type: 'class', to_name: 'com.Dst',
    }, ctx);
    const out = JSON.parse(await plugin.tool.foundry_memory_neighbours.execute({ type: 'class', name: 'com.Src', depth: 1 }, ctx));
    assert.equal(out.edges.length, 1);
  });

  it('neighbours rejects depth values above the safety bound', async () => {
    const ctx = { worktree: root };
    const out = JSON.parse(await plugin.tool.foundry_memory_neighbours.execute(
      { type: 'class', name: 'com.Src', depth: 6 },
      ctx,
    ));
    assert.match(out.error, /depth/i);
    assert.match(out.error, /5/);
  });

  it('query rejects write queries', async () => {
    const ctx = { worktree: root };
    const out = await plugin.tool.foundry_memory_query.execute({ datalog: ':put ent_class { name => value } [["x","y"]]' }, ctx);
    assert.match(out, /error.*read-only/i);
  });
});
