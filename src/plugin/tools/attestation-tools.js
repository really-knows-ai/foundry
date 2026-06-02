import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { extractAttestationBlock } from '../../scripts/lib/attestation/parse.js';
import { verifyAttestationRef } from '../../scripts/lib/attestation/verify.js';
import { buildAttestation } from '../../scripts/lib/attestation/attest.js';
import { parseFrontmatter } from '../../scripts/lib/workfile.js';
import { requireNoActiveStage } from '../../scripts/lib/stage-guard.js';
import { currentBranch } from '../../scripts/lib/branch-guard.js';
import { errorJson, makeIO, makeExec } from './helpers.js';

function refuse(error) { return JSON.stringify({ error }); }

function createShowTool(tool) {
  return tool({
    description: 'Show parsed attestation payload and human summary for a commit ref (default HEAD).',
    args: {
      ref: tool.schema.string().optional().describe('Git ref (default: HEAD)'),
    },
    async execute(args, context) {
      try {
        const ref = args.ref || 'HEAD';
        const cwd = context.worktree;
        const message = execFileSync('git', ['log', '-1', '--pretty=%B', ref],
          { cwd, encoding: 'utf8', stdio: 'pipe' }
        );
        const json = extractAttestationBlock(message);
        let payload;
        try {
          payload = JSON.parse(json);
        } catch {
          return errorJson(new Error(`malformed attestation JSON: ${json}`));
        }
        const subjectLine = message.split('\n')[0];
        return JSON.stringify({ ok: true, human_summary: subjectLine, payload });
      } catch (err) {
        return errorJson(err);
      }
    },
  });
}

function createVerifyTool(tool) {
  return tool({
    description: 'Verify GPG signature and attestation payload for a commit ref (default HEAD).',
    args: {
      ref: tool.schema.string().optional().describe('Git ref (default: HEAD)'),
    },
    async execute(args, context) {
      try {
        const ref = args.ref || 'HEAD';
        const cwd = context.worktree;
        const result = verifyAttestationRef({ cwd, ref });
        return JSON.stringify({ ok: true, ...result });
      } catch (err) {
        return errorJson(err);
      }
    },
  });
}

function guardStageAndBranch(cwd) {
  const io = makeIO(cwd);
  const stageGuard = requireNoActiveStage(io);
  if (!stageGuard.ok) {
    return { ok: false, error: `foundry_attest: ${stageGuard.error}` };
  }
  const branch = currentBranch({ exec: makeExec(cwd) });
  if (!branch || !branch.startsWith('work/')) {
    return { ok: false, error: `foundry_attest: must be run on a work/* branch, current branch is '${branch}'` };
  }
  return { ok: true, branch };
}

function refuseConfirm(branch, baseBranch) {
  return JSON.stringify({
    ok: false,
    error: 'foundry_attest requires {confirm: true}. Re-invoke with confirm:true to write ATTEST.md.',
    planned: {
      action: 'verify-cycle, compute-diff-sha, write-ATTEST.md, commit',
      branch,
      baseBranch: baseBranch || 'main',
    },
  });
}

function makeExecGit(cwd, opts) {
  return (argv) => {
    if (argv[0] === 'diff') {
      return execFileSync('git', argv, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    return execFileSync('git', argv, opts).toString();
  };
}

function readCycleFromWorkfile(cwd) {
  const workText = readFileSync(path.join(cwd, 'WORK.md'), 'utf8');
  const frontmatter = parseFrontmatter(workText);
  return frontmatter.cycle ?? 'unknown';
}

function gitRevParseHead(opts) {
  return execFileSync('git', ['rev-parse', 'HEAD'], opts).trim();
}

function commitErrorString(err) {
  const stderr = err.stderr ?? err.stdout ?? '';
  return `foundry_attest: commit failed. ${String(stderr).trim()}`;
}

function cleanupFailedCommit(attestPath, opts) {
  try { execFileSync('git', ['reset', 'HEAD', 'ATTEST.md'], opts); } catch { /* best effort */ }
  try { unlinkSync(attestPath); } catch { /* best effort */ }
}

function commitAttestation(cwd, cycle, content, opts) {
  const attestPath = path.join(cwd, 'ATTEST.md');
  writeFileSync(attestPath, content, 'utf8');
  try {
    execFileSync('git', ['add', 'ATTEST.md'], opts);
    const commitMsg = `[${cycle}] attest: cycle complete`;
    execFileSync('git', ['commit', '--no-gpg-sign', '-m', commitMsg], opts);
  } catch (err) {
    cleanupFailedCommit(attestPath, opts);
    return { ok: false, error: commitErrorString(err) };
  }
  const commitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
  return { ok: true, commitSha };
}

function readCoverageFile(cwd, cycleId) {
  const coveragePath = path.join(cwd, 'foundry/.stage/.coverage-' + cycleId + '.json');
  if (!existsSync(coveragePath)) return undefined;
  const raw = JSON.parse(readFileSync(coveragePath, 'utf8'));
  const coverage = new Map();
  for (const entry of raw) {
    coverage.set(entry.unitId, {
      unitId: entry.unitId,
      group: entry.group,
      mode: entry.mode,
      law: entry.law ?? null,
      evaluations: entry.evaluations,
      violations: entry.violations,
    });
  }
  return coverage;
}

function buildAttestationInputs(opts) {
  const coverage = readCoverageFile(opts.cwd, opts.cycleId);
  return {
    cwd: opts.cwd,
    foundryDir: 'foundry',
    baseBranch: opts.baseBranch,
    branchBaseSha: opts.branchBaseSha,
    goalText: opts.goalText,
    archiveBranch: opts.archiveBranch,
    archiveTipSha: opts.archiveTipSha,
    io: {
      readFile: (p) => readFileSync(p, 'utf8'),
      fileExists: (p) => existsSync(p),
      exists: (p) => existsSync(p),
      exec: (args) => execFileSync(args[0], args.slice(1), { cwd: opts.cwd, encoding: 'utf8' }),
    },
    execGit: opts.execGit,
    coverage,
  };
}

function handleBuildResult(result, cwd, cycle, opts) {
  if (!result.ok) return JSON.stringify(result);
  const commitResult = commitAttestation(cwd, cycle, result.content, opts);
  if (!commitResult.ok) return JSON.stringify(commitResult);
  return JSON.stringify({ ok: true, diffSha: result.diffSha, commitSha: commitResult.commitSha });
}

function createAttestTool(tool) {
  return tool({
    description:
      'Verify the current work cycle is complete (all required stages ran, no unresolved ' +
      'feedback) and commit an ATTEST.md attestation file to the work branch. ' +
      'foundry_git_finish will not merge without this commit at HEAD.',
    args: {
      baseBranch: tool.schema.string().optional()
        .describe('Branch to compute diff from (default: main)'),
      message: tool.schema.string()
        .describe('Goal text / human summary for the attestation'),
      confirm: tool.schema.boolean().optional()
        .describe('Must be true to write and commit ATTEST.md'),
    },
    async execute(args, context) {
      const cwd = context.worktree;
      const opts = { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };
      const guard = guardStageAndBranch(cwd);
      if (!guard.ok) return refuse(guard.error);
      if (args.confirm !== true) return refuseConfirm(guard.branch, args.baseBranch);
      const baseBranch = args.baseBranch || 'main';
      const execGit = makeExecGit(cwd, opts);
      const cycle = readCycleFromWorkfile(cwd);
      const tipSha = gitRevParseHead(opts);
      const archiveBranch = `archive/${guard.branch}-${tipSha.slice(0, 7)}`;
      const inputs = buildAttestationInputs({
        cwd, baseBranch, goalText: args.message,
        archiveBranch, archiveTipSha: tipSha, execGit,
        cycleId: cycle,
      });
      const result = await buildAttestation(inputs);
      return handleBuildResult(result, cwd, cycle, opts);
    },
  });
}

export function createAttestationTools({ tool }) {
  return {
    foundry_attestation_show: createShowTool(tool),
    foundry_attestation_verify: createVerifyTool(tool),
    foundry_attest: createAttestTool(tool),
  };
}
