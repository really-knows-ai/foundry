import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendStageAttestation,
  hashAttestation,
} from '../../../src/scripts/lib/attestation/hash.js';

/**
 * Create a mock IO object backed by an in-memory Map.
 *
 * Tracks mkdir and appendFile calls for assertion. Supports simulating
 * failures by throwing on demand.
 */
function createMockIo() {
  const files = new Map();
  const mkdirCalls = [];
  let mkdirShouldThrow = false;
  let mkdirThrowError = null;
  let appendShouldThrow = false;
  let appendThrowError = null;

  return {
    files,
    mkdirCalls,
    mkdir: async (dir, opts) => {
      if (mkdirShouldThrow) {
        throw mkdirThrowError || new Error('mkdir failed');
      }
      mkdirCalls.push({ dir, opts });
    },
    appendFile: async (path, data) => {
      if (appendShouldThrow) {
        throw appendThrowError || new Error('append failed');
      }
      const existing = files.get(path) || '';
      files.set(path, existing + data);
    },
    /** Make the next mkdir call throw with an optional custom error. */
    setMkdirShouldThrow(shouldThrow, error) {
      mkdirShouldThrow = shouldThrow;
      mkdirThrowError = error || null;
    },
    /** Make the next appendFile call throw with an optional custom error. */
    setAppendShouldThrow(shouldThrow, error) {
      appendShouldThrow = shouldThrow;
      appendThrowError = error || null;
    },
  };
}

const TEST_RUN_ID = '01JKVT7Z8Q3WN0GJM2TYBR4AA';

const BASE_PARAMS = {
  stage: 'forge',
  cycle: 'test-cycle',
  iteration: 1,
  timestamp: '2026-06-11T14:00:05.000Z',
  evaluations: [],
  violations: 0,
  changed_files: ['haikus/cats.md'],
  feedback_opened: [],
  feedback_resolved: ['fb-01'],
  artefact_hashes: [{ path: 'haikus/cats.md', hash: 'def456' }],
};

describe('appendStageAttestation', () => {
  it('a — writes to correct file path', async () => {
    const io = createMockIo();
    const result = await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    assert.equal(result.ok, true);
    assert.equal(result.filePath, `.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    assert.ok(io.files.has(`.foundry/attestations/${TEST_RUN_ID}.jsonl`));
  });

  it('b — produces valid JSONL', async () => {
    const io = createMockIo();
    await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    const data = io.files.get(`.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    const lines = data.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.doesNotThrow(() => JSON.parse(lines[0]));
  });

  it('c — contains all fields from buildStageAttestation plus _hash', async () => {
    const io = createMockIo();
    await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    const data = io.files.get(`.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    const parsed = JSON.parse(data.trim());

    assert.equal(parsed.schema, 'foundry-stage-attestation/v1');
    assert.equal(parsed.stage, BASE_PARAMS.stage);
    assert.equal(parsed.cycle, BASE_PARAMS.cycle);
    assert.equal(parsed.iteration, BASE_PARAMS.iteration);
    assert.equal(parsed.timestamp, BASE_PARAMS.timestamp);
    assert.equal(parsed.status, 'actioned');
    assert.ok(typeof parsed._hash === 'string');
  });

  it('d — _hash is a 64-char hex string', async () => {
    const io = createMockIo();
    await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    const data = io.files.get(`.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    const parsed = JSON.parse(data.trim());

    assert.match(parsed._hash, /^[0-9a-f]{64}$/);
  });

  it('e — _hash covers the content', async () => {
    const io = createMockIo();
    await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    const data = io.files.get(`.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    const parsed = JSON.parse(data.trim());
    const storedHash = parsed._hash;

    // Remove _hash and recompute
    delete parsed._hash;
    const recomputedHash = hashAttestation(parsed);
    assert.equal(recomputedHash, storedHash);
  });

  it('f — appends rather than overwrites', async () => {
    const io = createMockIo();
    const params1 = { ...BASE_PARAMS, iteration: 1 };
    const params2 = { ...BASE_PARAMS, iteration: 2 };

    await appendStageAttestation(io, TEST_RUN_ID, params1);
    await appendStageAttestation(io, TEST_RUN_ID, params2);

    const data = io.files.get(`.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    const lines = data.trim().split('\n');
    assert.equal(lines.length, 2);

    const obj1 = JSON.parse(lines[0]);
    const obj2 = JSON.parse(lines[1]);
    assert.equal(obj1.iteration, 1);
    assert.equal(obj2.iteration, 2);
  });

  it('g — creates the attestations directory', async () => {
    const io = createMockIo();
    await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    assert.equal(io.mkdirCalls.length, 1);
    assert.equal(io.mkdirCalls[0].dir, '.foundry/attestations');
    assert.deepEqual(io.mkdirCalls[0].opts, { recursive: true });
  });

  it('h — returns { ok: true, filePath, hash } on success', async () => {
    const io = createMockIo();
    const result = await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    assert.equal(result.ok, true);
    assert.equal(typeof result.filePath, 'string');
    assert.equal(result.filePath, `.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    assert.equal(typeof result.hash, 'string');
    assert.match(result.hash, /^[0-9a-f]{64}$/);
    // Should not have an error field on success
    assert.equal(Object.hasOwn(result, 'error'), false);
  });

  it('i — returns { ok: false, error } when mkdir fails', async () => {
    const io = createMockIo();
    const testError = new Error('permission denied');
    io.setMkdirShouldThrow(true, testError);

    const result = await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    assert.equal(result.ok, false);
    assert.equal(result.error, testError);
  });

  it('j — returns { ok: false, error } when appendFile fails', async () => {
    const io = createMockIo();
    const testError = new Error('disk full');
    io.setAppendShouldThrow(true, testError);

    const result = await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    assert.equal(result.ok, false);
    assert.equal(result.error, testError);
  });

  it('k — passes params through to buildStageAttestation', async () => {
    const io = createMockIo();
    await appendStageAttestation(io, TEST_RUN_ID, BASE_PARAMS);

    const data = io.files.get(`.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    const parsed = JSON.parse(data.trim());

    // The output should reflect the input params
    assert.equal(parsed.stage, BASE_PARAMS.stage);
    assert.equal(parsed.cycle, BASE_PARAMS.cycle);
    assert.equal(parsed.iteration, BASE_PARAMS.iteration);
    assert.equal(parsed.timestamp, BASE_PARAMS.timestamp);
    assert.deepEqual(parsed.evaluations, BASE_PARAMS.evaluations);
    assert.equal(parsed.violations, BASE_PARAMS.violations);
    assert.deepEqual(parsed.changed_files, BASE_PARAMS.changed_files.sort());
    assert.deepEqual(parsed.feedback_opened, BASE_PARAMS.feedback_opened);
    assert.deepEqual(parsed.feedback_resolved, BASE_PARAMS.feedback_resolved);
    assert.deepEqual(parsed.artefact_hashes, BASE_PARAMS.artefact_hashes);
  });

  it('l — handles empty optional fields', async () => {
    const io = createMockIo();
    const minimalParams = {
      stage: 'assay',
      cycle: 'test-cycle',
      iteration: 1,
      timestamp: '2026-06-11T14:00:05.000Z',
    };

    await appendStageAttestation(io, TEST_RUN_ID, minimalParams);

    const data = io.files.get(`.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    const parsed = JSON.parse(data.trim());

    // Optional fields should have sensible defaults
    assert.deepEqual(parsed.evaluations, []);
    assert.equal(parsed.violations, 0);
    assert.deepEqual(parsed.changed_files, []);
    assert.deepEqual(parsed.feedback_opened, []);
    assert.deepEqual(parsed.feedback_resolved, []);
    assert.deepEqual(parsed.artefact_hashes, []);
    // _hash must still be present and valid
    assert.match(parsed._hash, /^[0-9a-f]{64}$/);
  });

  it('m — works with human-appraise stage params', async () => {
    const io = createMockIo();
    const humanParams = {
      stage: 'human-appraise',
      cycle: 'test-cycle',
      iteration: 1,
      timestamp: '2026-06-11T14:00:05.000Z',
      verdict: 'resolved',
    };

    const result = await appendStageAttestation(io, TEST_RUN_ID, humanParams);

    assert.equal(result.ok, true);

    const data = io.files.get(`.foundry/attestations/${TEST_RUN_ID}.jsonl`);
    const parsed = JSON.parse(data.trim());

    assert.equal(parsed.stage, 'human-appraise');
    assert.equal(parsed.status, 'resolved');
    // Should have defaulted changed_files to empty array
    assert.deepEqual(parsed.changed_files, []);
    assert.match(parsed._hash, /^[0-9a-f]{64}$/);
  });
});
