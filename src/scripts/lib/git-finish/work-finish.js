/**
 * Work branch finisher — reads ATTEST.md, verifies diff SHA, squash-merges.
 *
 * ATTEST.md must exist, must be the HEAD commit, and its diff-sha256 must match
 * a recomputed SHA of the branch diff (merge-base to HEAD~1).
 */

import { sha256Buffer } from '../attestation/hash.js';

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

  // --- ATTEST.md gate ---

  const attestPath = `${cwd}/ATTEST.md`;

  if (!fileExists(attestPath)) {
    return {
      ok: false,
      error: 'foundry_git_finish: ATTEST.md not found. Run foundry_attest before finishing the branch.',
    };
  }

  // Verify HEAD commit is the attest commit
  const headLine = execGit(['log', '--oneline', '-1']).trim();
  if (!headLine.includes('attest: cycle complete')) {
    return {
      ok: false,
      error: `foundry_git_finish: HEAD commit is not the attest commit. Run foundry_attest first. HEAD: ${headLine}`,
    };
  }

  // Read and parse ATTEST.md
  const attestContent = readAttest(attestPath);
  const diffShaMatch = attestContent.match(/^diff-sha256:\s*([0-9a-f]{64})/m);
  if (!diffShaMatch) {
    return {
      ok: false,
      error: 'foundry_git_finish: ATTEST.md is malformed — no valid diff-sha256 line found.',
    };
  }
  const recordedDiffSha = diffShaMatch[1];

  // Recompute diff SHA from merge-base to HEAD~1 (excluding the attest commit)
  const mergeBase = execGit(['merge-base', 'HEAD', baseBranch]).trim();
  const diffOutput = execGit(['diff', mergeBase, 'HEAD~1']);
  const diffBuf = Buffer.isBuffer(diffOutput) ? diffOutput : Buffer.from(diffOutput, 'utf8');
  const computedDiffSha = sha256Buffer(diffBuf);

  if (computedDiffSha !== recordedDiffSha) {
    return {
      ok: false,
      error: `foundry_git_finish: diff SHA mismatch. Recorded: ${recordedDiffSha}. Computed: ${computedDiffSha}. The branch has changed since attestation.`,
    };
  }

  // --- Proceed with merge ---

  const tipSha = execGit(['rev-parse', branchName]).trim();
  const archiveBranch = `archive/${branchName}-${tipSha.slice(0, 7)}`;

  execGit(['branch', archiveBranch, branchName]);

  // Checkout base branch
  try {
    execGit(['checkout', baseBranch]);
  } catch (err) {
    try { execGit(['checkout', branchName]); } catch { /* best effort */ }
    try { execGit(['branch', '-D', archiveBranch]); } catch { /* best effort */ }
    const stderr = err?.stderr || err?.stdout || '';
    return {
      ok: false,
      error: `foundry_git_finish: checkout base branch failed.${stderr ? ' ' + String(stderr).trim() : ''}`,
    };
  }

  // Squash merge
  try {
    execGit(['merge', '--squash', branchName]);
  } catch (err) {
    try { execGit(['reset', '--merge']); } catch { /* best effort */ }
    try { execGit(['checkout', branchName]); } catch { /* best effort */ }
    try { execGit(['branch', '-D', archiveBranch]); } catch { /* best effort */ }
    const stderr = err?.stderr || err?.stdout || '';
    return {
      ok: false,
      error: `foundry_git_finish: squash merge failed.${stderr ? ' ' + String(stderr).trim() : ''}`,
    };
  }

  // Write commit message from ATTEST.md
  let commitFile;
  try {
    commitFile = writeTempMessage(attestContent);
  } catch (err) {
    try { execGit(['reset', '--merge']); } catch { /* best effort */ }
    try { execGit(['checkout', branchName]); } catch { /* best effort */ }
    try { execGit(['branch', '-D', archiveBranch]); } catch { /* best effort */ }
    return {
      ok: false,
      error: `foundry_git_finish: failed to write commit message file. ${err.message ?? String(err)}`,
    };
  }

  // GPG-signed commit
  try {
    execGit(['commit', '-S', '-F', commitFile]);
  } catch (err) {
    try { execGit(['reset', '--merge']); } catch { /* best effort */ }
    try { execGit(['checkout', branchName]); } catch { /* best effort */ }
    try { execGit(['branch', '-D', archiveBranch]); } catch { /* best effort */ }
    try { if (deleteFile && commitFile) deleteFile(commitFile); } catch { /* best effort */ }
    const stderr = err?.stderr || err?.stdout || '';
    return {
      ok: false,
      error: `foundry_git_finish: commit failed.${stderr ? ' ' + String(stderr).trim() : ''}`,
    };
  }

  try { if (deleteFile && commitFile) deleteFile(commitFile); } catch { /* best effort */ }

  const hash = execGit(['rev-parse', '--short', 'HEAD']).trim();

  try {
    execGit(['branch', '-D', branchName]);
  } catch (err) {
    const stderr = err?.stderr || err?.stdout || '';
    return {
      ok: true, hash, archiveBranch, archiveTipSha: tipSha, branch: baseBranch,
      warning: `Branch '${branchName}' could not be deleted. ${stderr ? String(stderr).trim() : ''}`.trim(),
    };
  }

  return { ok: true, hash, archiveBranch, archiveTipSha: tipSha, branch: baseBranch };
}
