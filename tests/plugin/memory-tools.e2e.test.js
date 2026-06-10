import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
      'foundry_memory_get', 'foundry_memory_list', 'foundry_memory_traverse', 'foundry_memory_query',
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
    const out = JSON.parse(await plugin.tool.foundry_memory_traverse.execute({ type: 'class', name: 'com.Src', depth: 1 }, ctx));
    assert.equal(out.edges.length, 1);
  });

  it('neighbours rejects depth values above the safety bound', async () => {
    const ctx = { worktree: root };
    const out = JSON.parse(await plugin.tool.foundry_memory_traverse.execute(
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

  it('TF10: query blocks permission bypass via rule aliasing', async () => {
    // Create a forbidden entity type that should not be accessible via aliasing
    writeFileSync(join(root, 'foundry/memory/entities/secret.md'),
      '---\ntype: secret\n---\n\n# secret\nForbidden type.\n');
    const schema = JSON.parse(readFileSync(join(root, 'foundry/memory/schema.json'), 'utf-8'));
    schema.entities.secret = { frontmatterHash: hashFrontmatter({ type: 'secret' }) };
    writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');

    // Dispose and reboot to load new schema
    disposeStores();
    plugin = await bootPlugin(root);

    // Put a secret entity
    const ctx = { worktree: root };
    await plugin.tool.foundry_memory_put.execute({ type: 'secret', name: 'api-key', value: 'sk-1234' }, ctx);

    // Create a cycle definition that only allows reading 'class', not 'secret'
    mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
    writeFileSync(join(root, 'foundry/cycles/test-cycle.md'), `---
output-type: report
memory:
  read: [class]
---

Cycle body.
`);

    // Try direct access to forbidden relation - this should be blocked
    const direct = '?[v] := *ent_secret{value: v}';
    const result1 = await plugin.tool.foundry_memory_query.execute({ datalog: direct }, { ...ctx, cycle: 'test-cycle' });
    const parsed1 = JSON.parse(result1);
    assert.ok(parsed1.error, 'Expected error for direct forbidden relation access');
    assert.match(parsed1.error, /ent_secret/i, 'Error should mention forbidden relation');
    assert.match(parsed1.error, /not in read permissions/i, 'Error should indicate permission violation');

    // Try bypassing via block comment embedding - should also be blocked
    const commentBypass = '?[v] := /* ent_secret */ *ent_secret{value: v}';
    const result2 = await plugin.tool.foundry_memory_query.execute({ datalog: commentBypass }, { ...ctx, cycle: 'test-cycle' });
    const parsed2 = JSON.parse(result2);
    assert.ok(parsed2.error, 'Expected error for comment-embedded bypass');
    assert.match(parsed2.error, /ent_secret/i, 'Error should mention forbidden relation');
  });

  it('TF11: neighbours rejects excessive depth (1000) with clear error', async () => {
    const ctx = { worktree: root };
    const result = JSON.parse(await plugin.tool.foundry_memory_traverse.execute(
      { type: 'class', name: 'com.Src', depth: 1000 },
      ctx,
    ));
    assert.ok(result.error, 'Expected error for excessive depth');
    assert.match(result.error, /depth/i, 'Error should mention depth');
    assert.match(result.error, /5/, 'Error should mention max depth of 5');
  });
});
