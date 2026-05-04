import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildAttestationPayload } from '../../../src/scripts/lib/attestation/payload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepo = path.join(__dirname, 'fixtures', 'basic-repo');

test('buildAttestationPayload emits deterministic top-level sections', () => {
  const payload = buildAttestationPayload({
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
    'scope',
    'schema',
    'verdict',
    'work_branch_archive',
  ]);
  assert.equal(payload.work_branch_archive.name, 'archive/work/make-haiku-demo-deadbee');
});

test('buildAttestationPayload uses injected io instead of reading from disk', () => {
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

## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
| injected.txt | text | injected-cycle | created |
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
    fileExists: (filePath) => {
      return filePath.endsWith('WORK.md') || 
             filePath.endsWith('WORK.history.yaml') || 
             filePath.endsWith('WORK.feedback.yaml');
    },
  };

  const payload = buildAttestationPayload({
    cwd: fixtureRepo,
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
  assert.equal(payload.outputs.length, 1);
  assert.equal(payload.outputs[0].path, 'injected.txt');
});

test('buildAttestationPayload process section - empty history', () => {
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: test-flow
cycle: test-cycle
---
# Goal
Test goal.
## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
`;
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    fileExists: (filePath) => filePath.endsWith('WORK.md'),
  };

  const payload = buildAttestationPayload({
    cwd: '/fake',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: mockIo,
  });

  assert.ok(payload.process, 'process section should exist');
  assert.ok(Array.isArray(payload.process.stages), 'process.stages should be an array');
  assert.equal(payload.process.stages.length, 0, 'empty history should yield empty stages array');
});

test('buildAttestationPayload process section - single entry without changed_files', () => {
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: test-flow
cycle: test-cycle
---
# Goal
Test goal.
## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
`;
      }
      if (filePath.endsWith('WORK.history.yaml')) {
        return `- cycle: test-cycle
  stage: forge
  iteration: 1
  comment: Test forge
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
`;
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    fileExists: (filePath) => 
      filePath.endsWith('WORK.md') || filePath.endsWith('WORK.history.yaml'),
  };

  const payload = buildAttestationPayload({
    cwd: '/fake',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: mockIo,
  });

  assert.equal(payload.process.stages.length, 1);
  assert.deepEqual(payload.process.stages[0], {
    stage: 'forge',
    result: 'recorded',
    changed_files: [],
  });
});

test('buildAttestationPayload process section - entry with unsorted changed_files', () => {
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: test-flow
cycle: test-cycle
---
# Goal
Test goal.
## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
`;
      }
      if (filePath.endsWith('WORK.history.yaml')) {
        return `- cycle: test-cycle
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
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    fileExists: (filePath) => 
      filePath.endsWith('WORK.md') || filePath.endsWith('WORK.history.yaml'),
  };

  const payload = buildAttestationPayload({
    cwd: '/fake',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: mockIo,
  });

  assert.equal(payload.process.stages.length, 1);
  assert.deepEqual(payload.process.stages[0].changed_files, ['a.txt', 'b.txt']);
});

test('buildAttestationPayload process section - sort stage with route back', () => {
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: test-flow
cycle: test-cycle
---
# Goal
Test goal.
## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
`;
      }
      if (filePath.endsWith('WORK.history.yaml')) {
        return `- cycle: test-cycle
  stage: sort
  iteration: 1
  comment: Routing back
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
  route: back
`;
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    fileExists: (filePath) => 
      filePath.endsWith('WORK.md') || filePath.endsWith('WORK.history.yaml'),
  };

  const payload = buildAttestationPayload({
    cwd: '/fake',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: mockIo,
  });

  assert.equal(payload.process.stages.length, 1);
  assert.equal(payload.process.stages[0].result, 'back');
});

test('buildAttestationPayload process section - sort stage with route forward', () => {
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: test-flow
cycle: test-cycle
---
# Goal
Test goal.
## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
`;
      }
      if (filePath.endsWith('WORK.history.yaml')) {
        return `- cycle: test-cycle
  stage: sort
  iteration: 1
  comment: Routing forward
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
  route: forward
`;
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    fileExists: (filePath) => 
      filePath.endsWith('WORK.md') || filePath.endsWith('WORK.history.yaml'),
  };

  const payload = buildAttestationPayload({
    cwd: '/fake',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: mockIo,
  });

  assert.equal(payload.process.stages.length, 1);
  assert.equal(payload.process.stages[0].result, 'forward');
});

test('buildAttestationPayload process section - multiple entries across cycles in seq order', () => {
  const mockIo = {
    readFile: (filePath) => {
      if (filePath.endsWith('WORK.md')) {
        return `---
flow: test-flow
cycle: cycle-2
---
# Goal
Test goal.
## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
`;
      }
      if (filePath.endsWith('WORK.history.yaml')) {
        // Multiple cycles, entries with varying seq values
        return `- cycle: cycle-1
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
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    },
    fileExists: (filePath) => 
      filePath.endsWith('WORK.md') || filePath.endsWith('WORK.history.yaml'),
  };

  const payload = buildAttestationPayload({
    cwd: '/fake',
    goalText: 'Test',
    archiveBranch: 'archive/test',
    archiveTipSha: 'abc123abc123abc123abc123abc123abc123abcd',
    io: mockIo,
  });

  // All entries should be included, regardless of cycle
  assert.equal(payload.process.stages.length, 3);
  
  // Verify seq ordering
  assert.equal(payload.process.stages[0].stage, 'forge');
  assert.equal(payload.process.stages[1].stage, 'appraise');
  assert.equal(payload.process.stages[2].stage, 'forge');
  
  // Verify changed_files are sorted
  assert.deepEqual(payload.process.stages[2].changed_files, ['a.txt', 'z.txt']);
});
