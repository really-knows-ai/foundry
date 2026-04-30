import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { makeMockIO } from './helpers/mock-io.js';
import {
  baseStage,
  findFirst,
  nextInRoute,
  parseFrontmatter,
  parseArtefactsTable,
  determineRoute,
  nextAfterQuench,
  nextAfterAppraise,
  globMatch,
  loadHistory,
  getModifiedFiles,
  getAllowedPatterns,
  checkModifiedFiles,
  getDirtyToolManagedFiles,
  runSort,
} from '../scripts/sort.js';

// ---------------------------------------------------------------------------
// Test helpers — feedback-store fixtures
// ---------------------------------------------------------------------------

const makeSortIO = makeMockIO;

function makeWorkMd(options = {}) {
  const cycle = Object.prototype.hasOwnProperty.call(options, 'cycle') ? options.cycle : 'c1';
  const stages = options.stages || ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
  const maxIterations = Object.prototype.hasOwnProperty.call(options, 'maxIterations') ? options.maxIterations : 100;
  const deadlockIterations = Object.prototype.hasOwnProperty.call(options, 'deadlockIterations') ? options.deadlockIterations : 5;
  const lines = [
    '---',
    `cycle: ${cycle}`,
    'stages:',
    ...stages.map(stage => `  - ${stage}`),
  ];
  if (maxIterations !== undefined) lines.push(`max-iterations: ${maxIterations}`);
  if (deadlockIterations !== undefined) lines.push(`deadlock-iterations: ${deadlockIterations}`);
  if (options.deadlockAppraise !== undefined) lines.push(`deadlock-appraise: ${options.deadlockAppraise}`);
  lines.push('---', '');
  return lines.join('\n');
}

// Build a WORK.feedback.yaml string with N items. Each item's history[0] is
// the current state; tests can set the history array directly to control depth.
function makeFeedbackYaml(items) {
  return yaml.dump({
    items: items.map((it, i) => ({
      id: `EXJ${String(i).padStart(23, '0')}`,
      file: it.file || 'a.md',
      tag: it.tag || 'law:x',
      text: it.text || `item-${i}`,
      source: it.source || 'appraise:w',
      history: it.history || [
        { state: 'open', stage: 'appraise:w', cycle: it.cycle || 'c1', timestamp: '2026-04-24T10:00:00.000Z' },
      ],
    })),
  });
}

describe('makeFeedbackYaml', () => {
  it('builds deterministic 26-character Crockford-legal fixture IDs', () => {
    const feedback = yaml.load(makeFeedbackYaml([{}, {}]));

    assert.deepEqual(feedback.items.map(item => item.id), [
      'EXJ00000000000000000000000',
      'EXJ00000000000000000000001',
    ]);
    for (const item of feedback.items) {
      assert.equal(item.id.length, 26);
      assert.match(item.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });
});

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

  it('routes to human-appraise after appraise when enabled', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'quench:review', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    assert.equal(determineRoute(stages, history, [], 3), 'human-appraise:review');
  });

  it('advances to done after human-appraise', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'quench:review', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'human-appraise:review', cycle: 'c1' },
    ];
    assert.equal(determineRoute(stages, history, [], 3), 'done');
  });

  it('loops back to forge when human-appraise adds feedback', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'quench:review', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'human-appraise:review', cycle: 'c1' },
    ];
    const feedback = [{ state: 'open', tag: 'human' }];
    assert.equal(determineRoute(stages, history, feedback, 3), 'forge:write');
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
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 0, 3), 'forge:write');
  });

  it('blocks when max iterations reached', () => {
    const feedback = [{ state: 'open' }];
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 3, 3), 'blocked');
  });

  it('loops back to appraise when actioned but not approved', () => {
    const feedback = [{ state: 'actioned', resolved: false }];
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 1, 3), 'appraise:check');
  });

  it('loops back to appraise when wont-fix but not approved', () => {
    const feedback = [{ state: 'wont-fix', resolved: false }];
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 1, 3), 'appraise:check');
  });

  it('returns done when all resolved', () => {
    const feedback = [{ state: 'resolved' }];
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 1, 3), 'done');
  });

  it('returns done with empty feedback', () => {
    assert.equal(nextAfterAppraise(stages, 'appraise:check', [], 1, 3), 'done');
  });

  it('advances to next stage when all feedback resolved', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
    const feedback = [{ state: 'resolved' }];
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 0, 3), 'human-appraise:review');
  });

  it('returns done when appraise is last stage and all resolved', () => {
    const stages = ['forge:write', 'quench:review', 'appraise:check'];
    const feedback = [{ state: 'resolved' }];
    assert.equal(nextAfterAppraise(stages, 'appraise:check', feedback, 0, 3), 'done');
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

  it('sorts entries by timestamp ascending regardless of file order', () => {
    const yamlContent = [
      '- stage: quench:review',
      '  cycle: c1',
      '  timestamp: "2026-01-01T00:02:00Z"',
      '- stage: forge:write',
      '  cycle: c1',
      '  timestamp: "2026-01-01T00:01:00Z"',
    ].join('\n');
    const io = { exists: () => true, readFile: () => yamlContent };
    const result = loadHistory('history.yaml', 'c1', io);
    assert.equal(result.length, 2);
    assert.equal(result[0].stage, 'forge:write');
    assert.equal(result[1].stage, 'quench:review');
  });
});

describe('getModifiedFiles', () => {
  // Boundary semantics: diff is from the matching sort commit's SHA to HEAD,
  // exclusive of the sort commit itself. This captures every file changed by
  // any stage commit made AFTER the last sort invocation.

  it('returns empty when sort commit is HEAD (no stage commits since last sort)', () => {
    const diffArgs = [];
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) {
          return 'abc1234 [c1] sort: forge:write\ndef5678 older commit';
        }
        if (cmd.startsWith('git diff')) {
          diffArgs.push(cmd);
          // diff from sort SHA (HEAD) to HEAD is empty
          return '';
        }
        throw new Error(`unexpected cmd: ${cmd}`);
      },
    };
    const result = getModifiedFiles('c1', io);
    assert.deepEqual(result, []);
    assert.equal(diffArgs.length, 1);
    assert.ok(diffArgs[0].includes('abc1234'), `expected diff to use sort SHA abc1234, got: ${diffArgs[0]}`);
    assert.ok(diffArgs[0].includes('--no-renames'), `expected --no-renames, got: ${diffArgs[0]}`);
  });

  it('diffs from sort commit SHA to HEAD when sort commit is HEAD~1 (one stage commit after)', () => {
    const diffArgs = [];
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) {
          return 'aaa1111 forge stage commit\nbbb2222 [c1] sort: forge:write\nccc3333 older';
        }
        if (cmd.startsWith('git diff')) {
          diffArgs.push(cmd);
          return 'src/main.ts\nWORK.md\n';
        }
        throw new Error(`unexpected cmd: ${cmd}`);
      },
    };
    const result = getModifiedFiles('c1', io);
    assert.deepEqual(result, ['src/main.ts', 'WORK.md']);
    assert.ok(diffArgs[0].includes('bbb2222'), `expected sort SHA bbb2222 in diff, got: ${diffArgs[0]}`);
    // Must NOT use the parent of the sort commit — that would include the sort commit's own changes
    assert.ok(!diffArgs[0].includes('HEAD~'), `expected SHA-based diff, not HEAD~ relative, got: ${diffArgs[0]}`);
  });

  it('diffs from sort commit SHA across multiple intervening stage commits', () => {
    const diffArgs = [];
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) {
          return [
            'aaa1111 appraise commit',
            'bbb2222 quench commit',
            'ccc3333 forge commit',
            'ddd4444 [c1] sort: forge:write',
            'eee5555 older',
          ].join('\n');
        }
        if (cmd.startsWith('git diff')) {
          diffArgs.push(cmd);
          return 'src/a.ts\nsrc/b.ts\nWORK.md\n';
        }
        throw new Error(`unexpected cmd: ${cmd}`);
      },
    };
    const result = getModifiedFiles('c1', io);
    assert.deepEqual(result, ['src/a.ts', 'src/b.ts', 'WORK.md']);
    assert.ok(diffArgs[0].includes('ddd4444'), `expected sort SHA ddd4444, got: ${diffArgs[0]}`);
  });

  it('returns empty when no matching sort commit is found in recent history', () => {
    // Graceful behaviour: if we cannot identify a base, we return [] rather
    // than diffing against an arbitrary depth (which risked false violations).
    let diffCalled = false;
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) {
          return 'aaa1111 some commit\nbbb2222 another commit';
        }
        if (cmd.startsWith('git diff')) {
          diffCalled = true;
          return 'src/main.ts\n';
        }
        throw new Error(`unexpected cmd: ${cmd}`);
      },
    };
    const result = getModifiedFiles('c1', io);
    assert.deepEqual(result, []);
    assert.equal(diffCalled, false, 'should not diff when no sort commit is found');
  });

  it('finds sort commit deeper in history with several stage commits after it', () => {
    const diffArgs = [];
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) {
          const lines = [];
          for (let i = 0; i < 10; i++) lines.push(`hash${i.toString().padStart(4, '0')} stage commit ${i}`);
          lines.push('sortsha1 [c1] sort: forge:write');
          lines.push('older123 older');
          return lines.join('\n');
        }
        if (cmd.startsWith('git diff')) {
          diffArgs.push(cmd);
          return 'src/x.ts\n';
        }
        throw new Error(`unexpected cmd: ${cmd}`);
      },
    };
    const result = getModifiedFiles('c1', io);
    assert.deepEqual(result, ['src/x.ts']);
    assert.ok(diffArgs[0].includes('sortsha1'), `expected sort SHA sortsha1, got: ${diffArgs[0]}`);
  });

  it('only matches sort commits for the requested cycle', () => {
    // A sort commit for a different cycle must not be picked up as the base.
    const diffArgs = [];
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) {
          return [
            'aaa1111 forge work',
            'bbb2222 [c2] sort: forge:write', // wrong cycle — must be ignored
            'ccc3333 [c1] sort: forge:write',
            'ddd4444 older',
          ].join('\n');
        }
        if (cmd.startsWith('git diff')) {
          diffArgs.push(cmd);
          return 'src/main.ts\n';
        }
        throw new Error(`unexpected cmd: ${cmd}`);
      },
    };
    const result = getModifiedFiles('c1', io);
    assert.deepEqual(result, ['src/main.ts']);
    assert.ok(diffArgs[0].includes('ccc3333'), `expected c1 sort SHA ccc3333, got: ${diffArgs[0]}`);
  });

  it('returns empty on exec error (e.g. shallow history with no commits)', () => {
    const io = { exec: () => { throw new Error('git failed'); } };
    assert.deepEqual(getModifiedFiles('c1', io), []);
  });
});

describe('getAllowedPatterns', () => {
  const alwaysAllowed = ['WORK.md', 'WORK.feedback.yaml', 'WORK.history.yaml'];

  it('returns only always-allowed for non-forge stages', () => {
    const io = { readFile: () => { throw new Error('should not read'); }, exists: () => true };
    assert.deepEqual(getAllowedPatterns('quench', 'foundry', 'foundry/cycles/c1.md', io), alwaysAllowed);
  });

  it('allows foundry-memory/** and .foundry/** for assay stage (post-Phase 2 relations relocation)', () => {
    const io = { readFile: () => { throw new Error('should not read'); }, exists: () => true };
    const result = getAllowedPatterns('assay', 'foundry', 'foundry/cycles/c1.md', io);
    assert.deepEqual(result, [...alwaysAllowed, '.foundry/**', 'foundry-memory/**']);
  });

  it('adds artefact file-patterns for forge stage', () => {
    const files = {
      'foundry/cycles/c1.md': '---\noutput-type: haiku\n---\n',
      'foundry/artefacts/haiku/definition.md': '---\nfile-patterns:\n  - "src/**/*.ts"\n  - "src/**/*.tsx"\n---\n',
    };
    const io = {
      readFile: (p) => { if (files[p]) return files[p]; throw new Error(`not found: ${p}`); },
      exists: (p) => !!files[p],
    };
    const result = getAllowedPatterns('forge', 'foundry', 'foundry/cycles/c1.md', io);
    assert.deepEqual(result, [...alwaysAllowed, 'src/**/*.ts', 'src/**/*.tsx']);
  });

  it('returns always-allowed when cycle def has no output', () => {
    const io = {
      readFile: () => '---\nstages:\n  - forge:a\n---\n',
      exists: () => true,
    };
    assert.deepEqual(getAllowedPatterns('forge', 'foundry', 'foundry/cycles/c1.md', io), alwaysAllowed);
  });

  it('returns always-allowed when artefact def missing', () => {
    const io = {
      readFile: (p) => {
        if (p === 'foundry/cycles/c1.md') return '---\noutput-type: haiku\n---\n';
        throw new Error('not found');
      },
      exists: (p) => p === 'foundry/cycles/c1.md',
    };
    assert.deepEqual(getAllowedPatterns('forge', 'foundry', 'foundry/cycles/c1.md', io), alwaysAllowed);
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
    // Non-forge stage: only always-allowed workfiles are permitted.
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

  it('allows WORK.feedback.yaml changes from feedback-writing stages', () => {
    const io = {
      exec: (cmd) => {
        if (cmd.startsWith('git log')) return 'abc [c1] sort: appraise:check';
        if (cmd.startsWith('git diff')) return 'WORK.feedback.yaml\n';
        return '';
      },
      readFile: () => '',
      exists: () => true,
    };
    const result = checkModifiedFiles('appraise', 'foundry', 'foundry/cycles/c1.md', 'c1', io);
    assert.deepEqual(result, { ok: true, violations: [] });
  });
});

describe('getDirtyToolManagedFiles', () => {
  it('detects dirty WORK.feedback.yaml as tool-managed state', () => {
    const io = {
      exec: (cmd) => cmd.includes('WORK.feedback.yaml') ? ' M WORK.feedback.yaml\n' : '',
    };
    assert.deepEqual(getDirtyToolManagedFiles(io), ['WORK.feedback.yaml']);
  });
});

// ---------------------------------------------------------------------------
// runSort
// ---------------------------------------------------------------------------

describe('runSort', () => {
  it('returns route for fresh cycle', () => {
    const workText = [
      '---',
      'cycle: c1',
      'stages:',
      '  - forge:write',
      '  - quench:review',
      '---',
      '',
    ].join('\n');
    const io = {
      exists: (p) => p === 'WORK.md',
      readFile: (p) => {
        if (p === 'WORK.md') return workText;
        throw new Error(`unexpected read: ${p}`);
      },
      exec: () => '',
    };
    const result = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(result.route, 'forge:write');
  });

  it('returns blocked when WORK.md not found', () => {
    const io = { exists: () => false, readFile: () => '', exec: () => '' };
    const result = runSort({}, io);
    assert.equal(result.route, 'blocked');
    assert.ok(result.details.includes('not found'));
  });

  it('returns blocked when no cycle in frontmatter', () => {
    const io = {
      exists: () => true,
      readFile: () => '---\nstages:\n  - forge:a\n---\n',
      exec: () => '',
    };
    const result = runSort({}, io);
    assert.equal(result.route, 'blocked');
  });

  // -------------------------------------------------------------------------
  // Model resolution + fail-fast on missing subagent
  // -------------------------------------------------------------------------

  const workWithModels = (modelsYaml) => [
    '---',
    'cycle: c1',
    'stages:',
    '  - forge:write',
    '  - quench:review',
    'models:',
    ...modelsYaml,
    '---',
    '',
  ].join('\n');

  it('resolves model slug replacing both / and . with -', () => {
    const workText = workWithModels(['  forge: github-copilot/claude-sonnet-4.6']);
    const io = {
      exists: (p) => {
        if (p === 'WORK.md') return true;
        if (p === '.opencode/agents/foundry-github-copilot-claude-sonnet-4-6.md') return true;
        return false;
      },
      readFile: (p) => {
        if (p === 'WORK.md') return workText;
        throw new Error(`unexpected read: ${p}`);
      },
      exec: () => '',
    };
    const result = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(result.route, 'forge:write');
    assert.equal(result.model, 'foundry-github-copilot-claude-sonnet-4-6');
  });

  it('resolves model slug for model without dots', () => {
    const workText = workWithModels(['  forge: opencode/claude-sonnet-4']);
    const io = {
      exists: (p) => {
        if (p === 'WORK.md') return true;
        if (p === '.opencode/agents/foundry-opencode-claude-sonnet-4.md') return true;
        return false;
      },
      readFile: () => workText,
      exec: () => '',
    };
    const result = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(result.route, 'forge:write');
    assert.equal(result.model, 'foundry-opencode-claude-sonnet-4');
  });

  it('returns violation when required subagent file is missing', () => {
    const workText = workWithModels(['  forge: github-copilot/claude-sonnet-4.6']);
    const io = {
      exists: (p) => p === 'WORK.md',
      readFile: () => workText,
      exec: () => '',
    };
    const result = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(result.route, 'violation');
    assert.match(result.details, /missing required subagent/i);
    assert.match(result.details, /foundry-github-copilot-claude-sonnet-4-6\.md/);
  });

  it('respects custom agentsDir option for fail-fast check', () => {
    const workText = workWithModels(['  forge: opencode/claude-sonnet-4']);
    const io = {
      exists: (p) => {
        if (p === 'WORK.md') return true;
        if (p === 'custom/agents/foundry-opencode-claude-sonnet-4.md') return true;
        return false;
      },
      readFile: () => workText,
      exec: () => '',
    };
    const result = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml', agentsDir: 'custom/agents' }, io);
    assert.equal(result.route, 'forge:write');
    assert.equal(result.model, 'foundry-opencode-claude-sonnet-4');
  });

  it('does not fail-fast when cycle has no models map', () => {
    const workText = [
      '---',
      'cycle: c1',
      'stages:',
      '  - forge:write',
      '---',
      '',
    ].join('\n');
    const io = {
      exists: (p) => p === 'WORK.md',
      readFile: () => workText,
      exec: () => '',
    };
    const result = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(result.route, 'forge:write');
    assert.equal(result.model, undefined);
  });

  it('does not fail-fast when models map has no entry for current stage base', () => {
    const workText = workWithModels(['  quench: opencode/claude-sonnet-4']);
    const io = {
      exists: (p) => p === 'WORK.md',
      readFile: () => workText,
      exec: () => '',
    };
    // Fresh cycle routes to forge:write, but models map only defines quench
    const result = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(result.route, 'forge:write');
    assert.equal(result.model, undefined);
  });
});

describe('runSort token minting', () => {
  const workText = [
    '---',
    'cycle: c1',
    'stages:',
    '  - forge:write',
    '  - quench:review',
    '---',
    '',
  ].join('\n');
  const io = {
    exists: (p) => p === 'WORK.md',
    readFile: () => workText,
    exec: () => '',
  };

  it('calls mint and returns token for dispatchable route', () => {
    const seen = [];
    const res = runSort({
      workPath: 'WORK.md', historyPath: 'history.yaml',
      mint: (p) => { seen.push(p); return 'TOKEN'; },
      now: 1_000_000,
    }, io);
    assert.equal(res.route, 'forge:write');
    assert.equal(res.token, 'TOKEN');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].route, 'forge:write');
    assert.equal(seen[0].cycle, 'c1');
    assert.equal(seen[0].exp, 1_000_000 + 10 * 60 * 1000);
  });

  it('omits token when mint not supplied', () => {
    const res = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(res.token, undefined);
  });

  it('does not call mint for non-dispatchable route (blocked)', () => {
    const mint = () => { throw new Error('should not be called'); };
    const ioNoWork = { exists: () => false, readFile: () => '', exec: () => '' };
    const res = runSort({ mint }, ioNoWork);
    assert.equal(res.route, 'blocked');
    assert.equal(res.token, undefined);
  });

  it('does not call mint for route=done', () => {
    const doneWork = [
      '---',
      'cycle: c1',
      'stages:',
      '  - forge:write',
      '---',
      '',
    ].join('\n');
    const historyYaml = '- { cycle: c1, stage: forge:write, iteration: 1, comment: x }\n';
    const doneIo = {
      exists: (p) => p === 'WORK.md' || p === 'history.yaml',
      readFile: (p) => p === 'WORK.md' ? doneWork : historyYaml,
      exec: () => '',
    };
    const mint = () => { throw new Error('should not be called'); };
    const res = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml', mint }, doneIo);
    assert.equal(res.route, 'done');
    assert.equal(res.token, undefined);
  });
});

describe('runSort micro-commit enforcement', () => {
  const workText = [
    '---',
    'cycle: c1',
    'stages:',
    '  - forge:write',
    '  - quench:review',
    '---',
    '',
  ].join('\n');

  function makeIo({ historyYaml = '', statusOutput = '' } = {}) {
    return {
      exists: (p) => p === 'WORK.md' || (p === 'history.yaml' && historyYaml !== ''),
      readFile: (p) => {
        if (p === 'WORK.md') return workText;
        if (p === 'history.yaml') return historyYaml;
        throw new Error(`unexpected read: ${p}`);
      },
      exec: (cmd) => {
        if (cmd.startsWith('git status --porcelain')) return statusOutput;
        if (cmd.startsWith('git log')) return '';
        if (cmd.startsWith('git diff')) return '';
        return '';
      },
    };
  }

  it('skips check when history is empty (first sort of cycle)', () => {
    const io = makeIo({ historyYaml: '', statusOutput: ' M WORK.md\n' });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(res.route, 'forge:write');
  });

  it('returns violation when tool-managed files are dirty and history has entries', () => {
    const historyYaml = '- { cycle: c1, stage: sort, iteration: 1, comment: x }\n';
    const io = makeIo({ historyYaml, statusOutput: ' M WORK.md\n' });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(res.route, 'violation');
    assert.match(res.details, /Uncommitted tool-managed files/);
    assert.match(res.details, /WORK\.md/);
    assert.match(res.details, /foundry_orchestrate/);
  });

  it('returns violation for untracked WORK.history.yaml', () => {
    const historyYaml = '- { cycle: c1, stage: sort, iteration: 1, comment: x }\n';
    const io = makeIo({ historyYaml, statusOutput: '?? WORK.history.yaml\n' });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(res.route, 'violation');
    assert.match(res.details, /WORK\.history\.yaml/);
  });

  it('returns violation for dirty .foundry/ state files', () => {
    const historyYaml = '- { cycle: c1, stage: sort, iteration: 1, comment: x }\n';
    const io = makeIo({ historyYaml, statusOutput: ' M .foundry/state.json\n' });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(res.route, 'violation');
    assert.match(res.details, /\.foundry\/state\.json/);
  });

  it('proceeds normally when tree is clean and history has entries', () => {
    const historyYaml = '- { cycle: c1, stage: sort, iteration: 1, comment: x }\n';
    const io = makeIo({ historyYaml, statusOutput: '' });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(res.route, 'forge:write');
  });

  it('treats git failure as clean (graceful degrade)', () => {
    const historyYaml = '- { cycle: c1, stage: sort, iteration: 1, comment: x }\n';
    const io = {
      exists: (p) => p === 'WORK.md' || p === 'history.yaml',
      readFile: (p) => (p === 'WORK.md' ? workText : historyYaml),
      exec: () => { throw new Error('git unavailable'); },
    };
    const res = runSort({ workPath: 'WORK.md', historyPath: 'history.yaml' }, io);
    assert.equal(res.route, 'forge:write');
  });
});

describe('determineRoute with assay', () => {
  const stages = ['assay:c', 'forge:c', 'quench:c', 'appraise:c'];

  it('dispatches assay as the first stage when no history exists', () => {
    const route = determineRoute(stages, [], [], 3);
    assert.equal(route, 'assay:c');
  });

  it('dispatches forge after assay completes', () => {
    const history = [{ stage: 'assay:c' }];
    const route = determineRoute(stages, history, [], 3);
    assert.equal(route, 'forge:c');
  });

  it('on a loop-back from appraise, skips assay and dispatches forge', () => {
    const history = [
      { stage: 'assay:c' },
      { stage: 'forge:c' },
      { stage: 'quench:c' },
      { stage: 'appraise:c' },
    ];
    const feedback = [{ state: 'rejected' }];
    const route = determineRoute(stages, history, feedback, 3);
    assert.equal(route, 'forge:c');
  });

  it('without any assay in stages, behaves exactly as before', () => {
    const base = ['forge:c', 'appraise:c'];
    assert.equal(determineRoute(base, [], [], 3), 'forge:c');
  });
});

// ---------------------------------------------------------------------------
// runSort — per-item deadlock (spec §6.1)
// ---------------------------------------------------------------------------

describe('runSort — per-item deadlock (spec §6.1)', () => {
  const stages = ['forge:write', 'quench:review', 'appraise:check', 'human-appraise:review'];
  const workText = makeWorkMd({ stages });

  // History showing many appraise rounds — under the OLD round-counting algorithm
  // this would trigger deadlock for any open item. Under the new per-item rule,
  // an item with shallow history is NOT deadlocked.
  const manyAppraiseRoundsHistory = yaml.dump([
    { stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:00:00Z' },
    { stage: 'quench:review', cycle: 'c1', timestamp: '2026-04-24T10:01:00Z' },
    { stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:02:00Z' },
    { stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:03:00Z' },
    { stage: 'quench:review', cycle: 'c1', timestamp: '2026-04-24T10:04:00Z' },
    { stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:05:00Z' },
    { stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:06:00Z' },
    { stage: 'quench:review', cycle: 'c1', timestamp: '2026-04-24T10:07:00Z' },
    { stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:08:00Z' },
    { stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:09:00Z' },
    { stage: 'quench:review', cycle: 'c1', timestamp: '2026-04-24T10:10:00Z' },
    { stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:11:00Z' },
    { stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:12:00Z' },
    { stage: 'quench:review', cycle: 'c1', timestamp: '2026-04-24T10:13:00Z' },
    { stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:14:00Z' },
  ]);

  it('brand-new open item is NOT deadlocked even when cycle iteration count is high', () => {
    // Item has depth=1, threshold=5 → not qualifying.
    const feedbackYaml = makeFeedbackYaml([
      {
        history: [
          { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:14:30Z' },
        ],
      },
    ]);
    const io = makeSortIO({
      'WORK.md': workText,
      'WORK.history.yaml': manyAppraiseRoundsHistory,
      'WORK.feedback.yaml': feedbackYaml,
    });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    // Last completed non-sort stage is appraise:check; with an open item,
    // routing should loop back to forge — NOT human-appraise.
    assert.equal(res.route, 'forge:write');

    // No deadlocked snapshot was written: item history depth is still 1.
    const after = yaml.load(io._get('WORK.feedback.yaml'));
    assert.equal(after.items[0].history.length, 1);
    assert.equal(after.items[0].history[0].state, 'open');
  });

  it('item whose own history depth >= threshold IS deadlocked and routes to human-appraise', () => {
    // Item has depth=5, threshold=5 → qualifies.
    const fiveStateHistory = [
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:14:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:11:00Z', reason: 'still bad' },
      { state: 'actioned', stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:09:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:05:00Z', reason: 'still bad' },
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:02:00Z' },
    ];
    const feedbackYaml = makeFeedbackYaml([{ history: fiveStateHistory }]);
    const io = makeSortIO({
      'WORK.md': workText,
      'WORK.history.yaml': manyAppraiseRoundsHistory,
      'WORK.feedback.yaml': feedbackYaml,
    });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    assert.equal(res.route, 'human-appraise:review');

    // A deadlocked snapshot was written — depth is now 6.
    const after = yaml.load(io._get('WORK.feedback.yaml'));
    assert.equal(after.items[0].history.length, 6);
    assert.equal(after.items[0].history[0].state, 'deadlocked');
    assert.equal(after.items[0].history[0].stage, 'sort');
    assert.equal(after.items[0].history[0].cycle, 'c1');
    assert.match(after.items[0].history[0].reason, /threshold=5/);
  });

  it('does not treat its own deadlock snapshot write as prior-stage dirty state', () => {
    const fiveStateHistory = [
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:14:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:11:00Z', reason: 'still bad' },
      { state: 'actioned', stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:09:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:05:00Z', reason: 'still bad' },
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:02:00Z' },
    ];
    const feedbackYaml = makeFeedbackYaml([{ history: fiveStateHistory }]);
    const io = makeSortIO({
      'WORK.md': workText,
      'WORK.history.yaml': manyAppraiseRoundsHistory,
      'WORK.feedback.yaml': feedbackYaml,
    });
    let feedbackWasWritten = false;
    const rename = io.rename;
    io.rename = (from, to) => {
      rename(from, to);
      if (to === 'WORK.feedback.yaml') feedbackWasWritten = true;
    };
    io.exec = (cmd) => {
      if (cmd.startsWith('git status --porcelain')) {
        return feedbackWasWritten ? ' M WORK.feedback.yaml\n' : '';
      }
      if (cmd.startsWith('git log')) return '';
      if (cmd.startsWith('git diff')) return '';
      return '';
    };

    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);

    assert.equal(res.route, 'human-appraise:review');
  });

  it('when deadlock-appraise: false, no snapshot is written and route is not forced', () => {
    const workTextDisabled = makeWorkMd({
      stages: ['forge:write', 'quench:review', 'appraise:check'],
      deadlockAppraise: false,
    });
    const fiveStateHistory = [
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:14:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:11:00Z', reason: 'still bad' },
      { state: 'actioned', stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:09:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:05:00Z', reason: 'still bad' },
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:02:00Z' },
    ];
    const feedbackYaml = makeFeedbackYaml([{ history: fiveStateHistory }]);
    const io = makeSortIO({
      'WORK.md': workTextDisabled,
      'WORK.history.yaml': manyAppraiseRoundsHistory,
      'WORK.feedback.yaml': feedbackYaml,
    });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    // No forced human-appraise route. Open item with last-completed=appraise → loop to forge.
    assert.notEqual(res.route, 'human-appraise:review');
    assert.notEqual(res.route, 'human-appraise:c1');

    // No snapshot was written.
    const after = yaml.load(io._get('WORK.feedback.yaml'));
    assert.equal(after.items[0].history.length, 5);
    assert.notEqual(after.items[0].history[0].state, 'deadlocked');
  });

  it('synthesizes human-appraise route from cycle when no human-appraise stage exists', () => {
    const workTextWithoutHumanStage = makeWorkMd({
      stages: ['forge:write', 'quench:review', 'appraise:check'],
      maxIterations: undefined,
    });
    const fiveStateHistory = [
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:14:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:11:00Z', reason: 'still bad' },
      { state: 'actioned', stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:09:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:05:00Z', reason: 'still bad' },
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:02:00Z' },
    ];
    const io = makeSortIO({
      'WORK.md': workTextWithoutHumanStage,
      'WORK.history.yaml': manyAppraiseRoundsHistory,
      'WORK.feedback.yaml': makeFeedbackYaml([{ history: fiveStateHistory }]),
    });

    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);

    assert.equal(res.route, 'human-appraise:c1');
  });

  it('blocks when deadlocked items remain after human-appraise', () => {
    const historyYaml = yaml.dump([
      { stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:00:00Z' },
      { stage: 'quench:review', cycle: 'c1', timestamp: '2026-04-24T10:01:00Z' },
      { stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:02:00Z' },
      { stage: 'human-appraise:review', cycle: 'c1', timestamp: '2026-04-24T10:03:00Z' },
    ]);
    const deadlockedHistory = [
      { state: 'deadlocked', stage: 'sort', cycle: 'c1', timestamp: '2026-04-24T10:03:30Z', reason: 'depth >= threshold=5' },
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:02:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:01:00Z', reason: 'still bad' },
      { state: 'actioned', stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:00:30Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:00:15Z', reason: 'still bad' },
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:00:00Z' },
    ];
    const io = makeSortIO({
      'WORK.md': workText,
      'WORK.history.yaml': historyYaml,
      'WORK.feedback.yaml': makeFeedbackYaml([{ history: deadlockedHistory }]),
    });

    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);

    assert.equal(res.route, 'blocked');
  });

  it('uses default deadlock threshold of 5 when frontmatter omits deadlock-iterations', () => {
    const workTextDefaultThreshold = makeWorkMd({ stages, deadlockIterations: undefined });
    const fourStateHistory = [
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:14:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:11:00Z', reason: 'still bad' },
      { state: 'actioned', stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:09:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:05:00Z', reason: 'still bad' },
    ];
    const fiveStateHistory = [
      ...fourStateHistory,
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:02:00Z' },
    ];
    const io = makeSortIO({
      'WORK.md': workTextDefaultThreshold,
      'WORK.history.yaml': manyAppraiseRoundsHistory,
      'WORK.feedback.yaml': makeFeedbackYaml([
        { file: 'a.md', history: fourStateHistory },
        { file: 'b.md', history: fiveStateHistory },
      ]),
    });

    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    const after = yaml.load(io._get('WORK.feedback.yaml'));

    assert.equal(res.route, 'human-appraise:review');
    assert.equal(after.items[0].history[0].state, 'open');
    assert.equal(after.items[1].history[0].state, 'deadlocked');
    assert.match(after.items[1].history[0].reason, /threshold=5/);
  });

  it('uses custom non-5 deadlock threshold from frontmatter', () => {
    const workTextCustomThreshold = makeWorkMd({ stages, deadlockIterations: 3 });
    const twoStateHistory = [
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:14:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T10:11:00Z', reason: 'still bad' },
    ];
    const threeStateHistory = [
      ...twoStateHistory,
      { state: 'actioned', stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:09:00Z' },
    ];
    const io = makeSortIO({
      'WORK.md': workTextCustomThreshold,
      'WORK.history.yaml': manyAppraiseRoundsHistory,
      'WORK.feedback.yaml': makeFeedbackYaml([
        { file: 'a.md', history: twoStateHistory },
        { file: 'b.md', history: threeStateHistory },
      ]),
    });

    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    const after = yaml.load(io._get('WORK.feedback.yaml'));

    assert.equal(res.route, 'human-appraise:review');
    assert.equal(after.items[0].history[0].state, 'open');
    assert.equal(after.items[1].history[0].state, 'deadlocked');
    assert.match(after.items[1].history[0].reason, /threshold=3/);
  });
});

// ---------------------------------------------------------------------------
// runSort — deadlock pass runs before routing (spec §6.1)
// ---------------------------------------------------------------------------

describe('runSort — deadlock pass runs before routing (spec §6.1)', () => {
  it('deadlock snapshot is written even when routing would have gone to quench', () => {
    // Stages: forge → quench → appraise. Last completed = forge → normal route is quench.
    // But a depth-5 item must override and route to human-appraise.
    const workText = makeWorkMd({ maxIterations: undefined });
    const historyYaml = yaml.dump([
      { stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T10:00:00Z' },
    ]);
    const fiveStateHistory = [
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T09:50:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T09:40:00Z', reason: 'r' },
      { state: 'actioned', stage: 'forge:write', cycle: 'c1', timestamp: '2026-04-24T09:30:00Z' },
      { state: 'rejected', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T09:20:00Z', reason: 'r' },
      { state: 'open', stage: 'appraise:check', cycle: 'c1', timestamp: '2026-04-24T09:10:00Z' },
    ];
    const feedbackYaml = makeFeedbackYaml([{ history: fiveStateHistory }]);
    const io = makeSortIO({
      'WORK.md': workText,
      'WORK.history.yaml': historyYaml,
      'WORK.feedback.yaml': feedbackYaml,
    });
    const res = runSort({ workPath: 'WORK.md', historyPath: 'WORK.history.yaml' }, io);
    // Deadlock pass overrides quench routing.
    assert.equal(res.route, 'human-appraise:review');

    // And the snapshot was written.
    const after = yaml.load(io._get('WORK.feedback.yaml'));
    assert.equal(after.items[0].history[0].state, 'deadlocked');
  });
});
