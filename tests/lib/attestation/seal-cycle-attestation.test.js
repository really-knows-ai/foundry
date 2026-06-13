import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sealCycleAttestation,
  hashAttestation,
} from '../../../src/scripts/lib/attestation/hash.js';
import { buildStageAttestation } from '../../../src/scripts/lib/attestation/stage-payload.js';
import { buildCycleAttestation } from '../../../src/scripts/lib/attestation/cycle-payload.js';
import { makeMockIO } from '../../helpers/mock-io.js';

// ---------------------------------------------------------------------------
// Helpers for building valid JSONL fixture lines
// ---------------------------------------------------------------------------

/**
 * Build a single self-verifying stage attestation JSON line.
 */
function makeStageLine(params) {
  const att = buildStageAttestation(params);
  const h = hashAttestation(att);
  return JSON.stringify({ ...att, _hash: h });
}

/**
 * Build a self-verifying cycle attestation JSON line from an array of
 * stage attestation objects.
 */
function makeCycleLine(stageAtts, cycle) {
  const att = buildCycleAttestation({
    cycle,
    stage_attestations: stageAtts,
    governance: null,
  });
  const h = hashAttestation(att);
  return JSON.stringify({ ...att, _hash: h });
}

// ---------------------------------------------------------------------------
// Shared fixture params
// ---------------------------------------------------------------------------

const RUN_ID = '01JKVT7Z8Q3WN0GJM2TYBR4AA';

const STAGE_1 = {
  stage: 'forge',
  cycle: 'test-cycle',
  iteration: 1,
  timestamp: '2026-06-11T14:00:05.000Z',
  evaluations: [],
  violations: 0,
  changed_files: ['test.md'],
  feedback_opened: [],
  feedback_resolved: ['fb-01'],
  artefact_hashes: [{ path: 'test.md', hash: 'abc123' }],
};

const STAGE_2 = {
  stage: 'quench',
  cycle: 'test-cycle',
  iteration: 1,
  timestamp: '2026-06-11T14:00:10.000Z',
  evaluations: [{ appraiser: 'test', verdict: 'passed', completed: true }],
  violations: 0,
  changed_files: [],
  feedback_opened: [],
  feedback_resolved: [],
  artefact_hashes: [],
};

const STAGE_3 = {
  stage: 'appraise',
  cycle: 'test-cycle',
  iteration: 1,
  timestamp: '2026-06-11T14:00:15.000Z',
  evaluations: [{ appraiser: 'test', verdict: 'passed', completed: true }],
  violations: 0,
  changed_files: [],
  feedback_opened: [],
  feedback_resolved: [],
  artefact_hashes: [],
  appraiser_verdicts: [{ appraiser: 'test', verdict: 'resolved' }],
};

// ---------------------------------------------------------------------------
// Group A1 — All lines have hash mismatches
// ---------------------------------------------------------------------------

describe('Group A1 — all lines have hash mismatches', () => {
  it('seals with composite_status incomplete when all stage lines have hash mismatches and are skipped', async () => {
    // Build valid lines then tamper with content to create hash mismatches
    const line1 = makeStageLine(STAGE_1);
    const line2 = makeStageLine(STAGE_2);
    // Tamper: change a value so the hash no longer matches
    const tampered1 = line1.replace('"forge"', '"hacked"');
    const tampered2 = line2.replace('"quench"', '"hacked"');

    const initialContent = [tampered1, tampered2].join('\n') + '\n';

    const io = makeMockIO({
      [`.foundry/attestations/${RUN_ID}.jsonl`]: initialContent,
    });

    const result = await sealCycleAttestation(RUN_ID, io);

    assert.equal(result.ok, true);
    assert.equal(result.composite_status, 'incomplete');
    assert.equal(result.stage_count, 0);
    assert.equal(result.cycle, RUN_ID);
    assert.match(result.seal_hash, /^[0-9a-f]{64}$/);

    // File should have 3 lines: 2 original tampered + 1 seal
    const content = io._get(`.foundry/attestations/${RUN_ID}.jsonl`);
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 3);

    const sealed = JSON.parse(lines[2]);
    assert.equal(sealed.schema, 'foundry-cycle-attestation/v1');
    assert.equal(sealed.composite_status, 'incomplete');
    assert.equal(sealed.stage_attestations.length, 0);
    assert.match(sealed._hash, /^[0-9a-f]{64}$/);

    // Verify seal hash recomputes
    const storedHash = sealed._hash;
    delete sealed._hash;
    assert.equal(hashAttestation(sealed), storedHash);
  });
});

// ---------------------------------------------------------------------------
// Group A — Happy path (multiple verified stage lines)
// ---------------------------------------------------------------------------

describe('Group A — happy path with 3 valid stage lines', () => {
  it('seals a run with multiple stage attestations', async () => {
    const line1 = makeStageLine(STAGE_1);
    const line2 = makeStageLine(STAGE_2);
    const line3 = makeStageLine(STAGE_3);
    const initialContent = [line1, line2, line3].join('\n') + '\n';

    const io = makeMockIO({
      [`.foundry/attestations/${RUN_ID}.jsonl`]: initialContent,
    });

    const result = await sealCycleAttestation(RUN_ID, io);

    assert.equal(result.ok, true);
    assert.equal(result.cycle, 'test-cycle');
    assert.equal(result.stage_count, 3);
    assert.match(result.seal_hash, /^[0-9a-f]{64}$/);
    // composite_status should not be 'incomplete' with 3 validated stages
    assert.notEqual(result.composite_status, 'incomplete');

    // File should have 4 lines: 3 original + 1 seal
    const content = io._get(`.foundry/attestations/${RUN_ID}.jsonl`);
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 4);

    // Parse final line and verify cycle attestation structure
    const sealed = JSON.parse(lines[3]);
    assert.equal(sealed.schema, 'foundry-cycle-attestation/v1');
    assert.equal(sealed.cycle, 'test-cycle');
    assert.ok(Array.isArray(sealed.stage_attestations));
    assert.equal(sealed.stage_attestations.length, 3);
    assert.match(sealed._hash, /^[0-9a-f]{64}$/);

    // Verify seal _hash recomputes correctly
    const storedHash = sealed._hash;
    delete sealed._hash;
    assert.equal(hashAttestation(sealed), storedHash);
  });
});

// ---------------------------------------------------------------------------
// Group B — Empty file
// ---------------------------------------------------------------------------

describe('Group B — empty file', () => {
  it('seals with composite_status incomplete and stage_count 0', async () => {
    const io = makeMockIO({
      [`.foundry/attestations/${RUN_ID}.jsonl`]: '',
    });

    const result = await sealCycleAttestation(RUN_ID, io);

    assert.equal(result.ok, true);
    assert.equal(result.composite_status, 'incomplete');
    assert.equal(result.stage_count, 0);
    assert.equal(result.cycle, RUN_ID);
    assert.match(result.seal_hash, /^[0-9a-f]{64}$/);

    // File should have 1 line: the seal line
    const content = io._get(`.foundry/attestations/${RUN_ID}.jsonl`);
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 1);

    const sealed = JSON.parse(lines[0]);
    assert.equal(sealed.schema, 'foundry-cycle-attestation/v1');
    assert.equal(sealed.composite_status, 'incomplete');
    assert.deepEqual(sealed.stage_attestations, []);
    assert.match(sealed._hash, /^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Group C — Non-existent file
// ---------------------------------------------------------------------------

describe('Group C — non-existent file', () => {
  it('returns {ok:false, error} when attestation file does not exist', async () => {
    // No file in the store
    const io = makeMockIO({});

    const result = await sealCycleAttestation(RUN_ID, io);

    assert.equal(result.ok, false);
    assert.equal(result.error, `no attestation file found for run ${RUN_ID}`);
  });
});

// ---------------------------------------------------------------------------
// Group C1 — IO read failure
// ---------------------------------------------------------------------------

describe('Group C1 — IO read failure', () => {
  it('propagates readFile error', async () => {
    const io = {
      exists: () => true,
      readFile: () => { throw new Error('permission denied'); },
      appendFile: () => {},
    };

    await assert.rejects(
      async () => await sealCycleAttestation(RUN_ID, io),
      { message: 'permission denied' },
    );
  });
});

// ---------------------------------------------------------------------------
// Group D — Only unparseable lines
// ---------------------------------------------------------------------------

describe('Group D — only unparseable lines', () => {
  it('seals with composite_status incomplete when all lines are corrupt', async () => {
    const io = makeMockIO({
      [`.foundry/attestations/${RUN_ID}.jsonl`]: 'not json\n{also: not}\n',
    });

    const result = await sealCycleAttestation(RUN_ID, io);

    assert.equal(result.ok, true);
    assert.equal(result.composite_status, 'incomplete');
    assert.equal(result.stage_count, 0);
    assert.equal(result.cycle, RUN_ID);
    assert.match(result.seal_hash, /^[0-9a-f]{64}$/);

    // File should have 3 lines: 2 original unparseable + 1 seal
    const content = io._get(`.foundry/attestations/${RUN_ID}.jsonl`);
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 3);

    const sealed = JSON.parse(lines[2]);
    assert.equal(sealed.schema, 'foundry-cycle-attestation/v1');
    assert.equal(sealed.composite_status, 'incomplete');
    assert.deepEqual(sealed.stage_attestations, []);
    assert.match(sealed._hash, /^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Group E — Mixed valid, corrupt, and tampered lines
// ---------------------------------------------------------------------------

describe('Group E — mixed valid, corrupt, and tampered lines', () => {
  it('builds composite from verified lines only and logs warnings', async () => {
    const line1 = makeStageLine(STAGE_1);
    const line3 = makeStageLine(STAGE_3);

    // Create a tampered line: valid forge hash but wrong content
    const forgedLine = makeStageLine(STAGE_1);
    const tamperedLine = forgedLine.replace('"test.md"', '"evil.md"');

    const initialContent = [
      line1,
      'not valid json',
      tamperedLine,
      line3,
    ].join('\n') + '\n';

    const io = makeMockIO({
      [`.foundry/attestations/${RUN_ID}.jsonl`]: initialContent,
    });

    // Spy on console.error and console.warn
    const originalError = console.error;
    const originalWarn = console.warn;
    const errorCalls = [];
    console.error = (...args) => { errorCalls.push(args.join(' ')); };
    console.warn = (...args) => { errorCalls.push(args.join(' ')); };

    try {
      const result = await sealCycleAttestation(RUN_ID, io);

      assert.equal(result.ok, true);
      assert.equal(result.stage_count, 2);
      assert.match(result.seal_hash, /^[0-9a-f]{64}$/);

      // File should have 5 lines: 4 original + 1 seal
      const content = io._get(`.foundry/attestations/${RUN_ID}.jsonl`);
      const lines = content.trim().split('\n');
      assert.equal(lines.length, 5);

      // Verify warnings were logged for corrupt lines and hash mismatches
      assert.ok(errorCalls.length >= 2);
      const allWarnings = errorCalls.join(' ');
      assert.ok(allWarnings.includes('unparseable'));
      assert.ok(allWarnings.includes('hash mismatch'));

      // Parse final seal line
      const sealed = JSON.parse(lines[4]);
      assert.equal(sealed.schema, 'foundry-cycle-attestation/v1');
      assert.equal(sealed.stage_attestations.length, 2);
      const hasTampered = sealed.stage_attestations.some(a => a._hash_mismatch === true);
      assert.equal(hasTampered, false, 'tampered attestations should be excluded from the composite');
      assert.match(sealed._hash, /^[0-9a-f]{64}$/);

      // Verify seal hash
      const storedHash = sealed._hash;
      delete sealed._hash;
      assert.equal(hashAttestation(sealed), storedHash);
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// Group F — Pre-existing cycle line with valid hash
// ---------------------------------------------------------------------------

describe('Group F — pre-existing cycle line with valid hash', () => {
  it('excludes pre-existing cycle line from stage_attestations', async () => {
    const line1 = makeStageLine(STAGE_1);
    const line2 = makeStageLine(STAGE_2);

    // Build a valid cycle attestation from these two stages
    const att1 = buildStageAttestation(STAGE_1);
    const att2 = buildStageAttestation(STAGE_2);
    const cycleLine = makeCycleLine([att1, att2], 'test-cycle');

    const initialContent = [line1, line2, cycleLine].join('\n') + '\n';

    const io = makeMockIO({
      [`.foundry/attestations/${RUN_ID}.jsonl`]: initialContent,
    });

    const result = await sealCycleAttestation(RUN_ID, io);

    // stage_count should be 2 (stage lines only, not the cycle line)
    assert.equal(result.stage_count, 2);
    assert.equal(result.ok, true);
    assert.match(result.seal_hash, /^[0-9a-f]{64}$/);

    // File should have 4 lines: 2 stage + 1 pre-existing cycle + 1 new seal
    const content = io._get(`.foundry/attestations/${RUN_ID}.jsonl`);
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 4);

    // Third line is the pre-existing cycle line, fourth is the new seal
    const preExisting = JSON.parse(lines[2]);
    assert.equal(preExisting.schema, 'foundry-cycle-attestation/v1');
    assert.equal(preExisting.stage_attestations.length, 2);

    const newSeal = JSON.parse(lines[3]);
    assert.equal(newSeal.schema, 'foundry-cycle-attestation/v1');
    assert.equal(newSeal.stage_attestations.length, 2);

    // Both cycle lines should have valid hashes
    const preHash = preExisting._hash;
    delete preExisting._hash;
    assert.equal(hashAttestation(preExisting), preHash);

    const newHash = newSeal._hash;
    delete newSeal._hash;
    assert.equal(hashAttestation(newSeal), newHash);
  });
});

// ---------------------------------------------------------------------------
// Group G — Pre-existing cycle line with bad hash
// ---------------------------------------------------------------------------

describe('Group G — pre-existing cycle line with bad hash', () => {
  it('ignores tampered cycle line and seals from stage lines only', async () => {
    const line1 = makeStageLine(STAGE_1);
    const line2 = makeStageLine(STAGE_2);

    // Create a cycle attestation then tamper with a value
    const att1 = buildStageAttestation(STAGE_1);
    const att2 = buildStageAttestation(STAGE_2);
    const cycleLine = makeCycleLine([att1, att2], 'test-cycle');
    // Tamper: replace the composite_status
    const tamperedCycleLine = cycleLine.replace('"pass"', '"incomplete"');

    const initialContent = [line1, line2, tamperedCycleLine].join('\n') + '\n';

    const io = makeMockIO({
      [`.foundry/attestations/${RUN_ID}.jsonl`]: initialContent,
    });

    const result = await sealCycleAttestation(RUN_ID, io);

    // Tampered cycle line is skipped; seal succeeds with the two valid stage lines
    assert.equal(result.ok, true);
    assert.equal(result.stage_count, 2);
  });
});

// ---------------------------------------------------------------------------
// Group H — Single valid stage line
// ---------------------------------------------------------------------------

describe('Group H — single valid stage line', () => {
  it('seals with stage_count 1 and correct composite_status', async () => {
    const line1 = makeStageLine({
      stage: 'assay',
      cycle: 'test-cycle',
      iteration: 1,
      timestamp: '2026-06-11T14:00:05.000Z',
      evaluations: [{ appraiser: 'test', verdict: 'passed', completed: true }],
    });

    const io = makeMockIO({
      [`.foundry/attestations/${RUN_ID}.jsonl`]: line1 + '\n',
    });

    const result = await sealCycleAttestation(RUN_ID, io);

    assert.equal(result.ok, true);
    assert.equal(result.cycle, 'test-cycle');
    assert.equal(result.stage_count, 1);
    assert.equal(result.composite_status, 'pass');
    assert.match(result.seal_hash, /^[0-9a-f]{64}$/);

    // File should have 2 lines: 1 stage + 1 seal
    const content = io._get(`.foundry/attestations/${RUN_ID}.jsonl`);
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);

    const sealed = JSON.parse(lines[1]);
    assert.equal(sealed.schema, 'foundry-cycle-attestation/v1');
    assert.equal(sealed.stage_attestations.length, 1);
    assert.equal(sealed.stage_attestations[0].stage, 'assay');
    assert.match(sealed._hash, /^[0-9a-f]{64}$/);

    // Verify seal hash
    const storedHash = sealed._hash;
    delete sealed._hash;
    assert.equal(hashAttestation(sealed), storedHash);
  });
});
