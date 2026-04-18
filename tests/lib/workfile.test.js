import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  writeFrontmatter,
  createWorkfile,
  getFrontmatterField,
  setFrontmatterField,
} from '../../scripts/lib/workfile.js';

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('extracts YAML frontmatter', () => {
    const text = '---\ncycle: forge\nstage: quench\n---\n# Goal\nDo stuff';
    const fm = parseFrontmatter(text);
    assert.equal(fm.cycle, 'forge');
    assert.equal(fm.stage, 'quench');
  });

  it('returns empty object when no frontmatter', () => {
    assert.deepEqual(parseFrontmatter('# Just a heading'), {});
  });

  it('returns empty object for empty string', () => {
    assert.deepEqual(parseFrontmatter(''), {});
  });

  it('handles frontmatter with arrays', () => {
    const text = '---\ntags:\n  - a\n  - b\n---\nbody';
    const fm = parseFrontmatter(text);
    assert.deepEqual(fm.tags, ['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// writeFrontmatter
// ---------------------------------------------------------------------------

describe('writeFrontmatter', () => {
  it('serializes scalar fields', () => {
    const result = writeFrontmatter({ cycle: 'forge', stage: 'quench' });
    assert.ok(result.startsWith('---\n'));
    assert.ok(result.endsWith('\n---'));
    assert.ok(result.includes('cycle: forge'));
    assert.ok(result.includes('stage: quench'));
  });

  it('serializes arrays', () => {
    const result = writeFrontmatter({ tags: ['a', 'b'] });
    assert.ok(result.includes('- a'));
    assert.ok(result.includes('- b'));
  });

  it('serializes nested objects (models map)', () => {
    const result = writeFrontmatter({ models: { forge: 'gpt-4', appraise: 'claude' } });
    assert.ok(result.includes('forge: gpt-4'));
    assert.ok(result.includes('appraise: claude'));
  });
});

// ---------------------------------------------------------------------------
// createWorkfile
// ---------------------------------------------------------------------------

describe('createWorkfile', () => {
  it('includes all sections', () => {
    const result = createWorkfile({ cycle: 'test' }, 'Write a haiku');
    assert.ok(result.includes('---\ncycle: test\n---'));
    assert.ok(result.includes('# Goal'));
    assert.ok(result.includes('Write a haiku'));
    assert.ok(result.includes('| Artefact | Status |'));
    assert.ok(result.includes('## Feedback'));
  });
});

// ---------------------------------------------------------------------------
// getFrontmatterField
// ---------------------------------------------------------------------------

describe('getFrontmatterField', () => {
  const text = '---\ncycle: forge\ntags:\n  - a\n  - b\n---\nbody';

  it('returns scalar field', () => {
    assert.equal(getFrontmatterField(text, 'cycle'), 'forge');
  });

  it('returns array field', () => {
    assert.deepEqual(getFrontmatterField(text, 'tags'), ['a', 'b']);
  });

  it('returns undefined for missing field', () => {
    assert.equal(getFrontmatterField(text, 'missing'), undefined);
  });
});

// ---------------------------------------------------------------------------
// setFrontmatterField
// ---------------------------------------------------------------------------

describe('setFrontmatterField', () => {
  it('updates existing field', () => {
    const text = '---\ncycle: forge\n---\n# Goal\nStuff';
    const result = setFrontmatterField(text, 'cycle', 'appraise');
    const fm = parseFrontmatter(result);
    assert.equal(fm.cycle, 'appraise');
  });

  it('adds new field', () => {
    const text = '---\ncycle: forge\n---\n# Goal\nStuff';
    const result = setFrontmatterField(text, 'stage', 'quench');
    const fm = parseFrontmatter(result);
    assert.equal(fm.stage, 'quench');
    assert.equal(fm.cycle, 'forge');
  });

  it('preserves body content', () => {
    const text = '---\ncycle: forge\n---\n# Goal\nImportant stuff';
    const result = setFrontmatterField(text, 'cycle', 'appraise');
    assert.ok(result.includes('# Goal\nImportant stuff'));
  });
});
