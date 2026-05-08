/**
 * Work branch finisher — reads ATTEST.md, verifies diff SHA, squash-merges.
 *
 * ATTEST.md must exist, must be the HEAD commit, and its diff-sha256 must match
 * a recomputed SHA of the branch diff (merge-base to HEAD~1).
 */

import { sha256Buffer } from '../attestation/hash.js';

/** Run git command; return { ok, result } or { ok: false, error }. */
function safeGit(execGit, args) {
  try {
    return { ok: true, result: execGit(args).trim() };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/** Best-effort git call — swallows all errors. */
function bestEffort(execGit, args) {
  try { execGit(args); } catch { /* best effort */ }
}

/** Best-effort rollback: reset, restore branch, delete archive, remove temp file. */
function rollback({ execGit, branchName, archiveBranch, commitFile, deleteFile }) {
  bestEffort(execGit, ['reset', '--merge']);
  bestEffort(execGit, ['checkout', branchName]);
  bestEffort(execGit, ['branch', '-D', archiveBranch]);
  if (deleteFile && commitFile) bestEffort(() => deleteFile(commitFile), []);
}

/** Extract stderr or stdout string from a caught error. */
function extractStderr(err) {
  if (!err) return '';
  if (err.stderr) return String(err.stderr).trim();
  if (err.stdout) return String(err.stdout).trim();
  return '';
}

/** Build an error string from a caught git error. */
function gitError(prefix, err) {
  const msg = extractStderr(err);
  if (msg) return prefix + ' ' + msg;
  return prefix;
}

/** Parse the diff-sha256 line from ATTEST.md content. */
function parseDiffSha(content) {
  const match = content.match(/^diff-sha256:\s*([0-9a-f]{64})/m);
  return match ? match[1] : null;
}

/** Compute the SHA of the branch diff (merge-base to HEAD~1). */
function computeDiffSha(execGit, baseBranch) {
  const mergeBase = execGit(['merge-base', 'HEAD', baseBranch]).trim();
  const diffOutput = execGit(['diff', mergeBase, 'HEAD~1']);
  const diffBuf = Buffer.isBuffer(diffOutput) ? diffOutput : Buffer.from(diffOutput, 'utf8');
  return sha256Buffer(diffBuf);
}

/** Validate ATTEST.md exists and HEAD is the attest commit. */
function checkAttestFile(cwd, fileExists, execGit) {
  const attestPath = `${cwd}/ATTEST.md`;
  if (!fileExists(attestPath)) {
    return {
      ok: false,
      error: 'foundry_git_finish: ATTEST.md not found. Run foundry_attest before finishing the branch.',
    };
  }
  const headLine = execGit(['log', '--oneline', '-1']).trim();
  if (!headLine.includes('attest: cycle complete')) {
    return {
      ok: false,
      error: `foundry_git_finish: HEAD commit is not the attest commit. Run foundry_attest first. HEAD: ${headLine}`,
    };
  }
  return { ok: true, attestPath };
}

/** Validate the diff SHA in ATTEST.md matches the recomputed branch diff. */
function checkDiffSha(attestPath, readAttest, execGit, baseBranch) {
  const attestContent = readAttest(attestPath);
  const recordedDiffSha = parseDiffSha(attestContent);
  if (!recordedDiffSha) {
    return {
      ok: false,
      error: 'foundry_git_finish: ATTEST.md is malformed — no valid diff-sha256 line found.',
    };
  }
  const computedDiffSha = computeDiffSha(execGit, baseBranch);
  if (computedDiffSha !== recordedDiffSha) {
    return {
      ok: false,
      error: `foundry_git_finish: diff SHA mismatch. Recorded: ${recordedDiffSha}. Computed: ${computedDiffSha}. The branch has changed since attestation.`,
    };
  }
  return { ok: true, attestContent };
}

/** Checkout the base branch; roll back on failure. */
function checkoutBase(execGit, baseBranch, branchName, archiveBranch, deleteFile) {
  const res = safeGit(execGit, ['checkout', baseBranch]);
  if (!res.ok) {
    rollback({ execGit, branchName, archiveBranch, deleteFile });
    return { ok: false, error: gitError('foundry_git_finish: checkout base branch failed.', res.error) };
  }
  return { ok: true };
}

/** Squash-merge the work branch; roll back on failure. */
function squashMerge(execGit, branchName, branchNameOrig, archiveBranch, deleteFile) {
  const res = safeGit(execGit, ['merge', '--squash', branchName]);
  if (!res.ok) {
    rollback({ execGit, branchName: branchNameOrig, archiveBranch, deleteFile });
    return { ok: false, error: gitError('foundry_git_finish: squash merge failed.', res.error) };
  }
  return { ok: true };
}

/** Write the commit message file; roll back on failure. */
function writeCommitMsg({ writeTempMessage, attestContent, execGit, branchName, archiveBranch, deleteFile }) {
  try {
    return { ok: true, commitFile: writeTempMessage(attestContent) };
  } catch (err) {
    rollback({ execGit, branchName, archiveBranch, deleteFile });
    return { ok: false, error: `foundry_git_finish: failed to write commit message file. ${err.message ?? String(err)}` };
  }
}

/** Create the signed commit; roll back on failure. */
function doCommit(execGit, commitFile, branchName, archiveBranch, deleteFile) {
  const res = safeGit(execGit, ['commit', '-S', '-F', commitFile]);
  if (!res.ok) {
    rollback({ execGit, branchName, archiveBranch, commitFile, deleteFile });
    return { ok: false, error: gitError('foundry_git_finish: commit failed.', res.error) };
  }
  return { ok: true };
}

/** Delete the branch; return warning if it fails. */
function deleteBranch(execGit, branchName) {
  const res = safeGit(execGit, ['branch', '-D', branchName]);
  if (!res.ok) {
    const msg = extractStderr(res.error);
    return { ok: true, warning: `Branch '${branchName}' could not be deleted. ${msg}`.trim() };
  }
  return { ok: true };
}

/** Build the success result object. */
function successResult(hash, archiveBranch, tipSha, baseBranch, warning) {
  const base = { ok: true, hash, archiveBranch, archiveTipSha: tipSha, branch: baseBranch };
  return warning ? { ...base, warning } : base;
}

/** Run checkout + squash-merge steps. Returns error result on failure. */
function runMerge(execGit, branchName, baseBranch, archiveBranch, deleteFile) {
  const checkout = checkoutBase(execGit, baseBranch, branchName, archiveBranch, deleteFile);
  if (!checkout.ok) return checkout;

  const merged = squashMerge(execGit, branchName, branchName, archiveBranch, deleteFile);
  if (!merged.ok) return merged;

  return { ok: true };
}

/** Run write-commit-message + commit steps. Returns error result on failure. */
function runCommit({ writeTempMessage, attestContent, execGit, branchName, archiveBranch, deleteFile }) {
  const msg = writeCommitMsg({ writeTempMessage, attestContent, execGit, branchName, archiveBranch, deleteFile });
  if (!msg.ok) return msg;

  const committed = doCommit(execGit, msg.commitFile, branchName, archiveBranch, deleteFile);
  if (!committed.ok) return committed;

  return { ok: true, commitFile: msg.commitFile };
}

/** Run post-attestation steps: archive, merge, commit, cleanup, delete branch. */
function runPostAttestation({
  execGit, branchName, baseBranch, deleteFile, writeTempMessage, shaCheck,
}) {
  const tipSha = execGit(['rev-parse', branchName]).trim();
  const archiveBranch = `archive/${branchName}-${tipSha.slice(0, 7)}`;
  execGit(['branch', archiveBranch, branchName]);

  const mergeResult = runMerge(execGit, branchName, baseBranch, archiveBranch, deleteFile);
  if (!mergeResult.ok) return mergeResult;

  const commitResult = runCommit({
    writeTempMessage,
    attestContent: shaCheck.attestContent,
    execGit, branchName, archiveBranch, deleteFile,
  });
  if (!commitResult.ok) return commitResult;

  if (deleteFile && commitResult.commitFile) {
    bestEffort(() => deleteFile(commitResult.commitFile), []);
  }

  const hash = execGit(['rev-parse', '--short', 'HEAD']).trim();
  const del = deleteBranch(execGit, branchName);

  return successResult(hash, archiveBranch, tipSha, baseBranch, del.warning);
}

export async function finishWorkBranchWithArchive({
  branchName,
  baseBranch,
  confirm,
  execGit,
  fileExists,
  readAttest,
  deleteFile,
  writeTempMessage,
  cwd,
}) {
  if (confirm !== true) {
    return {
      ok: false,
      error: 'foundry_git_finish requires {confirm: true} to perform destructive operations.',
    };
  }

  const fileCheck = checkAttestFile(cwd, fileExists, execGit);
  if (!fileCheck.ok) return fileCheck;

  const shaCheck = checkDiffSha(fileCheck.attestPath, readAttest, execGit, baseBranch);
  if (!shaCheck.ok) return shaCheck;

  return runPostAttestation({
    execGit, branchName, baseBranch, deleteFile, writeTempMessage, shaCheck,
  });
}
