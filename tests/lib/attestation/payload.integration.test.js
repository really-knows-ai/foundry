import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildAttestationPayload } from '../../../src/scripts/lib/attestation/payload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepo = path.join(__dirname, 'fixtures', 'basic-repo');

test('buildAttestationPayload emits deterministic top-level sections', async () => {
  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Write a haiku about rain.',
    archiveBranch: 'archive/work/make-haiku-demo-deadbee',
    archiveTipSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  });

  assert.deepEqual(Object.keys(payload), [
    'contract',
    'governance',
    'outputs',
    'process',
    'request',
    'schema',
    'coverage',
    'work_branch_archive',
  ]);
  assert.equal(payload.work_branch_archive.name, 'archive/work/make-haiku-demo-deadbee');
});

test('buildAttestationPayload uses injected io instead of reading from disk', async () => {
  // Create an io object with synthetic file contents
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: injected-flow
cycle: injected-cycle
stages:
  - stage-a
config-commit: injected-sha
---

# Goal
Injected goal.
`;
      }
      if (filePath.endsWith('WORK.history.yaml')) {
        return '[]\n';
      }
      if (filePath.endsWith('WORK.feedback.yaml')) {
        return 'feedback: injected\n';
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    exists: (filePath) => {
      return filePath.endsWith('WORK.md') ||
             filePath.endsWith('WORK.history.yaml') ||
             filePath.endsWith('WORK.feedback.yaml');
    },
    exec: () => '',
  };

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    foundryDir: '/nonexistent',
    goalText: 'Injected goal text',
    archiveBranch: 'archive/work/injected-branch',
    archiveTipSha: 'cafecafecafecafecafecafecafecafecafecafe',
    io: mockIo,
  });

  // Verify the injected content was used
  assert.equal(payload.contract.flow_id, 'injected-flow');
  assert.equal(payload.contract.entry_cycle, 'injected-cycle');
  assert.deepEqual(payload.contract.required_stages, ['stage-a']);
  assert.equal(payload.governance.config_commit, 'injected-sha');
  assert.equal(payload.outputs.length, 0);
});

test('buildAttestationPayload contract section - C2 required fields present', async () => {
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: test-flow
cycle: test-cycle
stages:
  - forge
  - appraise
config-commit: test-sha
expected-output-types:
  - text
  - code
allowed-write-scope:
  - src/**/*.js
  - tests/**/*.test.js
required-deterministic-checks:
  - npm test
  - npm run lint
required-human-gates: optional
---

# Goal
Test goal.
`;
      }
      if (filePath.endsWith('WORK.history.yaml')) {
        return '[]\n';
      }
      if (filePath.endsWith('WORK.feedback.yaml')) {
        return '';
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    exists: (filePath) => {
      return filePath.endsWith('WORK.md') ||
             filePath.endsWith('WORK.history.yaml') ||
             filePath.endsWith('WORK.feedback.yaml');
    },
    exec: () => '',
  };

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test goal text',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: mockIo,
  });

  // C2: Verify all four missing contract fields are present
  assert.deepEqual(payload.contract.expected_output_types, ['text', 'code']);
  assert.deepEqual(payload.contract.allowed_write_scope, ['src/**/*.js', 'tests/**/*.test.js']);
  assert.deepEqual(payload.contract.required_deterministic_checks, ['npm test', 'npm run lint']);
  assert.equal(payload.contract.required_human_gates, 'optional');
});

test('buildAttestationPayload contract section - C2 fields default when absent', async () => {
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: test-flow
cycle: test-cycle
stages:
  - forge
config-commit: test-sha
---

# Goal
Test goal.
`;
      }
      if (filePath.endsWith('WORK.history.yaml')) {
        return '[]\n';
      }
      if (filePath.endsWith('WORK.feedback.yaml')) {
        return '';
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    exists: (filePath) => {
      return filePath.endsWith('WORK.md') ||
             filePath.endsWith('WORK.history.yaml') ||
             filePath.endsWith('WORK.feedback.yaml');
    },
    exec: () => '',
  };

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test goal text',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: mockIo,
  });

  // C2 follow-up: Verify default values when fields are absent
  assert.deepEqual(payload.contract.expected_output_types, []);
  assert.deepEqual(payload.contract.allowed_write_scope, []);
  assert.deepEqual(payload.contract.required_deterministic_checks, []);
  assert.equal(payload.contract.required_human_gates, null);
});

// Helper for process section tests to reduce boilerplate
function makeMockIo({ historyText = '', feedbackText = '' } = {}) {
  const workMd = `---
flow: test-flow
cycle: test-cycle
---
# Goal
Test goal.
`;
  
  return {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) return workMd;
      if (filePath.endsWith('WORK.history.yaml')) return historyText;
      if (filePath.endsWith('WORK.feedback.yaml')) return feedbackText;
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    exists: (filePath) => 
      filePath.endsWith('WORK.md') ||
      (historyText !== '' && filePath.endsWith('WORK.history.yaml')) ||
      (feedbackText !== '' && filePath.endsWith('WORK.feedback.yaml')),
    exec: () => '',
  };
}

test('buildAttestationPayload process section - empty history', async () => {
  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: makeMockIo(),
  });

  assert.ok(payload.process, 'process section should exist');
  assert.ok(Array.isArray(payload.process.stages), 'process.stages should be an array');
  assert.equal(payload.process.stages.length, 0, 'empty history should yield empty stages array');
});

test('buildAttestationPayload process section - single entry without changed_files', async () => {
  const historyText = `- cycle: test-cycle
  stage: forge
  iteration: 1
  comment: Test forge
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
`;

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: makeMockIo({ historyText }),
  });

  assert.equal(payload.process.stages.length, 1);
  const stage = payload.process.stages[0];
  
  // Verify field presence and values (alphabetical order)
  assert.deepEqual(stage.changed_files, []);
  assert.equal(stage.cycle, 'test-cycle');
  assert.equal(stage.iteration, 1);
  assert.equal(stage.open_feedback, 0);
  assert.equal(stage.stage, 'forge');
  
  // Verify route is absent on non-sort stages
  assert.equal('route' in stage, false, 'route should not be present on non-sort stages');
  
  // Verify result field is absent
  assert.equal('result' in stage, false, 'result field should not exist');
});

test('buildAttestationPayload process section - entry with unsorted changed_files', async () => {
  const historyText = `- cycle: test-cycle
  stage: forge
  iteration: 1
  comment: Test forge
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
  changed_files:
    - b.txt
    - a.txt
`;

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abcd',
    io: makeMockIo({ historyText }),
  });

  assert.equal(payload.process.stages.length, 1);
  const stage = payload.process.stages[0];
  
  // changed_files should be sorted
  assert.deepEqual(stage.changed_files, ['a.txt', 'b.txt']);
  assert.equal(stage.cycle, 'test-cycle');
  assert.equal(stage.iteration, 1);
  assert.equal(stage.open_feedback, 0);
  assert.equal(stage.stage, 'forge');
  assert.equal('route' in stage, false);
});

test('buildAttestationPayload process section - sort stage with route back', async () => {
  const historyText = `- cycle: test-cycle
  stage: sort
  iteration: 1
  comment: Routing back
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
  route: back
`;

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: makeMockIo({ historyText }),
  });

  assert.equal(payload.process.stages.length, 1);
  const stage = payload.process.stages[0];
  
  assert.deepEqual(stage.changed_files, []);
  assert.equal(stage.cycle, 'test-cycle');
  assert.equal(stage.iteration, 1);
  assert.equal(stage.open_feedback, 0);
  assert.equal(stage.route, 'back', 'route should be present on sort stages');
  assert.equal(stage.stage, 'sort');
  assert.equal('result' in stage, false, 'result field should not exist');
});

test('buildAttestationPayload process section - sort stage with route forward', async () => {
  const historyText = `- cycle: test-cycle
  stage: sort
  iteration: 1
  comment: Routing forward
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
  route: forward
`;

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: makeMockIo({ historyText }),
  });

  assert.equal(payload.process.stages.length, 1);
  const stage = payload.process.stages[0];
  
  assert.deepEqual(stage.changed_files, []);
  assert.equal(stage.cycle, 'test-cycle');
  assert.equal(stage.iteration, 1);
  assert.equal(stage.open_feedback, 0);
  assert.equal(stage.route, 'forward', 'route should be present on sort stages');
  assert.equal(stage.stage, 'sort');
  assert.equal('result' in stage, false, 'result field should not exist');
});

test('buildAttestationPayload process section - multiple entries across cycles in seq order', async () => {
  const historyText = `- cycle: cycle-1
  stage: forge
  iteration: 1
  comment: First forge
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
- cycle: cycle-1
  stage: appraise
  iteration: 1
  comment: First appraise
  timestamp: '2025-01-01T01:00:00Z'
  seq: 1
  open_feedback: 0
- cycle: cycle-2
  stage: forge
  iteration: 2
  comment: Second forge
  timestamp: '2025-01-01T02:00:00Z'
  seq: 2
  open_feedback: 0
  changed_files:
    - z.txt
    - a.txt
`;

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: makeMockIo({ historyText }),
  });

  // All entries should be included, regardless of cycle
  assert.equal(payload.process.stages.length, 3);
  
  // Verify seq ordering
  assert.equal(payload.process.stages[0].stage, 'forge');
  assert.equal(payload.process.stages[0].cycle, 'cycle-1');
  assert.equal(payload.process.stages[0].iteration, 1);
  
  assert.equal(payload.process.stages[1].stage, 'appraise');
  assert.equal(payload.process.stages[1].cycle, 'cycle-1');
  
  assert.equal(payload.process.stages[2].stage, 'forge');
  assert.equal(payload.process.stages[2].cycle, 'cycle-2');
  assert.equal(payload.process.stages[2].iteration, 2);
  
  // Verify changed_files are sorted
  assert.deepEqual(payload.process.stages[2].changed_files, ['a.txt', 'z.txt']);
  
  // Verify no route field on non-sort stages
  assert.equal('route' in payload.process.stages[0], false);
  assert.equal('route' in payload.process.stages[1], false);
  assert.equal('route' in payload.process.stages[2], false);
});

test('buildAttestationPayload process section - open_feedback defaults to 0 when absent', async () => {
  const historyText = `- cycle: test-cycle
  stage: forge
  iteration: 1
  comment: Entry without explicit open_feedback
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
`;

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: makeMockIo({ historyText }),
  });

  assert.equal(payload.process.stages.length, 1);
  assert.equal(payload.process.stages[0].open_feedback, 0, 'open_feedback should default to 0');
});

test('buildAttestationPayload process section - multi-iteration feedback trail', async () => {
  const historyText = `- cycle: cycle-1
  stage: forge
  iteration: 1
  comment: Initial forge
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
- cycle: cycle-1
  stage: quench
  iteration: 1
  comment: Initial appraisal
  timestamp: '2025-01-01T01:00:00Z'
  seq: 1
  open_feedback: 3
- cycle: cycle-1
  stage: sort
  iteration: 1
  comment: Routing back due to feedback
  timestamp: '2025-01-01T02:00:00Z'
  seq: 2
  open_feedback: 3
  route: back
- cycle: cycle-2
  stage: forge
  iteration: 2
  comment: Addressing feedback
  timestamp: '2025-01-01T03:00:00Z'
  seq: 3
  open_feedback: 0
  changed_files:
    - revised.txt
- cycle: cycle-2
  stage: quench
  iteration: 2
  comment: Second appraisal
  timestamp: '2025-01-01T04:00:00Z'
  seq: 4
  open_feedback: 0
- cycle: cycle-2
  stage: sort
  iteration: 2
  comment: Routing forward
  timestamp: '2025-01-01T05:00:00Z'
  seq: 5
  open_feedback: 0
  route: forward
`;

  const payload = await buildAttestationPayload({
    cwd: '/fake',
    foundryDir: '/nonexistent',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: makeMockIo({ historyText }),
  });

  assert.equal(payload.process.stages.length, 6);
  
  // Verify feedback trail: 0 → 3 → 3 → 0 → 0 → 0
  assert.equal(payload.process.stages[0].open_feedback, 0, 'forge iter 1');
  assert.equal(payload.process.stages[1].open_feedback, 3, 'quench iter 1');
  assert.equal(payload.process.stages[2].open_feedback, 3, 'sort iter 1');
  assert.equal(payload.process.stages[3].open_feedback, 0, 'forge iter 2');
  assert.equal(payload.process.stages[4].open_feedback, 0, 'quench iter 2');
  assert.equal(payload.process.stages[5].open_feedback, 0, 'sort iter 2');
  
  // Verify iterations
  assert.equal(payload.process.stages[0].iteration, 1);
  assert.equal(payload.process.stages[1].iteration, 1);
  assert.equal(payload.process.stages[2].iteration, 1);
  assert.equal(payload.process.stages[3].iteration, 2);
  assert.equal(payload.process.stages[4].iteration, 2);
  assert.equal(payload.process.stages[5].iteration, 2);
  
  // Verify cycles
  assert.equal(payload.process.stages[0].cycle, 'cycle-1');
  assert.equal(payload.process.stages[5].cycle, 'cycle-2');
  
  // Verify route appears only on sort stages
  assert.equal('route' in payload.process.stages[0], false);
  assert.equal('route' in payload.process.stages[1], false);
  assert.equal(payload.process.stages[2].route, 'back');
  assert.equal('route' in payload.process.stages[3], false);
  assert.equal('route' in payload.process.stages[4], false);
  assert.equal(payload.process.stages[5].route, 'forward');
  
  // Verify changed_files on forge iter 2
  assert.deepEqual(payload.process.stages[3].changed_files, ['revised.txt']);
});

test('buildAttestationPayload throws on malformed WORK.history.yaml', async () => {
  const historyText = 'not: valid: yaml: [';

  await assert.rejects(
    () => buildAttestationPayload({
      cwd: '/fake',
      foundryDir: '/nonexistent',
      goalText: 'Test',
      archiveBranch: 'archive/test',
      archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
      io: makeMockIo({ historyText }),
    }),
    /WORK\.history\.yaml malformed/,
    'Should throw on malformed history YAML'
  );
});

test('does not include scope or verdict fields', async () => {
  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    foundryDir: '/nonexistent',
    goalText: 'Write a haiku about rain.',
    archiveBranch: 'archive/work/make-haiku-demo-deadbee',
    archiveTipSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  });
  assert.equal(payload.scope, undefined);
  assert.equal(payload.verdict, undefined);
});

test('schema is foundry-attestation/v2 with or without coverage data', async () => {
  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    foundryDir: '/nonexistent',
    goalText: 'Write a haiku about rain.',
    archiveBranch: 'archive/work/make-haiku-demo-deadbee',
    archiveTipSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  });
  assert.equal(payload.schema, 'foundry-attestation/v2');
});

test('coverage section is empty array when no coverage supplied', async () => {
  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
  });
  assert.ok(Array.isArray(payload.coverage));
  assert.equal(payload.coverage.length, 0);
});

test('coverage section present with correct fields when coverage provided', async () => {
  const coverageMap = new Map([
    ['default::bundle::0', {
      unitId: 'default::bundle::0',
      group: 'default',
      mode: 'bundle',
      law: null,
      evaluations: [
        { appraiser: 'skeptic', pass: 1, completed: true },
      ],
      violations: 0,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  assert.equal(payload.schema, 'foundry-attestation/v2');
  assert.equal(payload.coverage.length, 1);

  const entry = payload.coverage[0];
  assert.equal(entry.group, 'default');
  assert.equal(entry.mode, 'bundle');
  assert.equal(entry.violations, 0);
  assert.equal(entry.status, 'pass');
  assert.equal('law' in entry, false);
  assert.equal('appraisers' in entry, false);
  assert.equal('passes' in entry, false);
  assert.equal('verdicts' in entry, false);

  assert.equal(entry.evaluations.length, 1);
  assert.equal(entry.evaluations[0].appraiser, 'skeptic');
  assert.equal(entry.evaluations[0].pass, 1);
  assert.equal(entry.evaluations[0].completed, true);
});

test('coverage section: law-by-law entry includes law field', async () => {
  const coverageMap = new Map([
    ['security::law-by-law::0', {
      unitId: 'security::law-by-law::0',
      group: 'security',
      mode: 'law-by-law',
      law: 'no-secrets-in-source',
      evaluations: [
        { appraiser: 'skeptic', pass: 1, completed: true },
      ],
      violations: 0,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  assert.equal(payload.coverage.length, 1);
  const entry = payload.coverage[0];
  assert.equal(entry.law, 'no-secrets-in-source');
  assert.equal('appraisers' in entry, false);
  assert.equal('passes' in entry, false);
  assert.equal('verdicts' in entry, false);
});

test('coverage section: bundle-mode entry omits law field', async () => {
  const coverageMap = new Map([
    ['docs::bundle::0', {
      unitId: 'docs::bundle::0',
      group: 'docs',
      mode: 'bundle',
      law: null,
      evaluations: [
        { appraiser: 'skeptic', pass: 1, completed: true },
      ],
      violations: 0,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  assert.equal(payload.coverage.length, 1);
  assert.equal('law' in payload.coverage[0], false);
});

test('coverage entries sorted by (group, law) with null law sorting first', async () => {
  const coverageMap = new Map([
    ['security::law-by-law::1', {
      unitId: 'security::law-by-law::1',
      group: 'security',
      mode: 'law-by-law',
      law: 'zebra-rule',
      evaluations: [{ appraiser: 'a', pass: 1, completed: true }],
      violations: 0,
    }],
    ['security::bundle::0', {
      unitId: 'security::bundle::0',
      group: 'security',
      mode: 'bundle',
      law: null,
      evaluations: [{ appraiser: 'a', pass: 1, completed: true }],
      violations: 0,
    }],
    ['alpha::bundle::0', {
      unitId: 'alpha::bundle::0',
      group: 'alpha',
      mode: 'bundle',
      law: null,
      evaluations: [{ appraiser: 'a', pass: 1, completed: true }],
      violations: 0,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  // Order by group then law: alpha, security (null law / bundle), security (law-by-law / zebra-rule)
  assert.equal(payload.coverage.length, 3);
  assert.equal(payload.coverage[0].group, 'alpha');
  assert.equal(payload.coverage[1].group, 'security');
  assert.equal('law' in payload.coverage[1], false);
  assert.equal(payload.coverage[2].group, 'security');
  assert.equal(payload.coverage[2].law, 'zebra-rule');
});

test('evaluations sorted by (appraiser, pass) within each coverage entry', async () => {
  const coverageMap = new Map([
    ['test::bundle::0', {
      unitId: 'test::bundle::0',
      group: 'test',
      mode: 'bundle',
      law: null,
      evaluations: [
        { appraiser: 'skeptic', pass: 2, completed: true },
        { appraiser: 'auditor', pass: 1, completed: true },
        { appraiser: 'skeptic', pass: 1, completed: true },
        { appraiser: 'auditor', pass: 2, completed: true },
        { appraiser: 'auditor', pass: 3, completed: true },
        { appraiser: 'skeptic', pass: 3, completed: true },
      ],
      violations: 0,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  const evals = payload.coverage[0].evaluations;
  assert.equal(evals.length, 6);
  // auditor/1, auditor/2, auditor/3, skeptic/1, skeptic/2, skeptic/3
  assert.equal(evals[0].appraiser, 'auditor'); assert.equal(evals[0].pass, 1);
  assert.equal(evals[1].appraiser, 'auditor'); assert.equal(evals[1].pass, 2);
  assert.equal(evals[2].appraiser, 'auditor'); assert.equal(evals[2].pass, 3);
  assert.equal(evals[3].appraiser, 'skeptic'); assert.equal(evals[3].pass, 1);
  assert.equal(evals[4].appraiser, 'skeptic'); assert.equal(evals[4].pass, 2);
  assert.equal(evals[5].appraiser, 'skeptic'); assert.equal(evals[5].pass, 3);
});

test('status derivation: fail when violations > 0', async () => {
  const coverageMap = new Map([
    ['fail::bundle::0', {
      unitId: 'fail::bundle::0',
      group: 'fail',
      mode: 'bundle',
      law: null,
      evaluations: [{ appraiser: 'a', pass: 1, completed: true }],
      violations: 1,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  assert.equal(payload.coverage[0].status, 'fail');
});

test('status derivation: pass when zero violations and all completed', async () => {
  const coverageMap = new Map([
    ['pass::bundle::0', {
      unitId: 'pass::bundle::0',
      group: 'pass',
      mode: 'bundle',
      law: null,
      evaluations: [{ appraiser: 'a', pass: 1, completed: true }],
      violations: 0,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  assert.equal(payload.coverage[0].status, 'pass');
});

test('status derivation: incomplete when any evaluation not completed', async () => {
  const coverageMap = new Map([
    ['incomplete::bundle::0', {
      unitId: 'incomplete::bundle::0',
      group: 'incomplete',
      mode: 'bundle',
      law: null,
      evaluations: [
        { appraiser: 'a', pass: 1, completed: true },
        { appraiser: 'a', pass: 2, completed: false },
      ],
      violations: 0,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  assert.equal(payload.coverage[0].status, 'incomplete');
});

test('status derivation: violations take precedence over incomplete', async () => {
  const coverageMap = new Map([
    ['mixed::bundle::0', {
      unitId: 'mixed::bundle::0',
      group: 'mixed',
      mode: 'bundle',
      law: null,
      evaluations: [
        { appraiser: 'a', pass: 1, completed: true },
        { appraiser: 'a', pass: 2, completed: false },
      ],
      violations: 1,
    }],
  ]);

  const payload = await buildAttestationPayload({
    cwd: fixtureRepo,
    goalText: 'Test',
    archiveBranch: 'archive/work/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    coverage: coverageMap,
  });

  assert.equal(payload.coverage[0].status, 'fail');
});
