// src/scripts/lib/stage-output-schemas.js
// Stage output validation schemas for forge, appraise, and human-appraise.
// Each exported function validates a plain object against the stage's output
// schema and returns { ok: true } or { ok: false, errors: [...] }.

// ── JSON Schema definitions ──────────────────────────────────────────

const FORGE_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['done', 'actioned', 'wont-fix'] },
    reason: { type: 'string' },
  },
  allOf: [
    {
      if: { properties: { status: { const: 'wont-fix' } } },
      then: { required: ['reason'] },
    },
  ],
};

const APPRAISE_SCHEMA = {
  type: 'object',
  required: ['file', 'law', 'text', 'group', 'appraiser', 'pass'],
  properties: {
    file: { type: 'string', minLength: 1 },
    law: { type: 'string', minLength: 1 },
    text: { type: 'string', minLength: 1 },
    group: { type: 'string' },
    appraiser: { type: 'string' },
    pass: { type: 'integer' },
    evidence: { type: 'string' },
    severity: { type: 'string' },
    location: { type: 'string' },
  },
};

const HUMAN_APPRAISE_SCHEMA = {
  type: 'object',
  required: ['verdict'],
  properties: {
    verdict: { enum: ['approved', 'rejected', 'resolved'] },
    itemId: { type: 'string' },
    feedback: { type: 'string' },
  },
  allOf: [
    {
      // resolved requires itemId
      if: { properties: { verdict: { const: 'resolved' } } },
      then: { required: ['itemId'] },
    },
    {
      // approved must not have itemId
      if: { properties: { verdict: { const: 'approved' } } },
      then: { not: { required: ['itemId'] } },
    },
  ],
};

const APPRAISE_ADDRESS_VERDICT_SCHEMA = {
  type: 'object',
  required: ['action'],
  properties: {
    action: { enum: ['resolve', 'reject'] },
    feedback: { type: 'string' },
  },
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { action: { const: 'resolve' } } },
      then: { not: { required: ['feedback'] } },
    },
    {
      if: { properties: { action: { const: 'reject' } } },
      then: { required: ['feedback'] },
    },
  ],
};

// ── Schema validator ─────────────────────────────────────────────────

function checkObjectType(schema, data, path) {
  if (schema.type !== 'object') return [];
  if (isRecord(data)) return [];
  return [`${path} — must be a plain object`];
}

function checkStringType(schema, data, path) {
  if (schema.type !== 'string') return [];
  if (typeof data !== 'string') {
    return [`${path} — must be a string`];
  }
  if (schema.minLength !== undefined && data.length < schema.minLength) {
    return [`${path} — must be a non-empty string`];
  }
  return [];
}

function checkIntegerType(schema, data, path) {
  if (schema.type !== 'integer') return [];
  if (!Number.isInteger(data)) {
    return [`${path} — must be an integer`];
  }
  return [];
}

function checkType(schema, data, path) {
  return [
    ...checkObjectType(schema, data, path),
    ...checkStringType(schema, data, path),
    ...checkIntegerType(schema, data, path),
  ];
}

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkRequired(schema, data, path) {
  if (!schema.required || !isRecord(data)) return [];
  return schema.required
    .filter(key => !(key in data))
    .map(key => `${path}: ${key} — is required`);
}

function checkProperties(schema, data, path) {
  if (!schema.properties || !isRecord(data)) return [];
  const errors = [];
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (key in data) {
      errors.push(...validateSchema(propSchema, data[key], `${path}: ${key}`));
    }
  }
  return errors;
}

function checkAdditionalProperties(schema, data, path) {
  if (schema.additionalProperties !== false || !schema.properties || !isRecord(data)) return [];
  const allowed = new Set(Object.keys(schema.properties));
  return Object.keys(data)
    .filter(key => !allowed.has(key))
    .map(key => `${path}: ${key} — unknown field`);
}

function checkEnum(schema, data, path) {
  if (schema.enum === undefined) return [];
  if (schema.enum.includes(data)) return [];
  const allowed = schema.enum.map(v => JSON.stringify(v)).join(', ');
  return [`${path} — must be one of ${allowed}`];
}

function checkConst(schema, data, path) {
  if (schema.const === undefined) return [];
  if (data === schema.const) return [];
  return [`${path} — must be ${JSON.stringify(schema.const)}`];
}

function checkNot(schema, data, path) {
  if (!schema.not || !schema.not.required || !isRecord(data)) return [];
  return schema.not.required
    .filter(key => key in data)
    .map(key => `${path}: ${key} — must not be present`);
}

function skipAllOfItem(item, data) {
  if (!item.if) return true;
  if (!item.if.properties) return false;
  return Object.keys(item.if.properties).some(key => !(key in data));
}

function checkAllOf(schema, data, path) {
  if (!schema.allOf) return [];
  const errors = [];
  for (const item of schema.allOf) {
    if (skipAllOfItem(item, data)) continue;
    const ifErrors = validateSchema(item.if, data, path);
    if (ifErrors.length === 0) {
      errors.push(...validateSchema(item.then, data, path));
    }
  }
  return errors;
}

function validateSchema(schema, data, path = '') {
  const typeErrors = checkType(schema, data, path);
  if (typeErrors.length > 0) return typeErrors;

  return [
    ...checkRequired(schema, data, path),
    ...checkProperties(schema, data, path),
    ...checkAdditionalProperties(schema, data, path),
    ...checkEnum(schema, data, path),
    ...checkConst(schema, data, path),
    ...checkNot(schema, data, path),
    ...checkAllOf(schema, data, path),
  ];
}
// ── Exported validators ──────────────────────────────────────────────

export function validateForgeOutput(data) {
  const stage = 'forge';
  const errors = validateSchema(FORGE_SCHEMA, data, stage);
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

export function validateAppraiseOutput(data) {
  const stage = 'appraise';
  const errors = validateSchema(APPRAISE_SCHEMA, data, stage);
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

export function validateHumanAppraiseOutput(data) {
  const stage = 'human-appraise';
  const errors = validateSchema(HUMAN_APPRAISE_SCHEMA, data, stage);
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

export function validateAppraiseAddressVerdict(data) {
  const stage = 'appraise-address';
  const errors = validateSchema(APPRAISE_ADDRESS_VERDICT_SCHEMA, data, stage);
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * Check whether a human-appraise output record is a deadlock resolution.
 * A deadlock resolution record includes an `itemId` field.
 *
 * @param {unknown} data — parsed stage-output record
 * @returns {boolean}
 */
export function isDeadlockResolution(data) {
  return typeof data === 'object' && data !== null && 'itemId' in data;
}
