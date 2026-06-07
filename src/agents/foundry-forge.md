---
description: "Generate artefacts for forge stages"
permission:
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
  foundry_config_cycle: allow
  foundry_config_artefact_type: allow
  foundry_config_laws: allow
  "*": deny
---
