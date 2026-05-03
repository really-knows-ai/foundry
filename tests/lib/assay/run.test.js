import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAssay } from '../../../src/scripts/lib/assay/run.js';
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

  it('threads writeEmbedder through to putEntity so extractor-written entities get embeddings', async () => {
    const root = setupProject();
    writeExtractor(root, 'emb', { command: 'x', write: ['class'] });
    const putCalls = [];
    const putEntity = async (_store, row, _vocab, opts) => { putCalls.push({ row, opts }); };
    const relate = async () => {};
    const writeEmbedder = async (inputs) => inputs.map(() => [0.1, 0.2, 0.3]);
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['emb'], store: {}, vocabulary,
      putEntity, relate, writeEmbedder,
      spawn: async () => ({
        ok: true, exitCode: 0, timedOut: false,
        stdout: '{"kind":"entity","type":"class","name":"C1","value":"v1"}\n',
        stderr: '',
      }),
    });
    assert.equal(res.ok, true);
    assert.equal(putCalls.length, 1);
    // The fix: runAssay must forward writeEmbedder to putEntity as { embedder }.
    assert.ok(putCalls[0].opts, 'putEntity must be called with an options bag');
    assert.equal(putCalls[0].opts.embedder, writeEmbedder,
      'writeEmbedder must be threaded through as opts.embedder');
    rmSync(root, { recursive: true, force: true });
  });

  it('omits opts.embedder when writeEmbedder is not provided (embeddings disabled)', async () => {
    const root = setupProject();
    writeExtractor(root, 'plain', { command: 'x', write: ['class'] });
    const putCalls = [];
    const putEntity = async (_store, row, _vocab, opts) => { putCalls.push({ row, opts }); };
    const relate = async () => {};
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['plain'], store: {}, vocabulary,
      putEntity, relate,
      spawn: async () => ({
        ok: true, exitCode: 0, timedOut: false,
        stdout: '{"kind":"entity","type":"class","name":"C1","value":"v"}\n',
        stderr: '',
      }),
    });
    assert.equal(res.ok, true);
    assert.equal(putCalls.length, 1);
    // Either no opts or opts with no embedder is fine; what matters is writes.js
    // sees no embedder and takes the non-vector branch.
    const embedder = putCalls[0].opts?.embedder;
    assert.ok(!embedder, 'no embedder should be passed when writeEmbedder is undefined');
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

  // G29: Store must be synced after each extractor, not just at the end
  it('syncs store after each extractor completes (G29)', async () => {
    const root = setupProject();
    writeExtractor(root, 'first', { command: 'f', write: ['class'] });
    writeExtractor(root, 'second', { command: 's', write: ['method'] });
    const fakes = makeFakes();
    const syncCalls = [];
    const fakeSyncStore = async () => { syncCalls.push(Date.now()); };
    
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['first', 'second'], 
      store: fakes.store, 
      vocabulary,
      putEntity: fakes.putEntity, 
      relate: fakes.relate,
      syncStore: fakeSyncStore,
      spawn: async ({ command }) => ({
        ok: true, exitCode: 0, timedOut: false,
        stdout: command === 'f' 
          ? '{"kind":"entity","type":"class","name":"C1","value":"v1"}\n'
          : '{"kind":"entity","type":"method","name":"M1","value":"v1"}\n',
        stderr: '',
      }),
    });
    
    assert.equal(res.ok, true);
    // Critical: syncStore should be called twice (once per extractor)
    assert.equal(syncCalls.length, 2, 'syncStore must be called after each extractor');
    rmSync(root, { recursive: true, force: true });
  });

  it('persists first extractor writes even when second extractor fails (G29)', async () => {
    const root = setupProject();
    writeExtractor(root, 'succeeds', { command: 'ok', write: ['class'] });
    writeExtractor(root, 'fails', { command: 'boom', write: ['method'] });
    const fakes = makeFakes();
    const syncCalls = [];
    const fakeSyncStore = async () => { syncCalls.push({ entities: [...fakes.entities] }); };
    
    const res = await runAssay({
      foundryDir: 'foundry', cwd: root, io: diskIO(root),
      extractors: ['succeeds', 'fails'],
      store: fakes.store,
      vocabulary,
      putEntity: fakes.putEntity,
      relate: fakes.relate,
      syncStore: fakeSyncStore,
      spawn: async ({ command }) => command === 'ok'
        ? { ok: true, exitCode: 0, timedOut: false, stdout: '{"kind":"entity","type":"class","name":"Persisted","value":"data"}\n', stderr: '' }
        : { ok: false, exitCode: 1, timedOut: false, stdout: '', stderr: 'error' },
    });
    
    assert.equal(res.ok, false);
    assert.equal(res.failedExtractor, 'fails');
    // Critical: syncStore was called once (after first extractor succeeded)
    assert.equal(syncCalls.length, 1, 'first extractor writes must be synced before second runs');
    assert.equal(syncCalls[0].entities.length, 1);
    assert.equal(syncCalls[0].entities[0].name, 'Persisted');
    rmSync(root, { recursive: true, force: true });
  });

  it('writes first extractor rows to NDJSON before second extractor fails (TF6)', async () => {
    const root = setupProject();
    mkdirSync(join(root, 'foundry-memory/relations'), { recursive: true });
    
    writeExtractor(root, 'first', { command: 'first-cmd', write: ['class'] });
    writeExtractor(root, 'second', { command: 'second-cmd', write: ['method'] });
    
    // Use real memory store with actual NDJSON writes
    const { openStore, closeStore, syncStore } = await import('../../../src/scripts/lib/memory/store.js');
    const { putEntity, relate } = await import('../../../src/scripts/lib/memory/writes.js');
    
    const schema = {
      version: 1,
      entities: { class: { frontmatterHash: '_' }, method: { frontmatterHash: '_' } },
      edges: {},
      embeddings: null,
    };
    const io = diskIO(root);
    const store = await openStore({
      foundryDir: 'foundry',
      schema,
      io,
      dbAbsolutePath: join(root, 'memory.db'),
    });
    
    const res = await runAssay({
      foundryDir: 'foundry',
      cwd: root,
      io,
      extractors: ['first', 'second'],
      store,
      vocabulary,
      putEntity,
      relate,
      syncStore,
      spawn: async ({ command }) => {
        if (command === 'first-cmd') {
          return {
            ok: true, exitCode: 0, timedOut: false,
            stdout: '{"kind":"entity","type":"class","name":"FirstClass","value":"persisted data"}\n',
            stderr: '',
          };
        }
        // Second extractor fails
        return { ok: false, exitCode: 1, timedOut: false, stdout: '', stderr: 'extractor failed' };
      },
    });
    
    // Verify runAssay reports failure
    assert.equal(res.ok, false);
    assert.equal(res.failedExtractor, 'second');
    
    // Critical: First extractor's rows must be persisted to NDJSON despite second extractor failure
    const { readFileSync } = await import('node:fs');
    const ndjsonPath = join(root, 'foundry-memory/relations/class.ndjson');
    const ndjsonContent = readFileSync(ndjsonPath, 'utf8');
    const lines = ndjsonContent.trim().split('\n').filter(l => l);
    
    assert.equal(lines.length, 1, 'first extractor must have written 1 entity to NDJSON');
    const row = JSON.parse(lines[0]);
    assert.equal(row.name, 'FirstClass');
    assert.equal(row.value, 'persisted data');
    
    closeStore(store);
    rmSync(root, { recursive: true, force: true });
  });
});
