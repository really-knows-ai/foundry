import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttestation } from '../../../src/scripts/lib/attestation/attest.js';

// Minimal valid WORK.md with two required stages
const WORK_MD_VALID = `---
flow: make-haiku
cycle: forge
stages:
  - forge
  - appraise
config-commit: abc123
---

# Goal
Write a haiku.

## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
| haiku.txt | text | forge | done |
`;

// WORK.history.yaml with both required stages present
const HISTORY_VALID = `- cycle: forge
  stage: sort
  iteration: 1
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
  route: forge
- cycle: forge
  stage: forge
  iteration: 1
  timestamp: '2025-01-01T00:00:01Z'
  seq: 1
  open_feedback: 0
  changed_files:
    - haiku.txt
- cycle: forge
  stage: sort
  iteration: 1
  timestamp: '2025-01-01T00:00:02Z'
  seq: 2
  open_feedback: 0
  route: appraise
- cycle: forge
  stage: appraise
  iteration: 1
  timestamp: '2025-01-01T00:00:03Z'
  seq: 3
  open_feedback: 0
  changed_files: []
`;

// WORK.feedback.yaml — all resolved
const FEEDBACK_ALL_RESOLVED = `items:
  - id: 01HXXX
    file: haiku.txt
    tag: law:style
    text: "Too short"
    source: appraise:check
    history:
      - state: resolved
        stage: appraise:check
        cycle: forge
        timestamp: 2025-01-01T00:00:00.000Z
`;

// WORK.feedback.yaml — one unresolved item
const FEEDBACK_UNRESOLVED = `items:
  - id: 01HYYY
    file: haiku.txt
    tag: law:style
    text: "Still too short"
    source: appraise:check
    history:
      - state: open
        stage: appraise:check
        cycle: forge
        timestamp: 2025-01-01T00:00:00.000Z
`;

// WORK.md with a blocked artefact
const WORK_MD_BLOCKED = `---
flow: make-haiku
cycle: forge
stages:
  - forge
  - appraise
config-commit: abc123
---

# Goal
Write a haiku.

## Artefacts
| File | Type | Cycle | Status |
|------|------|-------|--------|
| haiku.txt | text | forge | blocked |
`;

// WORK.history.yaml missing the appraise stage
const HISTORY_MISSING_STAGE = `- cycle: forge
  stage: sort
  iteration: 1
  timestamp: '2025-01-01T00:00:00Z'
  seq: 0
  open_feedback: 0
  route: forge
- cycle: forge
  stage: forge
  iteration: 1
  timestamp: '2025-01-01T00:00:01Z'
  seq: 1
  open_feedback: 0
  changed_files:
    - haiku.txt
`;

function makeIo({ workMd = WORK_MD_VALID, history = HISTORY_VALID, feedback = FEEDBACK_ALL_RESOLVED } = {}) {
  const files = {
    '/repo/WORK.md': workMd,
    '/repo/WORK.history.yaml': history,
    '/repo/WORK.feedback.yaml': feedback,
  };
  return {
    readFile: (p) => { if (files[p] === undefined) throw new Error(`ENOENT: ${p}`); return files[p]; },
    fileExists: (p) => files[p] !== undefined,
  };
}

const FAKE_DIFF_SHA = 'a'.repeat(64);

function makeExecGit(overrides = {}) {
  return (argv) => {
    const cmd = argv.join(' ');
    if (cmd.startsWith('merge-base')) return 'basesha123\n';
    if (cmd.startsWith('diff')) return Buffer.from('fake diff output');
    if (overrides[cmd] !== undefined) return overrides[cmd];
    throw new Error(`Unexpected git command: ${cmd}`);
  };
}

describe('buildAttestation', () => {
  it('returns ok:true with ATTEST.md content for a valid complete cycle', async () => {
    const result = await buildAttestation({
      cwd: '/repo',
      baseBranch: 'main',
      goalText: 'Write a haiku',
      archiveBranch: 'archive/work/forge-abc1234',
      archiveTipSha: 'abc1234',
      io: makeIo(),
      execGit: makeExecGit(),
    });
    assert.equal(result.ok, true);
    assert.equal(typeof result.content, 'string');
    assert.match(result.content, /-----BEGIN FOUNDRY ATTESTATION-----/);
    assert.match(result.content, /-----END FOUNDRY ATTESTATION-----/);
    assert.match(result.content, /diff-sha256:/);
  });

  it('returns ok:false when a required stage is missing from history', async () => {
    const result = await buildAttestation({
      cwd: '/repo',
      baseBranch: 'main',
      goalText: 'Write a haiku',
      archiveBranch: 'archive/work/forge-abc1234',
      archiveTipSha: 'abc1234',
      io: makeIo({ history: HISTORY_MISSING_STAGE }),
      execGit: makeExecGit(),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing.*stage|stage.*missing|appraise/i);
  });

  it('returns ok:false when an artefact is blocked', async () => {
    const result = await buildAttestation({
      cwd: '/repo',
      baseBranch: 'main',
      goalText: 'Write a haiku',
      archiveBranch: 'archive/work/forge-abc1234',
      archiveTipSha: 'abc1234',
      io: makeIo({ workMd: WORK_MD_BLOCKED }),
      execGit: makeExecGit(),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /blocked/i);
  });

  it('returns ok:false when feedback items are unresolved', async () => {
    const result = await buildAttestation({
      cwd: '/repo',
      baseBranch: 'main',
      goalText: 'Write a haiku',
      archiveBranch: 'archive/work/forge-abc1234',
      archiveTipSha: 'abc1234',
      io: makeIo({ feedback: FEEDBACK_UNRESOLVED }),
      execGit: makeExecGit(),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /unresolved.*feedback|feedback.*unresolved/i);
  });

  it('includes the diff SHA in the ATTEST.md content', async () => {
    const result = await buildAttestation({
      cwd: '/repo',
      baseBranch: 'main',
      goalText: 'Write a haiku',
      archiveBranch: 'archive/work/forge-abc1234',
      archiveTipSha: 'abc1234',
      io: makeIo(),
      execGit: makeExecGit(),
    });
    assert.equal(result.ok, true);
    // diff-sha256 line must be present and contain a 64-char hex value
    assert.match(result.content, /diff-sha256: [0-9a-f]{64}/);
  });

  it('succeeds when WORK.feedback.yaml is absent', async () => {
    const io = makeIo();
    io.fileExists = (p) => !p.endsWith('WORK.feedback.yaml') && makeIo().fileExists(p);
    const result = await buildAttestation({
      cwd: '/repo',
      baseBranch: 'main',
      goalText: 'Write a haiku',
      archiveBranch: 'archive/work/forge-abc1234',
      archiveTipSha: 'abc1234',
      io,
      execGit: makeExecGit(),
    });
    assert.equal(result.ok, true);
  });

  it('succeeds when feedback items array is empty', async () => {
    const result = await buildAttestation({
      cwd: '/repo',
      baseBranch: 'main',
      goalText: 'Write a haiku',
      archiveBranch: 'archive/work/forge-abc1234',
      archiveTipSha: 'abc1234',
      io: makeIo({ feedback: 'items: []' }),
      execGit: makeExecGit(),
    });
    assert.equal(result.ok, true);
  });
});
