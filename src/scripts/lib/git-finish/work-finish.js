/**
 * Work branch finisher — verifies attestation seal, squash-merges.
 *
 * The HEAD commit body must contain foundry-run and attestation-seal fields
 * from the orchestration finalise step. The seal metadata becomes the merge
 * commit message.
 */

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

/** Verify the HEAD commit body contains seal metadata from orchestration finalise. */
function checkSeal(execGit) {
  const body = execGit(['log', '-1', '--pretty=%B']);
  const hasRunId = /^foundry-run:\s*\S/m.test(body);
  const hasSeal = /^attestation-seal:\s*\S/m.test(body);
  if (!hasRunId || !hasSeal) {
    return {
      ok: false,
      error: 'foundry_git_finish: no attestation seal found at HEAD. The orchestration finalise step has not sealed this run, or the seal commit was lost. Re-run the final stage to complete the cycle.',
    };
  }
  return { ok: true, body };
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

/** Run finish steps: archive, merge, commit, cleanup, delete branch. */
function runFinish({
  execGit, branchName, baseBranch, deleteFile, writeTempMessage, sealCheck,
}) {
  const tipSha = execGit(['rev-parse', branchName]).trim();
  const archiveBranch = `archive/${branchName}-${tipSha.slice(0, 7)}`;
  execGit(['branch', archiveBranch, branchName]);

  const mergeResult = runMerge(execGit, branchName, baseBranch, archiveBranch, deleteFile);
  if (!mergeResult.ok) return mergeResult;

  // Stage the attestation file so it is included in the merge commit alongside the artefact changes.
  const runIdMatch = sealCheck.body.match(/^foundry-run:\s*(\S+)/m);
  if (runIdMatch) {
    execGit(['add', '-f', `.foundry/attestations/${runIdMatch[1]}.jsonl`]);
  }

  const commitResult = runCommit({
    writeTempMessage,
    attestContent: sealCheck.body,
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
  deleteFile,
  writeTempMessage,
}) {
  if (confirm !== true) {
    return {
      ok: false,
      error: 'foundry_git_finish requires {confirm: true} to perform destructive operations.',
    };
  }

  const sealCheck = checkSeal(execGit);
  if (!sealCheck.ok) return sealCheck;

  return runFinish({
    execGit, branchName, baseBranch, deleteFile, writeTempMessage, sealCheck,
  });
}
