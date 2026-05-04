import { execFileSync } from 'node:child_process';
import { extractAttestationBlock } from '../../scripts/lib/attestation/parse.js';
import { verifyAttestationRef } from '../../scripts/lib/attestation/verify.js';
import { errorJson } from './helpers.js';

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
  };
}
