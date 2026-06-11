/**
 * Tests for run.js — run ID lifecycle in runRun.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeMockIO } from '../helpers/mock-io.js';

describe('runRun — run ID lifecycle', () => {
  it('calls generateRunId when WORK.md has no foundry-run field', async () => {
    const workMd = '---\ncycle: test\n---\n# Goal\nTest';
    const io = makeMockIO({ 'WORK.md': workMd });

    // Mock sort to return done immediately
    const sortFn = mock.fn(() => ({ route: 'done' }));

    const { runRun } = await import('../../src/scripts/run.js');
    await runRun({ io, sortFn });

    // WORK.md should now have foundry-run in frontmatter
    const updated = io.readFile('WORK.md');
    assert.ok(updated.includes('foundry-run:'));
  });

  it('writes foundry-run to WORK.md frontmatter', async () => {
    const workMd = '---\ncycle: test\n---\n# Goal\nTest';
    const io = makeMockIO({ 'WORK.md': workMd });

    const sortFn = mock.fn(() => ({ route: 'done' }));

    const { runRun } = await import('../../src/scripts/run.js');
    await runRun({ io, sortFn });

    const updated = io.readFile('WORK.md');
    assert.match(updated, /foundry-run: /);
  });

  it('does NOT call generateRunId when WORK.md already has foundry-run', async () => {
    const workMd = '---\ncycle: test\nfoundry-run: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n---\n# Goal\nTest';
    const io = makeMockIO({ 'WORK.md': workMd });

    const sortFn = mock.fn(() => ({ route: 'done' }));

    const { runRun } = await import('../../src/scripts/run.js');
    await runRun({ io, sortFn });

    // The existing foundry-run should be preserved unchanged
    const updated = io.readFile('WORK.md');
    assert.ok(updated.includes('foundry-run: 01ARZ3NDEKTSV4RRFFQ69G5FAV'));
  });

  it('the run ID value is the ULID returned by generateRunId', async () => {
    const workMd = '---\ncycle: test\n---\n# Goal\nTest';
    const io = makeMockIO({ 'WORK.md': workMd });

    const sortFn = mock.fn(() => ({ route: 'done' }));

    const { runRun } = await import('../../src/scripts/run.js');
    await runRun({ io, sortFn });

    const updated = io.readFile('WORK.md');
    const match = updated.match(/foundry-run: ([A-Z0-9]{26})/);
    assert.ok(match, 'Expected a 26-char ULID in foundry-run');
    assert.equal(match[1].length, 26);
    assert.match(match[1], /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
