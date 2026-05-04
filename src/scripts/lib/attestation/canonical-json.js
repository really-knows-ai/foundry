function stringifyCanonical(value, seen = new Set()) {
  if (value === null) return 'null';
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') {
    throw new TypeError('Do not know how to serialise a BigInt');
  }
  
  if (Array.isArray(value)) {
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
  
  if (typeof value === 'object') {
    // Check for boxed BigInt
    if (Object.prototype.toString.call(value) === '[object BigInt]') {
      throw new TypeError('Do not know how to serialise a BigInt');
    }
    
    // Unwrap boxed primitives
    if (value instanceof Number) return JSON.stringify(value.valueOf());
    if (value instanceof String) return JSON.stringify(value.valueOf());
    if (value instanceof Boolean) return value.valueOf() ? 'true' : 'false';
    
    // Handle objects with toJSON method (like Date)
    if (typeof value.toJSON === 'function') {
      return stringifyCanonical(value.toJSON(), seen);
    }
    
    if (seen.has(value)) {
      throw new TypeError('Converting circular structure to JSON');
    }
    seen.add(value);
    
    // Sort keys lexically and build JSON string
    const keys = Object.keys(value).sort();
    const pairs = [];
    for (const key of keys) {
      const val = stringifyCanonical(value[key], seen);
      if (val !== undefined) {
        pairs.push(JSON.stringify(key) + ':' + val);
      }
    }
    
    seen.delete(value);
    return '{' + pairs.join(',') + '}';
  }
  
  return undefined;
}

export function canonicalJson(value) {
  return stringifyCanonical(value);
}
