import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vacuumMemory } from '../../../../src/scripts/lib/memory/admin/vacuum.js';
import { openStore, closeStore } from '../../../../src/scripts/lib/memory/store.js';
import { diskIO } from '../_helpers.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vacuum-'));
  mkdirSync(join(root, 'foundry/memory/entities'), { recursive: true });
  mkdirSync(join(root, 'foundry/memory/edges'), { recursive: true });
  mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
  writeFileSync(join(root, 'foundry/memory/config.md'), '---\nenabled: true\n---\n');
  writeFileSync(
    join(root, 'foundry/memory/schema.json'),
    JSON.stringify({ version: 1, entities: {}, edges: {}, embeddings: null }) + '\n',
  );
  return root;
}

describe('vacuumMemory', () => {
  it('successfully compacts the database', async () => {
    const root = setup();
    const io = diskIO(root);
    const schema = JSON.parse(
      await io.readFile('foundry/memory/schema.json'),
    );
    const store = await openStore({
      foundryDir: 'foundry',
      schema,
      io,
      dbAbsolutePath: join(root, 'foundry/memory/memory.db'),
    });

    try {
      const result = await vacuumMemory({ store });

      assert.deepEqual(result, { ok: true });
    } finally {
      closeStore(store);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('handles "unknown system op" error gracefully', async () => {
    const root = setup();
    const io = diskIO(root);
    const schema = JSON.parse(
      await io.readFile('foundry/memory/schema.json'),
    );
    const store = await openStore({
      foundryDir: 'foundry',
      schema,
      io,
      dbAbsolutePath: join(root, 'foundry/memory/memory.db'),
    });

    try {
      // Create a mock store that simulates a Cozo build without ::compact support
      const mockStore = {
        db: {
          run: async (query) => {
            if (query === '::compact') {
              const err = new Error('unknown system op: compact');
              throw err;
            }
            return store.db.run(query);
          },
        },
      };

      const result = await vacuumMemory({ store: mockStore });

      assert.deepEqual(result, { ok: true });
    } finally {
      closeStore(store);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('propagates non-"unknown system op" errors', async () => {
    const root = setup();
    const io = diskIO(root);
    const schema = JSON.parse(
      await io.readFile('foundry/memory/schema.json'),
    );
    const store = await openStore({
      foundryDir: 'foundry',
      schema,
      io,
      dbAbsolutePath: join(root, 'foundry/memory/memory.db'),
    });

    try {
      // Create a mock store that throws a different error
      const mockStore = {
        db: {
          run: async (query) => {
            if (query === '::compact') {
              throw new Error('Database locked');
            }
            return store.db.run(query);
          },
        },
      };

      await assert.rejects(
        () => vacuumMemory({ store: mockStore }),
        /Database locked/,
      );
    } finally {
      closeStore(store);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
