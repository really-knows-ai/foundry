import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dumpMemory } from '../../../../scripts/lib/memory/admin/dump.js';

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
});
