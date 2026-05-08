import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadHistory, appendEntry, getIteration, parseAllHistoryEntries } from '../../src/scripts/lib/history.js';
import yaml from 'js-yaml';

function mockIO(initial = null) {
  // Accept legacy single-arg form: a string or null means one file at 'h.yaml'.
  // Accept object form: { path: content, ... }.
  let files;
  if (initial === null) {
    files = {};
  } else if (typeof initial === 'string') {
    files = { 'h.yaml': initial };
  } else {
    files = { ...initial };
  }
  return {
    exists: (p) => Object.hasOwn(files, p),
    readFile: (p) => {
      if (!Object.hasOwn(files, p)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFile: (p, content) => { files[p] = content; },
    rename: (from, to) => {
      if (!Object.hasOwn(files, from)) throw new Error(`ENOENT: ${from}`);
      files[to] = files[from];
      delete files[from];
    },
    getWritten: () => files['h.yaml'] ?? null,
    _get: (p) => files[p] ?? null,
  };
}

describe('mockIO — rename capability', () => {
  it('rename moves content and removes the source key', () => {
    const io = mockIO(null);
    io.writeFile('a.yaml', 'hello');
    io.rename('a.yaml', 'b.yaml');
    assert.equal(io.exists('a.yaml'), false);
    assert.equal(io.readFile('b.yaml'), 'hello');
  });
});

describe('loadHistory', () => {
  it('returns [] for missing file', () => {
    const io = mockIO(null);
    assert.deepEqual(loadHistory('h.yaml', 'c1', io), []);
  });

  it('filters by cycle', () => {
    const data = yaml.dump([
      { cycle: 'c1', stage: 'forge', timestamp: '2025-01-01T00:00:00Z' },
      { cycle: 'c2', stage: 'forge', timestamp: '2025-01-01T00:00:00Z' },
    ]);
    assert.equal(loadHistory('h.yaml', 'c1', mockIO(data)).length, 1);
  });

  it('sorts by timestamp ascending', () => {
    const data = yaml.dump([
      { cycle: 'c1', stage: 'b', timestamp: '2025-01-02T00:00:00Z' },
      { cycle: 'c1', stage: 'a', timestamp: '2025-01-01T00:00:00Z' },
    ]);
    const result = loadHistory('h.yaml', 'c1', mockIO(data));
    assert.equal(result[0].stage, 'a');
    assert.equal(result[1].stage, 'b');
  });

  it('handles empty file', () => {
    assert.deepEqual(loadHistory('h.yaml', 'c1', mockIO('')), []);
  });
});

describe('appendEntry', () => {
  it('creates new file with entry', () => {
    const io = mockIO(null);
    // Override exists to return false but writeFile works
    appendEntry('h.yaml', { cycle: 'c1', stage: 'forge', iteration: 1, comment: 'test' }, io);
    const written = yaml.load(io.getWritten());
    assert.equal(written.length, 1);
    assert.equal(written[0].cycle, 'c1');
    assert.ok(written[0].timestamp);
  });

  it('appends to existing file', () => {
    const existing = yaml.dump([{ cycle: 'c1', stage: 'forge', iteration: 1, comment: 'first', timestamp: '2025-01-01T00:00:00Z' }]);
    const io = mockIO(existing);
    appendEntry('h.yaml', { cycle: 'c1', stage: 'quench', iteration: 1, comment: 'second' }, io);
    const written = yaml.load(io.getWritten());
    assert.equal(written.length, 2);
  });

  it('throws if iteration missing', () => {
    const io = mockIO(null);
    assert.throws(() => appendEntry('h.yaml', { cycle: 'c1', stage: 'forge', comment: 'x' }, io), /iteration is required/);
  });

  it('throws if comment missing', () => {
    const io = mockIO(null);
    assert.throws(() => appendEntry('h.yaml', { cycle: 'c1', stage: 'forge', iteration: 1 }, io), /comment is required/);
  });
});

describe('getIteration', () => {
  it('counts forge entries', () => {
    const data = yaml.dump([
      { cycle: 'c1', stage: 'forge:write', timestamp: '2025-01-01T00:00:00Z' },
      { cycle: 'c1', stage: 'quench', timestamp: '2025-01-02T00:00:00Z' },
      { cycle: 'c1', stage: 'forge:revise', timestamp: '2025-01-03T00:00:00Z' },
    ]);
    assert.equal(getIteration('h.yaml', 'c1', mockIO(data)), 2);
  });

  it('returns 0 for no history', () => {
    assert.equal(getIteration('h.yaml', 'c1', mockIO(null)), 0);
  });
});

describe('appendEntry with route', () => {
  it('persists route field when provided', () => {
    const io = mockIO(null);
    appendEntry('h.yaml', { cycle: 'c1', stage: 'sort', iteration: 1, comment: 'routed', route: 'forge:x' }, io);
    const written = yaml.load(io.getWritten());
    assert.equal(written[0].route, 'forge:x');
  });

  it('omits route field when not provided', () => {
    const io = mockIO(null);
    appendEntry('h.yaml', { cycle: 'c1', stage: 'forge', iteration: 1, comment: 'x' }, io);
    const written = yaml.load(io.getWritten());
    assert.equal(written[0].route, undefined);
  });
});

describe('appendEntry — route/stage invariant', () => {
  it('throws when route is supplied on a non-sort stage', () => {
    const io = mockIO(null);
    assert.throws(
      () => appendEntry('h.yaml', {
        cycle: 'c1',
        stage: 'forge:write',
        iteration: 1,
        comment: 'x',
        route: 'quench:a',
      }, io),
      /route.*sort/i,
    );
  });

  it('accepts route when stage is sort', () => {
    const io = mockIO(null);
    assert.doesNotThrow(() =>
      appendEntry('h.yaml', {
        cycle: 'c1',
        stage: 'sort',
        iteration: 1,
        comment: 'sort → forge:x',
        route: 'forge:x',
      }, io),
    );
  });

  it('accepts entries without route on non-sort stages', () => {
    const io = mockIO(null);
    assert.doesNotThrow(() =>
      appendEntry('h.yaml', {
        cycle: 'c1',
        stage: 'forge:write',
        iteration: 1,
        comment: 'done',
      }, io),
    );
  });
});

describe('appendEntry — seq field', () => {
  it('first entry has seq 0', () => {
    const io = mockIO(null);
    appendEntry('h.yaml', { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x' }, io);
    const data = yaml.load(io.getWritten());
    assert.equal(data[0].seq, 0);
  });

  it('appended entry increments seq', () => {
    const existing = yaml.dump([
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'a', timestamp: '2025-01-01T00:00:00Z', seq: 0 },
    ]);
    const io = mockIO(existing);
    appendEntry('h.yaml', { cycle: 'c1', stage: 'quench:q', iteration: 1, comment: 'b' }, io);
    const data = yaml.load(io.getWritten());
    assert.equal(data[0].seq, 0);
    assert.equal(data[1].seq, 1);
  });
});

describe('loadHistory — (timestamp, seq) sort', () => {
  it('entries with same timestamp sort by seq ascending', () => {
    const sameTs = '2026-04-24T10:00:00.000Z';
    const data = yaml.dump([
      { cycle: 'c1', stage: 'b', iteration: 1, comment: 'b', timestamp: sameTs, seq: 2 },
      { cycle: 'c1', stage: 'a', iteration: 1, comment: 'a', timestamp: sameTs, seq: 1 },
    ]);
    const r = loadHistory('h.yaml', 'c1', mockIO(data));
    assert.equal(r[0].stage, 'a');
    assert.equal(r[1].stage, 'b');
  });

  it('entries missing seq are treated as seq 0 (backward compatible)', () => {
    const sameTs = '2026-04-24T10:00:00.000Z';
    const data = yaml.dump([
      { cycle: 'c1', stage: 'first', iteration: 1, comment: 'a', timestamp: sameTs },
      { cycle: 'c1', stage: 'second', iteration: 1, comment: 'b', timestamp: sameTs, seq: 5 },
    ]);
    const r = loadHistory('h.yaml', 'c1', mockIO(data));
    assert.equal(r[0].stage, 'first');
    assert.equal(r[1].stage, 'second');
  });
});

describe('appendEntry — atomic write', () => {
  it('routes through io.rename rather than writing the live path directly', () => {
    const io = mockIO(null);
    // Spy on rename.
    let renameCalled = false;
    const underlyingRename = io.rename;
    io.rename = (from, to) => { renameCalled = true; return underlyingRename(from, to); };
    // Spy on writeFile targets.
    const writtenPaths = [];
    const underlyingWrite = io.writeFile;
    io.writeFile = (p, body) => { writtenPaths.push(p); return underlyingWrite(p, body); };

    appendEntry('h.yaml', { cycle: 'c1', stage: 'quench:q', iteration: 1, comment: 'x' }, io);

    assert.equal(renameCalled, true, 'appendEntry must call io.rename');
    assert.ok(
      writtenPaths.some(p => p.endsWith('.tmp')),
      `expected a .tmp write; got ${JSON.stringify(writtenPaths)}`,
    );
    assert.ok(
      !writtenPaths.includes('h.yaml'),
      'appendEntry must not writeFile the live path directly',
    );
  });

  it('rename failure leaves the live history file unchanged', () => {
    const initial = yaml.dump([
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'pre-existing', timestamp: '2026-04-24T09:00:00.000Z', seq: 0 },
    ]);
    const io = mockIO(initial);
    const before = io._get('h.yaml');
    io.rename = () => { throw new Error('simulated rename failure'); };
    assert.throws(
      () => appendEntry('h.yaml', { cycle: 'c1', stage: 'quench:q', iteration: 1, comment: 'x' }, io),
      /simulated rename failure/,
    );
    assert.equal(io._get('h.yaml'), before, 'live file must be unchanged');
  });
});

describe('appendEntry — open_feedback parameter', () => {
  it('stamps the provided open_feedback value onto the entry', () => {
    const io = mockIO(null);
    appendEntry(
      'h.yaml',
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x', openFeedback: 7 },
      io,
    );
    const data = yaml.load(io.getWritten());
    assert.equal(data[0].open_feedback, 7);
  });
});

describe('appendEntry — open_feedback coercion', () => {
  it('undefined openFeedback coerces to 0 (field always present)', () => {
    const io = mockIO(null);
    appendEntry(
      'h.yaml',
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x' },
      io,
    );
    const data = yaml.load(io.getWritten());
    assert.ok('open_feedback' in data[0], 'open_feedback field must be present');
    assert.strictEqual(data[0].open_feedback, 0);
  });

  it('explicit zero is preserved', () => {
    const io = mockIO(null);
    appendEntry(
      'h.yaml',
      { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x', openFeedback: 0 },
      io,
    );
    const data = yaml.load(io.getWritten());
    assert.strictEqual(data[0].open_feedback, 0);
  });
});

describe('loadHistory — malformed yaml', () => {
  it('parse failure throws and marks the flow failed', () => {
    const io = mockIO(':::not-yaml:::');
    io.writeFile('WORK.md', '---\nflow: f\ncycle: c1\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n');
    assert.throws(
      () => loadHistory('h.yaml', 'c1', io),
      /history\.yaml malformed/i,
    );
    assert.match(io.readFile('WORK.md'), /status:\s*failed/);
  });

  it('non-array root is treated as malformed', () => {
    const io = mockIO(yaml.dump({ not: 'an array' }));
    io.writeFile('WORK.md', '---\nflow: f\ncycle: c1\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n');
    assert.throws(
      () => loadHistory('h.yaml', 'c1', io),
      /history\.yaml malformed/i,
    );
  });
});

describe('appendEntry — malformed existing yaml', () => {
  it('parse failure throws and marks the flow failed', () => {
    const io = mockIO(':::not-yaml:::');
    io.writeFile('WORK.md', '---\nflow: f\ncycle: c1\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n');
    assert.throws(
      () => appendEntry('h.yaml', { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x' }, io),
      /history\.yaml malformed/i,
    );
    assert.match(io.readFile('WORK.md'), /status:\s*failed/);
  });

  it('non-array root is treated as malformed', () => {
    const io = mockIO(yaml.dump({ not: 'an array' }));
    io.writeFile('WORK.md', '---\nflow: f\ncycle: c1\n---\n\n# Goal\n\ngo\n\n| File | Type | Cycle | Status |\n|------|------|-------|--------|\n');
    assert.throws(
      () => appendEntry('h.yaml', { cycle: 'c1', stage: 'forge:w', iteration: 1, comment: 'x' }, io),
      /history\.yaml malformed/i,
    );
  });
});

describe('parseAllHistoryEntries', () => {
  it('returns [] for empty string', () => {
    const result = parseAllHistoryEntries('');
    assert.deepEqual(result, []);
  });

  it('returns array with one entry for valid YAML array', () => {
    const yamlText = yaml.dump([
      { cycle: 'c1', stage: 'forge', iteration: 1, comment: 'test', timestamp: '2025-01-01T00:00:00Z', seq: 0 },
    ]);
    const result = parseAllHistoryEntries(yamlText);
    assert.equal(result.length, 1);
    assert.equal(result[0].stage, 'forge');
  });

  it('throws on malformed YAML', () => {
    assert.throws(
      () => parseAllHistoryEntries('not: valid: yaml: ['),
      /WORK\.history\.yaml malformed/,
    );
  });

  it('throws on non-array root', () => {
    const yamlText = yaml.dump({ foo: 'bar' });
    assert.throws(
      () => parseAllHistoryEntries(yamlText),
      /WORK\.history\.yaml malformed/,
    );
  });
});
