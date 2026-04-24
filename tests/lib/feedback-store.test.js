// tests/lib/feedback-store.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { openFeedbackStore } from '../../scripts/lib/feedback-store.js';

// In-memory IO shim with rename support (matches the shape used by history tests).
function mockIO(initial = {}) {
  const files = { ...initial };
  return {
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFile: (p, c) => { files[p] = c; },
    rename: (from, to) => {
      if (!Object.prototype.hasOwnProperty.call(files, from)) throw new Error(`ENOENT: ${from}`);
      files[to] = files[from];
      delete files[from];
    },
    unlink: (p) => { delete files[p]; },
    _files: files,
  };
}

describe('openFeedbackStore — empty file', () => {
  test('returns a store with empty list when file is missing', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.deepEqual(store.list(), []);
  });

  test('returns a store with empty list when file has {items: []}', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ items: [] }) });
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.deepEqual(store.list(), []);
  });
});

describe('openFeedbackStore — add + list round-trip', () => {
  test('adding an item persists it with the expected shape', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({
      file: 'haiku.md',
      tag: 'law:dark',
      text: 'too cheerful',
      source: 'appraise:write-check',
      cycle: 'write-haiku',
    });
    assert.equal(typeof id, 'string');
    assert.equal(id.length, 26);
    const items = store.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, id);
    assert.equal(items[0].file, 'haiku.md');
    assert.equal(items[0].tag, 'law:dark');
    assert.equal(items[0].text, 'too cheerful');
    assert.equal(items[0].source, 'appraise:write-check');
    assert.equal(items[0].history[0].state, 'open');
    assert.equal(items[0].history[0].stage, 'appraise:write-check');
    assert.equal(items[0].history[0].cycle, 'write-haiku');
    assert.match(items[0].history[0].timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('a fresh store instance on the same io sees the persisted item', () => {
    const io = mockIO();
    const s1 = openFeedbackStore('WORK.feedback.yaml', io);
    s1.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    const s2 = openFeedbackStore('WORK.feedback.yaml', io);
    assert.equal(s2.list().length, 1);
  });
});
