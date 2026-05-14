import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleLawMarkdown, assembleEditLawMarkdown } from '../../../src/scripts/lib/config-creators/law.js';

// ---------------------------------------------------------------------------
// assembleLawMarkdown
// ---------------------------------------------------------------------------

test('assembleLawMarkdown: minimum required fields', () => {
  const result = assembleLawMarkdown({
    id: 'safety-review',
    name: 'Safety Reviewer',
    description: 'Reviews artefacts for safety concerns.',
    passing: 'Artefact must not contain harmful content.',
    failing: 'Artefact must not contain PII.',
  });

  assert.equal(result, `## safety-review

Safety Reviewer — Reviews artefacts for safety concerns.

Artefact must not contain harmful content.

Artefact must not contain PII.`);
});

test('assembleLawMarkdown: with validators', () => {
  const result = assembleLawMarkdown({
    id: 'spell-check',
    name: 'Spell Check',
    description: 'Checks spelling.',
    passing: 'No spelling errors.',
    failing: 'Has spelling errors.',
    validators: [
      { id: 'dict', command: 'aspell list' },
    ],
  });

  assert.equal(result, `## spell-check

Spell Check — Checks spelling.

No spelling errors.

Has spelling errors.

validators:
  - id: dict
    command: aspell list`);
});

test('assembleLawMarkdown: with validators and failureMeans', () => {
  const result = assembleLawMarkdown({
    id: 'lint',
    name: 'Lint',
    description: 'Lints the artefact.',
    passing: 'Passes lint.',
    failing: 'Fails lint.',
    validators: [
      { id: 'eslint', command: 'eslint .', failureMeans: 'lint errors found' },
    ],
  });

  assert.match(result, /failure-means: lint errors found/);
});

test('assembleLawMarkdown: without validators', () => {
  const result = assembleLawMarkdown({
    id: 'simple-law',
    name: 'Simple',
    description: 'A simple law.',
    passing: 'Pass.',
    failing: 'Fail.',
  });

  assert.doesNotMatch(result, /validators/);
});

test('assembleLawMarkdown: multiple validators', () => {
  const result = assembleLawMarkdown({
    id: 'multi-val',
    name: 'Multi',
    description: 'Multiple validators.',
    passing: 'Pass.',
    failing: 'Fail.',
    validators: [
      { id: 'v1', command: 'cmd1' },
      { id: 'v2', command: 'cmd2', failureMeans: 'fail2' },
    ],
  });

  assert.match(result,
    / {2}- id: v1\n {4}command: cmd1\n {2}- id: v2\n {4}command: cmd2\n {4}failure-means: fail2/);
});

// ---------------------------------------------------------------------------
// assembleEditLawMarkdown
// ---------------------------------------------------------------------------

test('assembleEditLawMarkdown: update name only', () => {
  const existing = `## safety-review

Safety Reviewer — Reviews artefacts for safety concerns.

Must not contain harmful content.

Must not contain PII.`;

  const result = assembleEditLawMarkdown(existing, {
    name: 'Updated Reviewer',
  });

  assert.equal(result, `## safety-review

Updated Reviewer — Reviews artefacts for safety concerns.

Must not contain harmful content.

Must not contain PII.`);
});

test('assembleEditLawMarkdown: update description only', () => {
  const existing = `## safety-review

Safety Reviewer — Reviews artefacts for safety concerns.

Must not contain harmful content.

Must not contain PII.`;

  const result = assembleEditLawMarkdown(existing, {
    description: 'Updated safety concern description.',
  });

  assert.equal(result, `## safety-review

Safety Reviewer — Updated safety concern description.

Must not contain harmful content.

Must not contain PII.`);
});

test('assembleEditLawMarkdown: replace validators', () => {
  const existing = `## spell-check

Spell Check — Checks spelling.

No spelling errors.

Has spelling errors.

validators:
  - id: old-dict
    command: aspell list`;

  const result = assembleEditLawMarkdown(existing, {
    validators: [
      { id: 'new-dict', command: 'hunspell check' },
    ],
  });

  assert.equal(result, `## spell-check

Spell Check — Checks spelling.

No spelling errors.

Has spelling errors.

validators:
  - id: new-dict
    command: hunspell check`);
});

test('assembleEditLawMarkdown: remove validators (null)', () => {
  const existing = `## spell-check

Spell Check — Checks spelling.

No spelling errors.

Has spelling errors.

validators:
  - id: dict
    command: aspell list`;

  const result = assembleEditLawMarkdown(existing, {
    validators: null,
  });

  assert.equal(result, `## spell-check

Spell Check — Checks spelling.

No spelling errors.

Has spelling errors.`);
});

test('assembleEditLawMarkdown: update multiple fields', () => {
  const existing = `## safety-review

Safety Reviewer — Reviews artefacts for safety concerns.

Must not contain harmful content.

Must not contain PII.`;

  const result = assembleEditLawMarkdown(existing, {
    name: 'New Name',
    description: 'New description.',
    passing: 'New passing criteria.',
    failing: 'New failing criteria.',
  });

  assert.equal(result, `## safety-review

New Name — New description.

New passing criteria.

New failing criteria.`);
});

test('assembleEditLawMarkdown: preserves validators when not in updates', () => {
  const existing = `## spell-check

Spell Check — Checks spelling.

No spelling errors.

Has spelling errors.

validators:
  - id: dict
    command: aspell list`;

  const result = assembleEditLawMarkdown(existing, {
    name: 'Updated Spell Check',
  });

  // Name updated, validators preserved
  assert.match(result, /Updated Spell Check — Checks spelling\./);
  assert.match(result,
    /validators:\n {2}- id: dict\n {4}command: aspell list/);
});

test('assembleEditLawMarkdown: preserves unchanged fields', () => {
  const existing = `## safety-review

Safety Reviewer — Reviews artefacts for safety concerns.

Must not contain harmful content.

Must not contain PII.`;

  const result = assembleEditLawMarkdown(existing, {
    passing: 'Updated passing.',
  });

  assert.equal(result, `## safety-review

Safety Reviewer — Reviews artefacts for safety concerns.

Updated passing.

Must not contain PII.`);
});

test('assembleEditLawMarkdown: preserves content after the law block (other laws)', () => {
  const existing = `## law-one

Name One — Description one.

Passing one.

Failing one.

## law-two

Name Two — Description two.

Passing two.

Failing two.`;

  const result = assembleEditLawMarkdown(existing, {
    name: 'Updated One',
    description: 'Updated description.',
  });

  assert.equal(result, `## law-one

Updated One — Updated description.

Passing one.

Failing one.

## law-two

Name Two — Description two.

Passing two.

Failing two.`);
});

test('assembleEditLawMarkdown: throws on body with no heading', () => {
  assert.throws(() => {
    assembleEditLawMarkdown('just some text', { name: 'Test' });
  }, /must contain at least one ## law heading/);
});
