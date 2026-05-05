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

export function createAttestationTools({ tool }) {
  return {
    foundry_attestation_show: tool({
      description: 'Show parsed attestation payload and human summary for a commit ref (default HEAD).',
      args: {
        ref: tool.schema.string().optional().describe('Git ref (default: HEAD)'),
      },
      async execute(args, context) {
        try {
          const ref = args.ref || 'HEAD';
          const cwd = context.worktree;
          
          // Read commit message
          const message = execFileSync(
            'git',
            ['log', '-1', '--pretty=%B', ref],
            { cwd, encoding: 'utf8', stdio: 'pipe' }
          );
          
          // Extract attestation block
          const json = extractAttestationBlock(message);
          
          // Parse payload
          let payload;
          try {
            payload = JSON.parse(json);
          } catch (err) {
            return errorJson(new Error(`malformed attestation JSON: ${json}`));
          }
          
          // Build human summary from commit message subject line
          const subjectLine = message.split('\n')[0];
          
          return JSON.stringify({
            ok: true,
            human_summary: subjectLine,
            payload,
          });
        } catch (err) {
          return errorJson(err);
        }
      },
    }),

    foundry_attestation_verify: tool({
      description: 'Verify GPG signature and attestation payload for a commit ref (default HEAD).',
      args: {
        ref: tool.schema.string().optional().describe('Git ref (default: HEAD)'),
      },
      async execute(args, context) {
        try {
          const ref = args.ref || 'HEAD';
          const cwd = context.worktree;
          
          const result = verifyAttestationRef({ cwd, ref });
          
          return JSON.stringify({
            ok: true,
            ...result,
          });
        } catch (err) {
          return errorJson(err);
        }
      },
    }),

    foundry_attest: tool({
      description:
        'Verify the current work cycle is complete (all required stages ran, no unresolved ' +
        'feedback, no blocked artefacts) and commit a signed ATTEST.md to the work branch. ' +
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
        const io = makeIO(cwd);

        const stageGuard = requireNoActiveStage(io);
        if (!stageGuard.ok) return refuse(`foundry_attest: ${stageGuard.error}`);

        const branch = currentBranch({ exec: makeExec(cwd) });
        if (!branch || !branch.startsWith('work/')) {
          return refuse(`foundry_attest: must be run on a work/* branch, current branch is '${branch}'`);
        }

        if (args.confirm !== true) {
          return JSON.stringify({
            ok: false,
            error: 'foundry_attest requires {confirm: true}. Re-invoke with confirm:true to write ATTEST.md.',
            planned: {
              action: 'verify-cycle, compute-diff-sha, write-ATTEST.md, commit',
              branch,
              baseBranch: args.baseBranch || 'main',
            },
          });
        }

        const baseBranch = args.baseBranch || 'main';

        const execGit = (argv) => {
          if (argv[0] === 'diff') {
            return execFileSync('git', argv, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
          }
          return execFileSync('git', argv, opts).toString();
        };

        const workText = readFileSync(path.join(cwd, 'WORK.md'), 'utf8');
        const frontmatter = parseFrontmatter(workText);
        const cycle = frontmatter.cycle ?? 'unknown';

        const tipSha = execFileSync('git', ['rev-parse', 'HEAD'], opts).trim();
        const archiveBranch = `archive/${branch}-${tipSha.slice(0, 7)}`;

        const result = await buildAttestation({
          cwd,
          baseBranch,
          goalText: args.message,
          archiveBranch,
          archiveTipSha: tipSha,
          io: {
            readFile: (p) => readFileSync(p, 'utf8'),
            fileExists: (p) => existsSync(p),
          },
          execGit,
        });

        if (!result.ok) {
          return JSON.stringify(result);
        }

        const attestPath = path.join(cwd, 'ATTEST.md');
        writeFileSync(attestPath, result.content, 'utf8');

        try {
          execFileSync('git', ['add', 'ATTEST.md'], opts);
          const commitMsg = `[${cycle}] attest: cycle complete`;
          execFileSync('git', ['commit', '--no-gpg-sign', '-m', commitMsg], opts);
        } catch (err) {
          try { execFileSync('git', ['reset', 'HEAD', 'ATTEST.md'], opts); } catch { /* best effort */ }
          try { unlinkSync(attestPath); } catch { /* best effort */ }
          const stderr = err?.stderr || err?.stdout || '';
          return JSON.stringify({
            ok: false,
            error: `foundry_attest: commit failed. ${String(stderr).trim()}`,
          });
        }

        const commitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();

        return JSON.stringify({ ok: true, diffSha: result.diffSha, commitSha });
      },
    }),
  };
}
