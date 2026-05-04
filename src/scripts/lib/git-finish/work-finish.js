/**
 * Work branch finisher with attestation archive.
 *
 * Squash-merges a work branch to base, creates an archive branch reference,
 * and commits with a signed, attested message.
 */

import { canonicalJson } from '../attestation/canonical-json.js';
import { renderAttestedCommitMessage } from '../attestation/render.js';

const WORK_FILES = ['WORK.md', 'WORK.history.yaml', 'WORK.feedback.yaml'];

export async function finishWorkBranchWithArchive({
  branchName,
  baseBranch,
  confirm,
  message,
  execGit,
  buildPayload,
  writeTempMessage,
  deleteFile,
  fileExists,
  cwd,
}) {
  if (!writeTempMessage) {
    throw new Error('writeTempMessage is required');
  }

  if (confirm !== true) {
    return {
      ok: false,
      error: 'foundry_git_finish requires {confirm: true} to perform destructive operations. Re-invoke with confirm:true to apply the plan.',
    };
  }

  // Get the tip SHA of the work branch
  const tipSha = execGit(['rev-parse', branchName]).trim();
  const archiveBranch = `archive/${branchName}-${tipSha.slice(0, 7)}`;

  // Create archive branch pointing to current work branch tip
  execGit(['branch', archiveBranch, branchName]);

  // Remove WORK* files if provided cleanup dependencies
  if (deleteFile && fileExists && cwd) {
    const filesToDelete = WORK_FILES.filter((f) => {
      const path = `${cwd}/${f}`;
      return fileExists(path);
    });

    for (const f of filesToDelete) {
      deleteFile(`${cwd}/${f}`);
    }

    // Commit cleanup if there are files to remove
    if (filesToDelete.length > 0) {
      try {
        // Stage only the WORK files we deleted - selective staging, not git add -A
        for (const f of filesToDelete) {
          execGit(['add', f]);
        }
        const status = execGit(['status', '--porcelain']).trim();
        if (status) {
          const cleanupMsg = `[${branchName.replace('work/', '')}] cleanup: remove work files`;
          execGit(['commit', '--no-gpg-sign', '-m', cleanupMsg]);
        }
      } catch (err) {
        // Cleanup commit failed - rollback and abort
        try {
          execGit(['checkout', branchName]);
        } catch {
          // Best effort
        }
        try {
          execGit(['reset', '--hard', tipSha]);
        } catch {
          // Best effort
        }
        try {
          execGit(['branch', '-D', archiveBranch]);
        } catch {
          // Best effort to clean up leaked archive branch
        }
        const stderr = err?.stderr || err?.stdout || '';
        return {
          ok: false,
          error: `foundry_git_finish: cleanup commit failed. Work branch '${branchName}' preserved.${stderr ? ' ' + String(stderr).trim() : ''}`,
        };
      }
    }
  }

  // Checkout base branch with rollback on failure
  try {
    execGit(['checkout', baseBranch]);
  } catch (err) {
    // Rollback: restore work branch and delete leaked archive branch
    try {
      execGit(['checkout', branchName]);
    } catch {
      // Best effort
    }
    try {
      execGit(['reset', '--hard', tipSha]);
    } catch {
      // Best effort
    }
    try {
      execGit(['branch', '-D', archiveBranch]);
    } catch {
      // Best effort to clean up leaked archive branch
    }
    const stderr = err?.stderr || err?.stdout || '';
    return {
      ok: false,
      error: `foundry_git_finish: checkout base branch failed. Work branch '${branchName}' preserved.${stderr ? ' ' + String(stderr).trim() : ''}`,
    };
  }

  // Squash merge the work branch with rollback on failure
  try {
    execGit(['merge', '--squash', branchName]);
  } catch (err) {
    // Rollback: clear base branch state, restore work branch, delete leaked archive branch
    try {
      execGit(['reset', '--merge']);
    } catch {
      // Best effort to clear conflict/staged state on base branch
    }
    try {
      execGit(['checkout', branchName]);
    } catch {
      // Best effort
    }
    try {
      execGit(['reset', '--hard', tipSha]);
    } catch {
      // Best effort
    }
    try {
      execGit(['branch', '-D', archiveBranch]);
    } catch {
      // Best effort to clean up leaked archive branch
    }
    const stderr = err?.stderr || err?.stdout || '';
    return {
      ok: false,
      error: `foundry_git_finish: squash merge failed (likely a conflict). Work branch '${branchName}' preserved.${stderr ? ' ' + String(stderr).trim() : ''}`,
    };
  }

  // Build the attestation payload
  let commitFile;
  try {
    const payload = await buildPayload({
      archiveBranch,
      archiveTipSha: tipSha,
    });

    // Canonicalise the payload
    const payloadJson = canonicalJson(payload);

    // Render the attested commit message
    const commitMessage = renderAttestedCommitMessage({
      humanSummary: message,
      payloadJson,
    });

    // Write the commit message to a temp file
    commitFile = writeTempMessage(commitMessage);
  } catch (err) {
    // Rollback: reset base branch, restore work branch, delete leaked archive branch
    try {
      execGit(['reset', '--merge']);
    } catch {
      // Best effort to clear staged state on base branch
    }
    try {
      execGit(['checkout', branchName]);
    } catch {
      // Best effort
    }
    try {
      execGit(['reset', '--hard', tipSha]);
    } catch {
      // Best effort
    }
    try {
      execGit(['branch', '-D', archiveBranch]);
    } catch {
      // Best effort to clean up leaked archive branch
    }
    const stderr = err?.stderr || err?.stdout || err?.message || '';
    return {
      ok: false,
      error: `foundry_git_finish: prepare commit message failed. Work branch '${branchName}' preserved. ${String(stderr).trim()}`,
    };
  }

  // Create a signed commit with rollback on failure
  try {
    const commitArgs = ['commit', '-S', '-F', commitFile];
    execGit(commitArgs);
  } catch (err) {
    // Rollback: reset base branch, restore work branch, delete leaked archive branch, clean up temp file
    try {
      execGit(['reset', '--merge']);
    } catch {
      // Best effort to clear staged state on base branch
    }
    try {
      execGit(['checkout', branchName]);
    } catch {
      // Best effort
    }
    try {
      execGit(['reset', '--hard', tipSha]);
    } catch {
      // Best effort
    }
    try {
      execGit(['branch', '-D', archiveBranch]);
    } catch {
      // Best effort to clean up leaked archive branch
    }
    try {
      if (deleteFile && commitFile) {
        deleteFile(commitFile);
      }
    } catch {
      // Best effort to clean up temp commit-message file
    }
    const stderr = err?.stderr || err?.stdout || '';
    return {
      ok: false,
      error: `foundry_git_finish: commit failed. Work branch '${branchName}' preserved.${stderr ? ' ' + String(stderr).trim() : ''}`,
    };
  }

  // Clean up temp commit-message file on success
  try {
    if (deleteFile && commitFile) {
      deleteFile(commitFile);
    }
  } catch {
    // Best effort - don't fail the entire operation for temp file cleanup
  }

  // Get the final commit hash
  const hash = execGit(['rev-parse', '--short', 'HEAD']).trim();

  // Delete the work branch (best effort - failure here doesn't invalidate the signed commit)
  try {
    execGit(['branch', '-D', branchName]);
  } catch (err) {
    // Branch deletion failed, but the signed commit succeeded.
    // Return success with a warning about the orphaned branch.
    const stderr = err?.stderr || err?.stdout || '';
    return {
      ok: true,
      hash,
      archiveBranch,
      archiveTipSha: tipSha,
      branch: baseBranch,
      warning: `Branch '${branchName}' could not be deleted (may be checked out elsewhere). ${stderr ? String(stderr).trim() : ''}`.trim(),
    };
  }

  return {
    ok: true,
    hash,
    archiveBranch,
    archiveTipSha: tipSha,
    branch: baseBranch,
  };
}
