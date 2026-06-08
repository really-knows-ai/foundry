---
description: "Generate artefacts for forge stages"
permission:
  "*": deny
  read: allow
  glob: allow
  grep: allow
  list: allow
  edit:
    "*": allow
    "foundry/**": deny
  bash: deny
  foundry_stage_begin: allow
  foundry_stage_end: allow
  foundry_stage_output: allow
  foundry_workfile_get: allow
  foundry_config_read_cycle: allow
  foundry_config_read_artefact_type: allow
  foundry_config_read_laws: allow
---
