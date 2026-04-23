// Shared test helpers for scripts/lib/memory/** tests.
//
// `diskIO(root)` returns an IO shim identical to the one every memory test
// previously hand-rolled: paths are resolved relative to `root` (a temp dir),
// `writeFile` implicitly creates parent directories, `readDir` swallows
// ENOENT and returns `[]`, and `unlink` is a no-op when the file is absent.
//
// Matches the contract consumed by `scripts/lib/memory/**/*.js` (see
// `makeMemoryIO` in `.opencode/plugins/foundry.js` for the production shape).

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

export function diskIO(root) {
  const abs = (p) => join(root, p);
  return {
    exists: async (p) => existsSync(abs(p)),
    readFile: async (p) => readFileSync(abs(p), 'utf-8'),
    writeFile: async (p, c) => {
      mkdirSync(join(abs(p), '..'), { recursive: true });
      writeFileSync(abs(p), c, 'utf-8');
    },
    readDir: async (p) => {
      try { return readdirSync(abs(p)); } catch { return []; }
    },
    mkdir: async (p) => mkdirSync(abs(p), { recursive: true }),
    unlink: async (p) => { if (existsSync(abs(p))) unlinkSync(abs(p)); },
  };
}
