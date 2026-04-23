import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAssay } from '../../../scripts/lib/assay/run.js';
import { diskIO } from '../memory/_helpers.js';

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'assay-run-'));
  mkdirSync(join(root, 'foundry/memory/extractors'), { recursive: true });
  return root;
}

function writeExtractor(root, name, { command, write, timeout }) {
  const fm = { command, memory: { write } };
  if (timeout) fm.timeout = timeout;
  const yamlLines = [
    '---',
    `command: ${command}`,
    'memory:',
    `  write: [${write.join(', ')}]`,
    ...(timeout ? [`timeout: ${timeout}`] : []),
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n');
  writeFileSync(join(root, `foundry/memory/extractors/${name}.md`), yamlLines);
}

const vocabulary = {
  entities: { class: {}, method: {} },
  edges: { 'defined-in': { sources: ['method'], targets: ['class'] } },
};

function makeFakes() {
  const entities = [];
  const edges = [];
  return {
    store: {},
    putEntity: async (_store, row) => { entities.push(row); },
    relate: async (_store, row) => { edges.push(row); },
    entities, edges,
  };
}

describe('runAssay', () => {
  it('runs multiple extractors in order and upserts rows', async () => {
    const root = setupProject();
    writeExtractor(root, 'a', { command: 'anything-a', write: ['class'] });
    writeExtractor(root, 'b', { command: 'anything-b', write: ['method'] });
    const fakes = makeFakes();
    const callOrder = [];
    const fakeSpawn = async ({ command }) => {
      callOrder.push(command);
      if (command === 'anything-a') {
        return { ok: true, exitCode: 0, timedOut: false, stdout:
          '{"kind":"entity","type":"class","name":"C1","value":"v1"}\n',
          stderr: '' };
      }
      return { ok: true, exitCode: 0, timedOut: false, stdout:
        '{"kind":"entity","type":"method","name":"M1","value":"v"}\n' +
        '{"kind":"edge","from":{"type":"method","name":"M1"},"edge":"defined-in","to":{"type":"class","name":"C1"}}\n',
        stderr: '' };
    };
    const res = await runAssay({
      foundryDir: 'foundry',
      cwd: root,
      io: diskIO(root),
      extractors: ['a', 'b'],
      store: fakes.store,
      vocabulary,
      putEntity: fakes.putEntity,
      relate: fakes.relate,
      spawn: fakeSpawn,
    });
    assert.equal(res.ok, true);
    assert.equal(res.perExtractor.length, 2);
    assert.deepEqual(callOrder, ['anything-a', 'anything-b']);
    assert.equal(fakes.entities.length, 2);
    assert.equal(fakes.edges.length, 1);
    rmSync(root, { recursive: true, force: true });
  });

  it('aborts on non-zero exit from an extractor, returning the failed extractor name and stderr', async () => {
    const root = setupProject();
    writeExtractor(root, 'broken', { command: 'x', write: ['class'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['broken'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async () => ({ ok: false, exitCode: 2, timedOut: false, stdout: '', stderr: 'kaboom' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.equal(res.failedExtractor, 'broken');
    assert.match(res.reason, /exit code 2/);
    assert.match(res.stderr, /kaboom/);
    rmSync(root, { recursive: true, force: true });
  });

  it('aborts on timeout', async () => {
    const root = setupProject();
    writeExtractor(root, 'slow', { command: 'x', write: ['class'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['slow'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async () => ({ ok: false, exitCode: null, timedOut: true, stdout: '', stderr: '' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.match(res.reason, /timed out/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('aborts on bad JSONL', async () => {
    const root = setupProject();
    writeExtractor(root, 'junky', { command: 'x', write: ['class'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['junky'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async () => ({ ok: true, exitCode: 0, timedOut: false, stdout: 'not json\n', stderr: '' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.match(res.reason, /invalid JSON/);
    rmSync(root, { recursive: true, force: true });
  });

  it('aborts on permission violation (entity type outside memoryWrite)', async () => {
    const root = setupProject();
    writeExtractor(root, 'sneaky', { command: 'x', write: ['class'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['sneaky'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async () => ({ ok: true, exitCode: 0, timedOut: false,
        stdout: '{"kind":"entity","type":"method","name":"M","value":"v"}\n', stderr: '' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.match(res.reason, /'method'.*not.*memory\.write/);
    // No entities should have been upserted at all.
    assert.equal(fakes.entities.length, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it('preserves prior extractors writes when a later one fails', async () => {
    const root = setupProject();
    writeExtractor(root, 'good', { command: 'g', write: ['class'] });
    writeExtractor(root, 'bad',  { command: 'b', write: ['method'] });
    const fakes = makeFakes();
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['good', 'bad'], store: fakes.store, vocabulary,
      putEntity: fakes.putEntity, relate: fakes.relate,
      spawn: async ({ command }) => command === 'g'
        ? { ok: true, exitCode: 0, timedOut: false, stdout: '{"kind":"entity","type":"class","name":"Good","value":"v"}\n', stderr: '' }
        : { ok: false, exitCode: 1, timedOut: false, stdout: '', stderr: 'boom' },
    });
    assert.equal(res.ok, false);
    assert.equal(res.failedExtractor, 'bad');
    // "good" ran and committed; the returned perExtractor includes its count.
    assert.equal(fakes.entities.length, 1);
    assert.equal(fakes.entities[0].name, 'Good');
    rmSync(root, { recursive: true, force: true });
  });
});
