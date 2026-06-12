import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function makeCtx(worktree) { return { worktree }; }

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-git-'));
  execSync('git init -q', { cwd: dir, env: GIT_ENV });
  execSync('git config commit.gpgsign false', { cwd: dir, env: GIT_ENV });
  
  // Configure dummy GPG for testing: wrapper that handles both signing and verification
  const gpgWrapper = join(tmpdir(), `gpg-test-${process.pid}-${Date.now()}`);
  writeFileSync(gpgWrapper, 
    '#!/bin/sh\n' +
    '# Handle both signing and verification modes\n' +
    'if echo "$*" | grep -q -- "--verify"; then\n' +
    '  # Verification mode: consume input and report success on status-fd\n' +
    '  cat >/dev/null\n' +
    '  # Extract status-fd from arguments (default is stderr=2)\n' +
    '  STATUS_FD=2\n' +
    '  for arg in "$@"; do\n' +
    '    case "$arg" in\n' +
    '      --status-fd=*) STATUS_FD="${arg#--status-fd=}" ;;\n' +
    '    esac\n' +
    '  done\n' +
    '  # Write status messages to the specified fd\n' +
    '  echo "[GNUPG:] NEWSIG" >&"$STATUS_FD"\n' +
    '  echo "[GNUPG:] GOODSIG 0000000000000000 Test Key" >&"$STATUS_FD"\n' +
    '  echo "[GNUPG:] VALIDSIG 0000000000000000 2024-01-01 0000000000000000" >&"$STATUS_FD"\n' +
    '  echo "[GNUPG:] TRUST_ULTIMATE" >&"$STATUS_FD"\n' +
    '  echo "gpg: Good signature from \\"Test Key\\"" >&2\n' +
    '  exit 0\n' +
    'else\n' +
    '  # Signing mode: consume input and produce signature\n' +
    '  cat >/dev/null\n' +
    '  echo "[GNUPG:] SIG_CREATED " >&2\n' +
    '  cat <<\'SIGNATURE\'\n' +
    '-----BEGIN PGP SIGNATURE-----\n' +
    '\n' +
    'iQIzBAABCAAdFiEE5MksKLdEzNNGEp9iqJqFb6xMfuQFAmbG6tEACgkQqJqFb6xM\n' +
    'fuROjg//test\n' +
    '-----END PGP SIGNATURE-----\n' +
    'SIGNATURE\n' +
    '  exit 0\n' +
    'fi\n',
    { mode: 0o755 }
  );
  execSync(`git config gpg.program "${gpgWrapper}"`, { cwd: dir, env: GIT_ENV });
  
  execSync('git checkout -B main -q', { cwd: dir, env: GIT_ENV });
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  // Add .gitignore with .foundry/ to prevent plugin from modifying it
  writeFileSync(join(dir, '.gitignore'), '.foundry/\n');
  execSync('git add . && git commit -m init -q', { cwd: dir, env: GIT_ENV });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function enableSshSigning(dir) {
  const keyPath = join(dir, 'signing_key');
  const keyPubPath = join(dir, 'signing_key.pub');
  const allowedSignersPath = join(dir, 'allowed_signers');
  
  execSync('ssh-keygen -t ed25519 -N "" -f signing_key -q', { cwd: dir, env: GIT_ENV });
  // Ensure correct permissions (SSH requires 0600 for private keys)
  execSync(`chmod 600 "${keyPath}"`, { cwd: dir, env: GIT_ENV });
  
  const pubKey = readFileSync(keyPubPath, 'utf8');
  writeFileSync(allowedSignersPath, `t@t ${pubKey}`);
  
  // Ignore SSH keys and allowed_signers file to prevent them from being committed
  const gitignorePath = join(dir, '.gitignore');
  const gitignoreContent = readFileSync(gitignorePath, 'utf8');
  writeFileSync(gitignorePath, gitignoreContent + 'signing_key\nsigning_key.pub\nallowed_signers\n');
  
  execSync('git config gpg.format ssh', { cwd: dir, env: GIT_ENV });
  execSync(`git config user.signingkey "${keyPath}"`, { cwd: dir, env: GIT_ENV });
  execSync(`git config gpg.ssh.allowedSignersFile "${allowedSignersPath}"`, { cwd: dir, env: GIT_ENV });
  execSync('git config commit.gpgsign true', { cwd: dir, env: GIT_ENV });
}

// Creates a sealed commit with attestation metadata in the commit body.
// Call this on the work branch just before calling foundry_git_finish.
function createSealedCommit(dir, cycle = 'test') {
  const message = `[${cycle}] appraise:${cycle}: completed\n\nfoundry-run: 01TESTRUNID\nattestation-seal: abc123def4567890\ncomposite-status: pass\nstage-count: 4`;
  execSync(`git commit --allow-empty -m "${message.replace(/"/g, '\\"')}" --no-gpg-sign`, { cwd: dir, env: GIT_ENV });
}

test('foundry_git_finish on work branch preserves WORK files and merges feature', async () => {
  const dir = initRepo();
  const envSnapshot = {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
  };
  try {
    Object.assign(process.env, {
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    });
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    // Add feature content so squash-merge has something to commit
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\ntest\n');
    writeFileSync(join(dir, 'WORK.history.yaml'), '[]\n');
    writeFileSync(join(dir, 'WORK.feedback.yaml'), 'items: []\n');
    execSync('git add . && git commit -m workfiles -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-flow');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    // WORK files are now preserved in the squash merge (not deleted by git-finish)
    assert.equal(existsSync(join(dir, 'WORK.md')), true, 'WORK.md should be preserved');
    assert.equal(existsSync(join(dir, 'WORK.history.yaml')), true, 'WORK.history.yaml should be preserved');
    assert.equal(existsSync(join(dir, 'WORK.feedback.yaml')), true, 'WORK.feedback.yaml should be preserved');
    assert.equal(existsSync(join(dir, 'feature.txt')), true, 'Feature file should be merged');
  } finally {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    cleanup(dir);
  }
});

test('foundry_git_finish without confirm returns planned side effects without acting', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n');
    writeFileSync(join(dir, 'WORK.history.yaml'), '[]\n');
    execSync('git add . && git commit -m workfiles -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow' }, makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(res.planned, 'expected planned object');
    assert.equal(res.planned.workBranch, 'work/f-flow');
    assert.equal(res.planned.baseBranch, 'main');
    assert.match(res.planned.action, /verify-attest.*squash-merge.*signed-commit/);
    // Side effects should NOT have happened.
    assert.equal(existsSync(join(dir, 'WORK.md')), true);
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'work/f-flow');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish with confirm:false also returns planned without acting', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n');
    execSync('git add . && git commit -m workfiles -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: false }, makeCtx(dir),
    ));

    assert.equal(res.ok, false);
    assert.ok(res.planned);
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'work/f-flow');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish refuses dirty worktree even with confirm:true', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n');
    execSync('git add . && git commit -m workfiles -q', { cwd: dir, env: GIT_ENV });
    // Modify a tracked file without committing.
    writeFileSync(join(dir, 'README.md'), 'modified baseline\n');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    assert.ok(res.error, 'expected error for dirty worktree');
    assert.match(res.error, /dirty|uncommitted/i);
    // Branch should still be the work branch.
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'work/f-flow');
    // README modification should be preserved (not reverted).
    assert.match(execSync('cat README.md', { cwd: dir }).toString(), /modified/);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on base branch is a graceful no-op', async () => {
  const dir = initRepo();
  try {
    // Already on main from initRepo.
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    // Should not error; just indicate nothing to do.
    assert.equal(res.ok, true, `expected ok, got ${JSON.stringify(res)}`);
    assert.equal(res.noop, true);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish aborts on merge conflict and preserves work branch', async () => {
  const dir = initRepo();
  try {
    // Create conflicting change on main.
    writeFileSync(join(dir, 'conflict.txt'), 'main version\n');
    execSync('git add . && git commit -m main-change -q', { cwd: dir, env: GIT_ENV });
    // Branch off an earlier commit and add conflicting content.
    execSync('git checkout -b work/f-flow HEAD~1 -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'conflict.txt'), 'work version\n');
    execSync('git add . && git commit -m work-change -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    assert.ok(res.error, 'expected error for merge conflict');
    // Work branch must still exist (not force-deleted).
    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(branches.includes('work/f-flow'), `expected work branch to remain, got: ${branches}`);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish successful path returns ok with hash and base branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-flow');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish flow', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    assert.ok(res.hash);
    assert.equal(res.branch, 'main');
    // Work branch should be deleted (but archive branch should exist).
    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(!branches.match(/^\s*\*?\s*work\/f-flow\s*$/m), `expected work branch deleted, got: ${branches}`);
    assert.ok(branches.match(/^\s*archive\/work\/f-flow-[a-f0-9]+\s*$/m), `expected archive branch to exist, got: ${branches}`);
    // Feature should be merged and WORK files should be preserved
    assert.equal(existsSync(join(dir, 'feature.txt')), true);
    assert.equal(existsSync(join(dir, 'WORK.md')), true, 'WORK.md should be preserved in squash merge');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on config branch does not delete work files', async () => {
  const dir = initRepo();
  try {
    // Set up foundry directory structure.
    execSync(`mkdir -p "${join(dir, 'foundry', 'laws')}"`, { cwd: dir, env: GIT_ENV });
    execSync('git checkout -b config/add-law -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/new.md'), 'content\n');
    execSync('git add . && git commit -m "add law" -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish config', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    assert.equal(res.branch, 'main');
    // Verify no cleanup commit was created.
    const log = execSync('git log --oneline -1', { cwd: dir, env: GIT_ENV }).toString();
    assert.match(log, /finish config/);
    assert.doesNotMatch(log, /cleanup/);
    // Config branch should be deleted.
    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(!branches.includes('config/add-law'), `expected config branch deleted, got: ${branches}`);
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_branch returns wrapped error when branch already exists', async () => {
  const dir = initRepo();
  try {
    // Pre-create the branch we are about to ask for.
    execSync('git checkout -b work/myflow-some-desc -q', { cwd: dir, env: GIT_ENV });
    execSync('git checkout main -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_branch.execute(
      { kind: 'work', flowId: 'myflow', description: 'some desc' }, makeCtx(dir),
    ));

    assert.ok(res.error, `expected error JSON, got ${JSON.stringify(res)}`);
    assert.match(res.error, /foundry_git_branch/);
    assert.equal(res.ok, undefined);
    // Caller should remain on main; checkout should not have switched branches.
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'main');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_branch returns ok and branch name on success', async () => {
  const dir = initRepo();
  try {
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_branch.execute(
      { kind: 'work', flowId: 'myflow', description: 'fresh desc' }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    assert.equal(res.branch, 'work/myflow-fresh-desc');
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'work/myflow-fresh-desc');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// Per-kind matrix (Phase 3, spec §8.1)
// ---------------------------------------------------------------------------

async function callBranch(dir, args) {
  const plugin = await FoundryPlugin({ directory: dir });
  return JSON.parse(await plugin.tool.foundry_git_branch.execute(args, makeCtx(dir)));
}

test('foundry_git_branch: missing kind is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { description: 'x' });
    assert.ok(r.error);
    assert.match(r.error, /kind is required/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: unknown kind is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'bogus', description: 'x' });
    assert.match(r.error, /unknown kind/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" with flowId is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'config', flowId: 'f', description: 'x' });
    assert.match(r.error, /flowId is not valid for kind="config"/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" missing description is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'config' });
    assert.match(r.error, /description is required/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" on main creates config/<slug>', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'config', description: 'add law' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.branch, 'config/add-law');
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'config/add-law');
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" refused while on config/x', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'config', description: 'y' });
    assert.match(r.error, /already on a config\//);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="config" refused from a work branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-x -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'config', description: 'y' });
    assert.match(r.error, /from a work branch/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="work" missing flowId is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'work', description: 'x' });
    assert.match(r.error, /flowId is required for kind="work"/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="work" missing description is refused', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'work', flowId: 'f' });
    assert.match(r.error, /description is required for kind="work"/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="work" refused while on config/x', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'work', flowId: 'f', description: 'g' });
    assert.match(r.error, /cannot start a work branch from a config branch/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="work" refused while on work/x', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/a-b -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'work', flowId: 'f', description: 'g' });
    assert.match(r.error, /already on a work branch/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="dry-run" requires being on config/<x>', async () => {
  const dir = initRepo();
  try {
    const r = await callBranch(dir, { kind: 'dry-run', flowId: 'f', description: 'x' });
    assert.match(r.error, /requires a config\//);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="dry-run" refused on work branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-x -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'dry-run', flowId: 'f', description: 'x' });
    assert.match(r.error, /requires a config\//);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: kind="dry-run" on config/foo creates the flat sibling branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, {
      kind: 'dry-run', flowId: 'creative-flow', description: 'goal x',
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.branch, 'dry-run/foo/creative-flow-goal-x');
    const branch = execSync('git branch --show-current', { cwd: dir, env: GIT_ENV }).toString().trim();
    assert.equal(branch, 'dry-run/foo/creative-flow-goal-x');
  } finally { cleanup(dir); }
});

test('foundry_git_branch: refuses any kind while on a dry-run branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    execSync('git checkout -b dry-run/foo/x-y -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'dry-run', flowId: 'f', description: 'z' });
    assert.match(r.error, /cannot nest deeper/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch: refuses kind="config" while on a dry-run branch', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    execSync('git checkout -b dry-run/foo/x-y -q', { cwd: dir, env: GIT_ENV });
    const r = await callBranch(dir, { kind: 'config', description: 'z' });
    assert.match(r.error, /cannot nest deeper/);
  } finally { cleanup(dir); }
});

test('foundry_git_branch kind=dry-run truncates existing trace file', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b config/foo -q', { cwd: dir, env: GIT_ENV });
    // Seed a leftover trace from a prior dry-run with the same target slug.
    const traceDir = join(dir, '.foundry', 'trace');
    execSync(`mkdir -p "${traceDir}"`, { cwd: dir });
    const tracePath = join(traceDir, 'dry-run-foo-flow-x.jsonl');
    writeFileSync(tracePath, 'leftover line\n');

    const r = await callBranch(dir, {
      kind: 'dry-run', flowId: 'flow', description: 'x',
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.branch, 'dry-run/foo/flow-x');

    const contents = readFileSync(tracePath, 'utf-8');
    assert.equal(contents, '', `expected trace truncated, got: ${JSON.stringify(contents)}`);
  } finally { cleanup(dir); }
});

test('foundry_git_finish on detached HEAD names the branch state in its refusal', async () => {
  // Regression for B3: branch resolution at the finish entry point used
  // raw `git branch --show-current` which returns '' on detached HEAD.
  // The refusal envelope must still surface the detached-HEAD state via
  // currentBranch()'s null-fallback so the caller can act on it.
  const dir = initRepo();
  try {
    // Detach from main onto the same commit.
    execSync('git checkout --detach HEAD -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish', confirm: true }, makeCtx(dir),
    ));
    assert.ok(res.error, `expected refusal envelope, got ${JSON.stringify(res)}`);
    assert.match(res.error, /detached HEAD/,
      `expected 'detached HEAD' in error, got: ${res.error}`);
  } finally { cleanup(dir); }
});

// PHASE 2 TASK 2: Integration test for attestation block in commit message on HEAD
test('foundry_git_finish produces attestation block in final commit message on HEAD', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\nBuild a feature\n');
    writeFileSync(join(dir, 'WORK.history.yaml'), '[]\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-flow');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'feat: implement feature', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    
    // Verify the commit message contains seal metadata
    const commitMsg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV }).toString();
    assert.match(commitMsg, /foundry-run: 01TESTRUNID/, 'Should include foundry-run field');
    assert.match(commitMsg, /attestation-seal: abc123def4567890/, 'Should include attestation-seal field');
    assert.match(commitMsg, /composite-status: pass/, 'Should include composite-status field');
    assert.match(commitMsg, /stage-count: 4/, 'Should include stage-count field');
  } finally {
    cleanup(dir);
  }
});

// PHASE 2 TASK 2: Integration test for signed commit on HEAD
test('foundry_git_finish produces a signed commit on HEAD', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\nBuild a feature\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-flow');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'feat: implement feature', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    
    // Verify the commit is signed by checking the commit object for gpgsig header
    const commitObject = execSync('git cat-file commit HEAD', 
      { cwd: dir, env: GIT_ENV }).toString();
    
    assert.match(commitObject, /^gpgsig /m, 'Commit object should contain gpgsig header');
    assert.match(commitObject, /BEGIN PGP SIGNATURE/, 'Commit should contain PGP signature block');
  } finally {
    cleanup(dir);
  }
});

// PHASE 2 TASK 2: Integration test for archive reference in output
test('foundry_git_finish returns archive branch reference in result', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-flow -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\nBuild a feature\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-flow');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'feat: implement feature', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    assert.ok(res.archiveBranch, 'Should return archiveBranch in result');
    assert.match(res.archiveBranch, /^archive\/work\/f-flow-[a-f0-9]+$/, 
      'Archive branch should follow naming convention');
    assert.ok(res.archiveTipSha, 'Should return archiveTipSha in result');
    assert.match(res.archiveTipSha, /^[a-f0-9]{40}$/, 'Archive tip SHA should be full 40-char hash');
    
    // Verify the archive branch actually exists
    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(branches.includes(res.archiveBranch), 
      `Archive branch ${res.archiveBranch} should exist in repo`);
  } finally {
    cleanup(dir);
  }
});

// PHASE 2 TASK 3: SSH signing tests
test('foundry_git_finish with SSH signing produces a signed commit on HEAD', async () => {
  const dir = initRepo();
  try {
    // Enable SSH signing for this repo
    enableSshSigning(dir);
    
    execSync('git checkout -b work/f-ssh -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\nBuild a feature\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-ssh');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'feat: implement feature', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    
    // Verify the commit is SSH signed by checking the commit object for gpgsig-sha256 header
    const commitObject = execSync('git cat-file commit HEAD', 
      { cwd: dir, env: GIT_ENV }).toString();
    
    assert.match(commitObject, /^gpgsig/m, 'Commit object should contain gpgsig header for SSH signature');
    assert.match(commitObject, /BEGIN SSH SIGNATURE/, 'Commit should contain SSH signature block');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish with SSH signing includes attestation and archive reference', async () => {
  const dir = initRepo();
  try {
    // Enable SSH signing for this repo
    enableSshSigning(dir);
    
    execSync('git checkout -b work/f-attest -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\nBuild a feature\n');
    writeFileSync(join(dir, 'WORK.history.yaml'), '[]\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-attest');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'feat: implement feature', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    
    // Verify seal metadata exists
    const commitMsg = execSync('git log -1 --format=%B', { cwd: dir, env: GIT_ENV }).toString();
    assert.match(commitMsg, /foundry-run: 01TESTRUNID/, 'Should include foundry-run field');
    assert.match(commitMsg, /attestation-seal: abc123def4567890/, 'Should include attestation-seal field');
    assert.match(commitMsg, /composite-status: pass/, 'Should include composite-status');
    
    // Verify archive branch exists and is referenced
    assert.ok(res.archiveBranch, 'Should return archiveBranch');
    assert.match(res.archiveBranch, /^archive\/work\/f-attest-[a-f0-9]+$/);
    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(branches.includes(res.archiveBranch), 'Archive branch should exist');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on config branch does not require signed commit', async () => {
  const dir = initRepo();
  try {
    // Enable SSH signing for this repo
    enableSshSigning(dir);
    
    // Set up foundry directory structure
    execSync(`mkdir -p "${join(dir, 'foundry', 'laws')}"`, { cwd: dir, env: GIT_ENV });
    execSync('git checkout -b config/add-law -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'foundry/laws/new.md'), 'content\n');
    execSync('git add . && git commit -m "add law" -q', { cwd: dir, env: GIT_ENV });

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'finish config', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    
    // Config branches should complete successfully regardless of signing
    // The commit may or may not be signed depending on repo config, but the operation succeeds
    assert.equal(res.branch, 'main');
  } finally {
    cleanup(dir);
  }
});

// PHASE 2 TASK 3 VERIFICATION: GPG signing produces commit with signature
test('foundry_git_finish GPG-signed commit contains signature in commit object', async () => {
  const dir = initRepo();
  try {
    execSync('git checkout -b work/f-verify -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\nBuild a feature\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-verify');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'feat: implement feature', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    
    // Verify the commit object contains a GPG signature structure
    // We use a test GPG wrapper, so we cannot verify cryptographic validity here.
    // Real GPG verification coverage comes from the SSH signing test below.
    const commitObject = execSync('git cat-file commit HEAD', 
      { cwd: dir, env: GIT_ENV }).toString();
    
    assert.match(commitObject, /^gpgsig /m, 'Commit object should contain gpgsig header');
    assert.match(commitObject, /BEGIN PGP SIGNATURE/, 'Commit should contain PGP signature block');
  } finally {
    cleanup(dir);
  }
});

// PHASE 2 TASK 3 VERIFICATION: Git verify-commit tests for SSH signing
test('foundry_git_finish SSH-signed commit passes git verify-commit', async () => {
  const dir = initRepo();
  try {
    // Enable SSH signing for this repo
    enableSshSigning(dir);
    
    execSync('git checkout -b work/f-ssh-verify -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\nBuild a feature\n');
    execSync('git add . && git commit -m work -q', { cwd: dir, env: GIT_ENV });

    // Create sealed commit
    createSealedCommit(dir, 'f-ssh-verify');

    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'feat: implement feature', confirm: true }, makeCtx(dir),
    ));

    assert.equal(res.ok, true, res.error);
    
    // Verify the commit using Git's verify-commit command with SSH configuration
    // This ensures Git verifies the SSH signature using the allowed_signers file
    const verifyResult = execSync('git verify-commit HEAD 2>&1', 
      { cwd: dir, env: GIT_ENV }).toString();
    
    // Git verify-commit should succeed and show SSH signature verification
    assert.match(verifyResult, /Good "git" signature/i, 
      'Git verify-commit should show good SSH signature');
  } finally {
    cleanup(dir);
  }
});

test('foundry_git_finish on work branch succeeds even when repo signing is broken', async () => {
  const dir = initRepo();
  try {
    // Enable commit signing in the repo config.
    execSync('git config commit.gpgsign true', { cwd: dir, env: GIT_ENV });
    // Break signing by pointing to a non-existent GPG key (repo config is broken).
    execSync('git config user.signingkey 0000000000000000', { cwd: dir, env: GIT_ENV });

    execSync('git checkout -b work/f-broken-sign -q', { cwd: dir, env: GIT_ENV });
    writeFileSync(join(dir, 'feature.txt'), 'feature work\n');
    writeFileSync(join(dir, 'WORK.md'), '# Goal\n\nBuild a feature\n');
    writeFileSync(join(dir, 'WORK.history.yaml'), '[]\n');
    execSync('git add . && git commit -m work --no-gpg-sign -q',
      { cwd: dir, env: GIT_ENV });

    // Create sealed commit (also needs --no-gpg-sign because signing is broken)
    createSealedCommit(dir, 'f-broken-sign');

    // Apply the finish — should succeed despite broken signing config.
    const plugin = await FoundryPlugin({ directory: dir });
    const res = JSON.parse(await plugin.tool.foundry_git_finish.execute(
      { message: 'feat: implement feature', confirm: true }, makeCtx(dir),
    ));

    // Should succeed - final commit uses explicit -S which works with the test GPG wrapper.
    assert.equal(res.ok, true, `Expected finish to succeed despite broken signing, got: ${JSON.stringify(res)}`);
    assert.equal(res.branch, 'main');
    assert.ok(res.hash);

    const branches = execSync('git branch', { cwd: dir, env: GIT_ENV }).toString();
    assert.ok(!branches.match(/^\s*\*?\s*work\/f-broken-sign\s*$/m),
      `expected work branch deleted, got: ${branches}`);

    const log = execSync('git log -1 --pretty=%B main', { cwd: dir, env: GIT_ENV }).toString();
    assert.match(log, /foundry-run: 01TESTRUNID/, 'Should include foundry-run in commit message');
    
    // Verify the final commit is still signed (uses explicit -S flag with the working GPG).
    const commitObject = execSync('git cat-file commit HEAD', 
      { cwd: dir, env: GIT_ENV }).toString();
    assert.match(commitObject, /^gpgsig /m, 'Final commit should be signed');
    assert.match(commitObject, /BEGIN PGP SIGNATURE/, 'Final commit should contain signature');
  } finally {
    cleanup(dir);
  }
});

