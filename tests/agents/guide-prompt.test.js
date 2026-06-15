import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUIDE_PATH = resolve(REPO_ROOT, 'src/agents/foundry-guide.md');

function readGuide() {
  return readFileSync(GUIDE_PATH, 'utf8');
}

function parseFrontmatter(text) {
  const parsed = matter(text);
  return parsed;
}

function getBody(text) {
  const parsed = matter(text);
  return parsed.content;
}

describe('foundry-guide.md prompt body', () => {
  test('describes admin delegation without pseudo-call syntax', () => {
    const text = readGuide();
    assert.ok(
      text.includes('delegate to the admin agent through the task tool'),
      'guide prompt must describe admin delegation through the task tool'
    );
    assert.ok(
      !text.includes('task({'),
      'guide prompt must not include pseudo-call syntax that the model can print as prose'
    );
  });

  test('does not contain forbidden config-editing patterns in the prompt body', () => {
    const text = readGuide();
    const forbidden = [
      'edit config',
      'edit .opencode/',
      'edit foundry/',
      'writeFile',
      'config write',
      'admin tool',
    ];
    for (const pattern of forbidden) {
      assert.ok(
        !text.includes(pattern),
        `guide prompt must not contain "${pattern}"`
      );
    }
  });

  test('contains all four sub-agent names in the prompt body', () => {
    const text = readGuide();
    const agents = ['foundry-admin', 'foundry-forge', 'foundry-appraise', 'foundry-assay'];
    for (const agent of agents) {
      assert.ok(
        text.includes(agent),
        `guide prompt must contain "${agent}"`
      );
    }
  });

  test('does not contain refresh-agents', () => {
    const text = readGuide();
    assert.ok(
      !text.includes('refresh-agents'),
      'guide prompt must not contain refresh-agents'
    );
  });

  test('has mode: primary in frontmatter', () => {
    const text = readGuide();
    const parsed = parseFrontmatter(text);
    assert.equal(parsed.data.mode, 'primary', 'frontmatter must have mode: primary');
  });

  test('has a description in frontmatter', () => {
    const text = readGuide();
    const parsed = parseFrontmatter(text);
    assert.ok(
      parsed.data.description && parsed.data.description.length > 0,
      'frontmatter must have a non-empty description'
    );
  });
});

describe('guide lifecycle ownership', () => {
  test('guide frontmatter has foundry_git_branch: allow', () => {
    const text = readGuide();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_git_branch,
      'allow',
      'guide frontmatter must have foundry_git_branch: allow'
    );
  });

  test('guide frontmatter has foundry_git_finish: allow', () => {
    const text = readGuide();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_git_finish,
      'allow',
      'guide frontmatter must have foundry_git_finish: allow'
    );
  });

  test('guide prompt states guide owns branch lifecycle', () => {
    const text = readGuide();
    const body = getBody(text);
    const pattern = /(own|responsible for).*(branch lifecycle|branch.*decision|config branch|git branch)/i;
    assert.ok(
      pattern.test(body),
      'guide prompt must state guide owns branch lifecycle'
    );
  });

  test('guide prompt describes admin delegation return contract', () => {
    const text = readGuide();
    const body = getBody(text);
    const returnItems = /(path|sha|commit hash|validation output|command log|blocker)/i;
    assert.ok(
      returnItems.test(body),
      'guide prompt must describe what admin delegation returns (paths, SHAs, validation output, command logs, or blockers)'
    );
  });

  test('guide prompt identifies unexpected admin branch finishing as stop condition', () => {
    const text = readGuide();
    const body = getBody(text);
    const pattern = /(unexpected|unexpectedly).*admin.*(branch|finish)|admin.*(branch|finish).*(stop|report)/i;
    assert.ok(
      pattern.test(body),
      'guide prompt must mention unexpected admin branch behaviour as a stop or report condition'
    );
  });

  test('guide prompt describes verification of branch and dirty state', () => {
    const text = readGuide();
    const body = getBody(text);
    const pattern = /(verify|check).*(branch|dirty).*(state|status|tree)/i;
    assert.ok(
      pattern.test(body),
      'guide prompt must describe verifying branch or dirty state when delegated results affect workflow'
    );
  });
});
