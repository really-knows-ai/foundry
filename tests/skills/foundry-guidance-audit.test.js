import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = join(REPO_ROOT, 'src', 'skills');

function skillFiles() {
  return readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(SKILLS_ROOT, entry.name, 'SKILL.md'));
}

test('skills avoid telling users to call internal branch tools', () => {
  for (const file of skillFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('foundry_git_branch({'), `${file} exposes foundry_git_branch call syntax`);
  }
});

test('skills avoid dead-end rerun instructions', () => {
  for (const file of skillFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('Then re-run this skill'), `${file} tells user to re-run the skill`);
  }
});

test('init-foundry tells users to switch to the Foundry agent', () => {
  const text = readFileSync(join(SKILLS_ROOT, 'init-foundry', 'SKILL.md'), 'utf8');
  assert.ok(text.includes('switch to the **Foundry** agent'));
});
