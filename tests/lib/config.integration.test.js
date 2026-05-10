import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCycleDefinition,
  getArtefactType,
  getLaws,
  getLawsForQuench,
  getValidation,
  getAppraisers,
  getFlow,
  selectAppraisers,
} from '../../src/scripts/lib/config.js';

function mockIO(files = {}) {
  return {
    exists: async (p) => p in files,
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`Not found: ${p}`);
      return files[p];
    },
    readDir: async (p) => {
      if (!(p in files)) return [];
      return files[p];
    },
  };
}

describe('getCycleDefinition', () => {
  it('parses cycle with frontmatter', async () => {
    const io = mockIO({
      'foundry/cycles/build.md': '---\noutput-type: code\n---\nDo the build.',
    });
    const result = await getCycleDefinition('foundry', 'build', io);
    assert.equal(result.frontmatter['output-type'], 'code');
    assert.equal(result.body, 'Do the build.');
  });

  it('throws if cycle not found', async () => {
    const io = mockIO({});
    await assert.rejects(() => getCycleDefinition('foundry', 'nope', io), /Cycle not found/);
  });
});

describe('getArtefactType', () => {
  it('parses artefact type definition', async () => {
    const io = mockIO({
      'foundry/artefacts/code/definition.md': '---\nname: Code\n---\nCode artefact.',
    });
    const result = await getArtefactType('foundry', 'code', io);
    assert.equal(result.frontmatter.name, 'Code');
    assert.equal(result.body, 'Code artefact.');
  });

  it('throws if not found', async () => {
    const io = mockIO({});
    await assert.rejects(() => getArtefactType('foundry', 'nope', io), /Artefact type not found/);
  });
});

describe('getLaws', () => {
  it('collects global laws', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': '## clarity\nBe clear.\n\n## brevity\nBe brief.',
    });
    const laws = await getLaws('foundry', io);
    assert.equal(laws.length, 2);
    assert.equal(laws[0].id, 'clarity');
    assert.equal(laws[0].text, 'Be clear.');
    assert.equal(laws[0].source, undefined);
    assert.equal(laws[1].id, 'brevity');
  });

  it('includes type-specific laws when typeId given', async () => {
    const io = mockIO({
      'foundry/laws': ['global.md'],
      'foundry/laws/global.md': '## g1\nGlobal law.',
      'foundry/artefacts/code/laws.md': '## c1\nCode law.',
    });
    const laws = await getLaws('foundry', io, { typeId: 'code' });
    assert.equal(laws.length, 2);
    assert.equal(laws[1].source, undefined);
  });

  it('returns global laws when no typeId is provided', async () => {
    const io = mockIO({
      'foundry/laws': ['a.md'],
      'foundry/laws/a.md': '## x\nText.',
    });
    const laws = await getLaws('foundry', io);
    assert.equal(laws.length, 1);
  });

  it('returns laws without source field', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': '## clarity\nBe clear.',
    });
    const laws = await getLaws('foundry', io);
    assert.equal(laws[0].source, undefined);
  });

  it('strips validators block from prose', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## clarity
Be clear.

validators:
  - id: test-id
    command: echo test`,
    });
    const laws = await getLaws('foundry', io);
    assert.equal(laws[0].text, 'Be clear.');
    assert(!laws[0].text.includes('validators:'));
  });

  it('parser extracts validators with lowercase keys', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## clarity
Be clear.

validators:
  - id: check-one
    command: echo one
    failure-means: Test failed`,
    });
    const laws = await getLawsForQuench('foundry', io);
    assert.equal(laws.length, 1);
    assert.equal(laws[0].id, 'clarity');
    assert.equal(laws[0].text, 'Be clear.');
    assert.equal(laws[0].validators.length, 1);
    assert.equal(laws[0].validators[0].id, 'check-one');
    assert.equal(laws[0].validators[0].command, 'echo one');
    assert.equal(laws[0].validators[0]['failure-means'], 'Test failed');
  });

  it('getLawsForQuench returns only laws with validators', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## with-validators
Has validators.

validators:
  - id: check-one
    command: echo one

## without-validators
No validators here.`,
    });
    const laws = await getLawsForQuench('foundry', io);
    assert.equal(laws.length, 1);
    assert.equal(laws[0].id, 'with-validators');
  });

  it('parser rejects validator entry missing id', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## clarity
Be clear.

validators:
  - command: echo test`,
    });
    await assert.rejects(
      () => getLaws('foundry', io),
      /validator entry missing required 'id'/
    );
  });

  it('parser rejects validator entry missing command', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## clarity
Be clear.

validators:
  - id: check-one
    failure-means: failed`,
    });
    await assert.rejects(
      () => getLaws('foundry', io),
      /validator entry missing required 'command'/
    );
  });

  it('parser rejects duplicate validator ids within a law', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## clarity
Be clear.

validators:
  - id: check-one
    command: echo one
  - id: check-one
    command: echo two`,
    });
    await assert.rejects(
      () => getLaws('foundry', io),
      /duplicate validator id 'check-one' in law/
    );
  });

  it('parser accepts multiple validators per law with unique ids', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## clarity
Be clear.

validators:
  - id: check-one
    command: echo one
  - id: check-two
    command: echo two`,
    });
    const laws = await getLawsForQuench('foundry', io);
    assert.equal(laws[0].validators.length, 2);
    assert.equal(laws[0].validators[0].id, 'check-one');
    assert.equal(laws[0].validators[1].id, 'check-two');
  });

  it('parser treats failure-means as optional', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## clarity
Be clear.

validators:
  - id: check-one
    command: echo one`,
    });
    const laws = await getLawsForQuench('foundry', io);
    assert.equal(laws[0].validators[0]['failure-means'], undefined);
  });
});

describe('getLawsForQuench', () => {
  it('returns laws with validators only', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': `## with-validators
Has validators.

validators:
  - id: check
    command: echo test

## without-validators
No validators.`,
    });
    const laws = await getLawsForQuench('foundry', io);
    assert.equal(laws.length, 1);
    assert.equal(laws[0].id, 'with-validators');
  });

  it('includes type-specific laws with validators', async () => {
    const io = mockIO({
      'foundry/laws': ['global.md'],
      'foundry/laws/global.md': `## g-with-val
Global with validators.

validators:
  - id: gv
    command: echo g`,
      'foundry/artefacts/code/laws.md': `## c-with-val
Code with validators.

validators:
  - id: cv
    command: echo c`,
    });
    const laws = await getLawsForQuench('foundry', io, { typeId: 'code' });
    assert.equal(laws.length, 2);
    const ids = laws.map(l => l.id);
    assert.ok(ids.includes('g-with-val'));
    assert.ok(ids.includes('c-with-val'));
  });
});

describe('getLaws - new shape', () => {
  it('returns prose-only without source field', async () => {
    const io = mockIO({
      'foundry/laws': ['style.md'],
      'foundry/laws/style.md': '## clarity\nBe clear.',
    });
    const laws = await getLaws('foundry', io);
    assert.deepEqual(laws[0], { id: 'clarity', text: 'Be clear.' });
    assert.equal(laws[0].source, undefined);
  });
});

describe('getValidation', () => {
  it('parses Command:/Failure means: format under ## headings', async () => {
    const io = mockIO({
      'foundry/artefacts/haiku/validation.md': [
        '# Validation',
        '',
        '## three-lines',
        'Command: node validate-three-lines.js {file}',
        'Failure means: The haiku does not have exactly 3 lines.',
        '',
        '## syllable-structure',
        'Command: node validate-syllable-structure.js {file}',
        'Failure means: The haiku does not follow the 5-7-5 syllable structure.',
      ].join('\n'),
    });
    const result = await getValidation('foundry', 'haiku', io);
    assert.deepEqual(result, [
      { id: 'three-lines', command: 'node validate-three-lines.js {file}', failureMeans: 'The haiku does not have exactly 3 lines.' },
      { id: 'syllable-structure', command: 'node validate-syllable-structure.js {file}', failureMeans: 'The haiku does not follow the 5-7-5 syllable structure.' },
    ]);
  });

  it('returns null if file missing', async () => {
    const io = mockIO({});
    const result = await getValidation('foundry', 'code', io);
    assert.equal(result, null);
  });

  it('strips backticks from Command values', async () => {
    const io = mockIO({
      'foundry/artefacts/haiku/validation.md': [
        '## three-lines',
        'Command: `node validate-three-lines.js {file}`',
        'Failure means: Not 3 lines.',
      ].join('\n'),
    });
    const result = await getValidation('foundry', 'haiku', io);
    assert.equal(result[0].command, 'node validate-three-lines.js {file}');
  });
});

describe('getAppraisers', () => {
  it('parses appraiser files', async () => {
    const io = mockIO({
      'foundry/appraisers': ['critic.md', 'mentor.md'],
      'foundry/appraisers/critic.md': '---\nid: critic\nmodel: gpt-4\n---\nBe harsh.',
      'foundry/appraisers/mentor.md': '---\nid: mentor\n---\nBe kind.',
    });
    const result = await getAppraisers('foundry', io);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'critic');
    assert.equal(result[0].model, 'gpt-4');
    assert.equal(result[0].personality, 'Be harsh.');
    assert.equal(result[1].id, 'mentor');
    assert.equal(result[1].model, undefined);
  });

  it('returns empty if dir missing', async () => {
    const io = mockIO({});
    const result = await getAppraisers('foundry', io);
    assert.deepEqual(result, []);
  });
});

describe('getFlow', () => {
  it('parses flow definition', async () => {
    const io = mockIO({
      'foundry/flows/default.md': '---\ncycles:\n  - build\n---\nDefault flow.',
    });
    const result = await getFlow('foundry', 'default', io);
    assert.deepEqual(result.frontmatter.cycles, ['build']);
    assert.equal(result.body, 'Default flow.');
  });

  it('throws if not found', async () => {
    const io = mockIO({});
    await assert.rejects(() => getFlow('foundry', 'nope', io), /Flow not found/);
  });
});

describe('selectAppraisers', () => {
  it('round-robins appraisers to count', async () => {
    const io = mockIO({
      'foundry/artefacts/code/definition.md': '---\nname: Code\nappraisers:\n  count: 5\n---\n',
      'foundry/appraisers': ['a.md', 'b.md'],
      'foundry/appraisers/a.md': '---\nid: alice\n---\nAlice.',
      'foundry/appraisers/b.md': '---\nid: bob\n---\nBob.',
    });
    const result = await selectAppraisers('foundry', 'code', { io, countOverride: null });
    assert.equal(result.length, 5);
    assert.equal(result[0].id, 'alice');
    assert.equal(result[1].id, 'bob');
    assert.equal(result[2].id, 'alice');
  });

  it('filters by allowed list', async () => {
    const io = mockIO({
      'foundry/artefacts/code/definition.md': '---\nname: Code\nappraisers:\n  allowed:\n    - bob\n---\n',
      'foundry/appraisers': ['a.md', 'b.md'],
      'foundry/appraisers/a.md': '---\nid: alice\n---\nAlice.',
      'foundry/appraisers/b.md': '---\nid: bob\n---\nBob.',
    });
    const result = await selectAppraisers('foundry', 'code', { io });
    assert.equal(result.length, 3);
    assert.ok(result.every(r => r.id === 'bob'));
  });

  it('uses countOverride', async () => {
    const io = mockIO({
      'foundry/artefacts/code/definition.md': '---\nname: Code\n---\n',
      'foundry/appraisers': ['a.md'],
      'foundry/appraisers/a.md': '---\nid: alice\n---\nAlice.',
    });
    const result = await selectAppraisers('foundry', 'code', { io, countOverride: 2 });
    assert.equal(result.length, 2);
  });
});
