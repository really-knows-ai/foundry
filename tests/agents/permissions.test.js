import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTS_DIR = join(REPO_ROOT, 'src', 'agents');

const AGENT_NAMES = [
  'foundry-guide',
  'foundry-admin',
  'foundry-forge',
  'foundry-appraise',
  'foundry-assay',
];

function readAgent(name) {
  return readFileSync(join(AGENTS_DIR, `${name}.md`), 'utf8');
}

function parseFrontmatter(text) {
  return matter(text);
}

function getBody(text) {
  const parsed = matter(text);
  return parsed.content;
}

describe('guide permissions', () => {
  const name = 'foundry-guide';

  test('guide has foundry_git_branch: allow', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_git_branch,
      'allow',
      'guide must have foundry_git_branch: allow'
    );
  });

  test('guide has foundry_git_finish: allow', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_git_finish,
      'allow',
      'guide must have foundry_git_finish: allow'
    );
  });

  test('guide has bash: deny', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.bash,
      'deny',
      'guide must have bash: deny'
    );
  });

  test('guide has edit: deny', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.edit,
      'deny',
      'guide must have edit: deny'
    );
  });
});

describe('forge permissions', () => {
  const name = 'foundry-forge';

  test('forge must not have foundry_git_branch', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.notEqual(
      parsed.data.permission?.foundry_git_branch,
      'allow',
      'forge must not have foundry_git_branch: allow'
    );
  });

  test('forge must not have foundry_git_finish', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.notEqual(
      parsed.data.permission?.foundry_git_finish,
      'allow',
      'forge must not have foundry_git_finish: allow'
    );
  });

  test('forge has bash: deny', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.bash,
      'deny',
      'forge must have bash: deny'
    );
  });

  test('forge prompt does not mention git tools', () => {
    const text = readAgent(name);
    assert.ok(
      !text.includes('foundry_git_branch'),
      'forge prompt must not contain foundry_git_branch'
    );
    assert.ok(
      !text.includes('foundry_git_finish'),
      'forge prompt must not contain foundry_git_finish'
    );
  });
});

describe('appraise permissions', () => {
  const name = 'foundry-appraise';

  test('appraise must not have foundry_git_branch', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.notEqual(
      parsed.data.permission?.foundry_git_branch,
      'allow',
      'appraise must not have foundry_git_branch: allow'
    );
  });

  test('appraise must not have foundry_git_finish', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.notEqual(
      parsed.data.permission?.foundry_git_finish,
      'allow',
      'appraise must not have foundry_git_finish: allow'
    );
  });

  test('appraise has bash: deny', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.bash,
      'deny',
      'appraise must have bash: deny'
    );
  });

  test('appraise prompt does not mention git tools', () => {
    const text = readAgent(name);
    assert.ok(
      !text.includes('foundry_git_branch'),
      'appraise prompt must not contain foundry_git_branch'
    );
    assert.ok(
      !text.includes('foundry_git_finish'),
      'appraise prompt must not contain foundry_git_finish'
    );
  });
});

describe('assay permissions', () => {
  const name = 'foundry-assay';

  test('assay must not have foundry_git_branch', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.notEqual(
      parsed.data.permission?.foundry_git_branch,
      'allow',
      'assay must not have foundry_git_branch: allow'
    );
  });

  test('assay must not have foundry_git_finish', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.notEqual(
      parsed.data.permission?.foundry_git_finish,
      'allow',
      'assay must not have foundry_git_finish: allow'
    );
  });

  test('assay has explicit bash: deny', () => {
    const text = readAgent(name);
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.bash,
      'deny',
      'assay must have bash: deny'
    );
  });

  test('assay prompt does not mention git tools', () => {
    const text = readAgent(name);
    assert.ok(
      !text.includes('foundry_git_branch'),
      'assay prompt must not contain foundry_git_branch'
    );
    assert.ok(
      !text.includes('foundry_git_finish'),
      'assay prompt must not contain foundry_git_finish'
    );
  });
});

describe('all five agents — no stale unavailable-tool instructions', () => {
  for (const name of AGENT_NAMES) {
    test(`${name} prompt body does not contain bash instructions`, () => {
      const text = readAgent(name);
      const body = getBody(text);
      // Allow prohibition wording such as "must not use shell access" or "shell access is denied"
      // but flag active instructions that present shell access as available
      const activeBashPatterns = [
        /\bshell access\b(?!.*(?:denied|deny|prohibited|must not|not available))/i,
        /\b(?:use|run|call)\s+`?bash`?\b/i,
      ];
      // Exclude code-fenced examples
      const lines = body.split('\n');
      let inFence = false;
      for (const line of lines) {
        if (/^```/.test(line.trim())) {
          inFence = !inFence;
          continue;
        }
        if (inFence) continue;
        for (const pattern of activeBashPatterns) {
          const match = pattern.test(line);
          if (match) {
            // Check if it's a prohibition pattern
            const isProhibition = /must not|denied|prohibit|not (available|permitted)/i.test(line);
            if (!isProhibition) {
              assert.fail(`${name} prompt body must not present bash as an active instruction: "${line.trim()}"`);
            }
          }
        }
      }
    });

    test(`${name} prompt body does not contain manual git commands`, () => {
      const text = readAgent(name);
      const body = getBody(text);
      const gitCommands = [
        'git checkout',
        'git merge',
        'git branch',
        'git commit',
        'git push',
        'git pull',
        'git rebase',
      ];
      const lines = body.split('\n');
      let inFence = false;
      for (const line of lines) {
        if (/^```/.test(line.trim())) {
          inFence = !inFence;
          continue;
        }
        if (inFence) continue;
        for (const cmd of gitCommands) {
          if (line.toLowerCase().includes(cmd)) {
            assert.fail(`${name} prompt body must not contain "${cmd}": "${line.trim()}"`);
          }
        }
      }
    });
  }
});
