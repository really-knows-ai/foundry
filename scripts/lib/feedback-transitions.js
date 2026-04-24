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

// Legacy matrix preserved verbatim for scripts/lib/feedback.js (the old
// markdown-based flow). New code MUST use validateTransition (options-
// object form) above. This export is deleted in phase 4 alongside
// feedback.js itself. Keep semantics identical to the pre-phase-1 matrix.
//
// Reason strings below are byte-identical to the pre-phase-1 matrix;
// downstream logs and test assertions in tests/lib/feedback.test.js
// depend on this exact wording.

/** @deprecated Phase-1 shim for the legacy markdown feedback store.
 *  Do not use in new code. Deleted in phase 4 with scripts/lib/feedback.js. */
export const legacyTransitionsMatrix = {
  open:       { actioned: ['forge'],  'wont-fix': ['forge'] },
  actioned:   { approved: ['quench','appraise','human-appraise'], rejected: ['quench','appraise','human-appraise'] },
  'wont-fix': { approved: ['appraise','human-appraise'],          rejected: ['appraise','human-appraise'] },
  rejected:   { actioned: ['forge'],  'wont-fix': ['forge'] },
  approved:   {},
};

/** @deprecated Phase-1 shim for the legacy markdown feedback store.
 *  Do not use in new code. Deleted in phase 4 with scripts/lib/feedback.js. */
export function legacyValidateTransition(current, target, stageBase) {
  const row = legacyTransitionsMatrix[current];
  if (!row) return { ok: false, reason: `unknown state: ${current}` };
  const allowed = row[target];
  if (!allowed) return { ok: false, reason: `invalid transition ${current} → ${target}` };
  if (!allowed.includes(stageBase)) {
    return { ok: false, reason: `stage ${stageBase} cannot transition ${current} → ${target}` };
  }
  return { ok: true };
}
