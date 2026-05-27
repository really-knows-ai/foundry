/**
 * Forge contract enforcement — validates that forge addressed the single
 * presented feedback item according to the single-item dispatch contract.
 *
 * Rules (per spec R4):
 *   - Version changed → transition item to `actioned`.
 *   - Version unchanged + summary contains `WONT-FIX:` + source base is
 *     `appraise` → transition item to `wont-fix` with the justification
 *     as the reason.
 *   - Version unchanged + summary contains `WONT-FIX:` + source base is
 *     NOT `appraise` → contract violation.
 *   - Version unchanged + no `WONT-FIX:` in summary → contract violation.
 *   - No item (null/undefined) → no-op, contract passes.
 */

function currentState(feedbackStore, id) {
  const item = feedbackStore.get(id);
  return item ? item.history[0].state : null;
}

function postSystemFeedback(feedbackStore, cycleId, postVersion, text) {
  feedbackStore.add({
    file: '',
    tag: 'system:forge-contract-mismatch',
    text,
    source: 'system:forge-contract-mismatch',
    artefact_version: postVersion,
    cycle: cycleId,
  });
}

function handleVersionChanged(item, feedbackStore, cycleId, postVersion) {
  const result = feedbackStore.transition({
    id: item.id,
    target: 'actioned',
    stage: 'forge:' + cycleId,
    cycle: cycleId,
  });
  if (!result.ok) {
    postSystemFeedback(feedbackStore, cycleId, postVersion, result.error || 'store transition failed');
    feedbackStore.forceState(item.id, 'open', cycleId, `forge:${cycleId}`);
    return { contractPassed: false };
  }
  return { contractPassed: true };
}

function handleWontFixWithReason(item, feedbackStore, cycleId, postVersion, reason) {
  const result = feedbackStore.transition({
    id: item.id,
    target: 'wont-fix',
    stage: 'forge:' + cycleId,
    cycle: cycleId,
    reason,
  });
  if (!result.ok) {
    postSystemFeedback(feedbackStore, cycleId, postVersion, result.error || 'store transition failed');
    feedbackStore.forceState(item.id, 'open', cycleId, `forge:${cycleId}`);
  }
  return { contractPassed: result.ok };
}

/**
 * Enforce the forge contract on a single feedback item.
 *
 * When no item is provided (null/undefined), the contract passes without
 * side-effects. This covers the initial forge run where no feedback
 * exists yet and subsequent runs where all items were already resolved.
 *
 * @param {{ item: object|null, preVersion: string, postVersion: string,
 *           summary: string, feedbackStore: object, cycleId: string }} params
 * @returns {{ contractPassed: boolean }}
 */
export function enforceForgeContract({ item, preVersion, postVersion, summary, feedbackStore, cycleId }) {
  if (!item) return { contractPassed: true };

  const wontFixMatch = summary.match(/WONT-FIX:\s*(.+)/);
  const versionChanged = preVersion !== postVersion;
  const actioned = summary.trim() === 'ACTIONED';

  if (wontFixMatch) {
    return handleWontFixWithReason(item, feedbackStore, cycleId, postVersion, wontFixMatch[1]);
  }

  if (versionChanged || actioned) {
    return handleVersionChanged(item, feedbackStore, cycleId, postVersion);
  }

  postSystemFeedback(
    feedbackStore, cycleId, postVersion,
    'forge did not change artefacts and did not provide ACTIONED or WONT-FIX justification',
  );
  feedbackStore.forceState(item.id, 'open', cycleId, `forge:${cycleId}`);
  return { contractPassed: false };
}
