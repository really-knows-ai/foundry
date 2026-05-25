/**
 * Forge contract enforcement — validates that forge responded to every
 * presented feedback item and that the batch-level artefact version
 * semantics are satisfied.
 *
 * Per-item check: every item must end in 'actioned' or 'wont-fix'.
 * Batch-level check: if any item is actioned, version must change.
 * If no item is actioned, version must be unchanged.
 */

function currentState(feedbackStore, id) {
  const item = feedbackStore.get(id);
  return item ? item.history[0].state : null;
}

function revertAll(items, feedbackStore, cycleId) {
  for (const item of items) {
    feedbackStore.forceState(item.id, 'open', cycleId);
  }
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

function checkPerItemResponse(items, feedbackStore, cycleId, postVersion) {
  for (const item of items) {
    const state = currentState(feedbackStore, item.id);
    if (state !== 'actioned' && state !== 'wont-fix') {
      revertAll(items, feedbackStore, cycleId);
      postSystemFeedback(
        feedbackStore, cycleId, postVersion,
        'forge did not respond to every presented feedback item',
      );
      return false;
    }
  }
  return true;
}

function hasActionedItem(items, feedbackStore) {
  return items.some(item => currentState(feedbackStore, item.id) === 'actioned');
}

function checkBatchVersion(items, feedbackStore, cycleId, postVersion, preVersion) {
  const hasActioned = hasActionedItem(items, feedbackStore);

  if (hasActioned && preVersion === postVersion) {
    revertAll(items, feedbackStore, cycleId);
    postSystemFeedback(
      feedbackStore, cycleId, postVersion,
      'forge marked feedback as actioned without changing artefacts',
    );
    return { contractPassed: false };
  }

  if (!hasActioned && preVersion !== postVersion) {
    revertAll(items, feedbackStore, cycleId);
    postSystemFeedback(
      feedbackStore, cycleId, postVersion,
      'forge changed artefacts but did not mark any feedback as actioned',
    );
    return { contractPassed: false };
  }

  return { contractPassed: true };
}

/**
 * Enforce the forge contract on a batch of items presented to forge.
 *
 * Two-level check:
 * 1. Per-item: every item must end in 'actioned' or 'wont-fix'.
 * 2. Batch-level: artefact version semantics must be consistent.
 *
 * @param {{ items: Array<{id: string}>, preVersion: string, postVersion: string,
 *   feedbackStore: object, cycleId: string }} params
 * @returns {{ contractPassed: boolean }}
 */
export function enforceForgeContract({ items, preVersion, postVersion, feedbackStore, cycleId }) {
  if (!checkPerItemResponse(items, feedbackStore, cycleId, postVersion)) {
    return { contractPassed: false };
  }

  return checkBatchVersion(items, feedbackStore, cycleId, postVersion, preVersion);
}
