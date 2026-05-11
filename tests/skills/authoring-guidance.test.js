import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const AUTHORING_SKILLS = [
  'add-flow',
  'add-cycle',
  'add-artefact-type',
  'add-law',
  'add-appraiser',
];

function readSkill(name) {
  return readFileSync(join(REPO_ROOT, 'src', 'skills', name, 'SKILL.md'), 'utf8');
}

test('authoring skills include Foundry agent preflight', () => {
  for (const name of AUTHORING_SKILLS) {
    const text = readSkill(name);
    assert.ok(text.includes('## Foundry Agent Preflight'), `${name} missing Foundry Agent Preflight`);
    assert.ok(text.includes('switch to the **Foundry** agent'), `${name} missing Foundry agent switch guidance`);
  }
});

test('authoring skills keep branch tools internal', () => {
  for (const name of AUTHORING_SKILLS) {
    const text = readSkill(name);
    assert.ok(!text.includes('foundry_git_branch({'), `${name} exposes foundry_git_branch call syntax`);
    assert.ok(!text.includes('Then re-run this skill'), `${name} tells the user to re-run the skill`);
  }
});

test('authoring skills describe dependency composition', () => {
  const flow = readSkill('add-flow');
  assert.ok(flow.includes('Create missing dependencies in validation order'));
  assert.ok(flow.includes('artefact type'));
  assert.ok(flow.includes('laws'));
  assert.ok(flow.includes('validators'));
  assert.ok(flow.includes('appraisers'));
  assert.ok(flow.includes('cycles'));
});
