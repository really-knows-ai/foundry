/**
 * Full-cycle attestation integration test.
 *
 * Exercises a complete cycle (assay → forge → quench → appraise) with the
 * real appendStageAttestation function, then seals via sealCycleAttestation.
 * Uses a mock IO adapter — no real filesystem or git access.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendStageAttestation,
  sealCycleAttestation,
  hashAttestation,
} from '../../src/scripts/lib/attestation/hash.js';

// ---------------------------------------------------------------------------
// Mock IO that supports both async (appendStageAttestation) and sync
// (sealCycleAttestation) calling conventions.
// ---------------------------------------------------------------------------

function createCycleMockIo() {
  const store = {};

  return {
    exists: (p) => Object.hasOwn(store, p),
    readFile: (p) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    appendFile: (p, c) => {
      if (store[p] === undefined) store[p] = '';
      store[p] += c;
    },
    mkdir: async () => {}, // no-op, required by appendStageAttestation
    _get: (p) => store[p],
    _set: (p, c) => { store[p] = c; },
  };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

const RUN_ID = '01JKVT7Z8Q3WN0GJM2TYBR4BB';

describe('full-cycle attestation integration', () => {
  it('produces a sealable jsonl file with valid hashes on every line', async () => {
    const io = createCycleMockIo();
    const filePath = `.foundry/attestations/${RUN_ID}.jsonl`;

    // Stage 1: assay
    const assayResult = await appendStageAttestation(io, RUN_ID, {
      stage: 'assay',
      cycle: 'integration-cycle',
      iteration: 1,
      timestamp: '2026-06-11T14:00:01.000Z',
      evaluations: [{ appraiser: 'test', pass: true, completed: true }],
      violations: 0,
      changed_files: [],
      feedback_opened: [],
      feedback_resolved: [],
      artefact_hashes: [],
    });
    assert.equal(assayResult.ok, true);

    // Stage 2: forge
    const forgeResult = await appendStageAttestation(io, RUN_ID, {
      stage: 'forge',
      cycle: 'integration-cycle',
      iteration: 1,
      timestamp: '2026-06-11T14:00:05.000Z',
      evaluations: [],
      violations: 0,
      changed_files: ['test-output.md'],
      feedback_opened: [],
      feedback_resolved: ['fb-01'],
      artefact_hashes: [{ path: 'test-output.md', hash: 'def456' }],
    });
    assert.equal(forgeResult.ok, true);

    // Stage 3: quench
    const quenchResult = await appendStageAttestation(io, RUN_ID, {
      stage: 'quench',
      cycle: 'integration-cycle',
      iteration: 1,
      timestamp: '2026-06-11T14:00:10.000Z',
      evaluations: [{ appraiser: 'test', pass: true, completed: true }],
      violations: 0,
      changed_files: [],
      feedback_opened: ['fb-02'],
      feedback_resolved: [],
      artefact_hashes: [],
    });
    assert.equal(quenchResult.ok, true);

    // Stage 4: appraise
    const appraiseResult = await appendStageAttestation(io, RUN_ID, {
      stage: 'appraise',
      cycle: 'integration-cycle',
      iteration: 1,
      timestamp: '2026-06-11T14:00:15.000Z',
      evaluations: [{ appraiser: 'test', pass: true, completed: true }],
      violations: 0,
      changed_files: [],
      feedback_opened: [],
      feedback_resolved: [],
      artefact_hashes: [],
      appraiser_verdicts: [{ appraiser: 'test', verdict: 'resolved' }],
    });
    assert.equal(appraiseResult.ok, true);

    // Verify the file exists and has 4 lines (one per stage)
    assert.ok(io.exists(filePath));
    let content = io._get(filePath);
    let lines = content.trim().split('\n');
    assert.equal(lines.length, 4);

    // Every stage line must have a valid _hash
    for (let i = 0; i < lines.length; i++) {
      const parsed = JSON.parse(lines[i]);
      assert.ok(typeof parsed._hash === 'string');
      assert.match(parsed._hash, /^[0-9a-f]{64}$/);

      const storedHash = parsed._hash;
      delete parsed._hash;
      assert.equal(
        hashAttestation(parsed),
        storedHash,
        `line ${i + 1} hash mismatch`,
      );
    }

    // Seal the run
    const sealResult = sealCycleAttestation(RUN_ID, io);

    assert.equal(sealResult.ok, true);
    assert.equal(sealResult.cycle, 'integration-cycle');
    assert.equal(sealResult.stage_count, 4);
    assert.match(sealResult.seal_hash, /^[0-9a-f]{64}$/);

    // File should now have 5 lines: 4 stage + 1 cycle seal
    content = io._get(filePath);
    lines = content.trim().split('\n');
    assert.equal(lines.length, 5);

    // Every line must still have a valid _hash (including the new seal line)
    for (let i = 0; i < lines.length; i++) {
      const parsed = JSON.parse(lines[i]);
      assert.ok(typeof parsed._hash === 'string');
      assert.match(parsed._hash, /^[0-9a-f]{64}$/);

      const storedHash = parsed._hash;
      delete parsed._hash;
      assert.equal(
        hashAttestation(parsed),
        storedHash,
        `line ${i + 1} hash mismatch after seal`,
      );
    }

    // The final line is a cycle attestation
    const sealed = JSON.parse(lines[4]);
    assert.equal(sealed.schema, 'foundry-cycle-attestation/v1');
    assert.equal(sealed.cycle, 'integration-cycle');

    // The cycle attestation embeds all 4 stage attestations
    assert.equal(sealed.stage_attestations.length, 4);
    assert.equal(sealed.stage_attestations[0].stage, 'assay');
    assert.equal(sealed.stage_attestations[1].stage, 'forge');
    assert.equal(sealed.stage_attestations[2].stage, 'quench');
    assert.equal(sealed.stage_attestations[3].stage, 'appraise');

    // composite_status should be derived from the stage statuses
    // assay=pass, forge=actioned, quench=pass, appraise=pass → mixed
    assert.equal(sealed.composite_status, 'mixed');
  });
});
