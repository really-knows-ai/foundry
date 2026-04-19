export function createPendingStore() {
  const map = new Map();
  return {
    add(nonce, meta) { map.set(nonce, meta); },
    consume(nonce) {
      const meta = map.get(nonce);
      if (!meta) return null;
      map.delete(nonce);
      if (meta.exp < Date.now()) return null;
      return meta;
    },
    size() {
      const now = Date.now();
      for (const [k, v] of map) if (v.exp < now) map.delete(k);
      return map.size;
    },
  };
}
