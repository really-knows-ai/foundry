import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStageAttestation,
  deriveStageStatus,
  STAGE_ATTESTATION_SCHEMA,
} from '../../../src/scripts/lib/attestation/stage-payload.js';

function minimalParams(overrides = {}) {
  return {
    stage: 'forge',
    cycle: 'cycle-1',
    iteration: 1,
    timestamp: '2025-06-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildStageAttestation', () => {
  it('returns a frozen object with schema set to foundry-stage-attestation/v1', () => {
    const result = buildStageAttestation(minimalParams());
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.schema, 'foundry-stage-attestation/v1');
    assert.equal(result.schema, STAGE_ATTESTATION_SCHEMA);
  });

  it('all five valid stage names produce a successful attestation', () => {
    const stages = ['assay', 'forge', 'quench', 'appraise', 'human-appraise'];
    for (const stage of stages) {
      const result = buildStageAttestation(minimalParams({ stage }));
      assert.equal(result.stage, stage);
    }
  });

  it('an invalid stage name throws TypeError', () => {
    assert.throws(
      () => buildStageAttestation(minimalParams({ stage: 'invalid-stage' })),
      /Invalid stage name/,
    );
  });

  it('required fields produce correct output shape', () => {
    const result = buildStageAttestation(minimalParams());
    assert.equal(result.stage, 'forge');
    assert.equal(result.cycle, 'cycle-1');
    assert.equal(result.iteration, 1);
    assert.equal(result.timestamp, '2025-06-01T12:00:00.000Z');
    assert.equal(typeof result.status, 'string');
  });

  it('changed_files is sorted deterministically', () => {
    const result = buildStageAttestation(minimalParams({
      changed_files: ['b', 'a', 'c'],
    }));
    assert.deepEqual(result.changed_files, ['a', 'b', 'c']);
  });

  it('feedback_opened and feedback_resolved default to empty arrays', () => {
    const result = buildStageAttestation(minimalParams());
    assert.deepEqual(result.feedback_opened, []);
    assert.deepEqual(result.feedback_resolved, []);
  });

  it('artefact_hashes defaults to empty array when not supplied', () => {
    const result = buildStageAttestation(minimalParams());
    assert.deepEqual(result.artefact_hashes, []);
  });

  it('missing required stage field throws TypeError', () => {
    const params = minimalParams();
    delete params.stage;
    assert.throws(() => buildStageAttestation(params), /stage/);
  });

  it('missing required cycle field throws TypeError', () => {
    const params = minimalParams();
    delete params.cycle;
    assert.throws(() => buildStageAttestation(params), /cycle/);
  });
});

describe('deriveStageStatus — forge', () => {
  it('returns "pass" for forge with no violations and no changed files', () => {
    assert.equal(
      deriveStageStatus('forge', [], 0, { changed_files: [] }),
      'pass',
    );
  });

  it('returns "actioned" for forge with changed files', () => {
    assert.equal(
      deriveStageStatus('forge', [], 0, { changed_files: ['fix.txt'], wont_fix: false }),
      'actioned',
    );
  });

  it('returns "wont-fix" for forge with wont-fix flag true', () => {
    assert.equal(
      deriveStageStatus('forge', [], 0, { changed_files: [], wont_fix: true }),
      'wont-fix',
    );
  });

  it('returns "fail" for forge with violations > 0', () => {
    assert.equal(
      deriveStageStatus('forge', [], 2, { changed_files: [] }),
      'fail',
    );
  });
});

describe('deriveStageStatus — quench', () => {
  it('returns "fail" for quench with violations > 0', () => {
    assert.equal(
      deriveStageStatus('quench', [{ appraiser: 'a', pass: true, completed: true }], 3),
      'fail',
    );
  });

  it('returns "incomplete" for quench with incomplete evaluations', () => {
    assert.equal(
      deriveStageStatus('quench', [
        { appraiser: 'a', pass: true, completed: true },
        { appraiser: 'b', pass: true, completed: false },
      ], 0),
      'incomplete',
    );
  });

  it('returns "pass" for quench with zero violations and all complete', () => {
    assert.equal(
      deriveStageStatus('quench', [
        { appraiser: 'a', pass: true, completed: true },
        { appraiser: 'b', pass: true, completed: true },
      ], 0),
      'pass',
    );
  });

  it('violations take precedence over incomplete evaluations for quench', () => {
    assert.equal(
      deriveStageStatus('quench', [
        { appraiser: 'a', pass: true, completed: true },
        { appraiser: 'b', pass: true, completed: false },
      ], 1),
      'fail',
    );
  });
});

describe('deriveStageStatus — appraise', () => {
  it('returns "pass" for appraise when all verdicts resolved', () => {
    assert.equal(
      deriveStageStatus('appraise', [], 0, {
        appraiser_verdicts: [{ appraiser: 'a', verdict: 'resolved' }],
      }),
      'pass',
    );
  });

  it('returns "fail" for appraise when any verdict is rejected', () => {
    assert.equal(
      deriveStageStatus('appraise', [], 0, {
        appraiser_verdicts: [
          { appraiser: 'a', verdict: 'resolved' },
          { appraiser: 'b', verdict: 'rejected' },
        ],
      }),
      'fail',
    );
  });

  it('returns "incomplete" for appraise when some appraisers resolved and some not yet responded', () => {
    assert.equal(
      deriveStageStatus('appraise', [
        { appraiser: 'a', pass: true, completed: true },
        { appraiser: 'b', pass: true, completed: false },
      ], 0, {
        appraiser_verdicts: [{ appraiser: 'a', verdict: 'resolved' }],
      }),
      'incomplete',
    );
  });
});

describe('deriveStageStatus — human-appraise', () => {
  it('returns "resolved" for human-appraise with approve', () => {
    assert.equal(
      deriveStageStatus('human-appraise', [], 0, { verdict: 'resolved' }),
      'resolved',
    );
  });

  it('returns "rejected" for human-appraise with reject', () => {
    assert.equal(
      deriveStageStatus('human-appraise', [], 0, { verdict: 'rejected' }),
      'rejected',
    );
  });

  it('returns "fail" for human-appraise with violation', () => {
    assert.equal(
      deriveStageStatus('human-appraise', [], 0, { verdict: 'violation' }),
      'fail',
    );
  });
});

describe('deriveStageStatus — assay', () => {
  it('returns "pass" for assay when all extractors completed', () => {
    assert.equal(
      deriveStageStatus('assay', [
        { appraiser: 'ext-a', pass: true, completed: true },
        { appraiser: 'ext-b', pass: true, completed: true },
      ], 0),
      'pass',
    );
  });

  it('returns "incomplete" for assay when any extractor incomplete', () => {
    assert.equal(
      deriveStageStatus('assay', [
        { appraiser: 'ext-a', pass: true, completed: true },
        { appraiser: 'ext-b', pass: true, completed: false },
      ], 0),
      'incomplete',
    );
  });
});
