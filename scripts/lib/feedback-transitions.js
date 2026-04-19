import { createHash } from 'node:crypto';

// Matrix: [current][target] => set of allowed stageBases
const MATRIX = {
  open:       { actioned: ['forge'], 'wont-fix': ['forge'] },
  actioned:   { approved: ['quench', 'appraise', 'human-appraise'], rejected: ['quench', 'appraise', 'human-appraise'] },
  'wont-fix': { approved: ['appraise', 'human-appraise'], rejected: ['appraise', 'human-appraise'] },
  rejected:   { actioned: ['forge'], 'wont-fix': ['forge'] },
  approved:   {}, // terminal
};

export function validateTransition(current, target, stageBase) {
  const row = MATRIX[current];
  if (!row) return { ok: false, reason: `unknown state: ${current}` };
  const allowedStages = row[target];
  if (!allowedStages) return { ok: false, reason: `invalid transition ${current} → ${target}` };
  if (!allowedStages.includes(stageBase)) {
    return { ok: false, reason: `stage ${stageBase} cannot transition ${current} → ${target}` };
  }
  return { ok: true };
}

export function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
