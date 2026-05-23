// tests/lib/feedback-store.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { openFeedbackStore } from '../../src/scripts/lib/feedback-store.js';

// In-memory IO shim with rename support (matches the shape used by history tests).
function mockIO(initial = {}) {
  const files = { ...initial };
  return {
    exists: (p) => Object.hasOwn(files, p),
    readFile: (p) => {
      if (!Object.hasOwn(files, p)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFile: (p, c) => { files[p] = c; },
    rename: (from, to) => {
      if (!Object.hasOwn(files, from)) throw new Error(`ENOENT: ${from}`);
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

describe('openFeedbackStore — malformed YAML validation', () => {
  test('rejects top-level array with clear error', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump([{ id: '123' }]) });
    assert.throws(
      () => openFeedbackStore('WORK.feedback.yaml', io),
      /WORK\.feedback\.yaml malformed: top-level must be an object with an 'items' array/,
    );
  });

  test('rejects object without items array', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ other: 'field' }) });
    assert.throws(
      () => openFeedbackStore('WORK.feedback.yaml', io),
      /WORK\.feedback\.yaml malformed: top-level must be an object with an 'items' array/,
    );
  });

  test('rejects object with items as non-array', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ items: 'not-array' }) });
    assert.throws(
      () => openFeedbackStore('WORK.feedback.yaml', io),
      /WORK\.feedback\.yaml malformed: top-level must be an object with an 'items' array/,
    );
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

describe('store.transition — forge path', () => {
  test('open → actioned is persisted as a prepended snapshot', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    const r = store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    assert.equal(r.ok, true);
    const item = store.get(id);
    assert.equal(item.history.length, 2);
    assert.equal(item.history[0].state, 'actioned');
    assert.equal(item.history[0].stage, 'forge:write');
    assert.equal(item.history[1].state, 'open');
  });

  test('wont-fix transition requires a reason', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    const r = store.transition({ id, target: 'wont-fix', stage: 'forge:write', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /reason is required/);
  });

  test('wont-fix with reason persists reason on the snapshot', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    const r = store.transition({ id, target: 'wont-fix', stage: 'forge:write', cycle: 'c', reason: 'out of scope' });
    assert.equal(r.ok, true);
    assert.equal(store.get(id).history[0].reason, 'out of scope');
  });

  test('forge cannot transition from actioned', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    assert.equal(r.ok, false);
  });

  test('forge cannot wont-fix a quench-sourced item (A2/rule 7)', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'quench:schema', cycle: 'c' });
    const r = store.transition({
      id,
      target: 'wont-fix',
      stage: 'forge:write',
      cycle: 'c',
      reason: 'too hard',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /source is appraise/);
    assert.match(r.error, /source is quench:schema/);
  });
});

describe('store.transition — source-stage authorship', () => {
  test('appraise can resolve when its stage matches item.source', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'resolved', stage: 'appraise:write-check', cycle: 'c', reason: 'addressed' });
    assert.equal(r.ok, true);
    assert.equal(store.get(id).history[0].state, 'resolved');
    assert.equal(store.get(id).history[0].reason, 'addressed');
  });

  test('resolved transition does not require a reason (spec §4.3, REVISION-CONTRACT §A1 + G1)', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'resolved', stage: 'appraise:write-check', cycle: 'c' });
    assert.equal(r.ok, true);
  });

  test('appraise of a different stage id cannot resolve', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'resolved', stage: 'appraise:other-check', cycle: 'c', reason: 'fine' });
    assert.equal(r.ok, false);
    assert.match(r.error, /source/);
  });

  test('rejection requires a reason', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const bad = store.transition({ id, target: 'rejected', stage: 'appraise:write-check', cycle: 'c' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /reason is required/);
  });
});

describe('store.transition — human-appraise universal authority (A3)', () => {
  // Per REVISION-CONTRACT §A3 / spec §5.1 rule 5: human-appraise may override
  // ANY non-resolved item, not only deadlocked items. These tests exercise
  // the non-deadlocked override path that A3 locks in.

  test('human-appraise can resolve an actioned item it did NOT source', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:other', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({
      id,
      target: 'resolved',
      stage: 'human-appraise:review',
      cycle: 'c',
      reason: 'approved on review',
    });
    assert.equal(r.ok, true);
    assert.equal(store.get(id).history[0].state, 'resolved');
  });

  test('human-appraise can reject a wont-fix item it did NOT source', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:other', cycle: 'c' });
    store.transition({ id, target: 'wont-fix', stage: 'forge:write', cycle: 'c', reason: 'scope' });
    const r = store.transition({
      id,
      target: 'rejected',
      stage: 'human-appraise:review',
      cycle: 'c',
      reason: 'please fix after all',
    });
    assert.equal(r.ok, true);
  });

  test('human-appraise override on non-deadlocked items does not require reason for approval (G1)', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:other', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'resolved', stage: 'human-appraise:review', cycle: 'c' });
    assert.equal(r.ok, true);
  });

  test('human-appraise override on non-deadlocked items still requires reason for rejection', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:other', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'rejected', stage: 'human-appraise:review', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /reason is required/);
  });
});



describe('store.transition — terminal resolved', () => {
  test('no transitions from resolved', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    store.transition({ id, target: 'resolved', stage: 'appraise:a', cycle: 'c', reason: 'ok' });
    const r = store.transition({ id, target: 'rejected', stage: 'appraise:a', cycle: 'c', reason: 'x' });
    assert.equal(r.ok, false);
  });
});

describe('store.transition — unknown id', () => {
  test('returns ok:false with a clear error', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const r = store.transition({ id: 'DOES_NOT_EXIST', target: 'actioned', stage: 'forge:write', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});



describe('store.add — dedup semantics', () => {
  test('same (file, tag, text) returns existing id and does not write a new item', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const first = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    const second = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(second.deduped, true);
    assert.equal(second.id, first.id);
    assert.equal(store.list().length, 1);
  });

  test('different file breaks dedup', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    const r = store.add({ file: 'b.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(r.deduped, false);
    assert.equal(store.list().length, 2);
  });

  test('different tag breaks dedup', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    const r = store.add({ file: 'a.md', tag: 'law:y', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(r.deduped, false);
    assert.equal(store.list().length, 2);
  });

  test('resolved items do not block re-addition (regression feedback)', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const a = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    store.transition({ id: a.id, target: 'actioned', stage: 'forge:w', cycle: 'c' });
    store.transition({ id: a.id, target: 'resolved', stage: 'appraise:a', cycle: 'c', reason: 'ok' });
    const b = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(b.deduped, false);
    assert.notEqual(b.id, a.id);
    assert.equal(store.list().length, 2);
  });

  test('deadlocked items DO block dedup (they are non-resolved) [backward compat]', () => {
    // Deadlocked state is no longer written, but existing items with that
    // state in WORK.feedback.yaml should still block dedup.
    const io = mockIO({
      'WORK.feedback.yaml': yaml.dump({
        items: [{
          id: 'EXJ00000000000000000000000',
          file: 'a.md', tag: 'law:x', text: 'same',
          source: 'appraise:a', cycle: 'c',
          history: [{ state: 'deadlocked', stage: 'sort', cycle: 'c', timestamp: '2026-01-01T00:00:00.000Z', reason: 'backward compat' }],
        }],
      }),
    });
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const b = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(b.deduped, true);
    assert.equal(b.id, 'EXJ00000000000000000000000');
  });
});

describe('store.add — source format validation (RED target)', () => {
  // Per spec §4.2: source is `base:alias`. Task 1.6's implementation accepts
  // any non-empty string. These tests force the implementation to validate
  // the format; they are the RED step for task 1.10.

  test('rejects source without a colon', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise', cycle: 'c' }),
      /source must be in 'base:alias' form/,
    );
  });

  test('rejects source with empty alias', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:', cycle: 'c' }),
      /source must be in 'base:alias' form/,
    );
  });

  test('rejects source with empty base', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: ':alias', cycle: 'c' }),
      /source must be in 'base:alias' form/,
    );
  });

  test('rejects source with unknown base', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'sort:main', cycle: 'c' }),
      /unknown source base/,
    );
  });

  test('accepts all valid source bases', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    for (const base of ['forge', 'quench', 'appraise', 'human-appraise']) {
      const r = store.add({ file: `${base}.md`, tag: 'law:x', text: 't', source: `${base}:alias`, cycle: 'c' });
      assert.equal(typeof r.id, 'string');
    }
  });

  test('rejects assay as a source base (assay does not produce feedback)', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'validation', text: 't', source: 'assay:c', cycle: 'c' }),
      /unknown source base.*assay/,
    );
  });
});

describe('store.add — atomicity', () => {
  test('rename failure leaves the live file unchanged AND in-memory list unchanged', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ items: [] }) });
    const originalContent = io._files['WORK.feedback.yaml'];
    // Override rename to throw on the next call.
    const realRename = io.rename;
    io.rename = () => { throw new Error('simulated rename failure'); };
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' }),
      /simulated rename failure/
    );
    // Live file is untouched.
    assert.equal(io._files['WORK.feedback.yaml'], originalContent);
    // REVISION-CONTRACT §C1 M2: in-memory state must also roll back.
    // Without this assertion, a naive `items.push(item); persist();` passes
    // the file-unchanged check but leaves the store inconsistent with disk.
    assert.strictEqual(store.list().length, 0, 'in-memory list must roll back on persist failure');
    // Restore for cleanup.
    io.rename = realRename;
  });

  test('writeFile failure leaves the live file unchanged AND in-memory list unchanged', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ items: [] }) });
    const originalContent = io._files['WORK.feedback.yaml'];
    io.writeFile = () => { throw new Error('simulated writeFile failure'); };
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' }),
      /simulated writeFile failure/
    );
    assert.equal(io._files['WORK.feedback.yaml'], originalContent);
    assert.strictEqual(store.list().length, 0, 'in-memory list must roll back on persist failure');
  });
});
