export function createPendingStore() {
  const map = new Map();
  return {
    add(nonce, meta) { map.set(nonce, meta); },
    consume(nonce) {
      const meta = map.get(nonce);
      if (!meta) return null;
      if (meta.exp < Date.now()) {
        map.delete(nonce);
        return null;
      }
      map.delete(nonce);
      return meta;
    },
    size() {
      const now = Date.now();
      for (const [k, v] of map) if (v.exp < now) map.delete(k);
      return map.size;
    },
  };
}
