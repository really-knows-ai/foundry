// src/scripts/lib/stage-output-schemas.js
// Stage output validation schemas for forge, appraise, and human-appraise.
// Each exported function validates a plain object against the stage's output
// schema and returns { ok: true } or { ok: false, errors: [...] }.

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkExtraFields(data, allowed, stage) {
  const errors = [];
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      errors.push(`${stage}: ${key} — unknown field`);
    }
  }
  return errors;
}

// ── Forge ──────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(['done', 'actioned', 'wont-fix']);
const DONE_LIKE = new Set(['done', 'actioned']);
const FORGE_ALLOWED = new Set(['status', 'reason']);

function checkForgeStatus(data, stage) {
  const errors = [];
  if (data.status === undefined) {
    errors.push(`${stage}: status — is required`);
  } else if (!VALID_STATUSES.has(data.status)) {
    errors.push(`${stage}: status — must be one of done, actioned, wont-fix`);
  }
  return errors;
}

function checkForgeReason(data, stage) {
  const errors = [];
  if (data.status === 'wont-fix' && typeof data.reason !== 'string') {
    errors.push(`${stage}: reason — is required when status is wont-fix`);
  }
  if (DONE_LIKE.has(data.status) && data.reason !== undefined) {
    errors.push(`${stage}: reason — must not be present when status is ${data.status}`);
  }
  return errors;
}

export function validateForgeOutput(data) {
  const stage = 'forge';
  if (!isPlainObject(data)) {
    return { ok: false, errors: [`${stage}: data — must be a plain object`] };
  }
  const errors = [];
  errors.push(...checkForgeStatus(data, stage));
  errors.push(...checkForgeReason(data, stage));
  errors.push(...checkExtraFields(data, FORGE_ALLOWED, stage));
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

// ── Appraise ───────────────────────────────────────────────────────

const APPRAISE_REQUIRED = ['file', 'law', 'text'];
const APPRAISE_OPTIONAL = ['evidence', 'severity', 'location'];
const APPRAISE_ALLOWED = new Set([...APPRAISE_REQUIRED, ...APPRAISE_OPTIONAL]);

function checkRequiredStrings(data, fields, stage) {
  const errors = [];
  for (const field of fields) {
    const val = data[field];
    if (typeof val !== 'string' || val.length === 0) {
      errors.push(`${stage}: ${field} — must be a non-empty string`);
    }
  }
  return errors;
}

function checkOptionalStrings(data, fields, stage) {
  const errors = [];
  for (const field of fields) {
    if (data[field] !== undefined && typeof data[field] !== 'string') {
      errors.push(`${stage}: ${field} — must be a string`);
    }
  }
  return errors;
}

export function validateAppraiseOutput(data) {
  const stage = 'appraise';
  if (!isPlainObject(data)) {
    return { ok: false, errors: [`${stage}: data — must be a plain object`] };
  }
  const errors = [];
  errors.push(...checkRequiredStrings(data, APPRAISE_REQUIRED, stage));
  errors.push(...checkOptionalStrings(data, APPRAISE_OPTIONAL, stage));
  errors.push(...checkExtraFields(data, APPRAISE_ALLOWED, stage));
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

// ── Human-Appraise ─────────────────────────────────────────────────

const HUMAN_ALLOWED = new Set(['verdict']);

export function validateHumanAppraiseOutput(data) {
  const stage = 'human-appraise';
  if (!isPlainObject(data)) {
    return { ok: false, errors: [`${stage}: data — must be a plain object`] };
  }
  const errors = [];
  if (data.verdict !== 'approved') {
    errors.push(`${stage}: verdict — must be "approved"`);
  }
  errors.push(...checkExtraFields(data, HUMAN_ALLOWED, stage));
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}
