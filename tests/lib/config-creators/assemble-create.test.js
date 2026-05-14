import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleArtefactTypeMarkdown } from '../../../src/scripts/lib/config-creators/artefact-type.js';
import { assembleAppraiserMarkdown } from '../../../src/scripts/lib/config-creators/appraiser.js';
import { assembleFlowMarkdown } from '../../../src/scripts/lib/config-creators/flow.js';
import { assembleCycleMarkdown } from '../../../src/scripts/lib/config-creators/cycle.js';

// ---------------------------------------------------------------------------
// assembleArtefactTypeMarkdown
// ---------------------------------------------------------------------------

test('assembleArtefactTypeMarkdown: minimum required fields', () => {
  const result = assembleArtefactTypeMarkdown({
    id: 'short-story',
    name: 'Short Story',
    filePatterns: ['artefacts/short-story/*.md'],
    description: 'A short story.',
  });

  assert.equal(result, `---
name: short-story
file-patterns:
  - artefacts/short-story/*.md
---

## Definition

A short story.
`);
});

test('assembleArtefactTypeMarkdown: with appraisers count', () => {
  const result = assembleArtefactTypeMarkdown({
    id: 'essay',
    name: 'Essay',
    filePatterns: ['artefacts/essay/*.md'],
    description: 'An essay.',
    appraisers: { count: 3 },
  });

  assert.equal(result, `---
name: essay
file-patterns:
  - artefacts/essay/*.md
appraisers:
  count: 3
---

## Definition

An essay.
`);
});

test('assembleArtefactTypeMarkdown: with appraisers allowed list', () => {
  const result = assembleArtefactTypeMarkdown({
    id: 'poem',
    name: 'Poem',
    filePatterns: ['artefacts/poem/*.md'],
    description: 'A poem.',
    appraisers: { allowed: ['skeptic', 'enthusiast'] },
  });

  assert.match(result,
    /appraisers:\n {2}allowed:\n {4}- skeptic\n {4}- enthusiast/);
});

test('assembleArtefactTypeMarkdown: without appraisers field', () => {
  const result = assembleArtefactTypeMarkdown({
    id: 'minimal',
    name: 'Minimal',
    filePatterns: ['minimal/*.md'],
    description: 'Minimal description.',
  });

  assert.doesNotMatch(result, /appraisers/);
});

test('assembleArtefactTypeMarkdown: frontmatter name uses id not name arg', () => {
  const result = assembleArtefactTypeMarkdown({
    id: 'slug-id',
    name: 'Display Name',
    filePatterns: ['test/*.md'],
    description: 'Desc.',
  });

  assert.match(result, /^---\nname: slug-id\n/);
  assert.doesNotMatch(result, /Display Name/);
});

test('assembleArtefactTypeMarkdown: multiple file patterns', () => {
  const result = assembleArtefactTypeMarkdown({
    id: 'multi',
    name: 'Multi',
    filePatterns: ['multi/*.md', 'multi/**/*.md'],
    description: 'Multi pattern.',
  });

  assert.match(result,
    /file-patterns:\n {2}- multi\/\*\.md\n {2}- multi\/\*\*\/\*\.md/);
});

test('assembleArtefactTypeMarkdown: handles special characters in description', () => {
  const result = assembleArtefactTypeMarkdown({
    id: 'special',
    name: 'Special',
    filePatterns: ['special/*.md'],
    description: 'Has "quotes" and <angle> brackets.',
  });

  assert.match(result, /Has "quotes" and <angle> brackets\./);
});

// ---------------------------------------------------------------------------
// assembleAppraiserMarkdown
// ---------------------------------------------------------------------------

test('assembleAppraiserMarkdown: minimum required fields', () => {
  const result = assembleAppraiserMarkdown({
    id: 'skeptic',
    name: 'The Skeptic',
    description: 'A reviewer who looks for unsupported claims.',
  });

  assert.equal(result, `---
id: skeptic
name: The Skeptic
---

A reviewer who looks for unsupported claims.
`);
});

test('assembleAppraiserMarkdown: with model override', () => {
  const result = assembleAppraiserMarkdown({
    id: 'gpt-reviewer',
    name: 'GPT Reviewer',
    description: 'An AI reviewer.',
    model: 'gpt-4',
  });

  assert.equal(result, `---
id: gpt-reviewer
name: GPT Reviewer
model: gpt-4
---

An AI reviewer.
`);
});

test('assembleAppraiserMarkdown: without model', () => {
  const result = assembleAppraiserMarkdown({
    id: 'human',
    name: 'Human',
    description: 'A human reviewer.',
  });

  assert.doesNotMatch(result, /model:/);
});

test('assembleAppraiserMarkdown: handles multi-line description', () => {
  const result = assembleAppraiserMarkdown({
    id: 'detailed',
    name: 'Detailed',
    description: 'Line one.\nLine two.',
  });

  assert.match(result, /Line one\.\nLine two\./);
});

// ---------------------------------------------------------------------------
// assembleFlowMarkdown
// ---------------------------------------------------------------------------

test('assembleFlowMarkdown: minimum required fields', () => {
  const result = assembleFlowMarkdown({
    id: 'creative',
    name: 'Creative',
    startingCycles: ['draft'],
    description: 'Some prose.',
  });

  assert.equal(result, `---
id: creative
name: Creative
starting-cycles:
  - draft
---

## Cycles

Some prose.
`);
});

test('assembleFlowMarkdown: multiple starting cycles', () => {
  const result = assembleFlowMarkdown({
    id: 'multi-cycle',
    name: 'Multi Cycle',
    startingCycles: ['draft', 'revise', 'publish'],
    description: 'Multi-cycle flow.',
  });

  assert.match(result,
    /starting-cycles:\n {2}- draft\n {2}- revise\n {2}- publish/);
});

test('assembleFlowMarkdown: renders ## Cycles heading', () => {
  const result = assembleFlowMarkdown({
    id: 'test-flow',
    name: 'Test Flow',
    startingCycles: ['draft'],
    description: 'A test flow.',
  });

  assert.match(result, /## Cycles/);
});

test('assembleFlowMarkdown: handles description with special chars', () => {
  const result = assembleFlowMarkdown({
    id: 'spec-flow',
    name: 'Spec Flow',
    startingCycles: ['alpha'],
    description: 'Flow with **bold** and `code`.',
  });

  assert.match(result, /\*\*bold\*\*/);
  assert.match(result, /`code`/);
});

// ---------------------------------------------------------------------------
// assembleCycleMarkdown
// ---------------------------------------------------------------------------

test('assembleCycleMarkdown: minimum required fields (no description)', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
  });

  assert.equal(result, `---
id: draft
name: Draft
output-type: short-story
---
`);
});

test('assembleCycleMarkdown: with description', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
    description: 'A drafting cycle.',
  });

  assert.equal(result, `---
id: draft
name: Draft
output-type: short-story
---

## Cycle

A drafting cycle.
`);
});

test('assembleCycleMarkdown: with inputs', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
    inputs: { type: 'any-of', artefacts: ['brief'] },
  });

  assert.match(result,
    /inputs:\n {2}type: any-of\n {2}artefacts:\n {4}- brief/);
});

test('assembleCycleMarkdown: with targets', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
    targets: ['revise', 'publish'],
  });

  assert.match(result,
    /targets:\n {2}- revise\n {2}- publish/);
});

test('assembleCycleMarkdown: with boolean flags', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
    humanAppraise: true,
    deadlockAppraise: false,
  });

  assert.match(result, /human-appraise: true/);
  assert.match(result, /deadlock-appraise: false/);
});

test('assembleCycleMarkdown: with numeric fields', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
    deadlockIterations: 3,
    maxIterations: 10,
  });

  assert.match(result, /deadlock-iterations: 3/);
  assert.match(result, /max-iterations: 10/);
});

test('assembleCycleMarkdown: with assay config', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
    assay: { extractors: ['quality', 'consistency'] },
  });

  assert.match(result,
    /assay:\n {2}extractors:\n {4}- quality\n {4}- consistency/);
});

test('assembleCycleMarkdown: with memory config', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
    memory: { read: ['context'], write: ['result'] },
  });

  assert.match(result,
    /memory:\n {2}read:\n {4}- context\n {2}write:\n {4}- result/);
});

test('assembleCycleMarkdown: with models override', () => {
  const result = assembleCycleMarkdown({
    id: 'draft',
    name: 'Draft',
    outputType: 'short-story',
    models: { forge: 'opencode/claude-sonnet-4' },
  });

  assert.match(result,
    /models:\n {2}forge: opencode\/claude-sonnet-4/);
});

test('assembleCycleMarkdown: all optional fields together', () => {
  const result = assembleCycleMarkdown({
    id: 'full-cycle',
    name: 'Full Cycle',
    outputType: 'article',
    inputs: { type: 'all-of', artefacts: ['brief', 'research'] },
    targets: ['review'],
    humanAppraise: true,
    deadlockAppraise: false,
    deadlockIterations: 5,
    maxIterations: 20,
    assay: { extractors: ['quality'] },
    memory: { read: ['global-context'], write: ['artefact'] },
    models: { forge: 'gpt-4', appraise: 'claude-3' },
    description: 'A fully configured cycle.',
  });

  assert.match(result, /^---/);
  assert.match(result, /id: full-cycle/);
  assert.match(result, /name: Full Cycle/);
  assert.match(result, /output-type: article/);
  assert.match(result,
    /inputs:\n {2}type: all-of\n {2}artefacts:\n {4}- brief\n {4}- research/);
  assert.match(result, /targets:\n {2}- review/);
  assert.match(result, /human-appraise: true/);
  assert.match(result, /deadlock-appraise: false/);
  assert.match(result, /deadlock-iterations: 5/);
  assert.match(result, /max-iterations: 20/);
  assert.match(result,
    /assay:\n {2}extractors:\n {4}- quality/);
  assert.match(result,
    /memory:\n {2}read:\n {4}- global-context\n {2}write:\n {4}- artefact/);
  assert.match(result,
    /models:\n {2}forge: gpt-4\n {2}appraise: claude-3/);
  assert.match(result, /## Cycle\n\nA fully configured cycle\.\n$/);
});

test('assembleCycleMarkdown: omits optional fields when not provided', () => {
  const result = assembleCycleMarkdown({
    id: 'simple',
    name: 'Simple',
    outputType: 'note',
  });

  assert.doesNotMatch(result, /inputs/);
  assert.doesNotMatch(result, /targets/);
  assert.doesNotMatch(result, /human-appraise/);
  assert.doesNotMatch(result, /deadlock/);
  assert.doesNotMatch(result, /assay/);
  assert.doesNotMatch(result, /memory/);
  assert.doesNotMatch(result, /models/);
  assert.doesNotMatch(result, /## Cycle/);
});

test('assembleCycleMarkdown: camelCase to kebab-case mapping', () => {
  const result = assembleCycleMarkdown({
    id: 'mapping-test',
    name: 'Mapping Test',
    outputType: 'test',
    humanAppraise: true,
    deadlockAppraise: true,
    deadlockIterations: 3,
    maxIterations: 10,
  });

  assert.match(result, /human-appraise/);
  assert.match(result, /deadlock-appraise/);
  assert.match(result, /deadlock-iterations/);
  assert.match(result, /max-iterations/);
});
