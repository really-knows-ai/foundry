// src/scripts/lib/appraise-consensus.js
// Consensus engine for appraise-address sub-stage.
// Computes overall outcome from appraiser verdicts, collects addressed
// feedback items, and reads cycle-level consensus configuration.

import { getCycleDefinition } from '../lib/config.js';

/**
 * @typedef {'unanimous'|'majority'|'any'} ConsensusMode
 * @typedef {{ appraiser: string, verdict: 'resolved'|'rejected' }} Verdict
 */

const VALID_MODES = new Set(['unanimous', 'majority', 'any']);

const VALID_VERDICTS = new Set(['resolved', 'rejected']);

function normaliseVerdict(verdict) {
  return VALID_VERDICTS.has(verdict) ? verdict : 'rejected';
}

function countVerdicts(verdicts) {
  return verdicts.reduce(
    function(acc, v) {
      const normalised = normaliseVerdict(v.verdict);
      if (normalised === 'resolved') acc.resolved++;
      else acc.rejected++;
      return acc;
    },
    { resolved: 0, rejected: 0 },
  );
}

/**
 * Decides outcome for a single mode given vote counts.
 * Each mode has its own decision function.
 */
function resolveUnanimous(counts) { return counts.rejected === 0 ? 'resolved' : 'rejected'; }
function resolveMajority(counts) { return counts.resolved > counts.rejected ? 'resolved' : 'rejected'; }
function resolveAny(counts) { return counts.resolved >= 1 ? 'resolved' : 'rejected'; }

const MODE_RESOLVERS = {
  unanimous: resolveUnanimous,
  majority: resolveMajority,
  any: resolveAny,
};

/**
 * Compute the overall outcome from individual appraiser verdicts.
 *
 * @param {Verdict[]} verdicts  - Appraiser verdicts for one feedback item
 * @param {ConsensusMode} mode  - Cycle-level consensus configuration
 * @returns {{ outcome: 'resolved'|'rejected', resolved: number, rejected: number }}
 */
export function computeConsensus(verdicts, mode) {
  // Empty verdicts: no appraisers means no objections
  if (verdicts.length === 0) {
    return { outcome: 'resolved', resolved: 0, rejected: 0 };
  }

  const resolver = MODE_RESOLVERS[mode] || resolveUnanimous;
  const counts = countVerdicts(verdicts);
  return {
    outcome: resolver(counts),
    resolved: counts.resolved,
    rejected: counts.rejected,
  };
}

/**
 * Collect feedback items that need appraise evaluation for the current cycle.
 *
 * Items are eligible when:
 *   1. Current state is 'actioned' or 'wont-fix' (regardless of source stage)
 *   2. Current state is NOT 'deadlocked' (deadlocked items go to human-appraise)
 *
 * @param {object} store - Feedback store instance (openFeedbackStore)
 * @param {string} cycleId - Current cycle identifier
 * @returns {object[]} Eligible feedback items with full history
 */
export function collectAddressedItems(store, cycleId) {
  const eligibleStates = new Set(['actioned', 'wont-fix']);
  return store.list().filter(item => {
    const state = item.history[0].state;
    const itemCycle = item.history[0].cycle;
    return eligibleStates.has(state) && itemCycle === cycleId;
  });
}

/**
 * Read the consensus mode from cycle definition frontmatter.
 * Defaults to 'unanimous' when absent or invalid.
 *
 * @param {string} foundryDir
 * @param {string} cycleId
 * @param {object} io
 * @returns {Promise<'unanimous'|'majority'|'any'>}
 */
export async function readConsensusConfig(foundryDir, cycleId, io) {
  try {
    const def = await getCycleDefinition(foundryDir, cycleId, io);
    const mode = def.frontmatter && def.frontmatter['appraise-consensus'];
    if (VALID_MODES.has(mode)) return mode;
    return 'unanimous';
  } catch {
    return 'unanimous';
  }
}
