export function makeAsyncMockIO(files = {}) {
  const store = { ...files };
  const dirs = new Set();
  return {
    exists: async (p) => Object.hasOwn(store, p),
    readFile: async (p) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    writeFile: async (p, c) => { store[p] = c; },
    mkdirp: async (p) => { dirs.add(p); },
    _get: (p) => store[p],
    _set: (p, c) => { store[p] = c; },
    _has: (p) => p in store,
    _files: store,
    _dirs: dirs,
  };
}
