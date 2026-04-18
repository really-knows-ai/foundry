import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadHistory, appendEntry, getIteration } from '../../scripts/lib/history.js';
import yaml from 'js-yaml';

function mockIO(fileContent = null) {
  let written = null;
  return {
    exists: () => fileContent !== null,
    readFile: () => fileContent,
    writeFile: (path, content) => { written = content; },
    getWritten: () => written,
  };
}

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
