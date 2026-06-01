import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FoundryPlugin } from './src/plugin/foundry.js';

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const root = mkdtempSync(join(tmpdir(), 'quench-debug-'));

try {
  execSync('git init -q', { cwd: root, env: GIT_ENV });
  execSync('git checkout -B main -q', { cwd: root, env: GIT_ENV });
  writeFileSync(join(root, '.gitignore'), '.foundry/\n.snapshots/\n');
  writeFileSync(join(root, 'README.md'), 'baseline\n');
  execSync('git add . && git commit -m init -q', { cwd: root, env: GIT_ENV });

  mkdirSync(join(root, 'foundry/flows'), { recursive: true });
  writeFileSync(join(root, 'foundry/flows/haiku.md'), '---\nstart: write-haiku\n---\n# Haiku Flow\n');
  
  mkdirSync(join(root, 'foundry/cycles'), { recursive: true });
  writeFileSync(join(root, 'foundry/cycles/write-haiku.md'),
    '---\noutput-type: haiku\nstages: [forge, quench, appraise]\nmax-iterations: 3\nalways-human-appraise: false\nmodels:\n  forge: opencode-go/deepseek-v4-flash\n  appraise: opencode-go/deepseek-v4-flash\n---\n# Write Haiku\n');
  
  mkdirSync(join(root, 'foundry/artefacts/haiku'), { recursive: true });
  writeFileSync(join(root, 'foundry/artefacts/haiku/definition.md'), '---\ntype: haiku\nfile-patterns: ["haikus/*.md"]\n---\n');

  writeFileSync(join(root, 'foundry/artefacts/haiku/validate-fail.sh'), '#!/usr/bin/env bash\nexit 1\n');
  execSync('chmod +x ' + join(root, 'foundry/artefacts/haiku/validate-fail.sh'), { shell: true });

  mkdirSync(join(root, 'foundry/laws'), { recursive: true });
  writeFileSync(join(root, 'foundry/laws/shape.md'),
    '## shape\n\nHaikus must follow 5-7-5 syllable structure.\n\nvalidators:\n  - id: shape-checker\n    command: ./foundry/artefacts/haiku/validate-fail.sh\n');

  execSync('git checkout -q -b work/haiku-quench', { cwd: root, env: GIT_ENV });
  execSync('git add . && git commit -m "add haiku flow" -q', { cwd: root, env: GIT_ENV });

  mkdirSync(join(root, 'haikus'), { recursive: true });
  writeFileSync(join(root, 'haikus/test.md'), 'sausages and eggs\n');
  execSync('git add . && git commit -m "add haiku" -q', { cwd: root, env: GIT_ENV });

  const client = {
    session: { create: async () => ({ id: 's1' }), prompt: async () => ({ ok: true }), messages: async () => [] },
    config: { providers: async () => [] },
    provider: { list: () => ({ connected: [] }) },
  };

  console.log('creating plugin...');
  const plugin = await FoundryPlugin({ directory: root, client });
  console.log('running foundry_run...');
  const startTime = Date.now();
  const result = JSON.parse(await plugin.tool.foundry_run.execute(
    { flow: 'haiku', goal: 'test' },
    { worktree: root, sessionID: 'main-session' },
  ));
  console.log('RESULT after', Date.now()-startTime, 'ms:', JSON.stringify(result));
  
  // Check for feedback file
  const feedbackPath = join(root, 'WORK.feedback.yaml');
  if (existsSync(feedbackPath)) {
    console.log('FEEDBACK:', readFileSync(feedbackPath, 'utf8'));
  } else {
    console.log('NO WORK.feedback.yaml');
  }
} catch(err) {
  console.error('ERROR:', err.message);
} finally {
  execSync('rm -rf ' + root, { shell: true });
}
