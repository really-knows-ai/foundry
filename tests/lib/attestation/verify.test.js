import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractAttestationBlock } from '../../../src/scripts/lib/attestation/parse.js';
import { verifyAttestationRef } from '../../../src/scripts/lib/attestation/verify.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function createSignedRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'attestation-verify-'));
  execSync('git init -q', { cwd: dir, env: GIT_ENV });
  execSync('git config commit.gpgsign false', { cwd: dir, env: GIT_ENV });

  // Configure dummy GPG wrapper for testing
  const gpgWrapper = join(tmpdir(), `gpg-test-verify-${process.pid}-${Date.now()}`);
  writeFileSync(
    gpgWrapper,
    '#!/bin/sh\n' +
      '# Handle both signing and verification modes\n' +
      'if echo "$*" | grep -q -- "--verify"; then\n' +
      '  cat >/dev/null\n' +
      '  STATUS_FD=2\n' +
      '  for arg in "$@"; do\n' +
      '    case "$arg" in\n' +
      '      --status-fd=*) STATUS_FD="\${arg#--status-fd=}" ;;\n' +
      '    esac\n' +
      '  done\n' +
      '  echo "[GNUPG:] NEWSIG" >&"$STATUS_FD"\n' +
      '  echo "[GNUPG:] GOODSIG 0000000000000000 Test Key" >&"$STATUS_FD"\n' +
      '  echo "[GNUPG:] VALIDSIG 0000000000000000 2024-01-01 0000000000000000" >&"$STATUS_FD"\n' +
      '  echo "[GNUPG:] TRUST_ULTIMATE" >&"$STATUS_FD"\n' +
      '  echo "gpg: Good signature from \\"Test Key\\"" >&2\n' +
      '  exit 0\n' +
      'else\n' +
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
    { mode: 0o755 },
  );
  execSync(`git config gpg.program "${gpgWrapper}"`, { cwd: dir, env: GIT_ENV });

  // Create a signed commit with attestation block
  writeFileSync(join(dir, 'README.md'), 'test\n');
  execSync('git add .', { cwd: dir, env: GIT_ENV });
  const commitMessage = [
    'feat: add haiku flow',
    '',
    '-----BEGIN FOUNDRY ATTESTATION-----',
    '{"schema":"foundry-attestation/v1"}',
    '-----END FOUNDRY ATTESTATION-----',
  ].join('\n');
  execSync(`git commit -S -m "${commitMessage.replace(/"/g, '\\"')}"`, {
    cwd: dir,
    env: GIT_ENV,
  });

  return dir;
}

test('extractAttestationBlock returns the canonical JSON payload only', () => {
  const block = extractAttestationBlock([
    'feat: add haiku flow',
    '',
    '-----BEGIN FOUNDRY ATTESTATION-----',
    '{"schema":"foundry-attestation/v1"}',
    '-----END FOUNDRY ATTESTATION-----',
  ].join('\n'));

  assert.equal(block, '{"schema":"foundry-attestation/v1"}');
});

test('extractAttestationBlock handles literal END marker before the block', () => {
  const block = extractAttestationBlock([
    'feat: add haiku flow',
    '',
    'This commit message has a literal -----END FOUNDRY ATTESTATION----- marker in the description.',
    '',
    '-----BEGIN FOUNDRY ATTESTATION-----',
    '{"schema":"foundry-attestation/v1"}',
    '-----END FOUNDRY ATTESTATION-----',
  ].join('\n'));

  assert.equal(block, '{"schema":"foundry-attestation/v1"}');
});

test('verifyAttestationRef returns verified for a signed commit with matching payload', () => {
  const signedRepoDir = createSignedRepo();
  let gpgWrapper;
  try {
    // Extract wrapper path for cleanup
    const gpgConfig = execSync('git config gpg.program', { cwd: signedRepoDir, encoding: 'utf8' }).trim();
    gpgWrapper = gpgConfig;
    
    const result = verifyAttestationRef({ cwd: signedRepoDir, ref: 'HEAD' });
    assert.equal(result.status, 'verified');
    assert.equal(result.schema, 'foundry-attestation/v1');
  } finally {
    rmSync(signedRepoDir, { recursive: true, force: true });
    if (gpgWrapper) {
      try { rmSync(gpgWrapper, { force: true }); } catch {}
    }
  }
});

test('verifyAttestationRef throws descriptive error for malformed JSON in attestation block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attestation-malformed-'));
  const gpgWrapper = join(tmpdir(), `gpg-test-malformed-${process.pid}-${Date.now()}`);
  try {
    execSync('git init -q', { cwd: dir, env: GIT_ENV });
    execSync('git config commit.gpgsign false', { cwd: dir, env: GIT_ENV });

    // Configure dummy GPG wrapper
    writeFileSync(
      gpgWrapper,
      '#!/bin/sh\n' +
        'if echo "$*" | grep -q -- "--verify"; then\n' +
        '  cat >/dev/null\n' +
        '  STATUS_FD=2\n' +
        '  for arg in "$@"; do\n' +
        '    case "$arg" in\n' +
        '      --status-fd=*) STATUS_FD="\${arg#--status-fd=}" ;;\n' +
        '    esac\n' +
        '  done\n' +
        '  echo "[GNUPG:] NEWSIG" >&"$STATUS_FD"\n' +
        '  echo "[GNUPG:] GOODSIG 0000000000000000 Test Key" >&"$STATUS_FD"\n' +
        '  echo "[GNUPG:] VALIDSIG 0000000000000000 2024-01-01 0000000000000000" >&"$STATUS_FD"\n' +
        '  echo "[GNUPG:] TRUST_ULTIMATE" >&"$STATUS_FD"\n' +
        '  exit 0\n' +
        'else\n' +
        '  cat >/dev/null\n' +
        '  echo "[GNUPG:] SIG_CREATED " >&2\n' +
        '  cat <<\'SIGNATURE\'\n' +
        '-----BEGIN PGP SIGNATURE-----\n' +
        'iQIz\n' +
        '-----END PGP SIGNATURE-----\n' +
        'SIGNATURE\n' +
        '  exit 0\n' +
        'fi\n',
      { mode: 0o755 },
    );
    execSync(`git config gpg.program "${gpgWrapper}"`, { cwd: dir, env: GIT_ENV });

    // Create commit with malformed JSON
    writeFileSync(join(dir, 'README.md'), 'test\n');
    execSync('git add .', { cwd: dir, env: GIT_ENV });
    const commitMessage = [
      'feat: test malformed',
      '',
      '-----BEGIN FOUNDRY ATTESTATION-----',
      '{invalid-json}',
      '-----END FOUNDRY ATTESTATION-----',
    ].join('\n');
    execSync(`git commit -S -m "${commitMessage.replace(/"/g, '\\"')}"`, {
      cwd: dir,
      env: GIT_ENV,
    });

    assert.throws(
      () => verifyAttestationRef({ cwd: dir, ref: 'HEAD' }),
      (err) => {
        return (
          err instanceof Error &&
          err.message.includes('malformed attestation JSON') &&
          err.message.includes('{invalid-json}')
        );
      },
      'Expected descriptive error for malformed JSON',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    try { rmSync(gpgWrapper, { force: true }); } catch {}
  }
});

test('verifyAttestationRef throws when signed commit has no attestation block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attestation-missing-'));
  const gpgWrapper = join(tmpdir(), `gpg-test-missing-${process.pid}-${Date.now()}`);
  try {
    execSync('git init -q', { cwd: dir, env: GIT_ENV });
    execSync('git config commit.gpgsign false', { cwd: dir, env: GIT_ENV });

    // Configure dummy GPG wrapper
    writeFileSync(
      gpgWrapper,
      '#!/bin/sh\n' +
        'if echo "$*" | grep -q -- "--verify"; then\n' +
        '  cat >/dev/null\n' +
        '  STATUS_FD=2\n' +
        '  for arg in "$@"; do\n' +
        '    case "$arg" in\n' +
        '      --status-fd=*) STATUS_FD="\${arg#--status-fd=}" ;;\n' +
        '    esac\n' +
        '  done\n' +
        '  echo "[GNUPG:] NEWSIG" >&"$STATUS_FD"\n' +
        '  echo "[GNUPG:] GOODSIG 0000000000000000 Test Key" >&"$STATUS_FD"\n' +
        '  echo "[GNUPG:] VALIDSIG 0000000000000000 2024-01-01 0000000000000000" >&"$STATUS_FD"\n' +
        '  echo "[GNUPG:] TRUST_ULTIMATE" >&"$STATUS_FD"\n' +
        '  exit 0\n' +
        'else\n' +
        '  cat >/dev/null\n' +
        '  echo "[GNUPG:] SIG_CREATED " >&2\n' +
        '  cat <<\'SIGNATURE\'\n' +
        '-----BEGIN PGP SIGNATURE-----\n' +
        'iQIz\n' +
        '-----END PGP SIGNATURE-----\n' +
        'SIGNATURE\n' +
        '  exit 0\n' +
        'fi\n',
      { mode: 0o755 },
    );
    execSync(`git config gpg.program "${gpgWrapper}"`, { cwd: dir, env: GIT_ENV });

    // Create commit with no attestation block
    writeFileSync(join(dir, 'README.md'), 'test\n');
    execSync('git add .', { cwd: dir, env: GIT_ENV });
    execSync('git commit -S -m "feat: no attestation here"', {
      cwd: dir,
      env: GIT_ENV,
    });

    assert.throws(
      () => verifyAttestationRef({ cwd: dir, ref: 'HEAD' }),
      (err) => {
        return (
          err instanceof Error &&
          err.message.includes('attestation block not found')
        );
      },
      'Expected error when attestation block is missing',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    try { rmSync(gpgWrapper, { force: true }); } catch {}
  }
});
