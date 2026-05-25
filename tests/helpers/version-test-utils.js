/**
 * Shared test helpers for artefact version scenarios in integration tests.
 *
 * Provides deterministic hash constants and factory functions for feedback
 * items and forge history entries.
 */

export const HASH_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const HASH_V1 = '1111111111111111111111111111111111111111111111111111111111111111';
export const HASH_V2 = '2222222222222222222222222222222222222222222222222222222222222222';

/**
 * Build a feedback item suitable for passing to determineRoute.
 *
 * Defaults produce a valid quench-sourced open item. Override fields
 * on the returned object to build the fixture you need.
 *
 * @param {object} [overrides]
 * @returns {object} feedback item
 */
export function makeFeedbackWithVersion(overrides = {}) {
  const defaults = {
    id: 'fb-test-0000000000000001',
    file: 'haikus/cat-snoring.md',
    tag: 'law:line-count',
    state: 'open',
    depth: 1,
    source: 'quench:haiku-cycle',
    artefact_version: HASH_V1,
  };
  return { ...defaults, ...overrides };
}

/**
 * Build a forge history entry.
 *
 * @param {object} [overrides]
 * @returns {{ stage: string, iteration: number, contract_passed: boolean }}
 */
export function makeForgeHistoryEntry(overrides = {}) {
  return {
    stage: overrides.stage ?? 'forge:haiku-cycle',
    iteration: overrides.iteration ?? 1,
    contract_passed: overrides.contract_passed ?? true,
  };
}
