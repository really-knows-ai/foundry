// scripts/lib/feedback-transitions.js
import { createHash } from 'node:crypto';

// State machine per spec §5.
//
// States: open, actioned, wont-fix, rejected, deadlocked, resolved (terminal).
//
// Transition rules (spec §5.1):
//   1. Forge operates on {open, rejected} → {actioned, wont-fix}.
//   2. Source-stage (quench/appraise/human-appraise) operates on {actioned, wont-fix}
//      → {resolved, rejected}, but only when caller's stageId === item.source.
//   3. Sort (and only sort) writes 'deadlocked'. NOT validated here — sort bypasses
//      this function. Included for completeness: no stage-base is allowed to produce
//      'deadlocked' through this function.
//   4. Human-appraise override: on a deadlocked item, transitions to
//      {resolved, wont-fix, rejected} are legal regardless of source match.
//   5. 'resolved' is terminal.
//
// validateTransition takes an options object so new dimensions (sourceMatches,
// potential future flags) don't break the call shape.

const FORGE_TARGETS = new Set(['actioned', 'wont-fix']);
const SOURCE_TARGETS = new Set(['resolved', 'rejected']);
const HUMAN_OVERRIDE_TARGETS = new Set(['resolved', 'wont-fix', 'rejected']);
const KNOWN_STATES = new Set(['open', 'actioned', 'wont-fix', 'rejected', 'deadlocked', 'resolved']);
const SOURCE_STAGES = new Set(['quench', 'appraise', 'human-appraise']);

export function validateTransition({ currentState, target, stageBase, sourceMatches }) {
  if (typeof sourceMatches !== 'boolean') {
    throw new TypeError(
      `validateTransition: sourceMatches must be a boolean; got ${typeof sourceMatches}`
    );
  }
  if (!KNOWN_STATES.has(currentState)) {
    return { ok: false, reason: `unknown state: ${currentState}` };
  }

  if (currentState === 'resolved') {
    return { ok: false, reason: 'resolved is terminal' };
  }

  // Deadlocked: only human-appraise may transition, and only to override targets.
  if (currentState === 'deadlocked') {
    if (stageBase !== 'human-appraise') {
      return { ok: false, reason: `only human-appraise may resolve a deadlocked item; got ${stageBase}` };
    }
    if (!HUMAN_OVERRIDE_TARGETS.has(target)) {
      return { ok: false, reason: `invalid deadlock-override transition → ${target}` };
    }
    return { ok: true };
  }

  // Forge path: {open, rejected} → {actioned, wont-fix}.
  if (stageBase === 'forge') {
    if (currentState !== 'open' && currentState !== 'rejected') {
      return { ok: false, reason: `forge cannot transition from ${currentState}` };
    }
    if (!FORGE_TARGETS.has(target)) {
      return { ok: false, reason: `forge cannot produce ${target}` };
    }
    return { ok: true };
  }

  // Source-stage path: {actioned, wont-fix} → {resolved, rejected}, source must match.
  if (SOURCE_STAGES.has(stageBase)) {
    if (currentState !== 'actioned' && currentState !== 'wont-fix') {
      return { ok: false, reason: `${stageBase} cannot transition from ${currentState}` };
    }
    if (!SOURCE_TARGETS.has(target)) {
      return { ok: false, reason: `${stageBase} cannot produce ${target}` };
    }
    if (!sourceMatches) {
      return { ok: false, reason: `only the source stage may resolve/reject this item` };
    }
    return { ok: true };
  }

  return { ok: false, reason: `unsupported stage base: ${stageBase}` };
}

export function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Per spec §5.1 rule 7 (REVISION-CONTRACT §A2): forge may produce the
 * `wont-fix` target only for items whose source stage base is `appraise`.
 * For `quench`- or `human-appraise`-sourced items, forge's only legal
 * target from {open, rejected} is `actioned`.
 *
 * The predicate is forge-specific. Non-forge callers always receive
 * `false` — they should use validateTransition directly, not this helper.
 *
 * @param {{source: string}} item — feedback item; `source` is `base:alias`.
 * @param {string} callerStageBase — the caller's stage base (e.g. 'forge').
 * @returns {boolean}
 */
export function canForgeWontFix(item, callerStageBase) {
  if (callerStageBase !== 'forge') return false;
  if (!item || typeof item.source !== 'string' || !item.source) return false;
  const sourceBase = item.source.split(':')[0];
  return sourceBase === 'appraise';
}
