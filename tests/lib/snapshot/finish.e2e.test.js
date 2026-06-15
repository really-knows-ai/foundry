import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { finishDryRun } from '../../../src/scripts/lib/snapshot/finish.js';
import { realFsIo } from '../helpers/real-fs-io.js';

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-dryrun-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# initial\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  git('checkout', '-q', '-b', 'config/foo');
  git('checkout', '-q', '-b', 'dry-run/foo/flow-x-y');
  return { dir, git };
}

function execFn(dir) {
  return async (argv) => execFileSync('git', argv, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test('happy path: snapshot written, branch deleted, on parent', async () => {
  const { dir, git } = setupRepo();
  // commit a WORK.md on dry-run branch
  writeFileSync(join(dir, 'WORK.md'), '---\nflow: f\ngoal: "g"\nstatus: done\n---\nbody\n');
  git('add', '.');
  git('commit', '-qm', 'work');
  // seed empty trace file (untracked - add .gitignore so tree stays clean)
  writeFileSync(join(dir, '.gitignore'), '.foundry/\n.snapshots/\n');
  git('add', '.gitignore');
  git('commit', '-qm', 'ignore');
  mkdirSync(join(dir, '.foundry/trace'), { recursive: true });
  writeFileSync(join(dir, '.foundry/trace/dry-run-foo-flow-x-y.jsonl'), '');

  const r = await finishDryRun({
    message: 'test',
    branch: 'dry-run/foo/flow-x-y',
    io: realFsIo(dir),
    execFile: execFn(dir),
  });

  assert.equal(r.ok, true);
  assert.equal(r.branch, 'config/foo');
  assert.match(r.snapshotPath, /^\.snapshots\/dry-run-foo-flow-x-y-[0-9A-HJKMNP-TV-Z]{26}$/);
  const ulidPart = r.runId.slice('dry-run-foo-flow-x-y-'.length);
  assert.match(ulidPart, ULID_RE);

  const snap = join(dir, r.snapshotPath);
  assert.ok(existsSync(join(snap, 'README.md')));
  assert.ok(existsSync(join(snap, 'work/WORK.md')));
  assert.ok(existsSync(join(snap, 'diff.patch')));
  assert.ok(existsSync(join(snap, 'trace.jsonl')));

  const branches = execFileSync('git', ['branch', '--list'], { cwd: dir, encoding: 'utf8' });
  assert.ok(!branches.includes('dry-run/foo/flow-x-y'), `branch still present: ${branches}`);

  const head = execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(head, 'config/foo');
});

test('dirty tree refused, branch preserved', async () => {
  const { dir, git } = setupRepo();
  writeFileSync(join(dir, 'WORK.md'), 'orig');
  git('add', '.');
  git('commit', '-qm', 'work');
  // make tracked file dirty
  writeFileSync(join(dir, 'WORK.md'), 'modified');

  const r = await finishDryRun({
    message: 'x',
    branch: 'dry-run/foo/flow-x-y',
    io: realFsIo(dir),
    execFile: execFn(dir),
  });

  assert.equal(r.ok, false);
  assert.match(r.error, /dirty/i);
  assert.ok(Array.isArray(r.dirty) && r.dirty.length > 0);

  const branches = execFileSync('git', ['branch', '--list'], { cwd: dir, encoding: 'utf8' });
  assert.ok(branches.includes('dry-run/foo/flow-x-y'));
});

test('invalid branch name rejected', async () => {
  const { dir, git } = setupRepo();
  // checkout main so tree clean and main is the branch
  git('checkout', '-q', 'main');

  const r = await finishDryRun({
    message: 'x',
    branch: 'main',
    io: realFsIo(dir),
    execFile: execFn(dir),
  });

  assert.equal(r.ok, false);
  assert.match(r.error, /cannot derive parent/);
});

test('all WORK files captured verbatim', async () => {
  const { dir, git } = setupRepo();
  const md = '---\nflow: f\ngoal: "g"\nstatus: done\n---\nMD body\n';
  const hist = 'history: yes\n';
  const fb = 'feedback: maybe\n';
  writeFileSync(join(dir, 'WORK.md'), md);
  writeFileSync(join(dir, 'WORK.history.yaml'), hist);
  writeFileSync(join(dir, 'WORK.feedback.yaml'), fb);
  git('add', '.');
  git('commit', '-qm', 'work');

  const r = await finishDryRun({
    message: 'cap',
    branch: 'dry-run/foo/flow-x-y',
    io: realFsIo(dir),
    execFile: execFn(dir),
  });
  assert.equal(r.ok, true);
  const snap = join(dir, r.snapshotPath);
  assert.equal(readFileSync(join(snap, 'work/WORK.md'), 'utf8'), md);
  assert.equal(readFileSync(join(snap, 'work/WORK.history.yaml'), 'utf8'), hist);
  assert.equal(readFileSync(join(snap, 'work/WORK.feedback.yaml'), 'utf8'), fb);
});

test('trace content copied and original truncated', async () => {
  const { dir, git } = setupRepo();
  writeFileSync(join(dir, 'WORK.md'), '---\nflow: f\ngoal: "g"\nstatus: done\n---\nbody\n');
  writeFileSync(join(dir, '.gitignore'), '.foundry/\n.snapshots/\n');
  git('add', '.');
  git('commit', '-qm', 'work');
  // seed trace as untracked (gitignored)
  mkdirSync(join(dir, '.foundry/trace'), { recursive: true });
  const traceFile = join(dir, '.foundry/trace/dry-run-foo-flow-x-y.jsonl');
  const seed = '{"a":1}\n{"b":2}\n';
  writeFileSync(traceFile, seed);

  const r = await finishDryRun({
    message: 'trace test',
    branch: 'dry-run/foo/flow-x-y',
    io: realFsIo(dir),
    execFile: execFn(dir),
  });
  assert.equal(r.ok, true);
  const snap = join(dir, r.snapshotPath);
  assert.equal(readFileSync(join(snap, 'trace.jsonl'), 'utf8'), seed);
  assert.equal(readFileSync(traceFile, 'utf8'), '');
});

test('dispatch logs copied into snapshot', async () => {
  const { dir, git } = setupRepo();
  writeFileSync(join(dir, 'WORK.md'), '---\nflow: f\ngoal: "g"\nstatus: done\n---\nbody\n');
  writeFileSync(join(dir, '.gitignore'), '.foundry/\n.snapshots/\n');
  git('add', '.');
  git('commit', '-qm', 'work');
  mkdirSync(join(dir, '.foundry/dispatch-logs'), { recursive: true });
  const log = '{"status":"timeout","stderr":"permission prompt"}\n';
  writeFileSync(join(dir, '.foundry/dispatch-logs/child.json'), log);

  const r = await finishDryRun({
    message: 'dispatch log test',
    branch: 'dry-run/foo/flow-x-y',
    io: realFsIo(dir),
    execFile: execFn(dir),
  });

  assert.equal(r.ok, true);
  const snap = join(dir, r.snapshotPath);
  assert.equal(readFileSync(join(snap, 'dispatch-logs/child.json'), 'utf8'), log);
});

test('write failure leaves worktree on dry-run branch', async () => {
  const { dir, git } = setupRepo();
  writeFileSync(join(dir, 'WORK.md'), '---\nflow: f\ngoal: "g"\nstatus: done\n---\nbody\n');
  git('add', '.');
  git('commit', '-qm', 'work');

  // Create a failing IO adapter that fails during writeFile of README.md
  const failingIo = {
    ...realFsIo(dir),
    writeFile: async (path, content) => {
      if (path.includes('README.md')) {
        throw new Error('simulated write failure');
      }
      return realFsIo(dir).writeFile(path, content);
    },
  };

  const r = await finishDryRun({
    message: 'test',
    branch: 'dry-run/foo/flow-x-y',
    io: failingIo,
    execFile: execFn(dir),
  });

  // Should fail
  assert.equal(r.ok, false);
  assert.match(r.error, /snapshot write failed/);

  // CRITICAL: worktree should still be on dry-run branch, not parent
  const head = git('branch', '--show-current');
  assert.equal(head, 'dry-run/foo/flow-x-y', 'worktree should remain on dry-run branch after write failure');

  // dry-run branch should still exist for manual cleanup
  const branches = git('branch', '--list');
  assert.ok(branches.includes('dry-run/foo/flow-x-y'), 'dry-run branch should exist for cleanup');
});
