/**
 * Pure resolver for the law-group config cascade (R6).
 *
 * Given a group name, flow-level group definitions, artefact-type override
 * map, and the full appraiser pool, returns the effective
 * `{ mode, passes, appraisers, warnings }` by applying three layers:
 * built-in defaults → flow-level override → artefact-type pool override.
 *
 * This module performs no IO and has no side effects.
 */

/**
 * Resolve the effective configuration for a law group.
 *
 * @param {string} groupName - The group to resolve
 * @param {Record<string, {mode?: string, passes?: number, appraisers?: string[]}>} flowGroups
 *   Flow-level group definitions from Phase 02
 * @param {Record<string, string[] | {mode?, passes?, appraisers?}> | null | undefined} typeAppraisers
 *   Artefact-type override map keyed by group name
 * @param {Array<{id: string}>} fullAppraiserPool - Complete list of available appraisers
 * @param {string} [artefactTypeId] - Artefact-type identifier for error messages
 * @returns {{mode: string, passes: number, appraisers: Array<{id: string}>, warnings: string[]}}
 */
export function resolveGroupConfig(groupName, flowGroups, typeAppraisers, fullAppraiserPool, artefactTypeId) {
  // Step 1: Built-in defaults
  const acc = {
    mode: 'bundle',
    passes: 1,
    appraisers: fullAppraiserPool,
  };

  const warnings = [];

  // Step 2: Flow-level override
  applyFlowOverride(groupName, flowGroups, acc, warnings, fullAppraiserPool);

  // Step 3: Artefact-type override
  if (typeAppraisers !== null && typeAppraisers !== undefined) {
    detectLegacyKeys(typeAppraisers, artefactTypeId);
    applyTypeOverride(groupName, typeAppraisers, acc, warnings, { fullAppraiserPool, artefactTypeId });
  }

  return { mode: acc.mode, passes: acc.passes, appraisers: acc.appraisers, warnings };
}

/**
 * Overlay flow-level group definition fields onto the accumulator.
 * Validates `passes` and collects unknown-appraiser warnings.
 */
function applyFlowOverride(groupName, flowGroups, acc, warnings, fullAppraiserPool) {
  // Object.hasOwn is safe with null/undefined — returns false
  if (!Object.hasOwn(flowGroups, groupName)) return;

  const flowDef = flowGroups[groupName];

  if (flowDef.mode !== undefined) {
    acc.mode = flowDef.mode;
  }

  if (flowDef.passes !== undefined) {
    acc.passes = flowDef.passes;
    validatePasses(acc.passes, groupName);
  }

  if (flowDef.appraisers !== undefined) {
    acc.appraisers = filterAppraiserPool(groupName, flowDef.appraisers, fullAppraiserPool, warnings, 'in flow definition');
  }
}

/**
 * Apply the artefact-type override for a group.
 * Legacy keys are detected before reaching this function.
 */
function applyTypeOverride(groupName, typeAppraisers, acc, warnings, opts) {
  if (!Object.hasOwn(typeAppraisers, groupName)) return;

  const value = typeAppraisers[groupName];

  // null is a no-op
  if (value === null) return;

  validateTypeAppraisersValue(value, groupName, opts.artefactTypeId);

  if (Array.isArray(value)) {
    // Array form — direct pool override
    acc.appraisers = filterAppraiserPool(groupName, value, opts.fullAppraiserPool, warnings, 'in type override');
    return;
  }

  // Object form — warn about mode/passes, apply appraisers pool only
  collectTypeOverrideWarnings(value, groupName, warnings);

  if (value.appraisers !== undefined) {
    acc.appraisers = filterAppraiserPool(groupName, value.appraisers, opts.fullAppraiserPool, warnings, 'in type override');
  }
}

/**
 * Validate that `passes` is an integer ≥ 1.
 * @throws {Error} named after the group when validation fails
 */
function validatePasses(value, groupName) {
  if (typeof value !== 'number') {
    throw new Error(`Group "${groupName}": passes must be an integer ≥ 1, got ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Group "${groupName}": passes must be an integer ≥ 1, got ${value}`);
  }
  if (value < 1) {
    throw new Error(`Group "${groupName}": passes must be an integer ≥ 1, got ${value}`);
  }
}

/**
 * Check for legacy artefact-type keys `count` and `allowed` at the top
 * level of `typeAppraisers`. Throws if either is found, with a message
 * that includes the artefact type name when `artefactTypeId` is provided.
 * @throws {Error} naming the legacy key and (optionally) the artefact type
 */
function detectLegacyKeys(typeAppraisers, artefactTypeId) {
  const legacyKeys = ['count', 'allowed'];
  for (const key of legacyKeys) {
    if (Object.hasOwn(typeAppraisers, key)) {
      const prefix = artefactTypeId ? `Artefact type "${artefactTypeId}": ` : '';
      throw new Error(`${prefix}legacy key "${key}" found in appraisers — remove it and run upgrade-foundry`);
    }
  }
}

/**
 * Validate that a `typeAppraisers` group value is either an array or a
 * plain object. Throws with a message naming the group and (optionally)
 * the artefact type when it is neither.
 * @throws {Error} when the value type is invalid
 */
function validateTypeAppraisersValue(value, groupName, artefactTypeId) {
  if (Array.isArray(value)) return;
  if (typeof value === 'object') return;

  const typePart = artefactTypeId ? ` (artefact type "${artefactTypeId}")` : '';
  throw new Error(`Group "${groupName}"${typePart}: invalid appraisers value — expected an array or object, got ${typeof value}`);
}

/**
 * Filter the full appraiser pool to include only entries whose `id`
 * appears in the given ID list. Unknown IDs generate warnings.
 * The order follows the input ID list.
 */
function filterAppraiserPool(groupName, ids, fullPool, warnings, contextSuffix) {
  const poolMap = new Map(fullPool.map(a => [a.id, a]));
  const result = [];

  for (const id of ids) {
    const appraiser = poolMap.get(id);
    if (appraiser) {
      result.push(appraiser);
    } else {
      warnings.push(`Group "${groupName}": unknown appraiser "${id}" ${contextSuffix} — skipped`);
    }
  }

  return result;
}

/**
 * Collect warning strings for ignored `mode` and `passes` keys in an
 * object-form type override.
 */
function collectTypeOverrideWarnings(value, groupName, warnings) {
  if (value.mode !== undefined) {
    warnings.push(`Group "${groupName}": ignoring per-type "mode" override — mode and passes are not overridable per artefact type`);
  }
  if (value.passes !== undefined) {
    warnings.push(`Group "${groupName}": ignoring per-type "passes" override — mode and passes are not overridable per artefact type`);
  }
}
