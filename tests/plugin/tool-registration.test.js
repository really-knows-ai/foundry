import { test } from 'node:test';
import assert from 'node:assert';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

// Snapshot of the plugin's full public tool registration. This catches
// accidental additions or removals of registered tools — both are
// public-API changes that must be intentional.
//
// If this test fails, the public tool API changed — update the snapshot
// intentionally (and consider whether docs/skills need updating too).
const EXPECTED_TOOLS = [
  'foundry_artefact_list',
  'foundry_assay_run',
  'foundry_attestation_show',
  'foundry_attestation_verify',
  'foundry_config_add_law',
  'foundry_config_create_appraiser',
  'foundry_config_create_artefact_type',
  'foundry_config_create_cycle',
  'foundry_config_create_flow',
  'foundry_config_edit_law',
  'foundry_config_read_appraisers',
  'foundry_config_read_artefact_type',
  'foundry_config_read_cycle',
  'foundry_config_read_flow',
  'foundry_config_read_law',
  'foundry_config_read_laws',
  'foundry_config_run_command',
  'foundry_config_validate_appraiser',
  'foundry_config_validate_artefact_type',
  'foundry_config_validate_cycle',
  'foundry_config_validate_flow',
  'foundry_config_validate_law',
  'foundry_cycle_continue',
  'foundry_cycle_run',
  'foundry_feedback_list',
  'foundry_git_branch',
  'foundry_git_finish',
  'foundry_history_list',
  'foundry_memory_create_edge_type',
  'foundry_memory_create_entity_type',
  'foundry_memory_create_extractor',
  'foundry_memory_drop_edge_type',
  'foundry_memory_drop_entity_type',
  'foundry_memory_dump',
  'foundry_memory_get',
  'foundry_memory_init',
  'foundry_memory_list',
  'foundry_memory_put',
  'foundry_memory_query',
  'foundry_memory_reembed',
  'foundry_memory_relate',
  'foundry_memory_rename_edge_type',
  'foundry_memory_rename_entity_type',
  'foundry_memory_reset',
  'foundry_memory_search',
  'foundry_memory_traverse',
  'foundry_memory_unrelate',
  'foundry_memory_vacuum',
  'foundry_memory_validate',
  'foundry_models_list',
  'foundry_snapshot_delete',
  'foundry_snapshot_list',
  'foundry_snapshot_prune',
  'foundry_snapshot_show',
  'foundry_stage_begin',
  'foundry_stage_end',
  'foundry_stage_output',
  'foundry_stage_retry',
  'foundry_validate_run',
  'foundry_workfile_create',
  'foundry_workfile_delete',
  'foundry_workfile_get',
];

test('plugin registers exactly the expected public tool set', async () => {
  const plugin = await FoundryPlugin({ directory: process.cwd() });
  const actual = Object.keys(plugin.tool).sort();

  const added = actual.filter(t => !EXPECTED_TOOLS.includes(t));
  const removed = EXPECTED_TOOLS.filter(t => !actual.includes(t));

  assert.deepStrictEqual(
    actual,
    EXPECTED_TOOLS,
    `Public tool registration drifted from snapshot.\n` +
      `  Added (unexpected):   ${JSON.stringify(added)}\n` +
      `  Removed (missing):    ${JSON.stringify(removed)}\n` +
      `If this change is intentional, update EXPECTED_TOOLS in this test.`
  );
});

test('foundry_attest is absent from the registered tool set', async () => {
  const plugin = await FoundryPlugin({ directory: process.cwd() });
  const toolNames = Object.keys(plugin.tool);
  assert.ok(!toolNames.includes('foundry_attest'), 'foundry_attest must not be registered');
});
