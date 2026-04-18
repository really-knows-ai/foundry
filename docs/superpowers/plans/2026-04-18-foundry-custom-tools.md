# Foundry Custom Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all deterministic operations from Foundry skills into shared library modules and expose them as custom tools via the existing plugin, making the pipeline reliable and skills simple.

**Architecture:** Shared library in `scripts/lib/` provides pure functions with injectable I/O. The Foundry plugin (`foundry.js`) imports these and exposes 22 tool endpoints. Skills are updated to call tools instead of manipulating files directly.

**Tech Stack:** Node.js (ESM), `js-yaml`, `minimatch`, `@opencode-ai/plugin`, Node built-in test runner (`node:test`)

**Spec:** `docs/superpowers/specs/2026-04-18-foundry-custom-tools-design.md`

---

## Phase 1: Shared Library

### Task 1: Extract `scripts/lib/workfile.js`

**Files:**
- Create: `scripts/lib/workfile.js`
- Create: `tests/lib/workfile.test.js`
- Modify: `scripts/sort.js` (remove `parseFrontmatter`, import from lib)

- [ ] **Step 1: Write failing tests for parseFrontmatter (moved from sort.js)**

```js
// tests/lib/workfile.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  writeFrontmatter,
  createWorkfile,
  setFrontmatterField,
  getFrontmatterField,
} from '../../scripts/lib/workfile.js';

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter', () => {
    const text = '---\ncycle: test\nstages:\n  - forge:a\n---\nbody';
    const fm = parseFrontmatter(text);
    assert.equal(fm.cycle, 'test');
    assert.deepEqual(fm.stages, ['forge:a']);
  });

  it('returns empty object when no frontmatter', () => {
    assert.deepEqual(parseFrontmatter('no frontmatter here'), {});
  });

  it('returns empty object for empty frontmatter', () => {
    assert.deepEqual(parseFrontmatter('---\n\n---\nbody'), {});
  });
});
```

- [ ] **Step 2: Write failing tests for writeFrontmatter**

```js
// append to tests/lib/workfile.test.js
describe('writeFrontmatter', () => {
  it('serializes fields to YAML frontmatter block', () => {
    const result = writeFrontmatter({ cycle: 'test', stages: ['forge:a'] });
    assert.ok(result.startsWith('---\n'));
    assert.ok(result.endsWith('\n---'));
    const parsed = parseFrontmatter(result + '\nbody');
    assert.equal(parsed.cycle, 'test');
    assert.deepEqual(parsed.stages, ['forge:a']);
  });

  it('handles models map', () => {
    const result = writeFrontmatter({ cycle: 'c1', models: { forge: 'openai/gpt-4o' } });
    const parsed = parseFrontmatter(result + '\nbody');
    assert.deepEqual(parsed.models, { forge: 'openai/gpt-4o' });
  });
});
```

- [ ] **Step 3: Write failing tests for createWorkfile**

```js
// append to tests/lib/workfile.test.js
describe('createWorkfile', () => {
  it('creates full WORK.md template', () => {
    const result = createWorkfile(
      { flow: 'f1', cycle: 'c1', stages: ['forge:a'], 'max-iterations': 3 },
      'Write a haiku about cats'
    );
    const fm = parseFrontmatter(result);
    assert.equal(fm.flow, 'f1');
    assert.equal(fm.cycle, 'c1');
    assert.ok(result.includes('# Goal'));
    assert.ok(result.includes('Write a haiku about cats'));
    assert.ok(result.includes('| File | Type | Cycle | Status |'));
    assert.ok(result.includes('## Feedback'));
  });
});
```

- [ ] **Step 4: Write failing tests for setFrontmatterField and getFrontmatterField**

```js
// append to tests/lib/workfile.test.js
describe('getFrontmatterField', () => {
  it('reads a scalar field', () => {
    const text = '---\ncycle: test\nstages:\n  - forge:a\n---\nbody';
    assert.equal(getFrontmatterField(text, 'cycle'), 'test');
  });

  it('reads an array field', () => {
    const text = '---\ncycle: test\nstages:\n  - forge:a\n  - quench:b\n---\nbody';
    assert.deepEqual(getFrontmatterField(text, 'stages'), ['forge:a', 'quench:b']);
  });

  it('returns undefined for missing field', () => {
    const text = '---\ncycle: test\n---\nbody';
    assert.equal(getFrontmatterField(text, 'missing'), undefined);
  });
});

describe('setFrontmatterField', () => {
  it('updates an existing scalar field', () => {
    const text = '---\ncycle: old\nstages:\n  - forge:a\n---\nbody';
    const result = setFrontmatterField(text, 'cycle', 'new');
    assert.equal(getFrontmatterField(result, 'cycle'), 'new');
    assert.deepEqual(getFrontmatterField(result, 'stages'), ['forge:a']);
    assert.ok(result.includes('body'));
  });

  it('adds a new field', () => {
    const text = '---\ncycle: test\n---\nbody';
    const result = setFrontmatterField(text, 'models', { forge: 'openai/gpt-4o' });
    assert.deepEqual(getFrontmatterField(result, 'models'), { forge: 'openai/gpt-4o' });
    assert.equal(getFrontmatterField(result, 'cycle'), 'test');
  });

  it('preserves body content', () => {
    const text = '---\ncycle: test\n---\n# Goal\n\nDo the thing\n\n## Feedback\n';
    const result = setFrontmatterField(text, 'cycle', 'new');
    assert.ok(result.includes('# Goal'));
    assert.ok(result.includes('Do the thing'));
    assert.ok(result.includes('## Feedback'));
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `node --test tests/lib/workfile.test.js`
Expected: FAIL — module not found

- [ ] **Step 6: Implement workfile.js**

```js
// scripts/lib/workfile.js
import yaml from 'js-yaml';

export function parseFrontmatter(text) {
  const match = text.match(/^---\n(.+?)\n---/s);
  if (!match) return {};
  return yaml.load(match[1]) || {};
}

export function writeFrontmatter(fields) {
  const yamlStr = yaml.dump(fields, { flowLevel: 1, lineWidth: -1 }).trimEnd();
  return `---\n${yamlStr}\n---`;
}

export function createWorkfile(frontmatter, goal) {
  const fm = writeFrontmatter(frontmatter);
  return `${fm}

# Goal

${goal}

## Artefacts

| File | Type | Cycle | Status |
|------|------|-------|--------|

## Feedback
`;
}

export function getFrontmatterField(text, key) {
  const fm = parseFrontmatter(text);
  return fm[key];
}

export function setFrontmatterField(text, key, value) {
  const fm = parseFrontmatter(text);
  fm[key] = value;
  const body = text.replace(/^---\n.+?\n---\n?/s, '');
  return writeFrontmatter(fm) + '\n' + body;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tests/lib/workfile.test.js`
Expected: All PASS

- [ ] **Step 8: Update sort.js to import parseFrontmatter from lib**

In `scripts/sort.js`, remove the inline `parseFrontmatter` function and add:

```js
import { parseFrontmatter } from './lib/workfile.js';
```

Keep re-exporting it for existing test compatibility:

```js
export { parseFrontmatter } from './lib/workfile.js';
```

- [ ] **Step 9: Run existing sort tests to verify nothing breaks**

Run: `node --test tests/sort.test.js`
Expected: All 63 tests PASS

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/workfile.js tests/lib/workfile.test.js scripts/sort.js
git commit -m "feat: extract workfile lib from sort.js with create/get/set operations"
```

---

### Task 2: Extract `scripts/lib/artefacts.js`

**Files:**
- Create: `scripts/lib/artefacts.js`
- Create: `tests/lib/artefacts.test.js`
- Modify: `scripts/sort.js` (remove `parseArtefactsTable`, import from lib)

- [ ] **Step 1: Write failing tests**

```js
// tests/lib/artefacts.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArtefactsTable, addArtefactRow, setArtefactStatus } from '../../scripts/lib/artefacts.js';

describe('parseArtefactsTable', () => {
  it('parses a markdown table', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| src/main.ts | code | build | draft |',
    ].join('\n');
    const arts = parseArtefactsTable(text);
    assert.equal(arts.length, 1);
    assert.deepEqual(arts[0], { file: 'src/main.ts', type: 'code', cycle: 'build', status: 'draft' });
  });

  it('returns empty for no table', () => {
    assert.deepEqual(parseArtefactsTable('no table here'), []);
  });
});

describe('addArtefactRow', () => {
  it('adds a row to existing table', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '',
      '## Feedback',
    ].join('\n');
    const result = addArtefactRow(text, { file: 'out/haiku.md', type: 'haiku', cycle: 'c1', status: 'draft' });
    const arts = parseArtefactsTable(result);
    assert.equal(arts.length, 1);
    assert.equal(arts[0].file, 'out/haiku.md');
    assert.ok(result.includes('## Feedback'));
  });

  it('adds to table that already has rows', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| a.md | code | c1 | done |',
      '',
      '## Feedback',
    ].join('\n');
    const result = addArtefactRow(text, { file: 'b.md', type: 'docs', cycle: 'c2', status: 'draft' });
    const arts = parseArtefactsTable(result);
    assert.equal(arts.length, 2);
    assert.equal(arts[1].file, 'b.md');
  });
});

describe('setArtefactStatus', () => {
  it('updates status for a specific file', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| a.md | code | c1 | draft |',
      '| b.md | docs | c1 | draft |',
    ].join('\n');
    const result = setArtefactStatus(text, 'a.md', 'done');
    const arts = parseArtefactsTable(result);
    assert.equal(arts[0].status, 'done');
    assert.equal(arts[1].status, 'draft');
  });

  it('throws when file not found', () => {
    const text = [
      '| File | Type | Cycle | Status |',
      '|------|------|-------|--------|',
      '| a.md | code | c1 | draft |',
    ].join('\n');
    assert.throws(() => setArtefactStatus(text, 'missing.md', 'done'), /not found/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/lib/artefacts.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement artefacts.js**

```js
// scripts/lib/artefacts.js

export function parseArtefactsTable(text) {
  const artefacts = [];
  let inTable = false;

  for (const line of text.split('\n')) {
    const stripped = line.trim();

    if (stripped.startsWith('| File')) {
      inTable = true;
      continue;
    }
    if (inTable && stripped.startsWith('|---')) {
      continue;
    }
    if (inTable && stripped.startsWith('|')) {
      const cols = stripped.split('|').slice(1, -1).map(c => c.trim());
      if (cols.length >= 4) {
        artefacts.push({
          file: cols[0],
          type: cols[1],
          cycle: cols[2],
          status: cols[3],
        });
      }
    } else if (inTable) {
      inTable = false;
    }
  }

  return artefacts;
}

export function addArtefactRow(text, { file, type, cycle, status }) {
  const row = `| ${file} | ${type} | ${cycle} | ${status} |`;
  const lines = text.split('\n');
  // Find the separator line (|---...) and insert after the last table row
  let insertIdx = -1;
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.startsWith('| File')) {
      inTable = true;
      continue;
    }
    if (inTable && stripped.startsWith('|---')) {
      insertIdx = i + 1;
      continue;
    }
    if (inTable && stripped.startsWith('|')) {
      insertIdx = i + 1;
    } else if (inTable) {
      break;
    }
  }

  if (insertIdx === -1) {
    throw new Error('Artefacts table not found in WORK.md');
  }

  lines.splice(insertIdx, 0, row);
  return lines.join('\n');
}

export function setArtefactStatus(text, file, newStatus) {
  const lines = text.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!stripped.startsWith('|') || stripped.startsWith('| File') || stripped.startsWith('|---')) continue;

    const cols = stripped.split('|').slice(1, -1).map(c => c.trim());
    if (cols.length >= 4 && cols[0] === file) {
      cols[3] = newStatus;
      lines[i] = '| ' + cols.join(' | ') + ' |';
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error(`Artefact not found in table: ${file}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/lib/artefacts.test.js`
Expected: All PASS

- [ ] **Step 5: Update sort.js to import from lib**

In `scripts/sort.js`, remove the inline `parseArtefactsTable` function and add:

```js
import { parseArtefactsTable } from './lib/artefacts.js';
```

Re-export for test compatibility:

```js
export { parseArtefactsTable } from './lib/artefacts.js';
```

- [ ] **Step 6: Run existing sort tests**

Run: `node --test tests/sort.test.js`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/artefacts.js tests/lib/artefacts.test.js scripts/sort.js
git commit -m "feat: extract artefacts table lib with add/set-status operations"
```

---

### Task 3: Extract `scripts/lib/history.js`

**Files:**
- Create: `scripts/lib/history.js`
- Create: `tests/lib/history.test.js`
- Modify: `scripts/sort.js` (remove `loadHistory`, import from lib)

- [ ] **Step 1: Write failing tests**

```js
// tests/lib/history.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadHistory, appendEntry, getIteration } from '../../scripts/lib/history.js';

describe('loadHistory', () => {
  it('returns empty when file does not exist', () => {
    const io = { exists: () => false, readFile: () => { throw new Error('should not read'); } };
    assert.deepEqual(loadHistory('missing.yaml', 'c1', io), []);
  });

  it('parses YAML and filters by cycle', () => {
    const yamlContent = [
      '- stage: forge:write',
      '  cycle: c1',
      '  timestamp: "2026-01-01T00:01:00Z"',
      '- stage: quench:review',
      '  cycle: c2',
      '  timestamp: "2026-01-01T00:02:00Z"',
    ].join('\n');
    const io = { exists: () => true, readFile: () => yamlContent };
    const result = loadHistory('history.yaml', 'c1', io);
    assert.equal(result.length, 1);
    assert.equal(result[0].stage, 'forge:write');
  });

  it('sorts entries by timestamp ascending regardless of file order', () => {
    const yamlContent = [
      '- stage: quench:review',
      '  cycle: c1',
      '  timestamp: "2026-01-01T00:02:00Z"',
      '- stage: forge:write',
      '  cycle: c1',
      '  timestamp: "2026-01-01T00:01:00Z"',
    ].join('\n');
    const io = { exists: () => true, readFile: () => yamlContent };
    const result = loadHistory('history.yaml', 'c1', io);
    assert.equal(result[0].stage, 'forge:write');
    assert.equal(result[1].stage, 'quench:review');
  });

  it('returns empty for empty file', () => {
    const io = { exists: () => true, readFile: () => '' };
    assert.deepEqual(loadHistory('history.yaml', 'c1', io), []);
  });
});

describe('appendEntry', () => {
  it('appends to empty file', () => {
    let written = '';
    const io = {
      exists: () => false,
      readFile: () => '',
      writeFile: (p, content) => { written = content; },
    };
    appendEntry('history.yaml', { cycle: 'c1', stage: 'forge:write', iteration: 1, comment: 'test' }, io);
    assert.ok(written.includes('stage: forge:write'));
    assert.ok(written.includes('cycle: c1'));
    assert.ok(written.includes('iteration: 1'));
    assert.ok(written.includes('comment: test'));
    assert.ok(written.includes('timestamp:'));
  });

  it('appends to existing file', () => {
    const existing = '- stage: forge:write\n  cycle: c1\n  timestamp: "2026-01-01T00:01:00Z"\n  iteration: 1\n  comment: first\n';
    let written = '';
    const io = {
      exists: () => true,
      readFile: () => existing,
      writeFile: (p, content) => { written = content; },
    };
    appendEntry('history.yaml', { cycle: 'c1', stage: 'quench:review', iteration: 1, comment: 'second' }, io);
    assert.ok(written.includes('forge:write'));
    assert.ok(written.includes('quench:review'));
  });

  it('throws when required fields are missing', () => {
    const io = { exists: () => false, readFile: () => '', writeFile: () => {} };
    assert.throws(() => appendEntry('h.yaml', { cycle: 'c1', stage: 'forge:a' }, io), /missing required/i);
  });
});

describe('getIteration', () => {
  it('counts forge entries for cycle', () => {
    const yamlContent = [
      '- stage: forge:write',
      '  cycle: c1',
      '  timestamp: "2026-01-01T00:01:00Z"',
      '- stage: quench:review',
      '  cycle: c1',
      '  timestamp: "2026-01-01T00:02:00Z"',
      '- stage: forge:write',
      '  cycle: c1',
      '  timestamp: "2026-01-01T00:03:00Z"',
    ].join('\n');
    const io = { exists: () => true, readFile: () => yamlContent };
    assert.equal(getIteration('h.yaml', 'c1', io), 2);
  });

  it('returns 0 when no history', () => {
    const io = { exists: () => false, readFile: () => '' };
    assert.equal(getIteration('h.yaml', 'c1', io), 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/lib/history.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement history.js**

```js
// scripts/lib/history.js
import yaml from 'js-yaml';

export function loadHistory(historyPath, cycle, io) {
  if (!io.exists(historyPath)) return [];
  const data = yaml.load(io.readFile(historyPath)) || [];
  const filtered = data.filter(e => e.cycle === cycle);
  filtered.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });
  return filtered;
}

export function appendEntry(historyPath, { cycle, stage, iteration, comment }, io) {
  if (iteration === undefined || iteration === null || !comment) {
    throw new Error('Missing required fields: iteration and comment are required');
  }

  const entry = {
    timestamp: new Date().toISOString(),
    cycle,
    stage,
    iteration,
    comment,
  };

  let data = [];
  if (io.exists(historyPath)) {
    data = yaml.load(io.readFile(historyPath)) || [];
  }

  data.push(entry);
  io.writeFile(historyPath, yaml.dump(data, { flowLevel: -1, lineWidth: -1 }));
  return entry;
}

export function getIteration(historyPath, cycle, io) {
  const history = loadHistory(historyPath, cycle, io);
  return history.filter(e => (e.stage || '').split(':')[0] === 'forge').length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/lib/history.test.js`
Expected: All PASS

- [ ] **Step 5: Update sort.js to import from lib**

In `scripts/sort.js`, remove the inline `loadHistory` function and add:

```js
import { loadHistory } from './lib/history.js';
```

Re-export:

```js
export { loadHistory } from './lib/history.js';
```

- [ ] **Step 6: Run existing sort tests**

Run: `node --test tests/sort.test.js`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/history.js tests/lib/history.test.js scripts/sort.js
git commit -m "feat: extract history lib with append and iteration tracking"
```

---

### Task 4: Extract `scripts/lib/feedback.js`

**Files:**
- Create: `scripts/lib/feedback.js`
- Create: `tests/lib/feedback.test.js`
- Modify: `scripts/sort.js` (remove `parseFeedback`, `parseFeedbackItem`, import from lib)

- [ ] **Step 1: Write failing tests**

```js
// tests/lib/feedback.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeedback,
  parseFeedbackItem,
  addFeedbackItem,
  resolveFeedbackItem,
  actionFeedbackItem,
  wontfixFeedbackItem,
  listFeedback,
} from '../../scripts/lib/feedback.js';

describe('parseFeedbackItem', () => {
  it('parses open item', () => {
    const item = parseFeedbackItem('- [ ] Fix the thing #validation');
    assert.equal(item.state, 'open');
    assert.equal(item.resolved, false);
    assert.deepEqual(item.tags, ['#validation']);
  });

  it('parses actioned approved item', () => {
    const item = parseFeedbackItem('- [x] Done #validation | approved');
    assert.equal(item.state, 'actioned');
    assert.equal(item.resolved, true);
  });

  it('parses rejected item', () => {
    const item = parseFeedbackItem('- [x] Done #validation | rejected: still failing');
    assert.equal(item.state, 'rejected');
    assert.equal(item.resolved, false);
  });
});

describe('parseFeedback', () => {
  const artefacts = [
    { file: 'out/haiku.md', type: 'haiku', cycle: 'c1', status: 'draft' },
  ];

  it('parses items under matching file heading', () => {
    const text = [
      '## Feedback',
      '### out/haiku.md',
      '- [ ] Bad syllables #validation',
      '- [x] Fix imagery #law:vivid',
    ].join('\n');
    const items = parseFeedback(text, 'c1', artefacts);
    assert.equal(items.length, 2);
  });

  it('ignores items for non-cycle files', () => {
    const text = [
      '## Feedback',
      '### other.md',
      '- [ ] Ignored #validation',
    ].join('\n');
    assert.equal(parseFeedback(text, 'c1', artefacts).length, 0);
  });
});

describe('addFeedbackItem', () => {
  it('adds item under existing file heading', () => {
    const text = [
      '## Feedback',
      '',
      '### out/haiku.md',
      '- [ ] Existing issue #validation',
    ].join('\n');
    const result = addFeedbackItem(text, 'out/haiku.md', 'New issue', 'law:brevity');
    assert.ok(result.includes('- [ ] New issue #law:brevity'));
    // Should appear after existing item
    const lines = result.split('\n');
    const existingIdx = lines.findIndex(l => l.includes('Existing issue'));
    const newIdx = lines.findIndex(l => l.includes('New issue'));
    assert.ok(newIdx > existingIdx);
  });

  it('creates Feedback section and file heading when neither exists', () => {
    const text = '---\ncycle: c1\n---\n\n# Goal\n\nDo stuff\n';
    const result = addFeedbackItem(text, 'out/haiku.md', 'First issue', 'validation');
    assert.ok(result.includes('## Feedback'));
    assert.ok(result.includes('### out/haiku.md'));
    assert.ok(result.includes('- [ ] First issue #validation'));
  });

  it('creates file heading under existing Feedback section', () => {
    const text = [
      '## Feedback',
      '',
      '### other.md',
      '- [ ] Other issue #validation',
    ].join('\n');
    const result = addFeedbackItem(text, 'out/haiku.md', 'New file issue', 'validation');
    assert.ok(result.includes('### out/haiku.md'));
    assert.ok(result.includes('- [ ] New file issue #validation'));
  });
});

describe('actionFeedbackItem', () => {
  it('changes [ ] to [x] for the specified item', () => {
    const text = [
      '## Feedback',
      '### out/haiku.md',
      '- [ ] First #validation',
      '- [ ] Second #validation',
    ].join('\n');
    const result = actionFeedbackItem(text, 'out/haiku.md', 1);
    const lines = result.split('\n');
    assert.ok(lines.some(l => l.includes('- [x] Second #validation')));
    assert.ok(lines.some(l => l.includes('- [ ] First #validation')));
  });
});

describe('wontfixFeedbackItem', () => {
  it('changes to [~] and appends wont-fix reason', () => {
    const text = [
      '## Feedback',
      '### out/haiku.md',
      '- [ ] Issue #law:brevity',
    ].join('\n');
    const result = wontfixFeedbackItem(text, 'out/haiku.md', 0, 'artistic choice');
    assert.ok(result.includes('- [~] Issue #law:brevity | wont-fix: artistic choice'));
  });
});

describe('resolveFeedbackItem', () => {
  it('appends approved resolution', () => {
    const text = [
      '## Feedback',
      '### out/haiku.md',
      '- [x] Fixed issue #validation',
    ].join('\n');
    const result = resolveFeedbackItem(text, 'out/haiku.md', 0, 'approved');
    assert.ok(result.includes('- [x] Fixed issue #validation | approved'));
  });

  it('appends rejected resolution with reason', () => {
    const text = [
      '## Feedback',
      '### out/haiku.md',
      '- [x] Fixed issue #validation',
    ].join('\n');
    const result = resolveFeedbackItem(text, 'out/haiku.md', 0, 'rejected', 'still broken');
    assert.ok(result.includes('- [x] Fixed issue #validation | rejected: still broken'));
  });
});

describe('listFeedback', () => {
  it('returns structured feedback array', () => {
    const text = [
      '## Feedback',
      '### out/haiku.md',
      '- [ ] Open issue #validation',
      '- [x] Done issue #law:vivid | approved',
    ].join('\n');
    const artefacts = [{ file: 'out/haiku.md', type: 'haiku', cycle: 'c1', status: 'draft' }];
    const items = listFeedback(text, 'c1', artefacts);
    assert.equal(items.length, 2);
    assert.equal(items[0].state, 'open');
    assert.equal(items[0].file, 'out/haiku.md');
    assert.equal(items[0].index, 0);
    assert.equal(items[1].state, 'actioned');
    assert.equal(items[1].resolved, true);
    assert.equal(items[1].index, 1);
  });

  it('filters by file when provided', () => {
    const text = [
      '## Feedback',
      '### out/a.md',
      '- [ ] A issue #validation',
      '### out/b.md',
      '- [ ] B issue #validation',
    ].join('\n');
    const artefacts = [
      { file: 'out/a.md', type: 'haiku', cycle: 'c1', status: 'draft' },
      { file: 'out/b.md', type: 'haiku', cycle: 'c1', status: 'draft' },
    ];
    const items = listFeedback(text, 'c1', artefacts, 'out/a.md');
    assert.equal(items.length, 1);
    assert.equal(items[0].file, 'out/a.md');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/lib/feedback.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement feedback.js**

```js
// scripts/lib/feedback.js
import { extractAllTags } from './tags.js';

export function parseFeedbackItem(line) {
  const item = { raw: line, state: 'unknown', tags: [], resolved: false };

  if (line.startsWith('- [ ]')) {
    item.state = 'open';
  } else if (line.startsWith('- [x]')) {
    item.state = 'actioned';
  } else if (line.startsWith('- [~]')) {
    item.state = 'wont-fix';
  }

  if (line.includes('| approved')) {
    item.resolved = true;
  } else if (line.includes('| rejected')) {
    item.state = 'rejected';
    item.resolved = false;
  }

  item.tags = extractAllTags(line);

  return item;
}

export function parseFeedback(text, cycle, artefacts) {
  const cycleFiles = new Set();
  for (const art of artefacts) {
    if (art.cycle === cycle) {
      cycleFiles.add(art.file || '');
    }
  }

  const items = [];
  let currentFile = null;
  let inFeedback = false;
  let feedbackLevel = 0;

  for (const line of text.split('\n')) {
    const stripped = line.trim();

    if (stripped === '# Feedback' || stripped === '## Feedback') {
      inFeedback = true;
      feedbackLevel = stripped.startsWith('## ') ? 2 : 1;
      continue;
    }

    if (inFeedback && /^#{1,2} /.test(stripped)) {
      const level = stripped.startsWith('## ') ? 2 : 1;
      if (level <= feedbackLevel && stripped !== '# Feedback' && stripped !== '## Feedback') {
        inFeedback = false;
        continue;
      }
    }

    if (!inFeedback) continue;

    const fileHeadingPrefix = feedbackLevel === 1 ? '## ' : '### ';
    if (stripped.startsWith(fileHeadingPrefix)) {
      currentFile = stripped.slice(fileHeadingPrefix.length).trim();
      continue;
    }

    if (cycleFiles.has(currentFile) && /^- \[/.test(stripped)) {
      items.push(parseFeedbackItem(stripped));
    }
  }

  return items;
}

export function addFeedbackItem(text, file, itemText, tag) {
  const tagStr = tag.startsWith('#') ? tag : `#${tag}`;
  const newItem = `- [ ] ${itemText} ${tagStr}`;
  const lines = text.split('\n');

  // Find ## Feedback section
  let feedbackIdx = lines.findIndex(l => l.trim() === '## Feedback');

  if (feedbackIdx === -1) {
    // Append Feedback section at end
    lines.push('', '## Feedback', '', `### ${file}`, newItem);
    return lines.join('\n');
  }

  // Find ### <file> heading under Feedback
  let fileHeadingIdx = -1;
  let lastItemIdx = -1;
  let searchFromFeedback = true;

  for (let i = feedbackIdx + 1; i < lines.length; i++) {
    const stripped = lines[i].trim();

    // Stop if we hit a heading at or above Feedback level
    if (/^#{1,2} /.test(stripped) && !stripped.startsWith('### ') && stripped !== '## Feedback') {
      break;
    }

    if (stripped === `### ${file}`) {
      fileHeadingIdx = i;
      lastItemIdx = i;
      continue;
    }

    if (fileHeadingIdx !== -1 && stripped.startsWith('### ')) {
      // Hit another file heading, stop
      break;
    }

    if (fileHeadingIdx !== -1 && /^- \[/.test(stripped)) {
      lastItemIdx = i;
    }
  }

  if (fileHeadingIdx !== -1) {
    // Insert after last item under this file heading
    lines.splice(lastItemIdx + 1, 0, newItem);
  } else {
    // Find end of Feedback section to add new file heading
    let insertIdx = feedbackIdx + 1;
    for (let i = feedbackIdx + 1; i < lines.length; i++) {
      const stripped = lines[i].trim();
      if (/^#{1,2} /.test(stripped) && !stripped.startsWith('### ') && stripped !== '## Feedback') {
        insertIdx = i;
        break;
      }
      insertIdx = i + 1;
    }
    lines.splice(insertIdx, 0, '', `### ${file}`, newItem);
  }

  return lines.join('\n');
}

function findFeedbackItemLine(lines, file, index) {
  let inFileSection = false;
  let itemCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();

    if (stripped === `### ${file}`) {
      inFileSection = true;
      continue;
    }

    if (inFileSection && stripped.startsWith('### ')) {
      break;
    }

    if (inFileSection && /^- \[/.test(stripped)) {
      if (itemCount === index) {
        return i;
      }
      itemCount++;
    }
  }

  throw new Error(`Feedback item index ${index} not found under ${file}`);
}

export function actionFeedbackItem(text, file, index) {
  const lines = text.split('\n');
  const lineIdx = findFeedbackItemLine(lines, file, index);
  lines[lineIdx] = lines[lineIdx].replace('- [ ]', '- [x]');
  return lines.join('\n');
}

export function wontfixFeedbackItem(text, file, index, reason) {
  const lines = text.split('\n');
  const lineIdx = findFeedbackItemLine(lines, file, index);
  lines[lineIdx] = lines[lineIdx].replace('- [ ]', '- [~]') + ` | wont-fix: ${reason}`;
  return lines.join('\n');
}

export function resolveFeedbackItem(text, file, index, resolution, reason) {
  const lines = text.split('\n');
  const lineIdx = findFeedbackItemLine(lines, file, index);
  if (resolution === 'approved') {
    lines[lineIdx] = lines[lineIdx] + ' | approved';
  } else {
    lines[lineIdx] = lines[lineIdx] + ` | rejected: ${reason}`;
  }
  return lines.join('\n');
}

export function listFeedback(text, cycle, artefacts, filterFile) {
  const cycleFiles = new Set();
  for (const art of artefacts) {
    if (art.cycle === cycle) {
      cycleFiles.add(art.file || '');
    }
  }

  const items = [];
  let currentFile = null;
  let inFeedback = false;
  let feedbackLevel = 0;
  let itemIndex = -1;
  let prevFile = null;

  for (const line of text.split('\n')) {
    const stripped = line.trim();

    if (stripped === '# Feedback' || stripped === '## Feedback') {
      inFeedback = true;
      feedbackLevel = stripped.startsWith('## ') ? 2 : 1;
      continue;
    }

    if (inFeedback && /^#{1,2} /.test(stripped)) {
      const level = stripped.startsWith('## ') ? 2 : 1;
      if (level <= feedbackLevel && stripped !== '# Feedback' && stripped !== '## Feedback') {
        inFeedback = false;
        continue;
      }
    }

    if (!inFeedback) continue;

    const fileHeadingPrefix = feedbackLevel === 1 ? '## ' : '### ';
    if (stripped.startsWith(fileHeadingPrefix)) {
      currentFile = stripped.slice(fileHeadingPrefix.length).trim();
      if (currentFile !== prevFile) {
        itemIndex = 0;
        prevFile = currentFile;
      }
      continue;
    }

    if (cycleFiles.has(currentFile) && /^- \[/.test(stripped)) {
      if (!filterFile || currentFile === filterFile) {
        const parsed = parseFeedbackItem(stripped);
        items.push({
          file: currentFile,
          index: itemIndex,
          text: parsed.raw,
          state: parsed.state,
          tags: parsed.tags,
          resolved: parsed.resolved,
        });
      }
      itemIndex++;
    }
  }

  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/lib/feedback.test.js`
Expected: All PASS

- [ ] **Step 5: Update sort.js to import from lib**

In `scripts/sort.js`, remove the inline `parseFeedback` and `parseFeedbackItem` functions and add:

```js
import { parseFeedback, parseFeedbackItem } from './lib/feedback.js';
```

Re-export:

```js
export { parseFeedback, parseFeedbackItem } from './lib/feedback.js';
```

- [ ] **Step 6: Run existing sort tests**

Run: `node --test tests/sort.test.js`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/feedback.js tests/lib/feedback.test.js scripts/sort.js
git commit -m "feat: extract feedback lib with add/action/wontfix/resolve operations"
```

---

### Task 5: Create `scripts/lib/config.js`

**Files:**
- Create: `scripts/lib/config.js`
- Create: `tests/lib/config.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/lib/config.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCycleDefinition,
  getArtefactType,
  getLaws,
  getValidation,
  getAppraisers,
  getFlow,
  selectAppraisers,
} from '../../scripts/lib/config.js';

describe('getCycleDefinition', () => {
  it('returns parsed frontmatter and body', () => {
    const io = {
      readFile: () => '---\noutput: haiku\ninputs: []\n---\n\nProduce a haiku.',
      exists: () => true,
    };
    const result = getCycleDefinition('foundry', 'create-haiku', io);
    assert.equal(result.frontmatter.output, 'haiku');
    assert.ok(result.body.includes('Produce a haiku'));
  });

  it('throws when cycle not found', () => {
    const io = { exists: () => false, readFile: () => '' };
    assert.throws(() => getCycleDefinition('foundry', 'missing', io), /not found/);
  });
});

describe('getArtefactType', () => {
  it('returns parsed definition', () => {
    const io = {
      readFile: () => '---\nfile-patterns:\n  - "out/**/*.md"\n---\n\nA haiku artefact.',
      exists: () => true,
    };
    const result = getArtefactType('foundry', 'haiku', io);
    assert.deepEqual(result.frontmatter['file-patterns'], ['out/**/*.md']);
  });
});

describe('getLaws', () => {
  it('collects global laws', () => {
    const files = {
      'foundry/laws': ['core.md'],
      'foundry/laws/core.md': '## brevity\n\nBe brief.\n\n## clarity\n\nBe clear.\n',
    };
    const io = {
      exists: (p) => p in files || p === 'foundry/laws',
      readDir: (p) => files[p] || [],
      readFile: (p) => files[p] || '',
    };
    const result = getLaws('foundry', undefined, io);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'brevity');
    assert.ok(result[0].text.includes('Be brief'));
    assert.equal(result[0].source, 'foundry/laws/core.md');
  });

  it('includes type-specific laws when typeId provided', () => {
    const files = {
      'foundry/laws': ['core.md'],
      'foundry/laws/core.md': '## brevity\n\nBe brief.\n',
      'foundry/artefacts/haiku/laws.md': '## syllable-count\n\n5-7-5 pattern.\n',
    };
    const io = {
      exists: (p) => p in files || p === 'foundry/laws',
      readDir: (p) => files[p] || [],
      readFile: (p) => files[p] || '',
    };
    const result = getLaws('foundry', 'haiku', io);
    assert.equal(result.length, 2);
    assert.ok(result.some(l => l.id === 'syllable-count'));
  });
});

describe('getValidation', () => {
  it('returns commands from validation.md', () => {
    const io = {
      exists: () => true,
      readFile: () => '## Checks\n\n```bash\nwc -l {file}\n```\n\n```bash\ngrep -c "^" {file}\n```\n',
    };
    const result = getValidation('foundry', 'haiku', io);
    assert.equal(result.length, 2);
    assert.ok(result[0].includes('wc -l'));
  });

  it('returns null when validation.md does not exist', () => {
    const io = { exists: () => false, readFile: () => '' };
    assert.equal(getValidation('foundry', 'haiku', io), null);
  });
});

describe('getAppraisers', () => {
  it('returns all appraiser definitions', () => {
    const files = {
      'foundry/appraisers': ['pedantic.md', 'pragmatic.md'],
      'foundry/appraisers/pedantic.md': '---\nid: pedantic\nmodel: openai/gpt-4o\n---\n\nYou are pedantic.',
      'foundry/appraisers/pragmatic.md': '---\nid: pragmatic\n---\n\nYou are pragmatic.',
    };
    const io = {
      exists: (p) => p in files,
      readDir: (p) => files[p] || [],
      readFile: (p) => files[p] || '',
    };
    const result = getAppraisers('foundry', io);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'pedantic');
    assert.equal(result[0].model, 'openai/gpt-4o');
    assert.ok(result[0].personality.includes('You are pedantic'));
    assert.equal(result[1].model, undefined);
  });
});

describe('getFlow', () => {
  it('returns parsed flow definition', () => {
    const io = {
      exists: () => true,
      readFile: () => '---\ncycles:\n  - create-haiku\n  - review-haiku\n---\n\nA haiku flow.',
    };
    const result = getFlow('foundry', 'haiku-flow', io);
    assert.deepEqual(result.frontmatter.cycles, ['create-haiku', 'review-haiku']);
    assert.ok(result.body.includes('A haiku flow'));
  });
});

describe('selectAppraisers', () => {
  it('selects count appraisers with round-robin distribution', () => {
    const files = {
      'foundry/appraisers': ['a.md', 'b.md', 'c.md'],
      'foundry/appraisers/a.md': '---\nid: a\n---\nPersonality A',
      'foundry/appraisers/b.md': '---\nid: b\n---\nPersonality B',
      'foundry/appraisers/c.md': '---\nid: c\n---\nPersonality C',
      'foundry/artefacts/haiku/definition.md': '---\nappraisers:\n  count: 2\n---\n',
    };
    const io = {
      exists: (p) => p in files,
      readDir: (p) => files[p] || [],
      readFile: (p) => files[p] || '',
    };
    const result = selectAppraisers('foundry', 'haiku', undefined, io);
    assert.equal(result.length, 2);
  });

  it('respects allowed list', () => {
    const files = {
      'foundry/appraisers': ['a.md', 'b.md', 'c.md'],
      'foundry/appraisers/a.md': '---\nid: a\n---\nA',
      'foundry/appraisers/b.md': '---\nid: b\n---\nB',
      'foundry/appraisers/c.md': '---\nid: c\n---\nC',
      'foundry/artefacts/haiku/definition.md': '---\nappraisers:\n  count: 3\n  allowed: [a, b]\n---\n',
    };
    const io = {
      exists: (p) => p in files,
      readDir: (p) => files[p] || [],
      readFile: (p) => files[p] || '',
    };
    const result = selectAppraisers('foundry', 'haiku', undefined, io);
    assert.equal(result.length, 3);
    assert.ok(result.every(r => r.id === 'a' || r.id === 'b'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/lib/config.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement config.js**

```js
// scripts/lib/config.js
import { join } from 'path';
import { parseFrontmatter } from './workfile.js';

function parseDoc(text) {
  const frontmatter = parseFrontmatter(text);
  const body = text.replace(/^---\n.+?\n---\n?/s, '').trim();
  return { frontmatter, body };
}

export function getCycleDefinition(foundryDir, cycleId, io) {
  const path = join(foundryDir, 'cycles', `${cycleId}.md`);
  if (!io.exists(path)) {
    throw new Error(`Cycle definition not found: ${path}`);
  }
  return parseDoc(io.readFile(path));
}

export function getArtefactType(foundryDir, typeId, io) {
  const path = join(foundryDir, 'artefacts', typeId, 'definition.md');
  if (!io.exists(path)) {
    throw new Error(`Artefact type definition not found: ${path}`);
  }
  return parseDoc(io.readFile(path));
}

export function getLaws(foundryDir, typeId, io) {
  const laws = [];

  const lawsDir = join(foundryDir, 'laws');
  if (io.exists(lawsDir)) {
    for (const file of io.readDir(lawsDir)) {
      if (!file.endsWith('.md')) continue;
      const filePath = join(lawsDir, file);
      const text = io.readFile(filePath);
      for (const law of extractLawsFromText(text, filePath)) {
        laws.push(law);
      }
    }
  }

  if (typeId) {
    const typeLawsPath = join(foundryDir, 'artefacts', typeId, 'laws.md');
    if (io.exists(typeLawsPath)) {
      const text = io.readFile(typeLawsPath);
      for (const law of extractLawsFromText(text, typeLawsPath)) {
        laws.push(law);
      }
    }
  }

  return laws;
}

function extractLawsFromText(text, source) {
  const laws = [];
  let currentId = null;
  let currentText = [];

  for (const line of text.split('\n')) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (currentId) {
        laws.push({ id: currentId, text: currentText.join('\n').trim(), source });
      }
      currentId = match[1].trim();
      currentText = [];
    } else if (currentId) {
      currentText.push(line);
    }
  }

  if (currentId) {
    laws.push({ id: currentId, text: currentText.join('\n').trim(), source });
  }

  return laws;
}

export function getValidation(foundryDir, typeId, io) {
  const path = join(foundryDir, 'artefacts', typeId, 'validation.md');
  if (!io.exists(path)) return null;

  const text = io.readFile(path);
  const commands = [];
  const codeBlockRe = /```(?:bash|sh)?\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRe.exec(text)) !== null) {
    const cmd = match[1].trim();
    if (cmd) commands.push(cmd);
  }

  return commands;
}

export function getAppraisers(foundryDir, io) {
  const dir = join(foundryDir, 'appraisers');
  if (!io.exists(dir)) return [];

  const appraisers = [];
  for (const file of io.readDir(dir)) {
    if (!file.endsWith('.md')) continue;
    const filePath = join(dir, file);
    const text = io.readFile(filePath);
    const { frontmatter, body } = parseDoc(text);
    appraisers.push({
      id: frontmatter.id || file.replace('.md', ''),
      personality: body,
      model: frontmatter.model || undefined,
    });
  }

  return appraisers;
}

export function getFlow(foundryDir, flowId, io) {
  const path = join(foundryDir, 'flows', `${flowId}.md`);
  if (!io.exists(path)) {
    throw new Error(`Flow definition not found: ${path}`);
  }
  return parseDoc(io.readFile(path));
}

export function selectAppraisers(foundryDir, typeId, countOverride, io) {
  const allAppraisers = getAppraisers(foundryDir, io);
  const artDefPath = join(foundryDir, 'artefacts', typeId, 'definition.md');

  let count = 3;
  let allowed = null;

  if (io.exists(artDefPath)) {
    const { frontmatter } = parseDoc(io.readFile(artDefPath));
    if (frontmatter.appraisers) {
      count = frontmatter.appraisers.count ?? 3;
      allowed = frontmatter.appraisers.allowed ?? null;
    }
  }

  if (countOverride !== undefined && countOverride !== null) {
    count = countOverride;
  }

  let pool = allAppraisers;
  if (allowed) {
    pool = allAppraisers.filter(a => allowed.includes(a.id));
  }

  if (pool.length === 0) return [];

  // Round-robin distribution
  const selected = [];
  for (let i = 0; i < count; i++) {
    selected.push({ ...pool[i % pool.length] });
  }

  return selected;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/lib/config.test.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/config.js tests/lib/config.test.js
git commit -m "feat: add config lib for reading cycle/artefact/law/appraiser/flow definitions"
```

---

### Task 6: Clean up sort.js imports and update test script

**Files:**
- Modify: `scripts/sort.js` (verify all inline functions removed, imports from lib)
- Modify: `package.json` (update test script to run all tests)
- Modify: `tests/sort.test.js` (verify re-exports work)

- [ ] **Step 1: Verify sort.js only contains routing logic and imports**

After Tasks 1-4, sort.js should:
- Import `parseFrontmatter` from `./lib/workfile.js`
- Import `parseArtefactsTable` from `./lib/artefacts.js`
- Import `loadHistory` from `./lib/history.js`
- Import `parseFeedback`, `parseFeedbackItem` from `./lib/feedback.js`
- Keep: `baseStage`, `findFirst`, `nextInRoute`, `determineRoute`, `nextAfterQuench`, `nextAfterAppraise`, `getModifiedFiles`, `getAllowedPatterns`, `checkModifiedFiles`, `globMatch`, `main()`
- Re-export all moved functions for backward compatibility with existing tests

Verify by reading sort.js and confirming no duplicate function definitions remain.

- [ ] **Step 2: Update package.json test script**

```json
"scripts": {
  "test": "node --test tests/**/*.test.js"
}
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass across sort.test.js, workfile.test.js, artefacts.test.js, history.test.js, feedback.test.js, config.test.js

- [ ] **Step 4: Commit**

```bash
git add scripts/sort.js package.json
git commit -m "refactor: sort.js now imports from shared lib modules, test script runs all tests"
```

---

## Phase 2: Plugin Tools

### Task 7: Add history tools to plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`
- Modify: `.opencode/package.json` (ensure `@opencode-ai/plugin` is listed)

- [ ] **Step 1: Add tool imports and history tools**

Add to the top of `foundry.js`:

```js
import { tool } from '@opencode-ai/plugin';
import { loadHistory, appendEntry, getIteration } from '../../scripts/lib/history.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
```

Add a helper for creating the IO object that the lib functions need:

```js
function makeIO(directory) {
  return {
    exists: (p) => existsSync(path.join(directory, p)),
    readFile: (p) => readFileSync(path.join(directory, p), 'utf-8'),
    writeFile: (p, content) => writeFileSync(path.join(directory, p), content, 'utf-8'),
  };
}
```

Note: The IO helper should handle both absolute and relative paths. If a path is already absolute (starts with `/`), use it directly. Otherwise resolve relative to `directory`:

```js
function makeIO(directory) {
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(directory, p);
  return {
    exists: (p) => existsSync(resolve(p)),
    readFile: (p) => readFileSync(resolve(p), 'utf-8'),
    writeFile: (p, content) => writeFileSync(resolve(p), content, 'utf-8'),
  };
}
```

Add to the returned object inside `FoundryPlugin`, alongside the existing `config` and `experimental.chat.messages.transform`:

```js
tool: {
  foundry_history_append: tool({
    description: 'Append an entry to WORK.history.yaml for the current cycle. Auto-generates timestamp and validates required fields.',
    args: {
      cycle: tool.schema.string().describe('Current cycle ID'),
      stage: tool.schema.string().describe('Full stage alias (e.g., forge:write-haiku)'),
      comment: tool.schema.string().describe('Brief description of what happened'),
    },
    async execute(args, context) {
      const io = makeIO(context.worktree);
      const iteration = getIteration('WORK.history.yaml', args.cycle, io) + (args.stage.split(':')[0] === 'forge' ? 1 : 0);
      const entry = appendEntry('WORK.history.yaml', {
        cycle: args.cycle,
        stage: args.stage,
        iteration: iteration || 1,
        comment: args.comment,
      }, io);
      return JSON.stringify(entry, null, 2);
    },
  }),

  foundry_history_list: tool({
    description: 'List all history entries for a cycle from WORK.history.yaml, sorted by timestamp ascending.',
    args: {
      cycle: tool.schema.string().describe('Cycle ID to filter by'),
    },
    async execute(args, context) {
      const io = makeIO(context.worktree);
      const entries = loadHistory('WORK.history.yaml', args.cycle, io);
      return JSON.stringify(entries, null, 2);
    },
  }),
},
```

- [ ] **Step 2: Run all tests to verify nothing breaks**

Run: `npm test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat: add foundry_history_append and foundry_history_list tools to plugin"
```

---

### Task 8: Add workfile tools to plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`

- [ ] **Step 1: Add workfile imports and tools**

Add imports:

```js
import {
  parseFrontmatter,
  createWorkfile,
  setFrontmatterField,
  getFrontmatterField,
} from '../../scripts/lib/workfile.js';
```

Add tools inside the `tool: { }` block:

```js
foundry_workfile_create: tool({
  description: 'Create WORK.md with frontmatter, goal, artefacts table, and feedback section. Errors if WORK.md already exists.',
  args: {
    flow: tool.schema.string().describe('Flow ID'),
    cycle: tool.schema.string().describe('First cycle ID'),
    stages: tool.schema.array(tool.schema.string()).describe('Ordered stage aliases'),
    maxIterations: tool.schema.number().describe('Max forge iterations before blocking'),
    goal: tool.schema.string().describe('Goal text for the # Goal section'),
    models: tool.schema.record(tool.schema.string()).optional().describe('Optional map of stage base → model ID'),
  },
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    if (existsSync(filePath)) {
      throw new Error('WORK.md already exists. Delete it first or use foundry_workfile_set to update fields.');
    }
    const fm = { flow: args.flow, cycle: args.cycle, stages: args.stages, 'max-iterations': args.maxIterations };
    if (args.models) fm.models = args.models;
    const content = createWorkfile(fm, args.goal);
    writeFileSync(filePath, content, 'utf-8');
    return 'WORK.md created successfully';
  },
}),

foundry_workfile_get: tool({
  description: 'Read WORK.md and return parsed frontmatter and goal text.',
  args: {},
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(text);
    const goalMatch = text.match(/# Goal\n\n([\s\S]*?)(?=\n## )/);
    const goal = goalMatch ? goalMatch[1].trim() : '';
    return JSON.stringify({ frontmatter, goal }, null, 2);
  },
}),

foundry_workfile_set: tool({
  description: 'Update a single frontmatter field in WORK.md.',
  args: {
    key: tool.schema.string().describe('Frontmatter field name (e.g., cycle, stages, models)'),
    value: tool.schema.any().describe('New value for the field'),
  },
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const updated = setFrontmatterField(text, args.key, args.value);
    writeFileSync(filePath, updated, 'utf-8');
    return `Set ${args.key} in WORK.md frontmatter`;
  },
}),

foundry_workfile_delete: tool({
  description: 'Delete WORK.md.',
  args: {},
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const { unlinkSync } = await import('fs');
    unlinkSync(filePath);
    return 'WORK.md deleted';
  },
}),
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat: add foundry_workfile_create/get/set/delete tools to plugin"
```

---

### Task 9: Add artefacts tools to plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`

- [ ] **Step 1: Add artefacts imports and tools**

Add import:

```js
import { parseArtefactsTable, addArtefactRow, setArtefactStatus } from '../../scripts/lib/artefacts.js';
```

Add tools:

```js
foundry_artefacts_add: tool({
  description: 'Add a row to the artefacts table in WORK.md.',
  args: {
    file: tool.schema.string().describe('File path of the artefact'),
    type: tool.schema.string().describe('Artefact type ID'),
    cycle: tool.schema.string().describe('Cycle ID'),
    status: tool.schema.string().optional().describe('Status (default: draft)'),
  },
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const updated = addArtefactRow(text, {
      file: args.file,
      type: args.type,
      cycle: args.cycle,
      status: args.status || 'draft',
    });
    writeFileSync(filePath, updated, 'utf-8');
    return `Added artefact ${args.file} to table`;
  },
}),

foundry_artefacts_set_status: tool({
  description: 'Update the status of an artefact in the WORK.md artefacts table.',
  args: {
    file: tool.schema.string().describe('File path of the artefact'),
    status: tool.schema.string().describe('New status (e.g., draft, done, blocked)'),
  },
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const updated = setArtefactStatus(text, args.file, args.status);
    writeFileSync(filePath, updated, 'utf-8');
    return `Set ${args.file} status to ${args.status}`;
  },
}),

foundry_artefacts_list: tool({
  description: 'List all artefacts from the WORK.md artefacts table.',
  args: {},
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    return JSON.stringify(parseArtefactsTable(text), null, 2);
  },
}),
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat: add foundry_artefacts_add/set_status/list tools to plugin"
```

---

### Task 10: Add feedback tools to plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`

- [ ] **Step 1: Add feedback imports and tools**

Add import:

```js
import {
  addFeedbackItem,
  actionFeedbackItem,
  wontfixFeedbackItem,
  resolveFeedbackItem,
  listFeedback,
} from '../../scripts/lib/feedback.js';
import { parseArtefactsTable } from '../../scripts/lib/artefacts.js';
```

Note: `parseArtefactsTable` may already be imported from Task 9. Don't duplicate.

Add tools:

```js
foundry_feedback_add: tool({
  description: 'Add a feedback item under a file heading in the WORK.md Feedback section. Creates headings if needed.',
  args: {
    file: tool.schema.string().describe('File path the feedback applies to (must match artefacts table)'),
    text: tool.schema.string().describe('Feedback text'),
    tag: tool.schema.string().describe('Tag: validation, law:<id>, or hitl'),
  },
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const updated = addFeedbackItem(text, args.file, args.text, args.tag);
    writeFileSync(filePath, updated, 'utf-8');
    return `Added feedback item for ${args.file}`;
  },
}),

foundry_feedback_action: tool({
  description: 'Mark a feedback item as actioned [x] by its index under a file heading.',
  args: {
    file: tool.schema.string().describe('File path'),
    index: tool.schema.number().describe('Zero-based index of the item under this file heading'),
  },
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const updated = actionFeedbackItem(text, args.file, args.index);
    writeFileSync(filePath, updated, 'utf-8');
    return `Marked item ${args.index} under ${args.file} as actioned`;
  },
}),

foundry_feedback_wontfix: tool({
  description: 'Mark a feedback item as wont-fix [~] with a reason.',
  args: {
    file: tool.schema.string().describe('File path'),
    index: tool.schema.number().describe('Zero-based index of the item'),
    reason: tool.schema.string().describe('Justification for wont-fix'),
  },
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const updated = wontfixFeedbackItem(text, args.file, args.index, args.reason);
    writeFileSync(filePath, updated, 'utf-8');
    return `Marked item ${args.index} under ${args.file} as wont-fix: ${args.reason}`;
  },
}),

foundry_feedback_resolve: tool({
  description: 'Resolve a feedback item as approved or rejected.',
  args: {
    file: tool.schema.string().describe('File path'),
    index: tool.schema.number().describe('Zero-based index of the item'),
    resolution: tool.schema.enum(['approved', 'rejected']).describe('approved or rejected'),
    reason: tool.schema.string().optional().describe('Reason (required if rejected)'),
  },
  async execute(args, context) {
    if (args.resolution === 'rejected' && !args.reason) {
      throw new Error('Reason is required when rejecting a feedback item');
    }
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const updated = resolveFeedbackItem(text, args.file, args.index, args.resolution, args.reason);
    writeFileSync(filePath, updated, 'utf-8');
    return `Resolved item ${args.index} under ${args.file} as ${args.resolution}`;
  },
}),

foundry_feedback_list: tool({
  description: 'List all feedback items from WORK.md, optionally filtered by file.',
  args: {
    file: tool.schema.string().optional().describe('Filter to a specific file (optional)'),
  },
  async execute(args, context) {
    const filePath = path.join(context.worktree, 'WORK.md');
    const text = readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(text);
    const artefacts = parseArtefactsTable(text);
    const items = listFeedback(text, fm.cycle, artefacts, args.file);
    return JSON.stringify(items, null, 2);
  },
}),
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat: add foundry_feedback_add/action/wontfix/resolve/list tools to plugin"
```

---

### Task 11: Add sort tool to plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`
- Modify: `scripts/sort.js` (export a callable function instead of only CLI)

- [ ] **Step 1: Add a `runSort` function to sort.js**

Extract the core logic from `main()` into an exported function:

```js
// Add to scripts/sort.js, before the main() function

export function runSort({ workPath = 'WORK.md', historyPath = 'WORK.history.yaml', foundryDir = 'foundry', cycleDef } = {}, io = defaultIO) {
  if (!io.exists(workPath)) {
    throw new Error('WORK.md not found');
  }

  const workText = io.readFile(workPath);
  const frontmatter = parseFrontmatter(workText);

  const cycle = frontmatter.cycle;
  const stages = frontmatter.stages;
  const maxIterations = frontmatter['max-iterations'] ?? 3;

  if (!cycle) throw new Error('No cycle in WORK.md frontmatter');
  if (!stages || !Array.isArray(stages)) throw new Error('No stages in WORK.md frontmatter');
  if (!findFirst(stages, 'forge')) throw new Error('stages must include at least one forge stage');

  const artefacts = parseArtefactsTable(workText);
  const history = loadHistory(historyPath, cycle, io);
  const feedback = parseFeedback(workText, cycle, artefacts);

  // File modification enforcement
  const nonSortHistory = history.filter(e => baseStage(e.stage || '') !== 'sort');
  if (nonSortHistory.length > 0) {
    const lastEntry = nonSortHistory[nonSortHistory.length - 1];
    const lastBase = baseStage(lastEntry.stage || '');

    const resolvedCycleDef = cycleDef
      || frontmatter['cycle-def']
      || `${foundryDir}/cycles/${cycle}.md`;

    const result = checkModifiedFiles(lastBase, foundryDir, resolvedCycleDef, cycle, io);
    if (!result.ok) {
      return {
        route: 'violation',
        details: `File modification violation after ${lastBase} stage: ${result.violations.join(', ')}`,
      };
    }
  }

  // Tag validation
  const tagErrors = validateTags(workText, foundryDir);
  if (tagErrors.length > 0) {
    return {
      route: 'violation',
      details: `Tag validation failed: ${tagErrors.map(e => `line ${e.line}: ${e.message}`).join('; ')}`,
    };
  }

  const route = determineRoute(stages, history, feedback, maxIterations);

  // Resolve model if applicable
  const models = frontmatter.models || {};
  const routeBase = route.includes(':') ? baseStage(route) : null;
  let model = null;
  if (routeBase && models[routeBase]) {
    const modelId = models[routeBase];
    model = `foundry-${modelId.replace(/\//g, '-')}`;
  }

  return { route, model };
}
```

- [ ] **Step 2: Add sort tool to plugin**

Add import:

```js
import { runSort } from '../../scripts/sort.js';
```

Add tool:

```js
foundry_sort: tool({
  description: 'Run the sort routing logic to determine the next stage in the cycle. Returns route, optional model, and violation details.',
  args: {
    cycleDef: tool.schema.string().optional().describe('Path to cycle definition file (optional, auto-resolved)'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    const result = runSort({ cycleDef: args.cycleDef }, io);
    return JSON.stringify(result, null, 2);
  },
}),
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/sort.js .opencode/plugins/foundry.js
git commit -m "feat: add foundry_sort tool wrapping sort routing logic"
```

---

### Task 12: Add git tools to plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`

- [ ] **Step 1: Add git tools**

```js
foundry_git_branch: tool({
  description: 'Create a work branch off main for a foundry flow.',
  args: {
    flowId: tool.schema.string().describe('Flow ID'),
    description: tool.schema.string().describe('Short description for branch name'),
  },
  async execute(args, context) {
    const branchName = `work/${args.flowId}-${args.description}`;
    const { execSync } = await import('child_process');
    execSync(`git checkout -b ${branchName}`, { cwd: context.worktree });
    return `Created branch: ${branchName}`;
  },
}),

foundry_git_commit: tool({
  description: 'Create a micro commit with the foundry commit message format.',
  args: {
    cycle: tool.schema.string().describe('Cycle ID'),
    stage: tool.schema.string().describe('Full stage alias (e.g., forge:write-haiku)'),
    description: tool.schema.string().describe('Brief commit description'),
  },
  async execute(args, context) {
    const { execSync } = await import('child_process');
    const message = `[${args.cycle}] ${args.stage}: ${args.description}`;
    execSync('git add .', { cwd: context.worktree });
    const result = execSync(`git commit -m "${message}"`, { cwd: context.worktree, encoding: 'utf-8' });
    const hashMatch = result.match(/\[.+ ([a-f0-9]+)\]/);
    const hash = hashMatch ? hashMatch[1] : 'unknown';
    return `Committed: ${message} (${hash})`;
  },
}),
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat: add foundry_git_branch and foundry_git_commit tools to plugin"
```

---

### Task 13: Add config tools to plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`

- [ ] **Step 1: Add config imports and tools**

Add import:

```js
import {
  getCycleDefinition,
  getArtefactType,
  getLaws,
  getValidation,
  getAppraisers,
  getFlow,
} from '../../scripts/lib/config.js';
```

Note: `makeIO` needs a `readDir` method for config functions. Update `makeIO`:

```js
function makeIO(directory) {
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(directory, p);
  return {
    exists: (p) => existsSync(resolve(p)),
    readFile: (p) => readFileSync(resolve(p), 'utf-8'),
    writeFile: (p, content) => writeFileSync(resolve(p), content, 'utf-8'),
    readDir: (p) => {
      const { readdirSync } = require('fs');
      return readdirSync(resolve(p));
    },
  };
}
```

Wait — this is ESM, use `import`:

```js
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';

function makeIO(directory) {
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(directory, p);
  return {
    exists: (p) => existsSync(resolve(p)),
    readFile: (p) => readFileSync(resolve(p), 'utf-8'),
    writeFile: (p, content) => writeFileSync(resolve(p), content, 'utf-8'),
    readDir: (p) => readdirSync(resolve(p)),
  };
}
```

Add tools:

```js
foundry_config_cycle: tool({
  description: 'Read a cycle definition from foundry/cycles/. Returns parsed frontmatter and body.',
  args: {
    cycleId: tool.schema.string().describe('Cycle ID'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    return JSON.stringify(getCycleDefinition('foundry', args.cycleId, io), null, 2);
  },
}),

foundry_config_artefact_type: tool({
  description: 'Read an artefact type definition from foundry/artefacts/<type>/definition.md.',
  args: {
    typeId: tool.schema.string().describe('Artefact type ID'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    return JSON.stringify(getArtefactType('foundry', args.typeId, io), null, 2);
  },
}),

foundry_config_laws: tool({
  description: 'Read all applicable laws. Returns global laws, plus type-specific laws if typeId is provided.',
  args: {
    typeId: tool.schema.string().optional().describe('Artefact type ID for type-specific laws (optional)'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    return JSON.stringify(getLaws('foundry', args.typeId, io), null, 2);
  },
}),

foundry_config_validation: tool({
  description: 'Read validation commands for an artefact type. Returns null if no validation.md exists.',
  args: {
    typeId: tool.schema.string().describe('Artefact type ID'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    return JSON.stringify(getValidation('foundry', args.typeId, io));
  },
}),

foundry_config_appraisers: tool({
  description: 'List all appraiser definitions from foundry/appraisers/.',
  args: {},
  async execute(args, context) {
    const io = makeIO(context.worktree);
    return JSON.stringify(getAppraisers('foundry', io), null, 2);
  },
}),

foundry_config_flow: tool({
  description: 'Read a flow definition from foundry/flows/.',
  args: {
    flowId: tool.schema.string().describe('Flow ID'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    return JSON.stringify(getFlow('foundry', args.flowId, io), null, 2);
  },
}),
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat: add foundry_config tools for reading cycle/artefact/law/appraiser/flow definitions"
```

---

### Task 14: Add validate and appraiser selection tools to plugin

**Files:**
- Modify: `.opencode/plugins/foundry.js`

- [ ] **Step 1: Add validate tool**

```js
foundry_validate_run: tool({
  description: 'Run all validation commands for an artefact type against a file. Returns pass/fail for each command.',
  args: {
    typeId: tool.schema.string().describe('Artefact type ID'),
    file: tool.schema.string().describe('Path to the artefact file to validate'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    const commands = getValidation('foundry', args.typeId, io);
    if (commands === null) {
      return JSON.stringify({ skipped: true, message: 'No validation.md found for this type' });
    }

    const { execSync } = await import('child_process');
    const results = [];
    for (const cmd of commands) {
      const resolved = cmd.replace(/\{file\}/g, args.file);
      try {
        const output = execSync(resolved, { cwd: context.worktree, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        results.push({ command: resolved, passed: true, output: output.trim() });
      } catch (err) {
        results.push({ command: resolved, passed: false, output: (err.stderr || err.stdout || err.message).trim() });
      }
    }

    return JSON.stringify(results, null, 2);
  },
}),
```

- [ ] **Step 2: Add appraiser selection tool**

Add import:

```js
import { selectAppraisers } from '../../scripts/lib/config.js';
```

Add tool:

```js
foundry_appraisers_select: tool({
  description: 'Select appraisers for a type using the round-robin algorithm. Returns selected appraisers with resolved models.',
  args: {
    typeId: tool.schema.string().describe('Artefact type ID'),
    count: tool.schema.number().optional().describe('Override appraiser count (optional)'),
  },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    return JSON.stringify(selectAppraisers('foundry', args.typeId, args.count, io), null, 2);
  },
}),
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add .opencode/plugins/foundry.js
git commit -m "feat: add foundry_validate_run and foundry_appraisers_select tools to plugin"
```

---

## Phase 3: Update Skills

### Task 15: Update sort skill

**Files:**
- Modify: `skills/sort/SKILL.md`

- [ ] **Step 1: Rewrite sort skill to use tools**

Replace the Protocol section with:

```markdown
## Protocol

1. Call the `foundry_sort` tool to determine the next stage:

   The tool runs routing logic, file modification enforcement, and tag validation.
   It returns `{route, model?, details?}`.

2. Call `foundry_history_append` with:
   - `cycle`: current cycle ID (from WORK.md frontmatter)
   - `stage`: `sort`
   - `comment`: your reasoning — why this route was chosen, what feedback state you observed

3. Act on the result:
   - Route is a stage alias (e.g., `forge:write-haiku`) → dispatch the corresponding skill as a sub-agent
   - `done` → cycle is complete, return to the cycle skill
   - `blocked` → cycle is blocked (iteration limit hit), return to the cycle skill
   - `violation` → file modification or tag violation detected (details in `details` field). Log the violation, set artefact status to `blocked` via `foundry_artefacts_set_status`, and return to the cycle skill

### Model dispatch

When dispatching a stage as a sub-agent, use the `model` field from the sort result:
- If `model` is set (e.g., `foundry-openai-gpt-4o`): dispatch with `subagent_type: "<model>"`
- If `model` is null: dispatch with `subagent_type: "general"` (inherits session model)
- If the specified agent does not exist, **hard fail** with an error message

4. After the invoked skill completes, call `foundry_sort` again. Repeat until sort returns `done`, `blocked`, or `violation`.
```

Remove the section about running `node scripts/sort.js` and the enforcement checks section (tools handle that now).

Keep the "What you do NOT do" section as-is.

- [ ] **Step 2: Commit**

```bash
git add skills/sort/SKILL.md
git commit -m "refactor: update sort skill to use foundry_sort and foundry_history_append tools"
```

---

### Task 16: Update quench skill

**Files:**
- Modify: `skills/quench/SKILL.md`

- [ ] **Step 1: Rewrite quench skill to use tools**

Replace the Protocol section with:

```markdown
## Protocol

1. Call `foundry_workfile_get` to identify the artefact and its type
2. Call `foundry_config_validation` with the artefact type ID
3. If the result is null (no validation.md), output SKIP and stop
4. Call `foundry_validate_run` with the type ID and artefact file path
5. For each failed command in the results:
   - Call `foundry_feedback_add` with the artefact file, a description of the failure, and tag `validation`
6. If all commands passed, add no new feedback

## Reviewing actioned feedback

On subsequent passes, review previously actioned items:

1. Call `foundry_feedback_list` filtered to the artefact file — look for items with state `actioned` and tag `#validation`
2. For each actioned item, re-run the relevant validation via `foundry_validate_run`
   - If the relevant command passes: call `foundry_feedback_resolve` with `approved`
   - If it fails: call `foundry_feedback_resolve` with `rejected` and reason `still failing`

There is no wont-fix for validation feedback. Deterministic rules are not negotiable.

## History

After completing validation, call `foundry_history_append` with the cycle, stage alias, and a brief summary (e.g., "2 validation issues found" or "Validation passed").
```

Remove the old feedback format section (the tool handles formatting).

- [ ] **Step 2: Commit**

```bash
git add skills/quench/SKILL.md
git commit -m "refactor: update quench skill to use foundry tools"
```

---

### Task 17: Update hitl skill

**Files:**
- Modify: `skills/hitl/SKILL.md`

- [ ] **Step 1: Rewrite hitl skill to use tools**

Replace the Protocol section with:

```markdown
## Protocol

1. Call `foundry_workfile_get` — understand the current state: goal, artefacts, feedback
2. Call `foundry_config_cycle` — find the hitl configuration for your alias
3. Call `foundry_history_list` — get cycle history for summarizing progress
4. Call `foundry_feedback_list` — get current feedback state
5. Present to the human:
   - A summary of where we are in the cycle (based on history)
   - The current state of the artefact (show or summarize)
   - Any feedback that exists
   - The prompt from the hitl configuration (or a sensible default)
6. Wait for the human's response
7. Record the response:
   - If the human requested changes: call `foundry_feedback_add` with the artefact file, the human's request, and tag `hitl`
   - If the human wants to abort: call `foundry_artefacts_set_status` with status `blocked`
8. Call `foundry_history_append` with the cycle, stage alias, and what the human said or decided
9. Return control to the sort skill
```

- [ ] **Step 2: Commit**

```bash
git add skills/hitl/SKILL.md
git commit -m "refactor: update hitl skill to use foundry tools"
```

---

### Task 18: Update forge skill

**Files:**
- Modify: `skills/forge/SKILL.md`

- [ ] **Step 1: Rewrite forge skill to use tools**

Replace the Protocol section with:

```markdown
## Protocol

### First generation (no artefact registered in WORK.md yet)

1. Call `foundry_workfile_get` — understand the goal
2. Call `foundry_config_cycle` with the cycle ID — understand what to produce and what inputs are available
3. Call `foundry_config_artefact_type` with the output type — understand the artefact definition
4. Call `foundry_config_laws` with the type ID — get all applicable laws (global + type-specific)
5. If the cycle has inputs, read the input artefacts (read-only context)
6. Produce the artefact, respecting all applicable laws from the start
7. Write the artefact to the location specified in the artefact type definition
8. Call `foundry_artefacts_add` with the file path, type, cycle, and status `draft`

### Revision (feedback exists in WORK.md)

1. Call `foundry_feedback_list` filtered to the artefact file — find unresolved items
2. Read the artefact
3. If the cycle has inputs, read the input artefacts (read-only context)
4. For each unresolved feedback item, either:
   - Address it and call `foundry_feedback_action` with the file and item index
   - Call `foundry_feedback_wontfix` with justification if you believe the feedback should not be actioned (only for `#law:` feedback — validation feedback must be actioned)
5. Update the artefact file

## History

After completing your work, call `foundry_history_append` with the cycle, stage alias, and a brief description of what you did.
```

Keep the "Unresolved feedback" section, "Feedback tagged #hitl" section, and "What you do NOT do" section as-is.

- [ ] **Step 2: Commit**

```bash
git add skills/forge/SKILL.md
git commit -m "refactor: update forge skill to use foundry tools"
```

---

### Task 19: Update appraise skill

**Files:**
- Modify: `skills/appraise/SKILL.md`

- [ ] **Step 1: Rewrite appraise skill to use tools**

Replace the Protocol section with:

```markdown
## Protocol

1. Call `foundry_workfile_get` — identify the artefact to appraise and its type
2. Call `foundry_config_laws` with the type ID — get all applicable laws
3. Call `foundry_config_artefact_type` with the type ID — for context
4. Call `foundry_appraisers_select` with the type ID — get selected appraisers with resolved models
5. Dispatch each appraiser as a sub-agent (see Dispatch below)
6. Collect results from all appraisers
7. Consolidate:
   - Union of all issues — if any one appraiser flags it, it's feedback
   - De-duplicate: merge overlapping observations into a single feedback item
   - Preserve which appraiser(s) raised each issue
8. For each consolidated issue: call `foundry_feedback_add` with the artefact file, issue description, and tag `law:<law-id>`
9. If no appraiser found any issues, the artefact clears appraisal

## Dispatch

Each appraiser is dispatched as an independent sub-agent. The `foundry_appraisers_select` tool returns `{id, personality, model}` for each.

- If `model` is set: dispatch with `subagent_type: "foundry-<model>"` (already formatted by the tool)
  - Actually, the model field from select is the raw model ID (e.g., `openai/gpt-4o`). Convert to agent name: `foundry-<model-id-with-slashes-replaced-by-dashes>`
- If `model` is not set: dispatch with `subagent_type: "general"`
- If the specified agent does not exist, **hard fail** with an error

Dispatch all appraisers in parallel (multiple Task calls in a single response).
```

Replace the "Reviewing actioned and wont-fix feedback" section with:

```markdown
## Reviewing actioned and wont-fix feedback

On subsequent passes, review previously actioned and wont-fix items:

1. Call `foundry_feedback_list` filtered to the artefact file
2. For `actioned` items (state `actioned`, not resolved): check whether the change addresses the issue
   - If yes: call `foundry_feedback_resolve` with `approved`
   - If no: call `foundry_feedback_resolve` with `rejected` and reason
3. For `wont-fix` items (state `wont-fix`, not resolved): read the justification
   - If sound: call `foundry_feedback_resolve` with `approved`
   - If not: call `foundry_feedback_resolve` with `rejected`
```

Replace the History section with:

```markdown
## History

After completing the appraisal consolidation, call `foundry_history_append` with the cycle, stage alias, and a brief summary (e.g., "3 issues found across 2 appraisers" or "No issues found, cycle complete").
```

Keep the sub-agent prompt template, Dispatch instructions, and "What you do NOT do" section.

- [ ] **Step 2: Commit**

```bash
git add skills/appraise/SKILL.md
git commit -m "refactor: update appraise skill to use foundry tools"
```

---

### Task 20: Update cycle skill

**Files:**
- Modify: `skills/cycle/SKILL.md`

- [ ] **Step 1: Rewrite cycle skill to use tools**

Replace "Starting a foundry cycle" with:

```markdown
## Starting a foundry cycle

1. Call `foundry_config_cycle` with the cycle ID — get the cycle definition
2. Call `foundry_config_artefact_type` with the output type — get the artefact definition
3. Determine the stage route:
   - Use the cycle definition's `stages` field if present
   - Otherwise, generate defaults: always `forge`, call `foundry_config_validation` to check if validation exists (add `quench` if so), always `appraise`
   - Cycle definitions can include `hitl` entries
4. Call `foundry_workfile_set` to update frontmatter:
   - `foundry_workfile_set(key: "cycle", value: <cycle-id>)`
   - `foundry_workfile_set(key: "stages", value: [<stage list>])`
   - `foundry_workfile_set(key: "max-iterations", value: <n>)`
   - If the cycle definition has a `models` map: `foundry_workfile_set(key: "models", value: <models>)`
5. Invoke the sort skill
```

Replace "Completing a foundry cycle" with:

```markdown
## Completing a foundry cycle

When sort returns `done`:
- Call `foundry_artefacts_set_status` with the artefact file and status `done`
- Return control to the flow skill

When sort returns `blocked`:
- Call `foundry_artefacts_set_status` with the artefact file and status `blocked`
- Return control to the flow skill
```

Replace the "Micro commits" section with:

```markdown
## Micro commits

Every stage must end with a micro commit. Call `foundry_git_commit` with the cycle ID, stage alias, and a brief description.

Examples:
- `foundry_git_commit(cycle: "haiku-creation", stage: "forge:write-haiku", description: "initial draft")`
- `foundry_git_commit(cycle: "haiku-creation", stage: "quench:check-syllables", description: "checked syllable pattern")`
```

- [ ] **Step 2: Commit**

```bash
git add skills/cycle/SKILL.md
git commit -m "refactor: update cycle skill to use foundry tools"
```

---

### Task 21: Update flow skill

**Files:**
- Modify: `skills/flow/SKILL.md`

- [ ] **Step 1: Rewrite flow skill to use tools**

Replace "Starting a foundry flow" with:

```markdown
## Starting a foundry flow

1. Call `foundry_config_flow` with the flow ID — get the flow definition
2. Call `foundry_git_branch` with the flow ID and a short description
3. Call `foundry_workfile_create` with:
   - `flow`: the flow ID
   - `cycle`: the first cycle ID from the flow definition
   - `stages`: `[]` (the cycle skill will populate this)
   - `maxIterations`: 3 (default)
   - `goal`: goal from the flow definition + human context
4. Execute each cycle in order by invoking the cycle skill
5. Between cycles: call `foundry_workfile_set(key: "cycle", value: <next-cycle-id>)`
6. When all cycles are done: call `foundry_workfile_delete`
```

- [ ] **Step 2: Commit**

```bash
git add skills/flow/SKILL.md
git commit -m "refactor: update flow skill to use foundry tools"
```

---

## Phase 4: Cleanup

### Task 22: Remove sort.js CLI entry point and consolidate

**Files:**
- Modify: `scripts/sort.js` (remove `main()` and CLI entry point)
- Modify: `tests/sort.test.js` (update imports to use lib modules directly, add tests for `runSort`)

- [ ] **Step 1: Remove main() and CLI handling from sort.js**

Remove the `main()` function and the `if (process.argv[1] === ...)` block from the bottom of sort.js. The file now only exports functions.

Also remove the `parseArgs` import since it's only used by main().

- [ ] **Step 2: Update sort.test.js imports**

The existing tests import from `../scripts/sort.js` which re-exports from lib modules. These still work. Add a test for `runSort`:

```js
describe('runSort', () => {
  it('returns route for fresh cycle', () => {
    const files = {
      'WORK.md': '---\ncycle: c1\nstages:\n  - forge:a\n  - quench:b\n  - appraise:c\nmax-iterations: 3\n---\n\n# Goal\n\nTest\n\n## Artefacts\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n\n## Feedback\n',
      'foundry/laws': [],
    };
    const io = {
      exists: (p) => p in files || p === 'foundry/laws',
      readFile: (p) => files[p] || '',
      readDir: (p) => files[p] || [],
    };
    const result = runSort({}, io);
    assert.equal(result.route, 'forge:a');
  });
});
```

Add the import for `runSort` at the top of the test file.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/sort.js tests/sort.test.js
git commit -m "refactor: remove sort.js CLI entry point, add runSort tests"
```

---

### Task 23: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Verify plugin loads**

Check that the plugin file has valid syntax and all imports resolve:

Run: `node -e "import('./.opencode/plugins/foundry.js').then(() => console.log('OK')).catch(e => console.error(e))"`
Expected: `OK`

- [ ] **Step 3: Commit any remaining cleanup**

```bash
git add -A
git status
# Only commit if there are changes
git commit -m "chore: final cleanup after custom tools migration"
```
