import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeMockIO } from '../helpers/mock-io.js';
import {
  initForgeCallLog,
  writeCall,
  verifyAndClearForgeCallLog,
  readForgeRetryCount,
  incrementForgeRetryCount,
  resetForgeRetryCount,
} from '../../src/scripts/lib/stage-calls.js';

const LOG = '.foundry/.forge-tool-calls.jsonl';
const RETRIES = '.foundry/.forge-tool-retries';

describe('initForgeCallLog', () => {
  it('creates an empty log file', () => {
    const io = makeMockIO();
    initForgeCallLog(io);
    assert.equal(io.exists(LOG), true);
    assert.equal(io._get(LOG), '');
  });

  it('overwrites an existing log file', () => {
    const io = makeMockIO({ [LOG]: 'stale data\n' });
    initForgeCallLog(io);
    assert.equal(io._get(LOG), '');
  });
});

describe('writeCall', () => {
  it('appends a properly formatted entry when the log file exists', () => {
    const io = makeMockIO();
    initForgeCallLog(io);
    writeCall(io, 'foundry_config_read_laws');
    const content = io._get(LOG);
    assert.ok(content.includes('"tool":"foundry_config_read_laws"'));
    assert.ok(content.includes('"ts":'));
  });

  it('is a no-op when the log file does not exist', () => {
    const io = makeMockIO();
    writeCall(io, 'foundry_config_read_laws');
    assert.equal(io.exists(LOG), false);
  });

  it('appends one line per call', () => {
    const io = makeMockIO();
    initForgeCallLog(io);
    writeCall(io, 'a');
    writeCall(io, 'b');
    const lines = io._get(LOG).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('a'));
    assert.ok(lines[1].includes('b'));
  });
});

describe('verifyAndClearForgeCallLog', () => {
  it('returns ok when all expected tools were called', () => {
    const io = makeMockIO();
    initForgeCallLog(io);
    writeCall(io, 'foundry_workfile_get');
    writeCall(io, 'foundry_config_read_laws');
    const result = verifyAndClearForgeCallLog(io, ['foundry_workfile_get', 'foundry_config_read_laws']);
    assert.deepEqual(result, { ok: true, missing: [] });
  });

  it('returns missing tools when some were not called', () => {
    const io = makeMockIO();
    initForgeCallLog(io);
    writeCall(io, 'foundry_workfile_get');
    const result = verifyAndClearForgeCallLog(io, ['foundry_workfile_get', 'foundry_config_read_laws', 'foundry_config_read_artefact_type']);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['foundry_config_read_laws', 'foundry_config_read_artefact_type']);
  });

  it('returns all tools as missing when the log file is empty', () => {
    const io = makeMockIO();
    initForgeCallLog(io);
    const result = verifyAndClearForgeCallLog(io, ['foundry_workfile_get']);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['foundry_workfile_get']);
  });

  it('returns all tools as missing when the log file does not exist', () => {
    const io = makeMockIO();
    const result = verifyAndClearForgeCallLog(io, ['foundry_workfile_get']);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['foundry_workfile_get']);
  });

  it('deletes the log file after a successful verification', () => {
    const io = makeMockIO();
    initForgeCallLog(io);
    writeCall(io, 'foundry_config_read_laws');
    verifyAndClearForgeCallLog(io, ['foundry_config_read_laws']);
    assert.equal(io.exists(LOG), false);
  });

  it('deletes the log file after a failed verification', () => {
    const io = makeMockIO();
    initForgeCallLog(io);
    writeCall(io, 'foundry_workfile_get');
    verifyAndClearForgeCallLog(io, ['foundry_workfile_get', 'foundry_config_read_laws']);
    assert.equal(io.exists(LOG), false);
  });

  it('skips malformed JSON lines', () => {
    const io = makeMockIO({ [LOG]: 'not json\n' });
    const result = verifyAndClearForgeCallLog(io, ['foundry_config_read_laws']);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['foundry_config_read_laws']);
  });
});

describe('forge retry counter', () => {
  it('readForgeRetryCount returns 0 when file does not exist', () => {
    const io = makeMockIO();
    assert.equal(readForgeRetryCount(io), 0);
  });

  it('incrementForgeRetryCount creates and increments', () => {
    const io = makeMockIO();
    assert.equal(incrementForgeRetryCount(io), 1);
    assert.equal(io._get(RETRIES), '1');
    assert.equal(incrementForgeRetryCount(io), 2);
    assert.equal(io._get(RETRIES), '2');
  });

  it('resetForgeRetryCount removes the file', () => {
    const io = makeMockIO();
    incrementForgeRetryCount(io);
    resetForgeRetryCount(io);
    assert.equal(io.exists(RETRIES), false);
  });

  it('resetForgeRetryCount is a no-op when file does not exist', () => {
    const io = makeMockIO();
    resetForgeRetryCount(io);
    assert.equal(io.exists(RETRIES), false);
  });
});
