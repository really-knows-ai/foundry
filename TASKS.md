# Tasks

## Tool renames

- [x] Rename `foundry_run` → `foundry_cycle_run`
- [x] Rename `foundry_continue` → `foundry_cycle_continue`
- [x] Rename `foundry_memory_neighbours` → `foundry_memory_traverse`
- [x] Rename `foundry_memory_extractor_create` → `foundry_memory_create_extractor`
- [x] Rename `foundry_memory_change_embedding_model` → `foundry_memory_reembed`

## Feedback-driven forge dispatch

The forge contract (`forge-contract.js`) correctly handles transitioning feedback items to `actioned` or `wont-fix` when the forge sub-agent addresses them. But the orchestration (`run-executors.js`) always dispatches forge with `forgeItem: null` and passes `item: null` to the contract — so feedback transitions never actually happen. The pieces are written but not wired together.

- [x] Wire the sort/route logic to select the next open feedback item for a cycle
- [x] Pass the selected feedback item into the forge dispatch prompt as context
- [x] Pass the item into `enforceForgeContract` so transitions execute on version change or wont-fix
- [x] Remove dead feedback tools: `foundry_feedback_add`, `foundry_feedback_action`, `foundry_feedback_wontfix`, `foundry_feedback_resolve`

## Quench → resolved (existing behaviour, must not break)

Quench already handles the version-change → stale → new-feedback cycle correctly via three steps in `quench-module.js`:

1. `resolveStaleQuenchFeedback` — when the artefact version changes, auto-resolves old quench items as `"superseded by forge revision X"`
2. `postFeedbackItems` — posts new validator violations as feedback, skipping duplicates in actioned/wont-fix/resolved state
3. `resolvePriorFeedback` — prior quench items that still appear in current validator output → `rejected`; items that no longer appear → `approved` (resolved)

- [x] Verify that the forge feedback wiring changes do not break this behaviour (Phase 03 quench verification)

## Appraise → resolve/reject addressed feedback

After forge addresses a feedback item (→ actioned/wont-fix), each appraiser should be presented with the addressed item in sequence and assess whether it is resolved or rejected:

- Resolved → no new feedback, item transitions to terminal `resolved`
- Rejected → appraiser provides new feedback, item transitions to `rejected` (forge retries)

Cycle-level config for how consensus is reached (unanimous, majority, etc.). The orchestration system gathers appraiser verdicts and updates the feedback item — no agent tools needed for the transitions themselves.

- [x] Present each addressed feedback item to each appraiser in sequence during appraise (via address prompt builder)
- [x] Gather resolved/rejected verdicts from appraisers via stage_output (via collectVerdicts)
- [x] Apply consensus config to determine overall resolved/rejected outcome (via computeConsensus)
- [x] Transition feedback items based on the consensus result (via processAddressedItem)

## Human-appraise redesign

Two distinct scenarios triggered by cycle configuration:

**1. Deadlocked cycle** (`deadlock-human-appraise: true`) — there IS outstanding feedback that couldn't be resolved automatically. The user is presented with all unresolved feedback items (including their full history and argument context) and must make a resolution decision (resolve/reject each item) or add their own feedback.

**2. Always human appraise** (`always-human-appraise: true`) — the cycle has human appraise enabled but there is NO outstanding feedback (it wouldn't reach this point if there were). The user reviews the artefact change and can approve (no feedback) or reject with free-form feedback.

- [ ] Implement deadlock scenario: present all unresolved items with history, accept user resolution per item
- [ ] Wire deadlock override transitions: human → resolved/rejected on deadlocked items
- [ ] Implement always-human-appraise scenario: present artefact, accept approve/reject with optional feedback
- [ ] Remove the approval word heuristic (`looks good`, `approved`, etc.) — explicit actions only

## Per-stage attestation

Move attestation from cycle-level to stage-level. Each stage (assay, forge, quench, appraise, human-appraise) produces its own attestation when it completes, recording evaluations, violations, and derived status for that stage.

- `foundry_stage_attest` — attests a single stage on completion
- `foundry_cycle_attest` — merges all stage attestations into a composite cycle-level attestation
