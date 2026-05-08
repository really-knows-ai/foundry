function tryStringifyBool(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return undefined;
}

function tryStringifyNumber(value) {
  if (typeof value === 'number') return JSON.stringify(value);
  return undefined;
}

function tryStringifyString(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  return undefined;
}

function stringifyPrimitive(value) {
  if (value === null) return 'null';
  if (value === undefined) return undefined;
  const bool = tryStringifyBool(value);
  if (bool !== undefined) return bool;
  const num = tryStringifyNumber(value);
  if (num !== undefined) return num;
  return tryStringifyString(value);
}

function stringifyArray(value, seen) {
  if (seen.has(value)) {
    throw new TypeError('Converting circular structure to JSON');
  }
  seen.add(value);

  const items = [];
  for (let i = 0; i < value.length; i++) {
    const result = stringifyCanonical(value[i], seen);
    items.push(result === undefined ? 'null' : result);
  }

  seen.delete(value);
  return '[' + items.join(',') + ']';
}

function isBoxedBigInt(value) {
  return Object.prototype.toString.call(value) === '[object BigInt]';
}

function stringifyUnboxed(value) {
  if (value instanceof Number) return JSON.stringify(value.valueOf());
  if (value instanceof String) return JSON.stringify(value.valueOf());
  if (value instanceof Boolean) return value.valueOf() ? 'true' : 'false';
  return undefined;
}

function buildObjectPairs(value, seen) {
  const keys = Object.keys(value).sort();
  const pairs = [];
  for (const key of keys) {
    const val = stringifyCanonical(value[key], seen);
    if (val !== undefined) {
      pairs.push(JSON.stringify(key) + ':' + val);
    }
  }
  return pairs;
}

function stringifyPlainObject(value, seen) {
  if (seen.has(value)) {
    throw new TypeError('Converting circular structure to JSON');
  }
  seen.add(value);
  const pairs = buildObjectPairs(value, seen);
  seen.delete(value);
  return '{' + pairs.join(',') + '}';
}

function stringifyObject(value, seen) {
  if (isBoxedBigInt(value)) {
    throw new TypeError('Do not know how to serialise a BigInt');
  }

  const unboxed = stringifyUnboxed(value);
  if (unboxed !== undefined) return unboxed;

  if (typeof value.toJSON === 'function') {
    return stringifyCanonical(value.toJSON(), seen);
  }

  return stringifyPlainObject(value, seen);
}

function dispatchType(value, seen) {
  if (Array.isArray(value)) return stringifyArray(value, seen);
  if (typeof value === 'object') return stringifyObject(value, seen);
  return undefined;
}

function stringifyCanonical(value, seen = new Set()) {
  if (typeof value === 'bigint') {
    throw new TypeError('Do not know how to serialise a BigInt');
  }

  const primitive = stringifyPrimitive(value);
  if (primitive !== undefined) return primitive;

  return dispatchType(value, seen);
}

export function canonicalJson(value) {
  return stringifyCanonical(value);
}
