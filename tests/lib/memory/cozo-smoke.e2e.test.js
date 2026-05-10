import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { CozoDb } = require('cozo-node');

describe('cozo-node smoke test', () => {
  it('opens a sqlite-backed db and runs trivial query', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cozo-smoke-'));
    const db = new CozoDb('sqlite', join(dir, 'test.db'));
    try {
      const res = await db.run('?[x] := x = 1');
      assert.equal(res.rows[0][0], 1);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
