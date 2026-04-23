import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';

function setupWorktree({ count } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'plug-appr-'));
  mkdirSync(join(root, 'foundry/artefacts/code'), { recursive: true });
  mkdirSync(join(root, 'foundry/appraisers'), { recursive: true });
  const countLine = count != null ? `\nappraisers:\n  count: ${count}\n` : '\n';
  writeFileSync(
    join(root, 'foundry/artefacts/code/definition.md'),
    `---\nname: Code${countLine}---\nCode artefact.\n`,
  );
  writeFileSync(
    join(root, 'foundry/appraisers/alice.md'),
    '---\nid: alice\n---\nAlice the appraiser.\n',
  );
  writeFileSync(
    join(root, 'foundry/appraisers/bob.md'),
    '---\nid: bob\n---\nBob the appraiser.\n',
  );
  return root;
}

describe('plugin appraiser tools', () => {
  let root, plugin;
  before(async () => {
    root = setupWorktree({ count: 4 });
    plugin = await FoundryPlugin({ directory: root });
  });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  it('registers foundry_appraisers_select', () => {
    assert.ok(plugin.tool.foundry_appraisers_select, 'missing foundry_appraisers_select tool');
  });

  it('returns appraisers for a typeId using the configured count', async () => {
    const ctx = { worktree: root };
    const out = await plugin.tool.foundry_appraisers_select.execute({ typeId: 'code' }, ctx);
    const arr = JSON.parse(out);
    assert.ok(Array.isArray(arr), 'expected JSON array');
    assert.equal(arr.length, 4, 'expected configured count of 4');
    assert.equal(arr[0].id, 'alice');
    assert.equal(arr[1].id, 'bob');
    assert.equal(arr[2].id, 'alice');
    assert.equal(arr[3].id, 'bob');
  });

  it('respects the count arg override', async () => {
    const ctx = { worktree: root };
    const out = await plugin.tool.foundry_appraisers_select.execute({ typeId: 'code', count: 2 }, ctx);
    const arr = JSON.parse(out);
    assert.equal(arr.length, 2);
    assert.equal(arr[0].id, 'alice');
    assert.equal(arr[1].id, 'bob');
  });
});
