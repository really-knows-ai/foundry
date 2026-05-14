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

test('reset-memory must not tell users to create a config branch', () => {
  const text = readSkill('reset-memory');
  assert.ok(
    !/instruct the user to\s+create one before continuing/i.test(text),
    'reset-memory must not instruct the user to create a config branch'
  );
});

test('reset-memory includes positive internal branch handling', () => {
  const text = readSkill('reset-memory');
  assert.ok(
    /config.*branch.*internally/i.test(text),
    'reset-memory should handle config branch internally'
  );
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

// --- add-memory-entity-type must handle branch/memory internally ---

test('add-memory-entity-type must not tell users to create a config branch', () => {
  const text = readSkill('add-memory-entity-type');
  assert.ok(
    !/instruct the user to\s+create one before continuing/i.test(text),
    'add-memory-entity-type must not instruct the user to create a config branch'
  );
});

test('add-memory-entity-type must not tell users to run init-memory', () => {
  const text = readSkill('add-memory-entity-type');
  assert.ok(
    !/run\s+`init-memory`/i.test(text),
    'add-memory-entity-type must not say to run init-memory'
  );
});

test('add-memory-entity-type must not delegate edge creation to the user', () => {
  const text = readSkill('add-memory-entity-type');
  assert.ok(
    !/suggest.*add.*edge.*using.*`add-memory-edge-type`|tell.*run.*`add-memory-edge-type`/i.test(text),
    'add-memory-entity-type must not delegate edge follow-up as user-managed work'
  );
});

test('add-memory-entity-type includes positive internal branch handling', () => {
  const text = readSkill('add-memory-entity-type');
  assert.ok(
    /config.*branch.*internally/i.test(text),
    'add-memory-entity-type should handle config branch internally'
  );
});

test('add-memory-entity-type includes positive memory initialisation', () => {
  const text = readSkill('add-memory-entity-type');
  assert.ok(
    /initialise.*internally|compose.*internally/i.test(text),
    'add-memory-entity-type should initialise memory internally'
  );
});

// --- add-memory-edge-type must handle branch/memory internally ---

test('add-memory-edge-type must not tell users to create a config branch', () => {
  const text = readSkill('add-memory-edge-type');
  assert.ok(
    !/instruct the user to\s+create one before continuing/i.test(text),
    'add-memory-edge-type must not instruct the user to create a config branch'
  );
});

test('add-memory-edge-type must not tell users to run init-memory', () => {
  const text = readSkill('add-memory-edge-type');
  assert.ok(
    !/run\s+`init-memory`/i.test(text),
    'add-memory-edge-type must not say to run init-memory'
  );
});

test('add-memory-edge-type includes positive internal branch handling', () => {
  const text = readSkill('add-memory-edge-type');
  assert.ok(
    /config.*branch.*internally/i.test(text),
    'add-memory-edge-type should handle config branch internally'
  );
});

test('add-memory-edge-type includes positive memory initialisation', () => {
  const text = readSkill('add-memory-edge-type');
  assert.ok(
    /initialise.*internally|compose.*internally/i.test(text),
    'add-memory-edge-type should initialise memory internally'
  );
});

// --- add-extractor must not leave cycle wiring as user-managed ---

test('add-extractor must not present manual frontmatter editing as normal outcome', () => {
  const text = readSkill('add-extractor');
  assert.ok(
    !/add the following to the cycle.*frontmatter/i.test(text),
    'add-extractor must not present manual frontmatter editing as normal outcome'
  );
});

test('add-extractor must not tell users to create a config branch', () => {
  const text = readSkill('add-extractor');
  assert.ok(
    !/instruct the user to\s+create one before continuing/i.test(text),
    'add-extractor must not instruct the user to create a config branch'
  );
});

test('add-extractor includes positive internal branch handling', () => {
  const text = readSkill('add-extractor');
  assert.ok(
    /config.*branch.*internally/i.test(text),
    'add-extractor should handle config branch internally'
  );
});

test('add-extractor must not say it must not modify cycle definitions', () => {
  const text = readSkill('add-extractor');
  assert.ok(
    !/[*]*must not[*]* modify cycle definitions/i.test(text),
    'add-extractor must not say it must not modify cycle definitions'
  );
});

test('add-extractor includes positive cycle-definition guidance', () => {
  const text = readSkill('add-extractor');
  assert.ok(
    /update.*cycle.*internally|compose.*cycle.*internally|internally.*update.*cycle/i.test(text),
    'add-extractor should include positive guidance to update cycle definitions internally'
  );
});

// --- add-cycle must not expose generated agent files ---

test('add-cycle must not mention .opencode/agents/foundry-*.md in user guidance', () => {
  const text = readSkill('add-cycle');
  assert.ok(
    !text.includes('.opencode/agents/foundry-*.md'),
    'add-cycle must not expose .opencode/agents/foundry-*.md as user guidance'
  );
});

test('add-cycle must not reference foundry-* agent files for model selection', () => {
  const text = readSkill('add-cycle');
  assert.ok(
    !/listed as `foundry-\*` agent files/i.test(text),
    'add-cycle must not reference foundry-* agent files for model selection'
  );
});

test('add-cycle phrases model selection in Foundry concepts', () => {
  const text = readSkill('add-cycle');
  assert.ok(
    /models\s+(frontmatter|map)|session\s+defaults/i.test(text),
    'add-cycle should phrase model selection in Foundry concepts (models map / session defaults)'
  );
});

// --- add-cycle must not make flow wiring manual ---

test('add-cycle must not tell assistant to edit flow files by hand', () => {
  const text = readSkill('add-cycle');
  assert.ok(
    !/edit\s+`?foundry\/flows\/.*by hand/i.test(text),
    'add-cycle must not tell the assistant to edit flow files by hand'
  );
  assert.ok(
    !/commit\s+that\s+edit\s+by hand/i.test(text),
    'add-cycle must not tell the assistant to commit flow edits by hand'
  );
});

// --- init-memory must handle config branch internally ---

test('init-memory must not tell users to create a config branch', () => {
  const text = readSkill('init-memory');
  assert.ok(
    !/instruct the user to\s+create one before continuing/i.test(text),
    'init-memory must not instruct the user to create a config branch'
  );
});

test('init-memory includes positive internal branch handling', () => {
  const text = readSkill('init-memory');
  assert.ok(
    /config.*branch.*internally/i.test(text),
    'init-memory should handle config branch internally'
  );
});

// --- existing-file recovery must not fall back to hand editing ---

test('add-artefact-type must not fall back to hand editing for existing files', () => {
  const text = readSkill('add-artefact-type');
  assert.ok(
    !/the user should edit the file by hand/i.test(text),
    'add-artefact-type must not tell the user to edit the file by hand'
  );
});

test('add-cycle must not fall back to hand editing for existing files', () => {
  const text = readSkill('add-cycle');
  assert.ok(
    !/the user should edit the file by hand/i.test(text),
    'add-cycle must not tell the user to edit the file by hand for existing-file recovery'
  );
});

test('add-appraiser must not fall back to hand editing for existing files', () => {
  const text = readSkill('add-appraiser');
  assert.ok(
    !/the user should edit the file by hand/i.test(text),
    'add-appraiser must not tell the user to edit the file by hand'
  );
});

test('add-law must not fall back to hand editing for collisions', () => {
  const text = readSkill('add-law');
  assert.ok(
    !/ask the user to rename and edit by hand/i.test(text),
    'add-law must not ask the user to rename and edit by hand'
  );
});
