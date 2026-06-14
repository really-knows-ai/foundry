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
