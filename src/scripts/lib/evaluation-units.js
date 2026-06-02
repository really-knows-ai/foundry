/**
 * Evaluation-unit and dispatch-matrix computation (R7, R8).
 *
 * Pure functions that convert laws partitioned by group and each group's
 * resolved configuration into evaluation units and a flat dispatch matrix
 * of (group, unit, appraiser, pass) tuples.
 *
 * This module performs no IO and has no side effects.
 */

/**
 * @typedef {Object} Unit
 * @property {string} unitId - Canonical identifier: "<group>::<mode>::<index>"
 * @property {string} group - The law group this unit belongs to
 * @property {'bundle' | 'law-by-law'} mode - Evaluation mode
 * @property {string[]} lawIds - Array of law IDs in this unit.
 *   In 'bundle' mode, all laws in the group.
 *   In 'law-by-law' mode, exactly one law.
 */

/**
 * @typedef {Object} DispatchEntry
 * @property {string} group - The law group
 * @property {Unit} unit - The full evaluation unit this dispatch targets
 * @property {string} appraiser - Appraiser id
 * @property {number} pass - Pass number, 1-based
 */

/**
 * Default group config used when a group is absent from groupConfigs.
 * Matches the R2 zero-config default: bundle mode, 1 pass, empty pool.
 */
const DEFAULT_CONFIG = Object.freeze({ mode: 'bundle', passes: 1, appraisers: [] });

/**
 * Look up a group's resolved config, falling back to DEFAULT_CONFIG.
 *
 * @param {Map<string, GroupConfig>} groupConfigs
 * @param {string} group
 * @returns {{ mode: string, passes: number, appraisers: string[] }}
 */
function getConfig(groupConfigs, group) {
  if (groupConfigs.has(group)) {
    return groupConfigs.get(group);
  }
  return DEFAULT_CONFIG;
}

/**
 * Build evaluation units for a single group in law-by-law mode.
 *
 * @param {string} group - Group name
 * @param {Law[]} laws - Array of laws in the group
 * @returns {Unit[]}
 */
function buildLawByLawUnits(group, laws) {
  const units = [];
  for (let i = 0; i < laws.length; i++) {
    units.push({
      unitId: `${group}::law-by-law::${i}`,
      group,
      mode: 'law-by-law',
      lawIds: [laws[i].id],
    });
  }
  return units;
}

/**
 * Build evaluation units for a single group in bundle mode.
 *
 * @param {string} group - Group name
 * @param {Law[]} laws - Array of laws in the group
 * @returns {Unit[]}
 */
function buildBundleUnits(group, laws) {
  if (laws.length === 0) return [];
  return [{
    unitId: `${group}::bundle::0`,
    group,
    mode: 'bundle',
    lawIds: laws.map(l => l.id),
  }];
}

/**
 * Compute evaluation units for each law group.
 *
 * For a group in 'bundle' mode, produces one unit containing all laws
 * in the group. For a group in 'law-by-law' mode, produces one unit
 * per law, each containing exactly one law.
 *
 * A group with no laws produces an empty unit array (the caller handles
 * the empty case via the emptyAppraiseResult fallback).
 *
 * @param {Map<string, Law[]>} lawsByGroup - Laws partitioned by group name
 * @param {Map<string, GroupConfig>} groupConfigs - Resolved config keyed
 *   by group name. Each value: { mode, passes, appraisers }.
 * @returns {Map<string, Unit[]>} Units keyed by group name
 */
export function computeUnits(lawsByGroup, groupConfigs) {
  const unitsByGroup = new Map();

  for (const [group, laws] of lawsByGroup) {
    const config = getConfig(groupConfigs, group);
    const units = config.mode === 'law-by-law'
      ? buildLawByLawUnits(group, laws)
      : buildBundleUnits(group, laws);

    unitsByGroup.set(group, units);
  }

  return unitsByGroup;
}

/**
 * Build dispatch entries for a single group's units.
 *
 * @param {string} group - Group name
 * @param {Unit[]} units - Units for this group
 * @param {string[]} appraisers - Resolved appraiser pool
 * @param {number} passes - Number of passes per appraiser
 * @param {DispatchEntry[]} entries - Accumulator array to push into
 */
function buildGroupEntries(group, units, appraisers, passes, entries) {
  for (const unit of units) {
    for (const appraiser of appraisers) {
      for (let pass = 1; pass <= passes; pass++) {
        entries.push({ group, unit, appraiser, pass });
      }
    }
  }
}

/**
 * Compute the flat dispatch matrix for all evaluation units.
 *
 * For each group, for each unit in that group, for each appraiser in
 * the group's resolved pool, for each pass (1..passes), produces one
 * DispatchEntry. The unit field carries the full Unit object so that
 * consumers can access unitId, mode, and lawIds without a separate lookup.
 *
 * @param {Map<string, Unit[]>} unitsByGroup - Units keyed by group name
 *   (as returned by computeUnits).
 * @param {Map<string, GroupConfig>} groupConfigs - Resolved config
 *   keyed by group name. Each value: { mode, passes, appraisers }.
 * @returns {DispatchEntry[]} Flat array of dispatch entries
 */
export function computeDispatchMatrix(unitsByGroup, groupConfigs) {
  const entries = [];

  for (const [group, units] of unitsByGroup) {
    const config = getConfig(groupConfigs, group);
    buildGroupEntries(group, units, config.appraisers, config.passes, entries);
  }

  return entries;
}

/**
 * Convenience function that calls computeUnits then computeDispatchMatrix.
 *
 * @param {Map<string, Law[]>} lawsByGroup - Laws partitioned by group name
 * @param {Map<string, GroupConfig>} groupConfigs - Resolved config keyed
 *   by group name
 * @returns {{ unitsByGroup: Map<string, Unit[]>, dispatchMatrix: DispatchEntry[] }}
 */
export function buildDispatch(lawsByGroup, groupConfigs) {
  const unitsByGroup = computeUnits(lawsByGroup, groupConfigs);
  const dispatchMatrix = computeDispatchMatrix(unitsByGroup, groupConfigs);
  return { unitsByGroup, dispatchMatrix };
}
