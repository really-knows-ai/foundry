import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCycleDefinition,
  getArtefactType,
  getLaws,
  getValidation,
  getAppraisers,
  getFlow,
  selectAppraisers,
} from '../../scripts/lib/config.js';

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
      'foundry/cycles/build.md': '---\noutput: code\n---\nDo the build.',
    });
    const result = await getCycleDefinition('foundry', 'build', io);
    assert.equal(result.frontmatter.output, 'code');
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
    const laws = await getLaws('foundry', null, io);
    assert.equal(laws.length, 2);
    assert.equal(laws[0].id, 'clarity');
    assert.equal(laws[0].text, 'Be clear.');
    assert.equal(laws[0].source, 'laws/style.md');
    assert.equal(laws[1].id, 'brevity');
  });

  it('includes type-specific laws when typeId given', async () => {
    const io = mockIO({
      'foundry/laws': ['global.md'],
      'foundry/laws/global.md': '## g1\nGlobal law.',
      'foundry/artefacts/code/laws.md': '## c1\nCode law.',
    });
    const laws = await getLaws('foundry', 'code', io);
    assert.equal(laws.length, 2);
    assert.equal(laws[1].source, 'artefacts/code/laws.md');
  });

  it('works with io as second arg (no typeId)', async () => {
    const io = mockIO({
      'foundry/laws': ['a.md'],
      'foundry/laws/a.md': '## x\nText.',
    });
    const laws = await getLaws('foundry', io);
    assert.equal(laws.length, 1);
  });
});

describe('getValidation', () => {
  it('extracts commands from code blocks', async () => {
    const io = mockIO({
      'foundry/artefacts/code/validation.md': '# Validation\n\n```bash\nnpm test\nnpm run lint\n```\n\nSome text.\n\n```sh\necho hi\n```',
    });
    const cmds = await getValidation('foundry', 'code', io);
    assert.deepEqual(cmds, ['npm test', 'npm run lint', 'echo hi']);
  });

  it('returns null if file missing', async () => {
    const io = mockIO({});
    const result = await getValidation('foundry', 'code', io);
    assert.equal(result, null);
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
    const result = await selectAppraisers('foundry', 'code', null, io);
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
    const result = await selectAppraisers('foundry', 'code', io);
    assert.equal(result.length, 3);
    assert.ok(result.every(r => r.id === 'bob'));
  });

  it('uses countOverride', async () => {
    const io = mockIO({
      'foundry/artefacts/code/definition.md': '---\nname: Code\n---\n',
      'foundry/appraisers': ['a.md'],
      'foundry/appraisers/a.md': '---\nid: alice\n---\nAlice.',
    });
    const result = await selectAppraisers('foundry', 'code', 2, io);
    assert.equal(result.length, 2);
  });
});
