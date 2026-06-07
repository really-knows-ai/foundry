import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL_PATH = resolve(REPO_ROOT, 'src/skills/list-agents/SKILL.md');

function readSkill() {
  return readFileSync(SKILL_PATH, 'utf8');
}

function parseFrontmatter(text) {
  const parsed = matter(text);
  return parsed;
}

const EXPECTED_LISTING_LINES = [
  'foundry-guide     — user-facing conversational orchestrator',
  'foundry-admin     — configuration management (invoked via task)',
  'foundry-forge     — artefact generation (auto-dispatched)',
  'foundry-appraise  — evaluation (auto-dispatched)',
  'foundry-assay     — memory population (auto-dispatched)',
];

describe('list-agents SKILL.md', () => {
  test('description matches expected string', () => {
    const text = readSkill();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.description,
      'Use when you need to see the five fixed Foundry agents and their roles.',
      'description must match the new static listing description'
    );
  });

  test('lists exactly five agents with their roles in the expected format', () => {
    const text = readSkill();
    for (const line of EXPECTED_LISTING_LINES) {
      assert.ok(
        text.includes(line),
        `skill must contain listing line: "${line}"`
      );
    }
  });

  test('protocol does not contain "glob", "frontmatter", or "model"', () => {
    const text = readSkill();
    const forbidden = ['glob', 'frontmatter', 'model'];
    for (const word of forbidden) {
      assert.ok(
        !text.includes(word),
        `skill protocol must not contain "${word}"`
      );
    }
  });

  test('does not contain "No foundry agent files found" fallback', () => {
    const text = readSkill();
    assert.ok(
      !text.includes('No foundry agent files found'),
      'skill must not contain the no-files-found fallback'
    );
  });
});
