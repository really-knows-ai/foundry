// Stage output buffer — shared in-memory store keyed by stageId::tokenHash.
// Both the stage-output-tool (plugin) and run-appraise (scripts) consume this.

/** @type {Map<string, object[]>} In-memory buffer keyed by stageId::tokenHash. */
const stageOutputsBuffer = new Map();

/**
 * Add a validated data object to the buffer for the given stage and token.
 * @param {string} stageId - The full stage alias (e.g. "forge:cycle-1")
 * @param {string} tokenHash - The token hash for the active stage
 * @param {object} data - The validated data to accumulate
 */
export function pushToStageOutputs(stageId, tokenHash, data) {
  const key = `${stageId}::${tokenHash}`;
  const buf = stageOutputsBuffer.get(key) || [];
  buf.push(data);
  stageOutputsBuffer.set(key, buf);
}

/**
 * Retrieve all accumulated outputs for a given stage ID.
 * Returns a shallow copy of the internal array to prevent mutation.
 * @param {string} stageId - The full stage alias (e.g. "forge:cycle-1")
 * @returns {object[]} Array of validated data objects
 */
export function getStageOutputs(stageId) {
  const results = [];
  for (const [key, outputs] of stageOutputsBuffer) {
    if (key.startsWith(stageId + '::') || key === stageId) {
      results.push(...outputs);
    }
  }
  return results;
}

/**
 * Clear all accumulated outputs for a given stage ID.
 * Used after flushing buffer entries to disk.
 * @param {string} stageId - The full stage alias (e.g. "forge:cycle-1")
 */
export function clearStageOutputs(stageId) {
  for (const key of stageOutputsBuffer.keys()) {
    if (key.startsWith(stageId + '::') || key === stageId) {
      stageOutputsBuffer.delete(key);
    }
  }
}

/**
 * Clear all accumulated outputs for every stage.
 * Internal helper for test isolation — exported with underscore prefix.
 */
export function _clearAllOutputs() {
  stageOutputsBuffer.clear();
}
