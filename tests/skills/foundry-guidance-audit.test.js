import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = join(REPO_ROOT, 'src', 'skills');
const DOCS_ROOT = join(REPO_ROOT, 'docs');

function skillFiles() {
  return readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(SKILLS_ROOT, entry.name, 'SKILL.md'));
}

function readSkill(name) {
  return readFileSync(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
}

function readDoc(name) {
  return readFileSync(join(DOCS_ROOT, name), 'utf8');
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

test('skills avoid exposing internal finish tool call syntax', () => {
  for (const file of skillFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('foundry_git_finish({'), `${file} exposes foundry_git_finish call syntax`);
  }
});

test('init-foundry tells users to switch to the Foundry agent', () => {
  const text = readSkill('init-foundry');
  assert.ok(text.includes('switch to the **Foundry** agent'));
});

test('init-foundry owns Foundry guide agent installation', () => {
  const text = readSkill('init-foundry');
  assert.ok(text.includes('Create `.opencode/agents/foundry.md`'));
  assert.ok(text.includes('Copy whichever template path exists'));
  assert.ok(text.includes('`dist/agents/foundry.md`'));
  assert.ok(text.includes('`src/agents/foundry.md`'));
});

// --- getting-started.md walkthrough guidance ---

test('getting-started does not expose direct branch tool call syntax in walkthrough', () => {
  const doc = readDoc('getting-started.md');
  assert.ok(!doc.includes('foundry_git_branch({'), 'getting-started must not include foundry_git_branch call syntax');
  assert.ok(!doc.includes('foundry_git_finish({'), 'getting-started must not include foundry_git_finish call syntax');
});

test('getting-started does not present Run `add-*` as the walkthrough path', () => {
  const doc = readDoc('getting-started.md');
  assert.ok(!doc.includes('Run `add-artefact-type`'), 'getting-started must not instruct user to Run add-artefact-type');
  assert.ok(!doc.includes('Run `add-law`'), 'getting-started must not instruct user to Run add-law');
  assert.ok(!doc.includes('Run `add-appraiser`'), 'getting-started must not instruct user to Run add-appraiser');
  assert.ok(!doc.includes('Run `add-cycle`'), 'getting-started must not instruct user to Run add-cycle');
  assert.ok(!doc.includes('Run `add-flow`'), 'getting-started must not instruct user to Run add-flow');
});

test('getting-started keeps memory setup agent-centred', () => {
  const doc = readDoc('getting-started.md');
  assert.ok(!doc.includes('Run the `init-memory` skill'), 'getting-started must not instruct users to Run init-memory');
  assert.ok(doc.includes('ask the Foundry agent to add flow memory'), 'getting-started should route memory setup through the Foundry agent');
});

test('getting-started does not include direct validation/create tool calls in walkthrough', () => {
  const doc = readDoc('getting-started.md');
  assert.ok(!doc.includes('foundry_config_validate_artefact_type({'), 'getting-started must not expose validate_artefact_type call');
  assert.ok(!doc.includes('foundry_config_validate_law({'), 'getting-started must not expose validate_law call');
  assert.ok(!doc.includes('foundry_config_validate_appraiser({'), 'getting-started must not expose validate_appraiser call');
  assert.ok(!doc.includes('foundry_config_validate_cycle({'), 'getting-started must not expose validate_cycle call');
  assert.ok(!doc.includes('foundry_config_validate_flow({'), 'getting-started must not expose validate_flow call');
});

test('getting-started includes Foundry agent switch and outcome-oriented guidance', () => {
  const doc = readDoc('getting-started.md');
  assert.ok(doc.includes('switch to the **Foundry** agent'), 'getting-started must direct users to switch to the Foundry agent');
  assert.ok(
    doc.includes('ask the Foundry agent'),
    'getting-started must guide users to ask the Foundry agent for an outcome'
  );
});

// --- memory and maintenance skills avoid dead ends ---

test('init-memory avoids user-facing dead-end delegation', () => {
  const text = readSkill('init-memory');
  assert.ok(!text.includes('Use `add-memory-entity-type`'), 'init-memory must not delegate to add-memory-entity-type');
  assert.ok(!text.includes('Use `add-memory-edge-type`'), 'init-memory must not delegate to add-memory-edge-type');
  assert.ok(!text.includes('Run `add-'), 'init-memory must not use Run `add-` style delegation');
});

test('reset-memory avoids user-facing dead-end delegation', () => {
  const text = readSkill('reset-memory');
  assert.ok(!/[Rr]un\s+`init-memory`/.test(text), 'reset-memory must not delegate to run/init-memory');
  assert.ok(!text.includes('ask the user to run'), 'reset-memory must not use ask the user to run');
  assert.ok(!text.includes('tell the user to run'), 'reset-memory must not use tell the user to run');
});

test('add-extractor avoids dead-end wording and direct tool-call JSON examples for the user', () => {
  const text = readSkill('add-extractor');
  assert.ok(!text.includes('offer to create it via `add-memory-entity-type`'), 'add-extractor must not offer to create via add-memory-entity-type');
  assert.ok(!/must not create entity or edge types/i.test(text), 'add-extractor must not use must not create entity or edge types dead-end');
  assert.ok(!text.includes('or `orchestrate` skill'), 'add-extractor must not tell users to run orchestrate directly');
});

// --- add-extractor dependency composition ---

test('add-extractor includes positive dependency-composition guidance', () => {
  const text = readSkill('add-extractor');
  assert.ok(
    text.includes('Compose into'),
    'add-extractor should include positive "Compose into" guidance for missing dependencies'
  );
});
