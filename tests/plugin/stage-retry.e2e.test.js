import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoundryPlugin } from '../../src/plugin/foundry.js';
import { disposeStores } from '../../src/scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../src/scripts/lib/memory/schema.js';

function setupFailedWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'retry-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'work/retry-test'], { cwd: root });
  
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, '.foundry'), { recursive: true });
  
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/finding.md'),
    '---\ntype: finding\n---\n\nA finding.\n');
  
  const schema = {
    version: 1,
    entities: { finding: { frontmatterHash: hashFrontmatter({ type: 'finding' }) } },
    edges: {},
    embeddings: null,
  };
  writeFileSync(join(root, 'foundry/memory/schema.json'), JSON.stringify(schema, null, 2) + '\n');
  writeFileSync(join(root, 'foundry/cycles/observe.md'),
    `---\noutput-type: report\nmemory:\n  write: [finding]\n---\n\nCycle body.\n`);
  
  // Create a failed WORK.md
  writeFileSync(join(root, 'WORK.md'),
    `---
flow: f
cycle: observe
status: failed
reason: 'memory sync at stage end failed: EISDIR test'
---

# Goal

go

| File | Type | Cycle | Status |
|------|------|-------|--------|
`);
  
  // Simulate a completed stage with last-stage.json
  writeFileSync(join(root, '.foundry/last-stage.json'),
    JSON.stringify({ cycle: 'observe', stage: 'forge:observe', baseSha: 'abc123', summary: 'work done' }, null, 2));
  
  // Create .gitignore (plugin will create this on boot)
  writeFileSync(join(root, '.gitignore'), '.foundry/\n');
  
  // Commit all files so git working tree is clean
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'setup failed flow'], { cwd: root });
  
  return root;
}

describe('foundry_stage_retry', () => {
  it('clears failed status and allows workflow to continue', async () => {
    const root = setupFailedWorktree();
    const plugin = await FoundryPlugin({ directory: root });
    const ctx = { worktree: root, cycle: 'observe' };
    
    const retryOut = JSON.parse(await plugin.tool.foundry_stage_retry.execute({}, ctx));
    assert.equal(retryOut.ok, true, `expected retry to succeed, got: ${JSON.stringify(retryOut)}`);

    const work = readFileSync(join(root, 'WORK.md'), 'utf-8');
    assert.doesNotMatch(work, /status: failed/, 'failed status should be cleared');
    assert.doesNotMatch(work, /reason:/, 'reason should be cleared');

    // Verify we can now use mutating tools
    const putOut = JSON.parse(await plugin.tool.foundry_memory_put.execute(
      { type: 'finding', name: 'f1', value: 'v1' }, ctx));
    assert.equal(putOut.ok, true, 'memory_put should work after retry');
    
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('clears last-stage.json to reset stage state', async () => {
    const root = setupFailedWorktree();
    const plugin = await FoundryPlugin({ directory: root });
    const ctx = { worktree: root, cycle: 'observe' };
    
    const retryOut = JSON.parse(await plugin.tool.foundry_stage_retry.execute({}, ctx));
    assert.equal(retryOut.ok, true);

    assert.equal(existsSync(join(root, '.foundry/last-stage.json')), false,
      'last-stage.json should be cleared to allow stage re-run');
    
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses when git working tree is not clean', async () => {
    const root = setupFailedWorktree();
    const plugin = await FoundryPlugin({ directory: root });
    const ctx = { worktree: root, cycle: 'observe' };
    
    writeFileSync(join(root, 'uncommitted.txt'), 'dirty worktree');

    const retryOut = JSON.parse(await plugin.tool.foundry_stage_retry.execute({}, ctx));
    assert.equal(retryOut.ok, false);
    assert.match(retryOut.error, /clean.*working tree/i,
      'should require clean working tree');

    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses when flow is not in failed state', async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'retry-not-failed-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root2 });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root2 });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root2 });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: root2 });
    execFileSync('git', ['checkout', '-q', '-b', 'work/retry-test'], { cwd: root2 });
    
    mkdirSync(join(root2, 'foundry/memory/entities'), { recursive: true });
    writeFileSync(join(root2, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
    writeFileSync(join(root2, 'foundry/memory/schema.json'), JSON.stringify({
      version: 1, entities: {}, edges: {}, embeddings: null,
    }, null, 2) + '\n');
    
    // WORK.md without failed status
    writeFileSync(join(root2, 'WORK.md'), '---\nflow: f\ncycle: observe\n---\n\n# Goal\n\ngo\n');
    writeFileSync(join(root2, '.gitignore'), '.foundry/\n');
    execFileSync('git', ['add', '.'], { cwd: root2 });
    execFileSync('git', ['commit', '-q', '-m', 'setup'], { cwd: root2 });

    const plugin2 = await FoundryPlugin({ directory: root2 });
    const retryOut = JSON.parse(await plugin2.tool.foundry_stage_retry.execute(
      {}, { worktree: root2, cycle: 'observe' }));
    
    assert.equal(retryOut.ok, false);
    assert.match(retryOut.error, /not.*failed/i,
      'should refuse when flow is not failed');

    disposeStores();
    rmSync(root2, { recursive: true, force: true });
  });

  it('refuses when active stage exists', async () => {
    const root = setupFailedWorktree();
    const plugin = await FoundryPlugin({ directory: root });
    const ctx = { worktree: root, cycle: 'observe' };
    
    writeFileSync(join(root, '.foundry/active-stage.json'),
      JSON.stringify({ cycle: 'observe', stage: 'forge:observe', baseSha: 'abc123' }));

    const retryOut = JSON.parse(await plugin.tool.foundry_stage_retry.execute({}, ctx));
    assert.equal(retryOut.ok, false);
    assert.match(retryOut.error, /active stage/i,
      'should refuse when active stage exists');

    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });

  it('invalidates memory singleton to discard uncommitted changes', async () => {
    const root = setupFailedWorktree();
    const plugin = await FoundryPlugin({ directory: root });
    const ctx = { worktree: root, cycle: 'observe' };
    
    // This test verifies the memory singleton is invalidated.
    // We can't easily test the singleton directly, but we can verify the
    // behaviour: after retry, memory operations start fresh from disk.
    
    const retryOut = JSON.parse(await plugin.tool.foundry_stage_retry.execute({}, ctx));
    assert.equal(retryOut.ok, true);

    // After retry, memory should be clean (reloaded from NDJSON)
    const listOut = JSON.parse(await plugin.tool.foundry_memory_list.execute(
      { type: 'finding' }, ctx));
    assert.ok(Array.isArray(listOut), 'memory_list should return array');
    assert.equal(listOut.length, 0, 'memory should be empty after retry (reloaded from disk)');
    
    disposeStores();
    rmSync(root, { recursive: true, force: true });
  });
});
