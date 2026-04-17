import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseStage,
  findFirst,
  nextInRoute,
  parseFrontmatter,
  parseFeedback,
  parseFeedbackItem,
  parseArtefactsTable,
  determineRoute,
  nextAfterQuench,
  nextAfterAppraise,
  globMatch,
  loadHistory,
  getModifiedFiles,
  getAllowedPatterns,
  checkModifiedFiles,
} from '../scripts/sort.js';

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

describe('baseStage', () => {
  it('extracts base from aliased stage', () => {
    assert.equal(baseStage('forge:write-haiku'), 'forge');
  });
  it('returns full string if no colon', () => {
    assert.equal(baseStage('forge'), 'forge');
  });
  it('handles multiple colons', () => {
    assert.equal(baseStage('forge:a:b'), 'forge');
  });
});

describe('findFirst', () => {
  const stages = ['forge:write', 'quench:review', 'appraise:check'];
  it('finds first stage matching base', () => {
    assert.equal(findFirst(stages, 'quench'), 'quench:review');
  });
  it('returns null when no match', () => {
    assert.equal(findFirst(stages, 'hitl'), null);
  });
  it('returns first when multiple match', () => {
    assert.equal(findFirst(['forge:a', 'forge:b'], 'forge'), 'forge:a');
  });
});

describe('nextInRoute', () => {
  const stages = ['forge:a', 'quench:b', 'appraise:c'];
  it('returns next stage', () => {
    assert.equal(nextInRoute(stages, 'forge:a'), 'quench:b');
  });
  it('returns null at end of route', () => {
    assert.equal(nextInRoute(stages, 'appraise:c'), null);
  });
  it('returns null for unknown stage', () => {
    assert.equal(nextInRoute(stages, 'hitl:x'), null);
  });
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter', () => {
    const text = '---\ncycle: test\nstages:\n  - forge:a\n---\nbody';
    const fm = parseFrontmatter(text);
    assert.equal(fm.cycle, 'test');
    assert.deepEqual(fm.stages, ['forge:a']);
  });
  it('returns empty object when no frontmatter', () => {
    assert.deepEqual(parseFrontmatter('no frontmatter here'), {});
  });
  it('returns empty object for empty frontmatter', () => {
    assert.deepEqual(parseFrontmatter('---\n\n---\nbody'), {});
  });
});

describe('parseFeedbackItem', () => {
  it('parses open item', () => {
    const item = parseFeedbackItem('- [ ] Fix the thing #validation');
    assert.equal(item.state, 'open');
    assert.equal(item.resolved, false);
    assert.deepEqual(item.tags, ['#validation']);
  });
  it('parses actioned item', () => {
    const item = parseFeedbackItem('- [x] Done #law:brevity');
    assert.equal(item.state, 'actioned');
    assert.deepEqual(item.tags, ['#law:brevity']);
  });
  it('parses wont-fix item', () => {
    const item = parseFeedbackItem('- [~] Not doing this #hitl');
    assert.equal(item.state, 'wont-fix');
  });
  it('parses approved resolution', () => {
    const item = parseFeedbackItem('- [x] Done #validation | approved');
    assert.equal(item.state, 'actioned');
    assert.equal(item.resolved, true);
  });
  it('parses rejected resolution', () => {
    const item = parseFeedbackItem('- [x] Done #validation | rejected');
    assert.equal(item.state, 'rejected');
    assert.equal(item.resolved, false);
  });
  it('extracts multiple tags', () => {
    const item = parseFeedbackItem('- [ ] Issue #validation #law:brevity');
    assert.deepEqual(item.tags, ['#validation', '#law:brevity']);
  });
  it('handles unknown checkbox state', () => {
    const item = parseFeedbackItem('- [?] Weird state #hitl');
    assert.equal(item.state, 'unknown');
  });
});

describe('parseArtefactsTable', () => {
  it('parses a markdown table', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| src/main.ts | code | build | draft |',
      '| README.md | docs | build | done |',
    ].join('\n');
    const arts = parseArtefactsTable(text);
    assert.equal(arts.length, 2);
    assert.deepEqual(arts[0], { file: 'src/main.ts', type: 'code', cycle: 'build', status: 'draft' });
    assert.deepEqual(arts[1], { file: 'README.md', type: 'docs', cycle: 'build', status: 'done' });
  });
  it('returns empty for no table', () => {
    assert.deepEqual(parseArtefactsTable('no table here'), []);
  });
  it('stops parsing when table ends', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| a.ts | code | c1 | draft |',
      '',
      'Some other text',
      '| not | a | table | row |',
    ].join('\n');
    const arts = parseArtefactsTable(text);
    assert.equal(arts.length, 1);
  });

});

describe('parseFeedback', () => {
  const artefacts = [
    { file: 'src/main.ts', type: 'code', cycle: 'build', status: 'draft' },
  ];

  it('parses feedback items under matching file heading', () => {
    const text = [
      '# Feedback',
      '## src/main.ts',
      '- [ ] Fix error handling #validation',
      '- [x] Add types #law:types',
    ].join('\n');
    const items = parseFeedback(text, 'build', artefacts);
    assert.equal(items.length, 2);
    assert.equal(items[0].state, 'open');
    assert.equal(items[1].state, 'actioned');
  });

  it('ignores feedback for non-cycle files', () => {
    const text = [
      '# Feedback',
      '## other-file.ts',
      '- [ ] Should be ignored #validation',
    ].join('\n');
    const items = parseFeedback(text, 'build', artefacts);
    assert.equal(items.length, 0);
  });

  it('stops at next top-level heading', () => {
    const text = [
      '# Feedback',
      '## src/main.ts',
      '- [ ] Included #validation',
      '# Other Section',
      '## src/main.ts',
      '- [ ] Excluded #validation',
    ].join('\n');
    const items = parseFeedback(text, 'build', artefacts);
    assert.equal(items.length, 1);
  });

  it('returns empty when no Feedback section', () => {
    const items = parseFeedback('# Something else\n- [ ] Nope', 'build', artefacts);
    assert.equal(items.length, 0);
  });

  it('parses feedback under h2 Feedback heading', () => {
    const text = [
      '## Feedback',
      '### src/main.ts',
      '- [ ] Fix error handling #validation',
      '- [x] Add types #law:types',
    ].join('\n');
    const items = parseFeedback(text, 'build', artefacts);
    assert.equal(items.length, 2);
    assert.equal(items[0].state, 'open');
    assert.equal(items[1].state, 'actioned');
  });

  it('stops h2 Feedback at next h2 heading', () => {
    const text = [
      '## Feedback',
      '### src/main.ts',
      '- [ ] Included #validation',
      '## Other Section',
      '### src/main.ts',
      '- [ ] Excluded #validation',
    ].join('\n');
    const items = parseFeedback(text, 'build', artefacts);
    assert.equal(items.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Routing logic
// ---------------------------------------------------------------------------

describe('determineRoute', () => {
  const stages = ['forge:write', 'quench:review', 'appraise:check'];

  it('returns first stage when no history', () => {
    assert.equal(determineRoute(stages, [], [], 3), 'forge:write');
  });

  it('advances after forge', () => {
    const history = [{ stage: 'forge:write', cycle: 'c1' }];
    assert.equal(determineRoute(stages, history, [], 3), 'quench:review');
  });

  it('advances after hitl', () => {
    const stagesWithHitl = ['forge:write', 'hitl:human', 'quench:review'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'hitl:human', cycle: 'c1' },
    ];
    assert.equal(determineRoute(stagesWithHitl, history, [], 3), 'quench:review');
  });

  it('returns done when forge is last stage and completes', () => {
    const history = [{ stage: 'forge:write', cycle: 'c1' }];
    assert.equal(determineRoute(['forge:write'], history, [], 3), 'done');
  });

  it('skips sort entries in history', () => {
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'sort', cycle: 'c1' },
    ];
    assert.equal(determineRoute(stages, history, [], 3), 'quench:review');
  });

  it('returns blocked for unknown last stage base', () => {
    const history = [{ stage: 'unknown:thing', cycle: 'c1' }];
    assert.equal(determineRoute(stages, history, [], 3), 'blocked');
  });
});

describe('nextAfterQuench', () => {
  const stages = ['forge:write', 'quench:review', 'appraise:check'];

  it('loops back to forge on open feedback', () => {
    const feedback = [{ state: 'open' }];
    assert.equal(nextAfterQuench(stages, 'quench:review', feedback, 0, 3), 'forge:write');
  });

  it('loops back to forge on rejected feedback', () => {
    const feedback = [{ state: 'rejected' }];
    assert.equal(nextAfterQuench(stages, 'quench:review', feedback, 0, 3), 'forge:write');
  });

  it('blocks when max iterations reached with open feedback', () => {
    const feedback = [{ state: 'open' }];
    assert.equal(nextAfterQuench(stages, 'quench:review', feedback, 3, 3), 'blocked');
  });

  it('advances when all feedback resolved', () => {
    const feedback = [{ state: 'actioned', resolved: true }];
    assert.equal(nextAfterQuench(stages, 'quench:review', feedback, 1, 3), 'appraise:check');
  });

  it('returns done at end of route with resolved feedback', () => {
    const feedback = [{ state: 'actioned', resolved: true }];
    assert.equal(nextAfterQuench(['forge:write', 'quench:review'], 'quench:review', feedback, 1, 3), 'done');
  });
});

describe('nextAfterAppraise', () => {
  const stages = ['forge:write', 'quench:review', 'appraise:check'];

  it('loops back to forge on open feedback', () => {
    const feedback = [{ state: 'open' }];
    assert.equal(nextAfterAppraise(stages, feedback, 0, 3), 'forge:write');
  });

  it('blocks when max iterations reached', () => {
    const feedback = [{ state: 'open' }];
    assert.equal(nextAfterAppraise(stages, feedback, 3, 3), 'blocked');
  });

  it('loops back to appraise when actioned but not approved', () => {
    const feedback = [{ state: 'actioned', resolved: false }];
    assert.equal(nextAfterAppraise(stages, feedback, 1, 3), 'appraise:check');
  });

  it('loops back to appraise when wont-fix but not approved', () => {
    const feedback = [{ state: 'wont-fix', resolved: false }];
    assert.equal(nextAfterAppraise(stages, feedback, 1, 3), 'appraise:check');
  });

  it('returns done when all resolved', () => {
    const feedback = [{ state: 'actioned', resolved: true }];
    assert.equal(nextAfterAppraise(stages, feedback, 1, 3), 'done');
  });

  it('returns done with empty feedback', () => {
    assert.equal(nextAfterAppraise(stages, [], 1, 3), 'done');
  });
});

// ---------------------------------------------------------------------------
// globMatch
// ---------------------------------------------------------------------------

describe('globMatch', () => {
  it('matches exact path', () => {
    assert.equal(globMatch('WORK.md', 'WORK.md'), true);
  });
  it('matches wildcard', () => {
    assert.equal(globMatch('src/main.ts', 'src/*.ts'), true);
  });
  it('matches globstar', () => {
    assert.equal(globMatch('src/deep/nested/file.ts', 'src/**/*.ts'), true);
  });
  it('rejects non-match', () => {
    assert.equal(globMatch('src/main.js', 'src/*.ts'), false);
  });
});

// ---------------------------------------------------------------------------
// I/O-dependent functions (with mock io)
// ---------------------------------------------------------------------------

describe('loadHistory', () => {
  it('returns empty when file does not exist', () => {
    const io = { exists: () => false, readFile: () => { throw new Error('should not read'); } };
    assert.deepEqual(loadHistory('missing.yaml', 'c1', io), []);
  });

  it('parses YAML and filters by cycle', () => {
    const yamlContent = [
      '- stage: forge:write',
      '  cycle: c1',
      '- stage: quench:review',
      '  cycle: c2',
      '- stage: appraise:check',
      '  cycle: c1',
    ].join('\n');
    const io = { exists: () => true, readFile: () => yamlContent };
    const result = loadHistory('history.yaml', 'c1', io);
    assert.equal(result.length, 2);
    assert.equal(result[0].stage, 'forge:write');
    assert.equal(result[1].stage, 'appraise:check');
  });

  it('returns empty for empty file', () => {
    const io = { exists: () => true, readFile: () => '' };
    assert.deepEqual(loadHistory('history.yaml', 'c1', io), []);
  });
});

describe('getModifiedFiles', () => {
  it('finds sort commit and diffs from it', () => {
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) {
          return 'abc1234 some commit\ndef5678 [c1] sort: forge:write\nghi9012 older';
        }
        if (cmd.startsWith('git diff')) {
          // Sort commit is 2nd line: commitCount starts at 1, +1 for line 1, +1 for line 2 (match) = 3
          assert.ok(cmd.includes('HEAD~3'), `expected HEAD~3 but got: ${cmd}`);
          return 'src/main.ts\nWORK.md\n';
        }
        throw new Error(`unexpected cmd: ${cmd}`);
      },
    };
    const result = getModifiedFiles('c1', io);
    assert.deepEqual(result, ['src/main.ts', 'WORK.md']);
  });

  it('falls back to HEAD~1 when no sort commit found', () => {
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) {
          return 'abc1234 some commit\ndef5678 another commit';
        }
        if (cmd.startsWith('git diff')) {
          assert.ok(cmd.includes('HEAD~1'));
          return 'src/main.ts\n';
        }
        throw new Error(`unexpected cmd: ${cmd}`);
      },
    };
    const result = getModifiedFiles('c1', io);
    assert.deepEqual(result, ['src/main.ts']);
  });

  it('returns empty on exec error', () => {
    const io = { exec: () => { throw new Error('git failed'); } };
    assert.deepEqual(getModifiedFiles('c1', io), []);
  });
});

describe('getAllowedPatterns', () => {
  it('returns only always-allowed for non-forge stages', () => {
    const io = { readFile: () => { throw new Error('should not read'); }, exists: () => true };
    assert.deepEqual(getAllowedPatterns('quench', 'foundry', 'foundry/cycles/c1.md', io), ['WORK.md', 'WORK.history.yaml']);
  });

  it('adds artefact file-patterns for forge stage', () => {
    const files = {
      'foundry/cycles/c1.md': '---\noutput: haiku\n---\n',
      'foundry/artefacts/haiku/definition.md': '---\nfile-patterns:\n  - "src/**/*.ts"\n  - "src/**/*.tsx"\n---\n',
    };
    const io = {
      readFile: (p) => { if (files[p]) return files[p]; throw new Error(`not found: ${p}`); },
      exists: (p) => !!files[p],
    };
    const result = getAllowedPatterns('forge', 'foundry', 'foundry/cycles/c1.md', io);
    assert.deepEqual(result, ['WORK.md', 'WORK.history.yaml', 'src/**/*.ts', 'src/**/*.tsx']);
  });

  it('returns always-allowed when cycle def has no output', () => {
    const io = {
      readFile: () => '---\nstages:\n  - forge:a\n---\n',
      exists: () => true,
    };
    assert.deepEqual(getAllowedPatterns('forge', 'foundry', 'foundry/cycles/c1.md', io), ['WORK.md', 'WORK.history.yaml']);
  });

  it('returns always-allowed when artefact def missing', () => {
    const io = {
      readFile: (p) => {
        if (p === 'foundry/cycles/c1.md') return '---\noutput: haiku\n---\n';
        throw new Error('not found');
      },
      exists: (p) => p === 'foundry/cycles/c1.md',
    };
    assert.deepEqual(getAllowedPatterns('forge', 'foundry', 'foundry/cycles/c1.md', io), ['WORK.md', 'WORK.history.yaml']);
  });
});

describe('checkModifiedFiles', () => {
  it('returns ok when no files modified', () => {
    const io = { exec: () => { throw new Error('no commits'); }, readFile: () => '', exists: () => false };
    const result = checkModifiedFiles('forge', 'foundry', 'foundry/cycles/c1.md', 'c1', io);
    assert.deepEqual(result, { ok: true, violations: [] });
  });

  it('detects violations for disallowed files', () => {
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) return 'abc [c1] sort: forge:write';
        if (cmd.startsWith('git diff')) return 'WORK.md\nsrc/main.ts\npackage.json\n';
        return '';
      },
      readFile: () => '---\nstages:\n  - forge:a\n---\n',
      exists: () => true,
    };
    // Non-forge stage: only WORK.md + WORK.history.yaml allowed
    const result = checkModifiedFiles('quench', 'foundry', 'foundry/cycles/c1.md', 'c1', io);
    assert.equal(result.ok, false);
    assert.deepEqual(result.violations, ['src/main.ts', 'package.json']);
  });

  it('passes when all files match allowed patterns', () => {
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) return 'abc [c1] sort: forge:write';
        if (cmd.startsWith('git diff')) return 'WORK.md\nWORK.history.yaml\n';
        return '';
      },
      readFile: () => '',
      exists: () => true,
    };
    const result = checkModifiedFiles('quench', 'foundry', 'foundry/cycles/c1.md', 'c1', io);
    assert.deepEqual(result, { ok: true, violations: [] });
  });
});
