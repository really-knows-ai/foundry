// tests/scripts/run-appraise-ext.test.js
//
// Phase 08 coverage: partitionLawsByGroup, resolveGroupConfigs,
// recordToUnitId, buildCompletionCoverage, writeCoverageFile,
// and executeAppraise pipeline.
//
// Pure-function tests use direct imports. The pipeline test uses a
// temporary git repo with foundry fixture files and a mock client.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import {
  partitionLawsByGroup,
  resolveGroupConfigs,
  recordToUnitId,
  buildCompletionCoverage,
  writeCoverageFile,
} from '../../src/scripts/run-appraise.js';

// -------------------------------------------------------------------------
// partitionLawsByGroup
// -------------------------------------------------------------------------

describe('partitionLawsByGroup', () => {
  it('places laws without a group under "default"', () => {
    const laws = [
      { id: 'law-a', text: 'Law A' },
      { id: 'law-b', text: 'Law B' },
    ];
    const result = partitionLawsByGroup(laws);
    assert.equal(result.size, 1);
    assert.ok(result.has('default'));
    assert.equal(result.get('default').length, 2);
  });

  it('handles explicit group field', () => {
    const laws = [
      { id: 'law-a', text: 'Law A', group: 'security' },
      { id: 'law-b', text: 'Law B', group: 'default' },
    ];
    const result = partitionLawsByGroup(laws);
    assert.equal(result.size, 2);
    assert.ok(result.has('security'));
    assert.ok(result.has('default'));
    assert.equal(result.get('security').length, 1);
    assert.equal(result.get('default').length, 1);
  });

  it('handles null and undefined group as "default"', () => {
    const laws = [
      { id: 'law-a', text: 'Law A', group: null },
      { id: 'law-b', text: 'Law B' },
    ];
    const result = partitionLawsByGroup(laws);
    assert.equal(result.size, 1);
    assert.ok(result.has('default'));
    assert.equal(result.get('default').length, 2);
  });

  it('handles multiple groups', () => {
    const laws = [
      { id: 'l1', text: 'L1', group: 'g1' },
      { id: 'l2', text: 'L2', group: 'g2' },
      { id: 'l3', text: 'L3', group: 'g1' },
    ];
    const result = partitionLawsByGroup(laws);
    assert.equal(result.size, 2);
    assert.equal(result.get('g1').length, 2);
    assert.equal(result.get('g2').length, 1);
  });
});

// -------------------------------------------------------------------------
// resolveGroupConfigs
// -------------------------------------------------------------------------

describe('resolveGroupConfigs', () => {
  it('resolves configs for multiple groups and collects warnings', () => {
    const groupNames = ['default', 'security'];
    const flowGroups = {
      security: { mode: 'law-by-law', passes: 2, appraisers: ['alice', 'bob'] },
    };
    const typeAppraisers = null;
    const fullAppraiserPool = [{ id: 'alice' }, { id: 'bob' }, { id: 'charlie' }];

    const { configs, warnings } = resolveGroupConfigs(
      groupNames, flowGroups, typeAppraisers, fullAppraiserPool, 'code'
    );

    assert.equal(configs.size, 2);

    const defaultConfig = configs.get('default');
    assert.equal(defaultConfig.mode, 'bundle');
    assert.equal(defaultConfig.passes, 1);
    assert.equal(defaultConfig.appraisers.length, 3);

    const securityConfig = configs.get('security');
    assert.equal(securityConfig.mode, 'law-by-law');
    assert.equal(securityConfig.passes, 2);
    assert.equal(securityConfig.appraisers.length, 2);

    assert.deepEqual(warnings, []);
  });

  it('collects warnings from resolveGroupConfig', () => {
    const groupNames = ['default'];
    const flowGroups = {
      default: { appraisers: ['unknown-appraiser', 'alice'] },
    };
    const typeAppraisers = null;
    const fullAppraiserPool = [{ id: 'alice' }];

    const { configs, warnings } = resolveGroupConfigs(
      groupNames, flowGroups, typeAppraisers, fullAppraiserPool, 'code'
    );

    assert.equal(configs.size, 1);
    assert.ok(warnings.length > 0);
    assert.ok(warnings[0].includes('unknown-appraiser'));
  });
});

// -------------------------------------------------------------------------
// recordToUnitId
// -------------------------------------------------------------------------

describe('recordToUnitId', () => {
  const mockUnitsByGroup = new Map();

  before(() => {
    mockUnitsByGroup.set('security', [
      { unitId: 'security::bundle::0', mode: 'bundle', group: 'security', lawIds: ['law-a', 'law-b'] },
    ]);
    mockUnitsByGroup.set('performance', [
      { unitId: 'performance::law-by-law::0', mode: 'law-by-law', group: 'performance', lawIds: ['perf-a'] },
      { unitId: 'performance::law-by-law::1', mode: 'law-by-law', group: 'performance', lawIds: ['perf-b'] },
    ]);
  });

  it('maps bundle-mode violations to the single bundle unit', () => {
    const result = recordToUnitId({ group: 'security', law: 'law-a' }, mockUnitsByGroup);
    assert.equal(result, 'security::bundle::0');
  });

  it('maps law-by-law mode violations to the correct per-law unit', () => {
    const result = recordToUnitId({ group: 'performance', law: 'perf-a' }, mockUnitsByGroup);
    assert.equal(result, 'performance::law-by-law::0');
  });

  it('returns undefined for unknown group', () => {
    const result = recordToUnitId({ group: 'nonexistent', law: 'law-a' }, mockUnitsByGroup);
    assert.equal(result, undefined);
  });

  it('returns undefined for unknown law in law-by-law mode', () => {
    const result = recordToUnitId({ group: 'performance', law: 'unknown-law' }, mockUnitsByGroup);
    assert.equal(result, undefined);
  });

  it('returns undefined when group has no units', () => {
    mockUnitsByGroup.set('empty-group', []);
    const result = recordToUnitId({ group: 'empty-group', law: 'law-a' }, mockUnitsByGroup);
    assert.equal(result, undefined);
  });
});

// -------------------------------------------------------------------------
// buildCompletionCoverage
// -------------------------------------------------------------------------

describe('buildCompletionCoverage', () => {
  it('records fulfilled dispatches as completed evaluations', () => {
    const unit = { unitId: 'default::bundle::0', mode: 'bundle', group: 'default', lawIds: ['law-a'] };
    const matrix = [
      { group: 'default', unit, appraiser: { id: 'a1' }, pass: 1 },
      { group: 'default', unit, appraiser: { id: 'a2' }, pass: 1 },
    ];
    const settled = [
      { status: 'fulfilled', value: {} },
      { status: 'fulfilled', value: {} },
    ];
    const coverage = buildCompletionCoverage(matrix, settled, [], {}, new Map([['default', [unit]]]));

    assert.equal(coverage.size, 1);
    const entry = coverage.get('default::bundle::0');
    assert.equal(entry.group, 'default');
    assert.equal(entry.mode, 'bundle');
    assert.equal(entry.law, null);
    assert.equal(entry.evaluations.length, 2);
    assert.equal(entry.violations, 0);
    assert.ok(entry.evaluations.every(e => e.completed === true));
  });

  it('records rejected dispatches as uncompleted', () => {
    const unit = { unitId: 'unit::0', mode: 'bundle', group: 'g', lawIds: ['l'] };
    const matrix = [
      { group: 'g', unit, appraiser: { id: 'a1' }, pass: 1 },
      { group: 'g', unit, appraiser: { id: 'a2' }, pass: 1 },
    ];
    const settled = [
      { status: 'fulfilled', value: {} },
      { status: 'rejected', reason: new Error('fail') },
    ];
    const coverage = buildCompletionCoverage(matrix, settled, [], {}, new Map([['g', [unit]]]));

    const entry = coverage.get('unit::0');
    assert.equal(entry.evaluations[0].completed, true);
    assert.equal(entry.evaluations[1].completed, false);
  });

  it('counts violations from stage-output files', () => {
    const unit = { unitId: 'default::bundle::0', mode: 'bundle', group: 'default', lawIds: ['law-a', 'law-b'] };
    const matrix = [{ group: 'default', unit, appraiser: { id: 'a1' }, pass: 1 }];
    const settled = [{ status: 'fulfilled', value: {} }];
    const io = {
      readFile: () => JSON.stringify({ file: 'x.js', law: 'law-a', text: 'i', group: 'default', appraiser: 'a1', pass: 1 }) + '\n'
        + JSON.stringify({ file: 'y.js', law: 'law-b', text: 'i2', group: 'default', appraiser: 'a1', pass: 1 }) + '\n',
    };
    const coverage = buildCompletionCoverage(matrix, settled, ['v.jsonl'], io, new Map([['default', [unit]]]));

    assert.equal(coverage.get('default::bundle::0').violations, 2);
  });

  it('skips malformed lines in stage-output files', () => {
    const unit = { unitId: 'default::bundle::0', mode: 'bundle', group: 'default', lawIds: ['law-a'] };
    const matrix = [{ group: 'default', unit, appraiser: { id: 'a1' }, pass: 1 }];
    const settled = [{ status: 'fulfilled', value: {} }];
    const io = {
      readFile: () => 'not json\n{"file": "x.js", "law": "law-a", "text": "issue", "group": "default", "appraiser": "a1", "pass": 1}\n',
    };
    const coverage = buildCompletionCoverage(matrix, settled, ['v.jsonl'], io, new Map([['default', [unit]]]));

    assert.equal(coverage.get('default::bundle::0').violations, 1);
  });

  it('sets law field to law id for law-by-law units', () => {
    const unit = { unitId: 'sec::law-by-law::0', mode: 'law-by-law', group: 'sec', lawIds: ['no-secrets'] };
    const matrix = [{ group: 'sec', unit, appraiser: { id: 'a1' }, pass: 1 }];
    const settled = [{ status: 'fulfilled', value: {} }];
    const coverage = buildCompletionCoverage(matrix, settled, [], {}, new Map([['sec', [unit]]]));

    assert.equal(coverage.get('sec::law-by-law::0').law, 'no-secrets');
  });

  it('counts violations per unit with law-by-law mode', () => {
    const unitA = { unitId: 'sec::law-by-law::0', mode: 'law-by-law', group: 'sec', lawIds: ['law-a'] };
    const unitB = { unitId: 'sec::law-by-law::1', mode: 'law-by-law', group: 'sec', lawIds: ['law-b'] };
    const matrix = [
      { group: 'sec', unit: unitA, appraiser: { id: 'a1' }, pass: 1 },
      { group: 'sec', unit: unitB, appraiser: { id: 'a1' }, pass: 1 },
    ];
    const settled = [{ status: 'fulfilled' }, { status: 'fulfilled' }];
    const io = {
      readFile: () => JSON.stringify({ file: 'x.js', law: 'law-a', text: 'i', group: 'sec', appraiser: 'a1', pass: 1 }) + '\n',
    };
    const coverage = buildCompletionCoverage(matrix, settled, ['v.jsonl'], io, new Map([['sec', [unitA, unitB]]]));

    assert.equal(coverage.get('sec::law-by-law::0').violations, 1);
    assert.equal(coverage.get('sec::law-by-law::1').violations, 0);
  });
});

// -------------------------------------------------------------------------
// writeCoverageFile
// -------------------------------------------------------------------------

describe('writeCoverageFile', () => {
  it('serialises coverage map to JSON sorted by unitId', () => {
    const coverage = new Map([
      ['z::bundle::0', {
        unitId: 'z::bundle::0', group: 'z', mode: 'bundle', law: null,
        evaluations: [{ appraiser: 'a1', pass: 1, completed: true }], violations: 0,
      }],
      ['a::bundle::0', {
        unitId: 'a::bundle::0', group: 'a', mode: 'bundle', law: null,
        evaluations: [{ appraiser: 'a2', pass: 1, completed: true }], violations: 1,
      }],
    ]);
    const written = [];
    const io = { writeFile: (p, c) => written.push({ path: p, content: c }) };
    writeCoverageFile(io, coverage, 'test-cycle');

    assert.equal(written.length, 1);
    assert.ok(written[0].path.endsWith('.coverage-test-cycle.json'));

    const parsed = JSON.parse(written[0].content);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].unitId, 'a::bundle::0');
    assert.equal(parsed[1].unitId, 'z::bundle::0');
    assert.equal(parsed[0].violations, 1);
    assert.equal(parsed[1].violations, 0);
  });
});

// -------------------------------------------------------------------------
// Integration test: executeAppraise with real IO + fixture files
// -------------------------------------------------------------------------

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'foundry', GIT_AUTHOR_EMAIL: 'foundry@test',
  GIT_COMMITTER_NAME: 'foundry', GIT_COMMITTER_EMAIL: 'foundry@test',
};

function setupFoundryFixtures(extraGroups) {
  const root = mkdtempSync(join(tmpdir(), 'run-appr-ext-'));

  // Initialise git repo on main branch
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, env: GIT_ENV });

  // Foundry directory structure
  mkdirSync(join(root, 'foundry/laws'), { recursive: true });
  mkdirSync(join(root, 'foundry/appraisers'), { recursive: true });
  mkdirSync(join(root, 'foundry/flows'), { recursive: true });
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  mkdirSync(join(root, 'foundry/artefacts/code'), { recursive: true });
  mkdirSync(join(root, '.foundry/stage-outputs'), { recursive: true });
  mkdirSync(join(root, 'foundry/.stage'), { recursive: true });

  // Cycle definition
  writeFileSync(join(root, 'foundry/cycles/test-cycle.md'),
    '---\noutput-type: code\nflow-id: test-flow\n---\n\nCycle body.\n');

  // Flow definition
  const flowContent = extraGroups
    ? '---\nlaw-groups:\n  security:\n    mode: law-by-law\n    passes: 2\n    appraisers:\n      - alice\n      - bob\n---\n\nFlow body.\n'
    : '---\n---\n\nFlow body.\n';
  writeFileSync(join(root, 'foundry/flows/test-flow.md'), flowContent);

  // Appraisers (parseDoc parses frontmatter, personality is the body)
  writeFileSync(join(root, 'foundry/appraisers/alice.md'),
    '---\nid: alice\n---\nStrict appraiser.');
  writeFileSync(join(root, 'foundry/appraisers/bob.md'),
    '---\nid: bob\n---\nLenient appraiser.');

  // Law definitions in parseLaws format (## heading + body)
  if (extraGroups) {
    writeFileSync(join(root, 'foundry/laws/law-a.md'),
      '## law-a\n\nLaw A — no secrets.\n\ngroup: security');
    writeFileSync(join(root, 'foundry/laws/law-b.md'),
      '## law-b\n\nLaw B — secure storage.\n\ngroup: security');
  } else {
    writeFileSync(join(root, 'foundry/laws/law-a.md'),
      '## law-a\n\nLaw A — default.\n');
    writeFileSync(join(root, 'foundry/laws/law-b.md'),
      '## law-b\n\nLaw B — default.\n');
  }

  // Artefact type definition with file pattern
  writeFileSync(join(root, 'foundry/artefacts/code/definition.md'),
    '---\nname: Code\nfile-patterns:\n  - "**/*.js"\n---\nCode artefact.\n');

  // Artefact file on main
  writeFileSync(join(root, 'app.js'), 'const x = 1;\n');

  // Commit on main
  execFileSync('git', ['add', '-A'], { cwd: root, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '-m', 'initialise'], { cwd: root, env: GIT_ENV });

  // Create work branch with changes
  execFileSync('git', ['checkout', '-q', '-b', 'work/test'], { cwd: root, env: GIT_ENV });
  writeFileSync(join(root, 'app.js'), 'const x = 2;\n');
  execFileSync('git', ['add', '-A'], { cwd: root, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '-m', 'modify artefact'], { cwd: root, env: GIT_ENV });

  return root;
}

function makeIO(root) {
  const abs = (p) => path.isAbsolute(p) ? p : path.resolve(root, p);
  return {
    readFile: (p) => readFileSync(abs(p), 'utf8'),
    readDir: (p) => {
      const entries = readdirSync(abs(p));
      return entries.filter(f => f !== '.gitkeep');
    },
    exists: (p) => existsSync(abs(p)),
    writeFile: (p, c) => writeFileSync(abs(p), c, 'utf8'),
    rename: (from, to) => { try { rmSync(abs(to), { force: true }); renameSync(abs(from), abs(to)); } catch {} },
    unlink: (p) => { try { unlinkSync(abs(p)); } catch {} },
    mkdir: (p) => mkdirSync(abs(p), { recursive: true }),
    exec: (args) => execFileSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8' }).toString().trim(),
  };
}

describe('executeAppraise pipeline — zero-config regression', () => {
  let tmpDir, io;

  before(() => {
    tmpDir = setupFoundryFixtures(false);
    io = makeIO(tmpDir);
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('returns ok and coverage map with no law-groups configured', async () => {
    const { executeAppraise } = await import('../../src/scripts/run-appraise.js');

    const client = {
      session: {
        create: () => Promise.resolve({ id: 'session-ext-1' }),
        prompt: () => Promise.resolve({}),
      },
    };
    const childSessions = new Map();
    const context = { sessionID: 'parent-ext-1' };

    const result = await executeAppraise({
      client,
      childSessions,
      context,
      io,
      worktree: tmpDir,
      historyPath: join(tmpDir, 'history.jsonl'),
      feedbackPath: join(tmpDir, 'feedback'),
      sort: { route: 'appraise:test-cycle' },
    });

    assert.ok(result.ok === true, `expected ok:true, got ${JSON.stringify(result)}`);
    assert.ok(result.coverage instanceof Map, 'coverage should be a Map');

    // Zero config: one bundle unit for all laws with 2 appraisers × 1 pass
    assert.equal(result.coverage.size, 1);
    const entry = result.coverage.get('default::bundle::0');
    assert.ok(entry, 'should have default::bundle::0 entry');
    assert.equal(entry.mode, 'bundle');
    assert.equal(entry.evaluations.length, 2);
    assert.ok(entry.evaluations.every(e => e.completed === true));
    // Each evaluation records appraiser id (string)
    assert.equal(typeof entry.evaluations[0].appraiser, 'string');
  });

  it('stage output stays as appraise:<cycle>', async () => {
    const { executeAppraise } = await import('../../src/scripts/run-appraise.js');

    const client = {
      session: {
        create: () => Promise.resolve({ id: 'session-ext-2' }),
        prompt: () => Promise.resolve({}),
      },
    };
    const childSessions = new Map();
    const context = { sessionID: 'parent-ext-2' };

    const result = await executeAppraise({
      client,
      childSessions,
      context,
      io,
      worktree: tmpDir,
      historyPath: join(tmpDir, 'history.jsonl'),
      feedbackPath: join(tmpDir, 'feedback'),
      sort: { route: 'appraise:test-cycle' },
    });

    assert.ok(result.ok);
  });
});

describe('executeAppraise pipeline — law-by-law arithmetic', () => {
  let tmpDir, io;

  before(() => {
    // Security group with law-by-law mode, 2 passes, 2 appraisers
    tmpDir = setupFoundryFixtures(true);
    io = makeIO(tmpDir);
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('dispatches passes × appraisers sessions per law', async () => {
    const { executeAppraise } = await import('../../src/scripts/run-appraise.js');

    let sessionCount = 0;
    const client = {
      session: {
        create: () => {
          sessionCount++;
          return Promise.resolve({ id: 'session-lbl-' + sessionCount });
        },
        prompt: () => Promise.resolve({}),
      },
    };
    const childSessions = new Map();
    const context = { sessionID: 'parent-lbl' };

    const result = await executeAppraise({
      client,
      childSessions,
      context,
      io,
      worktree: tmpDir,
      historyPath: join(tmpDir, 'history.jsonl'),
      feedbackPath: join(tmpDir, 'feedback'),
      sort: { route: 'appraise:test-cycle' },
    });

    assert.ok(result.ok);
    // 2 laws × 2 passes × 2 appraisers = 8 dispatch entries
    assert.equal(sessionCount, 8, 'expected 8 dispatched sessions for 2 laws × 2 passes × 2 appraisers');
    assert.equal(result.coverage.size, 2, 'expected 2 coverage units (one per law)');

    // Each unit should have 4 evaluations (2 appraisers × 2 passes)
    for (const entry of result.coverage.values()) {
      assert.equal(entry.evaluations.length, 4, 'each unit should have 4 evaluations');
      assert.ok(entry.evaluations.every(e => e.completed === true));
    }
  });
});

describe('executeAppraise pipeline — error handling', () => {
  let tmpDir, io;

  before(() => {
    tmpDir = setupFoundryFixtures(false);
    io = makeIO(tmpDir);
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('returns {ok: true} even when empty appraiser pool (via emptyAppraiseResult)', async () => {
    const { executeAppraise } = await import('../../src/scripts/run-appraise.js');

    // Remove all appraisers to trigger empty pool
    rmSync(join(tmpDir, 'foundry/appraisers'), { recursive: true, force: true });
    mkdirSync(join(tmpDir, 'foundry/appraisers'), { recursive: true });

    const client = {
      session: {
        create: () => Promise.resolve({ id: 'session-err' }),
        prompt: () => Promise.resolve({}),
      },
    };
    const childSessions = new Map();
    const context = { sessionID: 'parent-err' };

    // Go back to main to avoid branch issues
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: tmpDir, env: GIT_ENV });

    const result = await executeAppraise({
      client,
      childSessions,
      context,
      io,
      worktree: tmpDir,
      historyPath: join(tmpDir, 'history.jsonl'),
      feedbackPath: join(tmpDir, 'feedback'),
      sort: { route: 'appraise:test-cycle' },
    });

    assert.ok(result.ok === true, 'expected ok:true even with empty pool');
    // With empty appraiser pool, no dispatch entries → emptyAppraiseResult returns {ok: true}
    assert.ok(result.coverage === undefined || result.coverage instanceof Map);
  });
});

describe('executeAppraise pipeline — coverage persistence', () => {
  let tmpDir, io;

  before(() => {
    tmpDir = setupFoundryFixtures(false);
    io = makeIO(tmpDir);
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('writes coverage file to foundry/.stage/', async () => {
    const { executeAppraise } = await import('../../src/scripts/run-appraise.js');

    const client = {
      session: {
        create: () => Promise.resolve({ id: 'session-cov' }),
        prompt: () => Promise.resolve({}),
      },
    };
    const childSessions = new Map();
    const context = { sessionID: 'parent-cov' };

    const result = await executeAppraise({
      client,
      childSessions,
      context,
      io,
      worktree: tmpDir,
      historyPath: join(tmpDir, 'history.jsonl'),
      feedbackPath: join(tmpDir, 'feedback'),
      sort: { route: 'appraise:test-cycle' },
    });

    assert.ok(result.ok);

    // Check that coverage file was written
    const coveragePath = join(tmpDir, 'foundry/.stage/.coverage-test-cycle.json');
    assert.ok(existsSync(coveragePath), 'coverage file should exist');

    const parsed = JSON.parse(readFileSync(coveragePath, 'utf8'));
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length > 0);
    assert.ok(parsed[0].unitId);
    assert.ok(Array.isArray(parsed[0].evaluations));
    assert.equal(typeof parsed[0].violations, 'number');
  });
});
