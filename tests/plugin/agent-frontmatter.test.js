// tests/plugin/agent-frontmatter.test.js
// Verifies that each agent markdown file has valid frontmatter with
// correct description, permission tables, and mode field.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
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

/**
 * Returns the list of tool names that are expected to have `"allow"` as
 * their value in each agent's permission table (excluding `"*"` and any
 * keys that map to a nested pattern object or `"deny"`).
 */
function specPermittedTools(agentName) {
  const tables = {
    'foundry-guide': [
      'read', 'glob', 'grep', 'list', 'question', 'skill', 'webfetch', 'task',
      'foundry_run', 'foundry_continue', 'foundry_stage_retry',
      'foundry_git_branch', 'foundry_git_finish',
      'foundry_config_read_appraisers', 'foundry_config_read_artefact_type',
      'foundry_config_read_cycle', 'foundry_config_read_flow', 'foundry_config_read_laws',
      'foundry_config_read_law', 'foundry_workfile_get', 'foundry_feedback_list',
      'foundry_models_list', 'foundry_snapshot_list', 'foundry_snapshot_show',
      'foundry_attestation_show', 'foundry_attestation_verify',
    ],
    'foundry-admin': [
      'read', 'glob', 'grep', 'list',
      'foundry_config_create_artefact_type', 'foundry_config_create_appraiser',
      'foundry_config_create_flow', 'foundry_config_create_cycle',
      'foundry_config_validate_artefact_type', 'foundry_config_validate_law',
      'foundry_config_validate_appraiser', 'foundry_config_validate_flow',
      'foundry_config_validate_cycle', 'foundry_config_read_law',
      'foundry_config_add_law', 'foundry_config_edit_law',
      'foundry_config_read_cycle', 'foundry_config_read_artefact_type',
      'foundry_config_read_laws', 'foundry_config_read_flow', 'foundry_config_read_appraisers',
      'foundry_workfile_get', 'foundry_workfile_create', 'foundry_workfile_delete',
      'foundry_git_branch', 'foundry_git_finish', 'foundry_models_list',
      'foundry_memory_get', 'foundry_memory_list', 'foundry_memory_neighbours',
      'foundry_memory_query', 'foundry_memory_search', 'foundry_memory_put',
      'foundry_memory_relate', 'foundry_memory_unrelate',
      'foundry_memory_create_entity_type', 'foundry_memory_create_edge_type',
      'foundry_memory_rename_entity_type', 'foundry_memory_rename_edge_type',
      'foundry_memory_drop_entity_type', 'foundry_memory_drop_edge_type',
      'foundry_memory_reset', 'foundry_memory_validate', 'foundry_memory_init',
      'foundry_memory_dump', 'foundry_memory_vacuum',
      'foundry_memory_change_embedding_model',
      'foundry_memory_extractor_create',
      'foundry_snapshot_list', 'foundry_snapshot_show', 'foundry_snapshot_delete',
      'foundry_snapshot_prune',
      'foundry_attestation_show', 'foundry_attestation_verify', 'foundry_attest',
    ],
    'foundry-forge': [
      'read', 'glob', 'grep', 'list',
      'foundry_stage_begin', 'foundry_stage_end', 'foundry_stage_output',
      'foundry_workfile_get', 'foundry_config_read_cycle',
      'foundry_config_read_artefact_type', 'foundry_config_read_laws',
    ],
    'foundry-appraise': [
      'read', 'glob', 'grep', 'list',
      'foundry_stage_begin', 'foundry_stage_end', 'foundry_stage_output',
      'foundry_artefact_list', 'foundry_config_read_artefact_type',
    ],
    'foundry-assay': [
      'read', 'glob', 'grep', 'list',
      'foundry_stage_begin', 'foundry_stage_end', 'foundry_assay_run',
      'foundry_workfile_get', 'foundry_config_read_cycle',
    ],
  };
  return tables[agentName] || [];
}

describe('agent frontmatter — T1.1: valid frontmatter with description and permission', () => {
  for (const name of AGENT_NAMES) {
    test(`${name} has valid frontmatter with description and permission`, () => {
      const filePath = join(AGENTS_DIR, `${name}.md`);
      const raw = readFileSync(filePath, 'utf8');
      const parsed = matter(raw);

      assert.ok(parsed.data, `${name}: frontmatter data must exist`);
      assert.equal(typeof parsed.data.description, 'string', `${name}: description must be a string`);
      assert.ok(parsed.data.description.length > 0, `${name}: description must be non-empty`);
      assert.ok(parsed.data.permission, `${name}: permission must exist`);
      assert.equal(typeof parsed.data.permission, 'object', `${name}: permission must be an object`);
      assert.equal(parsed.data.permission['*'], 'deny', `${name}: "*" must map to "deny"`);

      if (name === 'foundry-guide') {
        assert.equal(parsed.data.mode, 'primary', `${name}: must have mode: primary`);
      } else {
        assert.equal(parsed.data.mode, undefined, `${name}: must not have mode`);
      }
    });
  }
});

describe('agent frontmatter — T1.2: permitted tools present', () => {
  for (const name of AGENT_NAMES) {
    test(`${name} includes all spec-defined permitted tools`, () => {
      const filePath = join(AGENTS_DIR, `${name}.md`);
      const raw = readFileSync(filePath, 'utf8');
      const parsed = matter(raw);
      const perm = parsed.data.permission;
      const expected = specPermittedTools(name);

      for (const tool of expected) {
        assert.equal(perm[tool], 'allow', `${name}: "${tool}" must be "allow"`);
      }
    });
  }
});

describe('agent frontmatter — T1.3: catch-all deny rule', () => {
  for (const name of AGENT_NAMES) {
    if (name === 'foundry-guide') {
      test('foundry-guide: "*" is the last permission key', () => {
        const filePath = join(AGENTS_DIR, 'foundry-guide.md');
        const raw = readFileSync(filePath, 'utf8');
        const parsed = matter(raw);
        const keys = Object.keys(parsed.data.permission);
        const lastKey = keys[keys.length - 1];
        assert.equal(lastKey, '*', 'foundry-guide: last permission key must be "*", got "' + lastKey + '"');
      });
    } else {
      test(`${name}: "*" is the first permission key`, () => {
        const filePath = join(AGENTS_DIR, `${name}.md`);
        const raw = readFileSync(filePath, 'utf8');
        const parsed = matter(raw);
        const keys = Object.keys(parsed.data.permission);
        const firstKey = keys[0];
        assert.equal(firstKey, '*', `${name}: first permission key must be "*", got "${firstKey}"`);
      });
    }
  }
});
