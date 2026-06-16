import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADMIN_PATH = resolve(REPO_ROOT, 'src/agents/foundry-admin.md');

function readAdmin() {
  return readFileSync(ADMIN_PATH, 'utf8');
}

function parseFrontmatter(text) {
  return matter(text);
}

describe('foundry-admin.md frontmatter — git tools prohibited', () => {
  test('admin must not have foundry_git_branch permission', () => {
    const text = readAdmin();
    const parsed = parseFrontmatter(text);
    assert.notEqual(
      parsed.data.permission?.foundry_git_branch,
      'allow',
      'foundry_git_branch must not be allow for admin'
    );
  });

  test('admin must not have foundry_git_finish permission', () => {
    const text = readAdmin();
    const parsed = parseFrontmatter(text);
    assert.notEqual(
      parsed.data.permission?.foundry_git_finish,
      'allow',
      'foundry_git_finish must not be allow for admin'
    );
  });

  test('admin must have bash: deny', () => {
    const text = readAdmin();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.bash,
      'deny',
      'bash must be deny for admin'
    );
  });
});

describe('foundry-admin.md frontmatter — new config tools permitted', () => {
  test('admin must have foundry_config_write_file permission', () => {
    const text = readAdmin();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_config_write_file,
      'allow',
      'foundry_config_write_file must be allow for admin'
    );
  });

  test('admin must have foundry_config_add_dependency permission', () => {
    const text = readAdmin();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_config_add_dependency,
      'allow',
      'foundry_config_add_dependency must be allow for admin'
    );
  });

  test('admin must have foundry_config_git_log permission', () => {
    const text = readAdmin();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_config_git_log,
      'allow',
      'foundry_config_git_log must be allow for admin'
    );
  });

  test('admin must have foundry_config_run_validator permission', () => {
    const text = readAdmin();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_config_run_validator,
      'allow',
      'foundry_config_run_validator must be allow for admin'
    );
  });

  test('admin must have foundry_config_run_validator_test permission', () => {
    const text = readAdmin();
    const parsed = parseFrontmatter(text);
    assert.equal(
      parsed.data.permission?.foundry_config_run_validator_test,
      'allow',
      'foundry_config_run_validator_test must be allow for admin'
    );
  });
});

describe('foundry-admin.md prompt body — git lifecycle prohibitions', () => {
  test('admin prompt does not instruct use of foundry_git_branch', () => {
    const text = readAdmin();
    assert.ok(
      !text.includes('foundry_git_branch'),
      'admin prompt must not contain foundry_git_branch'
    );
  });

  test('admin prompt does not instruct use of foundry_git_finish', () => {
    const text = readAdmin();
    assert.ok(
      !text.includes('foundry_git_finish'),
      'admin prompt must not contain foundry_git_finish'
    );
  });

  test('admin prompt states guide owns branch lifecycle', () => {
    const text = readAdmin();
    const pattern = /guide.*(branch lifecycle|branch context|supplies.*branch)/i;
    assert.ok(
      pattern.test(text),
      'admin prompt must state guide owns branch lifecycle'
    );
  });

  test('admin prompt states admin assumes correct branch', () => {
    const text = readAdmin();
    const pattern = /assume.*(correct |current ).*branch|already on the correct branch/i;
    assert.ok(
      pattern.test(text),
      'admin prompt must state admin assumes correct branch'
    );
  });

  test('admin prompt states admin never finishes or merges branches', () => {
    const text = readAdmin();
    const pattern = /never.*(finish|merge|delete|switch).*branch|must not.*(finish|merge|delete|switch).*branch/i;
    assert.ok(
      pattern.test(text),
      'admin prompt must state admin never finishes or merges branches'
    );
  });

  test('admin prompt instructs to report errors as blockers', () => {
    const text = readAdmin();
    const pattern = /(report|stop).*(error|blocker|precondition)/i;
    assert.ok(
      pattern.test(text),
      'admin prompt must instruct to report errors as blockers'
    );
  });
});
