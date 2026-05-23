// Tests for the output-key disambiguation (FOLLOW_UP.md #4).
//
// Cycles previously used `output:` to name the artefact-type they produce.
// Artefact-type definitions used `output:` to name the directory new files
// of that type are written under. Same key, different schemas — a footgun.
//
// The chosen resolution renames the cycle key and drops the artefact-type
// key entirely (the latter had no source-code consumers — forge's write
// scope is `file-patterns`, not a directory hint):
//   - cycle  `output:`     → `output-type:`  (load-bearing rename)
//   - artefact-type `output:` → removed       (field had no runtime use)
//
// Cleanup of stale `output:` lines on artefact-type definitions is covered
// by the upgrade-foundry skill rather than runtime code, since unknown
// frontmatter keys are simply ignored by the loader.
//
// This file pins the runtime behavior that drives the cycle rename:
//
//   1. `readForgeFilePatterns` reads `output-type:` on the cycle.
//   2. The orchestrate forge-violation path emits a clear migration
//      diagnostic when it sees a cycle with the old `output:` key.
//   3. `getAllowedPatterns` (sort.js) reads `output-type:`.

import { test } from 'node:test';
import assert from 'node:assert';
import { readForgeFilePatterns, runOrchestrate } from '../src/scripts/orchestrate.js';
import { getAllowedPatterns } from '../src/scripts/sort.js';

function makeIo(files = {}) {
  const fs = new Map(Object.entries(files));
  return {
    fs,
    exists: (p) => fs.has(p),
    readFile: (p) => {
      if (!fs.has(p)) throw new Error(`ENOENT: ${p}`);
      return fs.get(p);
    },
    writeFile: (p, c) => fs.set(p, c),
    rename: (from, to) => {
      if (!fs.has(from)) throw new Error(`ENOENT: ${from}`);
      fs.set(to, fs.get(from));
      fs.delete(from);
    },
    unlink: (p) => fs.delete(p),
    mkdir: () => {},
    exec: () => '',
  };
}

test('readForgeFilePatterns: cycle uses output-type to name the artefact-type', async () => {
  const io = makeIo({
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md", "haikus/**/*.md"]
---
`,
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
---
`,
  });
  assert.deepStrictEqual(
    await readForgeFilePatterns('create-haiku', io),
    { patterns: ['haikus/*.md', 'haikus/**/*.md'], outputType: 'haiku' }
  );
});

test('readForgeFilePatterns: bare `output:` on a cycle is no longer recognized (rename to output-type)', async () => {
  // Old schema (pre-rename) used `output:`. New schema requires `output-type:`.
  // Without a hard-error path here, the function should at minimum stop
  // resolving file-patterns from the old key — silent success would mask
  // unmigrated cycles. Returning null is the existing "no patterns" signal.
  const io = makeIo({
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
---
`,
  });
  const result = await readForgeFilePatterns('create-haiku', io);
  assert.equal(result, null, 'old output: key must not resolve patterns under new schema');
});

test('runOrchestrate setup: cycle with old `output:` key emits migration diagnostic', async () => {
  // The setup phase reads the cycle definition to learn its output
  // artefact-type. Under the new schema it must look at `output-type:`. A
  // cycle still carrying the old `output:` key should yield a violation
  // whose message names the new key explicitly so the operator knows to
  // run the upgrade-foundry skill — not a generic "missing output field".
  const io = makeIo({
    // No `stages:` key → needsSetup() is true, so the orchestrator runs
    // the setup branch where the cycle output-type check lives.
    'WORK.md': `---
flow: creative-flow
cycle: create-haiku
---
# Goal

g
`,
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns: ["haikus/*.md"]
---
`,
  });

  const result = await runOrchestrate({}, io);
  // Expect a violation whose message tells the operator to rename the
  // old `output:` key. Exact wording flexible; the substring `output-type`
  // signals that the diagnostic is the schema-rename one rather than a
  // generic "missing field".
  assert.equal(result.action, 'violation', `expected violation, got ${result.action}: ${JSON.stringify(result)}`);
  const msg = result.error || result.message || result.details || '';
  assert.match(
    msg,
    /output-type/i,
    `violation should mention the new key 'output-type'; got: ${JSON.stringify(result)}`
  );
});

test('getAllowedPatterns: cycle uses output-type to find artefact patterns for forge', () => {
  const files = {
    'foundry/cycles/create-haiku.md': `---
id: create-haiku
output-type: haiku
---
`,
    'foundry/artefacts/haiku/definition.md': `---
id: haiku
file-patterns:
  - "haikus/*.md"
---
`,
  };
  const io = {
    readFile: (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    exists: (p) => p in files,
  };
  const patterns = getAllowedPatterns('forge', 'foundry', 'foundry/cycles/create-haiku.md', io);
  assert.ok(
    patterns.includes('haikus/*.md'),
    `expected haikus/*.md in patterns, got: ${JSON.stringify(patterns)}`
  );
});
