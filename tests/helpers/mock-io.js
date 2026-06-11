export function makeMockIO(files = {}, { exec = () => '' } = {}) {
  const store = { ...files };
  return {
    exists: (p) => Object.hasOwn(store, p),
    readFile: (p) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    writeFile: (p, c) => { store[p] = c; },
    appendFile: (p, c) => {
      if (store[p] === undefined) store[p] = '';
      store[p] += c;
    },
    rename: (from, to) => {
      if (!(from in store)) throw new Error(`ENOENT: ${from}`);
      store[to] = store[from];
      delete store[from];
    },
    unlink: (p) => { delete store[p]; },
    exec,
    _get: (p) => store[p],
    _set: (p, c) => { store[p] = c; },
  };
}
