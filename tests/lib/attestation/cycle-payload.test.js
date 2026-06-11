import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCycleAttestation,
  deriveCompositeStatus,
  CYCLE_ATTESTATION_SCHEMA,
} from '../../../src/scripts/lib/attestation/cycle-payload.js';
import { buildStageAttestation } from '../../../src/scripts/lib/attestation/stage-payload.js';

function makeStage(stage, overrides = {}) {
  return buildStageAttestation({
    stage,
    cycle: 'cycle-1',
    iteration: 1,
    timestamp: '2025-06-01T12:00:00.000Z',
    ...overrides,
  });
}

describe('buildCycleAttestation', () => {
  it('returns a frozen object with schema set to foundry-cycle-attestation/v1', () => {
    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [makeStage('forge')],
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.schema, 'foundry-cycle-attestation/v1');
    assert.equal(result.schema, CYCLE_ATTESTATION_SCHEMA);
  });

  it('merging three stage attestations (forge, quench, appraise) produces an array of three in correct order', () => {
    const attForge = makeStage('forge', { iteration: 1 });
    const attQuench = makeStage('quench', { iteration: 1 });
    const attAppraise = makeStage('appraise', { iteration: 1 });

    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [attAppraise, attForge, attQuench],
    });

    assert.equal(result.stage_attestations.length, 3);
    assert.equal(result.stage_attestations[0].stage, 'forge');
    assert.equal(result.stage_attestations[1].stage, 'quench');
    assert.equal(result.stage_attestations[2].stage, 'appraise');
  });

  it('stage attestations are sorted by iteration then stage ordinal', () => {
    const attForge1 = makeStage('forge', { iteration: 1, timestamp: '2025-06-01T12:00:00.000Z' });
    const attQuench1 = makeStage('quench', { iteration: 1, timestamp: '2025-06-01T12:01:00.000Z' });
    const attForge2 = makeStage('forge', { iteration: 2, timestamp: '2025-06-01T13:00:00.000Z' });

    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [attForge2, attQuench1, attForge1],
    });

    assert.equal(result.stage_attestations.length, 3);
    assert.equal(result.stage_attestations[0].stage, 'forge');
    assert.equal(result.stage_attestations[0].iteration, 1);
    assert.equal(result.stage_attestations[1].stage, 'quench');
    assert.equal(result.stage_attestations[1].iteration, 1);
    assert.equal(result.stage_attestations[2].stage, 'forge');
    assert.equal(result.stage_attestations[2].iteration, 2);
  });

  it('empty stage attestations array produces TypeError', () => {
    assert.throws(
      () => buildCycleAttestation({ cycle: 'cycle-1', stage_attestations: [] }),
      /non-empty/,
    );
  });

  it('governance section is present with file hashes', () => {
    const governance = { workfile_hashes: { 'WORK.md': 'abc' }, config_commit: 'sha1' };
    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [makeStage('forge')],
      governance,
    });
    assert.ok(result.governance);
    assert.equal(result.governance.workfile_hashes['WORK.md'], 'abc');
    assert.equal(result.governance.config_commit, 'sha1');
  });
});

describe('deriveCompositeStatus', () => {
  function stageWithStatus(status) {
    return { ...makeStage('forge'), status };
  }

  it('returns "pass" when all children are "pass"', () => {
    assert.equal(
      deriveCompositeStatus([stageWithStatus('pass'), stageWithStatus('pass')]),
      'pass',
    );
  });

  it('returns "fail" when any child is "fail"', () => {
    assert.equal(
      deriveCompositeStatus([stageWithStatus('pass'), stageWithStatus('fail')]),
      'fail',
    );
  });

  it('returns "rejected" when any child is "rejected"', () => {
    assert.equal(
      deriveCompositeStatus([stageWithStatus('pass'), stageWithStatus('rejected')]),
      'rejected',
    );
  });

  it('returns "incomplete" when any child is "incomplete" but none failed', () => {
    assert.equal(
      deriveCompositeStatus([stageWithStatus('pass'), stageWithStatus('incomplete')]),
      'incomplete',
    );
  });

  it('returns "mixed" when children have statuses that do not resolve to a single category', () => {
    assert.equal(
      deriveCompositeStatus([stageWithStatus('pass'), stageWithStatus('actioned')]),
      'mixed',
    );
  });
});

describe('feedback and artefact summaries', () => {
  it('feedback_summary counts opened, resolved, rejected, and open_remaining across stage attestations', () => {
    const forge = makeStage('forge', {
      feedback_opened: ['fb-1', 'fb-2'],
      feedback_resolved: [],
    });
    const quench = makeStage('quench', {
      feedback_opened: ['fb-3'],
      feedback_resolved: ['fb-1'],
    });
    const appraise = makeStage('appraise', {
      feedback_opened: [],
      feedback_resolved: ['fb-2', 'fb-3'],
    });

    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [forge, quench, appraise],
    });

    assert.equal(result.feedback_summary.opened, 3);
    assert.equal(result.feedback_summary.resolved, 3);
    assert.equal(result.feedback_summary.rejected, 0);
    assert.equal(result.feedback_summary.open_remaining, 0);
  });

  it('feedback_summary counts rejected when a human-appraise stage is rejected', () => {
    const forge = makeStage('forge', {
      feedback_opened: ['fb-1', 'fb-2'],
      feedback_resolved: [],
    });
    const rejected = makeStage('human-appraise', {
      feedback_opened: ['fb-3'],
      feedback_resolved: ['fb-1', 'fb-2'],
      verdict: 'rejected',
    });

    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [forge, rejected],
    });

    assert.equal(result.feedback_summary.opened, 3);
    assert.equal(result.feedback_summary.resolved, 2);
    // rejected stage contributes its feedback_resolved count
    assert.equal(result.feedback_summary.rejected, 2);
    assert.equal(result.feedback_summary.open_remaining, 1);
  });

  it('artefact_summary.total_changed sums unique changed files across stages', () => {
    const forge = makeStage('forge', { changed_files: ['a.txt', 'b.txt'] });
    const quench = makeStage('quench', { changed_files: ['b.txt', 'c.txt'] });

    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [forge, quench],
    });

    // Unique files: a.txt, b.txt, c.txt = 3
    assert.equal(result.artefact_summary.total_changed, 3);
    assert.equal(result.artefact_summary.unique_paths, 3);
  });
});

describe('cycle_duration_ms', () => {
  it('is null when only one stage attestation exists', () => {
    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [makeStage('forge')],
    });
    assert.equal(result.cycle_duration_ms, null);
  });

  it('is positive when two or more stage attestations with timestamps exist', () => {
    const early = makeStage('forge', { timestamp: '2025-06-01T12:00:00.000Z' });
    const late = makeStage('quench', { timestamp: '2025-06-01T12:05:30.000Z' });

    const result = buildCycleAttestation({
      cycle: 'cycle-1',
      stage_attestations: [early, late],
    });

    assert.ok(result.cycle_duration_ms > 0);
    // 5 minutes 30 seconds = 330000 ms
    assert.equal(result.cycle_duration_ms, 330000);
  });
});
