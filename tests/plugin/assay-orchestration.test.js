import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundryPlugin } from '../../.opencode/plugins/foundry.js';
import { disposeStores } from '../../scripts/lib/memory/singleton.js';
import { hashFrontmatter } from '../../scripts/lib/memory/schema.js';

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME:'t', GIT_AUTHOR_EMAIL:'t@t', GIT_COMMITTER_NAME:'t', GIT_COMMITTER_EMAIL:'t@t' };

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'assay-orch-'));
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, 'foundry/artefacts/doc'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/relations'), { recursive: true });
  mkdirSync(join(root, '.opencode/agents'), { recursive: true });
  writeFileSync(join(root, '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md'), '# agent\n');
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(join(root, 'foundry/memory/entities/class.md'), '---\ntype: class\n---\n\n# class\nA class.\n');
  writeFileSync(join(root, 'foundry/memory/relations/class.ndjson'), '');
  writeFileSync(join(root, 'foundry/memory/schema.json'),
    JSON.stringify({ version: 1, entities: { class: { frontmatterHash: hashFrontmatter({ type: 'class' }) } }, edges: {}, embeddings: null }, null, 2));
  writeFileSync(join(root, 'foundry/memory/extractors/one.md'),
    `---\ncommand: scripts/x.sh\nmemory:\n  write: [class]\n---\n\n# one\n`);
  writeFileSync(join(root, 'foundry/artefacts/doc/definition.md'),
    `---\ntype: doc\nfile-patterns: [out/**]\n---\n\n# doc\n`);
  writeFileSync(join(root, 'foundry/cycles/c.md'),
    `---\noutput: doc\nmemory:\n  read: [class]\n  write: [class]\nassay:\n  extractors: [one]\nmodels:\n  forge: github-copilot/claude-sonnet-4.6\n  appraise: github-copilot/claude-sonnet-4.6\n  assay: github-copilot/claude-sonnet-4.6\n---\n\n# c\n`);
  writeFileSync(join(root, 'WORK.md'),
    `---\nflow: test-flow\ncycle: c\n---\n\n# Goal\n\nanything\n`);
  execSync('git init -q', { cwd: root, env: GIT_ENV });
  execSync('git add -A && git commit -q -m init', { cwd: root, env: GIT_ENV });
  return root;
}

describe('foundry_orchestrate + assay', () => {
  let root, plugin;
  before(async () => { root = setup(); plugin = await FoundryPlugin({ directory: root }); });
  after(() => { disposeStores(); rmSync(root, { recursive: true, force: true }); });

  it('dispatches assay as the first stage of the cycle', async () => {
    const res = JSON.parse(await plugin.tool.foundry_orchestrate.execute({}, { worktree: root }));
    assert.equal(res.action, 'dispatch');
    assert.equal(res.stage, 'assay:c');
    assert.match(res.prompt, /assay/);
  });
});
