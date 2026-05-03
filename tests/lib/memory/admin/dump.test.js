import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dumpMemory } from '../../../../src/scripts/lib/memory/admin/dump.js';

describe('dumpMemory (unit, with mock store)', () => {
  it('dumps single entity', async () => {
    // Mock cozo db: distinguish getEntity (?[v]) from listEntities (?[n, v]).
    const store = { db: { run: async (q) => {
      if (/ent_class/.test(q) && /\?\[v\]/.test(q)) return { rows: [['va']], headers: ['value'] };
      if (/ent_class/.test(q)) return { rows: [['com.A', 'va']], headers: ['name', 'value'] };
      return { rows: [] };
    }}};
    const out = await dumpMemory({ store, vocabulary: { entities: { class: {} }, edges: {} }, type: 'class', name: 'com.A' });
    assert.match(out, /com\.A/);
    assert.match(out, /va/);
  });

  it('summary includes edge counts', async () => {
    // Mock store that returns counts for entities and edges
    const store = { db: { run: async (q) => {
      // Entity queries
      if (/ent_class/.test(q)) return { rows: [['com.A', 'va'], ['com.B', 'vb']], headers: ['name', 'value'] };
      if (/ent_method/.test(q)) return { rows: [['foo', 'vfoo']], headers: ['name', 'value'] };
      // Edge queries
      if (/edge_calls/.test(q)) return { rows: [['m.a', 'm.b'], ['m.c', 'm.d']], headers: ['from', 'to'] };
      if (/edge_extends/.test(q)) return { rows: [['c.a', 'c.b']], headers: ['from', 'to'] };
      return { rows: [] };
    }}};
    const vocabulary = {
      entities: { class: {}, method: {} },
      edges: { calls: {}, extends: {} }
    };
    const out = await dumpMemory({ store, vocabulary });
    // Should show entity counts
    assert.match(out, /entity class: 2 rows/);
    assert.match(out, /entity method: 1 rows/);
    // Should show edge counts
    assert.match(out, /edge calls: 2 rows/);
    assert.match(out, /edge extends: 1 rows/);
  });
});
