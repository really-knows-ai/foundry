import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchSlug,
  appendTraceRecord,
  truncateTrace,
} from '../../scripts/lib/tracing.js';

/**
 * Build an in-memory IO mock that records calls and stores files.
 * The `useAppendFile` flag controls whether the mock exposes `appendFile`
 * (exercising the native path) or omits it (exercising the fallback path).
 */
function makeIo({ useAppendFile = true, initialFiles = {} } = {}) {
  const files = { ...initialFiles };
  const calls = [];

  const io = {
    async mkdirp(dir) {
      calls.push(['mkdirp', dir]);
    },
    async exists(path) {
      calls.push(['exists', path]);
      return Object.prototype.hasOwnProperty.call(files, path);
    },
    async readFile(path) {
      calls.push(['readFile', path]);
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[path];
    },
    async writeFile(path, data) {
      calls.push(['writeFile', path, data]);
      files[path] = data;
    },
  };

  if (useAppendFile) {
    io.appendFile = async (path, data) => {
      calls.push(['appendFile', path, data]);
      files[path] = (files[path] ?? '') + data;
    };
  }

  return { io, files, calls };
}

describe('branchSlug', () => {
  it('replaces every / with -', () => {
    assert.equal(branchSlug('dry-run/foo/bar-baz'), 'dry-run-foo-bar-baz');
  });

  it('handles single-segment input unchanged', () => {
    assert.equal(branchSlug('main'), 'main');
  });

  it('replaces multiple slashes', () => {
    assert.equal(branchSlug('a/b/c/d'), 'a-b-c-d');
  });
});

describe('appendTraceRecord', () => {
  it('mkdirps the trace dir and appends a JSONL line at the right path', async () => {
    const { io, files, calls } = makeIo();
    const record = { ts: 1, kind: 'cmd', cmd: 'git status' };

    await appendTraceRecord({
      branch: 'dry-run/foo/bar-baz',
      record,
      io,
    });

    const expectedPath = '.foundry/trace/dry-run-foo-bar-baz.jsonl';
    assert.equal(files[expectedPath], JSON.stringify(record) + '\n');

    // mkdirp must occur before the append.
    const mkdirpIdx = calls.findIndex((c) => c[0] === 'mkdirp');
    const appendIdx = calls.findIndex((c) => c[0] === 'appendFile');
    assert.ok(mkdirpIdx >= 0, 'mkdirp was called');
    assert.ok(appendIdx >= 0, 'appendFile was called');
    assert.ok(mkdirpIdx < appendIdx, 'mkdirp before appendFile');
    assert.equal(calls[mkdirpIdx][1], '.foundry/trace');
  });

  it('appends successive records as separate JSONL lines', async () => {
    const { io, files } = makeIo();
    const r1 = { n: 1 };
    const r2 = { n: 2 };

    await appendTraceRecord({ branch: 'dry-run/x/y', record: r1, io });
    await appendTraceRecord({ branch: 'dry-run/x/y', record: r2, io });

    const path = '.foundry/trace/dry-run-x-y.jsonl';
    assert.equal(files[path], JSON.stringify(r1) + '\n' + JSON.stringify(r2) + '\n');
  });

  it('falls back to readFile+writeFile when io has no appendFile', async () => {
    const { io, files, calls } = makeIo({ useAppendFile: false });
    const r1 = { n: 1 };
    const r2 = { n: 2 };

    await appendTraceRecord({ branch: 'dry-run/x/y', record: r1, io });
    await appendTraceRecord({ branch: 'dry-run/x/y', record: r2, io });

    const path = '.foundry/trace/dry-run-x-y.jsonl';
    assert.equal(files[path], JSON.stringify(r1) + '\n' + JSON.stringify(r2) + '\n');

    // Must not have used appendFile.
    assert.ok(!calls.some((c) => c[0] === 'appendFile'));
    // Must have used writeFile.
    assert.ok(calls.some((c) => c[0] === 'writeFile'));
  });
});

describe('truncateTrace', () => {
  it('empties an existing file', async () => {
    const path = '.foundry/trace/dry-run-foo-bar.jsonl';
    const { io, files } = makeIo({
      initialFiles: { [path]: '{"old":true}\n' },
    });

    await truncateTrace({ branch: 'dry-run/foo/bar', io });

    assert.equal(files[path], '');
  });

  it('is a no-op when the file does not exist', async () => {
    const { io, files, calls } = makeIo();

    await truncateTrace({ branch: 'dry-run/foo/bar', io });

    const path = '.foundry/trace/dry-run-foo-bar.jsonl';
    assert.equal(Object.prototype.hasOwnProperty.call(files, path), false);
    // Must not have called writeFile.
    assert.ok(!calls.some((c) => c[0] === 'writeFile'));
  });
});
