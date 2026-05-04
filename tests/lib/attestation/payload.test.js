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
        return 'history: injected\n';
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
