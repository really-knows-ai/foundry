import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderReadme } from '../../../scripts/lib/snapshot/render.js';

test('happy path: full frontmatter + non-empty trace', () => {
  const out = renderReadme({
    branch: 'dry-run/foo/flow-x-goal',
    parent: 'config/foo',
    message: 'tested the new law',
    workfile: '---\nflow: flow-x\ngoal: write a thing\nstatus: done\n---\n',
    traceText: '{"ts":"2026-04-29T10:00:00.000Z"}\n{"ts":"2026-04-29T10:01:23.000Z"}\n',
  });

  assert.match(out, /^---\n/);
  assert.match(out, /\nbranch: dry-run\/foo\/flow-x-goal\n/);
  assert.match(out, /\nparent: config\/foo\n/);
  assert.match(out, /\nflow: flow-x\n/);
  assert.match(out, /\ngoal: "write a thing"\n/);
  assert.match(out, /\nstartedAt: 2026-04-29T10:00:00\.000Z\n/);
  assert.match(out, /\nfinishedAt: 2026-04-29T10:01:23\.000Z\n/);
  assert.match(out, /\nexitReason: done\n/);
  assert.match(out, /\n---\n\n# Dry-run snapshot\n\ntested the new law\n$/);
});

test('empty traceText: timestamps are null', () => {
  const out = renderReadme({
    branch: 'b',
    parent: 'p',
    message: 'm',
    workfile: '---\nflow: f\ngoal: g\nstatus: done\n---\n',
    traceText: '',
  });
  assert.match(out, /\nstartedAt: null\n/);
  assert.match(out, /\nfinishedAt: null\n/);
});

test('missing workfile: flow/goal null, exitReason unknown', () => {
  const out = renderReadme({
    branch: 'b',
    parent: 'p',
    message: 'm',
    workfile: '',
    traceText: '',
  });
  assert.match(out, /\nflow: null\n/);
  assert.match(out, /\ngoal: null\n/);
  assert.match(out, /\nexitReason: unknown\n/);
});

test('malformed first/last trace line: timestamps null, no crash', () => {
  const out = renderReadme({
    branch: 'b',
    parent: 'p',
    message: 'm',
    workfile: '---\nflow: f\ngoal: g\nstatus: done\n---\n',
    traceText: 'not json\n',
  });
  assert.match(out, /\nstartedAt: null\n/);
  assert.match(out, /\nfinishedAt: null\n/);
});

test('goal with colon is JSON-stringified', () => {
  const out = renderReadme({
    branch: 'b',
    parent: 'p',
    message: 'm',
    workfile: '---\nflow: f\ngoal: "use X: do Y"\nstatus: done\n---\n',
    traceText: '',
  });
  assert.match(out, /\ngoal: "use X: do Y"\n/);
});

test('single-line trace: startedAt and finishedAt equal', () => {
  const out = renderReadme({
    branch: 'b',
    parent: 'p',
    message: 'm',
    workfile: '---\nflow: f\ngoal: g\nstatus: done\n---\n',
    traceText: '{"ts":"2026-04-29T12:00:00.000Z"}\n',
  });
  assert.match(out, /\nstartedAt: 2026-04-29T12:00:00\.000Z\n/);
  assert.match(out, /\nfinishedAt: 2026-04-29T12:00:00\.000Z\n/);
});

test('exact example output matches spec', () => {
  const out = renderReadme({
    branch: 'dry-run/foo/flow-x-goal',
    parent: 'config/foo',
    message: 'tested the new law',
    workfile: '---\nflow: flow-x\ngoal: write a thing\nstatus: done\n---\n',
    traceText: '{"ts":"2026-04-29T10:00:00.000Z"}\n{"ts":"2026-04-29T10:01:23.000Z"}\n',
  });
  const expected = `---
branch: dry-run/foo/flow-x-goal
parent: config/foo
flow: flow-x
goal: "write a thing"
startedAt: 2026-04-29T10:00:00.000Z
finishedAt: 2026-04-29T10:01:23.000Z
exitReason: done
---

# Dry-run snapshot

tested the new law
`;
  assert.equal(out, expected);
});
