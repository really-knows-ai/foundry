import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export function realFsIo(root) {
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(root, p);
  return {
    exists: async (p) => existsSync(resolve(p)),
    readFile: async (p) => readFileSync(resolve(p), 'utf-8'),
    writeFile: async (p, c) => {
      mkdirSync(path.dirname(resolve(p)), { recursive: true });
      writeFileSync(resolve(p), c, 'utf-8');
    },
    mkdirp: async (p) => mkdirSync(resolve(p), { recursive: true }),
    readdir: async (p) => existsSync(resolve(p)) ? readdirSync(resolve(p)) : [],
    rm: async (p, opts = {}) => {
      if (existsSync(resolve(p))) rmSync(resolve(p), { recursive: !!opts.recursive, force: true });
    },
  };
}
