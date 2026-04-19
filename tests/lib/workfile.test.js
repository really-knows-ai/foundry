import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  writeFrontmatter,
  createWorkfile,
  getFrontmatterField,
  setFrontmatterField,
  enrichStages,
  parseStagesValue,
  parseModelsValue,
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
    assert.ok(result.includes('| File | Type | Cycle | Status |'));
    assert.ok(result.includes('## Feedback'));
  });

  it('produces valid WORK.md with minimal frontmatter (no stages, no maxIterations)', () => {
    const result = createWorkfile({ flow: 'creative-flow', cycle: 'create-haiku' }, 'Write a haiku');
    const fm = parseFrontmatter(result);
    assert.equal(fm.flow, 'creative-flow');
    assert.equal(fm.cycle, 'create-haiku');
    assert.equal(fm.stages, undefined);
    assert.equal(fm.maxIterations, undefined);
    assert.ok(!result.includes('stages:'));
    assert.ok(!result.includes('maxIterations:'));
    assert.ok(result.includes('# Goal'));
    assert.ok(result.includes('## Feedback'));
  });

  it('round-trips: minimal workfile, then setFrontmatterField adds stages', () => {
    const initial = createWorkfile({ flow: 'creative-flow', cycle: 'create-haiku' }, 'Goal text');
    const withStages = setFrontmatterField(initial, 'stages', ['forge:create-haiku', 'quench:create-haiku']);
    const fm = parseFrontmatter(withStages);
    assert.deepEqual(fm.stages, ['forge:create-haiku', 'quench:create-haiku']);
    assert.equal(fm.flow, 'creative-flow');
    assert.equal(fm.cycle, 'create-haiku');
    assert.ok(withStages.includes('Goal text'));
    assert.ok(withStages.includes('## Feedback'));
  });

  it('supports frontmatter with stages but no maxIterations', () => {
    const result = createWorkfile({ flow: 'f', cycle: 'c', stages: ['forge:c'] }, 'g');
    const fm = parseFrontmatter(result);
    assert.deepEqual(fm.stages, ['forge:c']);
    assert.equal(fm.maxIterations, undefined);
  });

  it('supports frontmatter with maxIterations but no stages', () => {
    const result = createWorkfile({ flow: 'f', cycle: 'c', maxIterations: 5 }, 'g');
    const fm = parseFrontmatter(result);
    assert.equal(fm.maxIterations, 5);
    assert.equal(fm.stages, undefined);
  });
});

// ---------------------------------------------------------------------------
// enrichStages
// ---------------------------------------------------------------------------

describe('enrichStages', () => {
  it('adds cycleId alias to bare stage names', () => {
    const result = enrichStages(['forge', 'quench', 'appraise'], 'create-haiku');
    assert.deepEqual(result, ['forge:create-haiku', 'quench:create-haiku', 'appraise:create-haiku']);
  });

  it('preserves already-aliased stages', () => {
    const result = enrichStages(['forge:write-haiku', 'quench:check-syllables'], 'create-haiku');
    assert.deepEqual(result, ['forge:write-haiku', 'quench:check-syllables']);
  });

  it('handles mix of bare and aliased', () => {
    const result = enrichStages(['forge:custom', 'quench', 'appraise'], 'my-cycle');
    assert.deepEqual(result, ['forge:custom', 'quench:my-cycle', 'appraise:my-cycle']);
  });
});

//

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

// ---------------------------------------------------------------------------
// parseStagesValue
// ---------------------------------------------------------------------------

describe('parseStagesValue', () => {
  it('returns a JSON array as-is', () => {
    assert.deepEqual(parseStagesValue('["forge:a","quench:b"]'), ['forge:a', 'quench:b']);
  });

  it('splits comma-separated string into array', () => {
    assert.deepEqual(
      parseStagesValue('forge:write-haiku, quench:check-haiku, appraise:evaluate-haiku'),
      ['forge:write-haiku', 'quench:check-haiku', 'appraise:evaluate-haiku'],
    );
  });

  it('handles single stage string', () => {
    assert.deepEqual(parseStagesValue('forge:write-haiku'), ['forge:write-haiku']);
  });

  it('trims whitespace from each entry', () => {
    assert.deepEqual(
      parseStagesValue('  forge:a ,  quench:b  '),
      ['forge:a', 'quench:b'],
    );
  });

  it('filters out empty entries', () => {
    assert.deepEqual(parseStagesValue('forge:a,,quench:b,'), ['forge:a', 'quench:b']);
  });
});

// ---------------------------------------------------------------------------
// parseModelsValue
// ---------------------------------------------------------------------------

describe('parseModelsValue', () => {
  it('returns a JSON object as-is', () => {
    assert.deepEqual(parseModelsValue('{"forge":"openai/gpt-4o","quench":"claude-sonnet"}'), { forge: 'openai/gpt-4o', quench: 'claude-sonnet' });
  });

  it('parses key: value comma-separated string', () => {
    assert.deepEqual(
      parseModelsValue('forge: github-copilot/claude-sonnet-4.6, quench: github-copilot/claude-sonnet-4.6, appraise: github-copilot/gpt-5.4'),
      { forge: 'github-copilot/claude-sonnet-4.6', quench: 'github-copilot/claude-sonnet-4.6', appraise: 'github-copilot/gpt-5.4' },
    );
  });

  it('handles extra whitespace', () => {
    assert.deepEqual(parseModelsValue('  forge :  gpt-4o  ,  quench :  claude  '), { forge: 'gpt-4o', quench: 'claude' });
  });

  it('skips malformed entries without colon', () => {
    assert.deepEqual(parseModelsValue('forge: gpt-4o, badentry, quench: claude'), { forge: 'gpt-4o', quench: 'claude' });
  });

  it('returns empty object for empty string', () => {
    assert.deepEqual(parseModelsValue(''), {});
  });
});
