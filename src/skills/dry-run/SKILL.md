---
name: dry-run
type: atomic
description: Trial-run a flow against in-progress config on a dry-run/<x>/<y> branch; finish writes a forensic snapshot and discards the branch.
---

# Dry-run

You help the user trial in-progress config changes against a real flow,
without merging the config or polluting the config branch's history.

## When to use

The user is on a `config/<x>` branch with edits in progress (a new law, a
modified flow, a fresh appraiser, etc.) and wants to see how a flow
behaves under those changes — without merging, and without leaving WORK
files or memory rows behind on `config/<x>`.

## Prerequisites

1. Current branch is `config/<x>` (single segment, not nested).
2. Working tree is clean.
3. The flow id and a one-line description of the goal are known.

If on `main`, edit on a `config/<x>` branch first. If configuration
changes are needed, move to a suitable `config/*` branch internally
when the current branch is safe. If the current branch is `work/*` or
`dry-run/*/*`, stop and explain the active work must be finished first.

## Protocol

### 1. Branch into dry-run mode

The assistant creates a `dry-run/<x>/<flow>-<purpose>` branch and
truncates the trace file. From here every internal tool call is logged
to `.foundry/trace/<branch-slug>.jsonl`.

### 2. Run the flow

Use the `flow` skill (or call `foundry_orchestrate` directly) to drive
the flow against the goal. Memory data writes go to `foundry-memory/`
on this branch — they are discarded with the branch.

If the flow needs config to be adjusted mid-run: stop, finish the
dry-run (step 4), edit on `config/<x>`, then start a new dry-run.

### 3. Inspect WORK during the run (optional)

`foundry_workfile_get` and the read-only memory tools work as normal;
they appear in the trace.

### 4. Finish: snapshot + discard

Finish the dry-run with a one-paragraph findings message and explicit
confirmation.

The tool:

- writes `.snapshots/<run-id>/` on the parent `config/<x>` working
  tree, containing `README.md`, `work/WORK*`, `diff.patch`, and
  `trace.jsonl`;
- force-deletes the dry-run branch (its commits become unreachable);
- truncates `.foundry/trace/<branch-slug>.jsonl`.

The user is now back on `config/<x>` with the snapshot on disk.
Nothing is committed. The snapshot directory is gitignored.

`baseBranch` is **not valid** for a dry-run finish — the parent is the
config branch the dry-run was started from.

### 5. Inspect the snapshot

- `foundry_snapshot_list()` enumerates all snapshots.
- `foundry_snapshot_show({ runId })` returns a structured summary.
- The actual files at `.snapshots/<run-id>/` are flat — read directly
  with `Read` or shell tools.

If the snapshot reveals the config needs adjustment: edit on
`config/<x>` (still on it after finish), then optionally re-enter
dry-run mode for another run. Snapshots accumulate; prune them with
`foundry_snapshot_delete` or `foundry_snapshot_prune`.

### 6. Finish the config

When ready, finish `config/<x>` to `main` with a config description and
explicit confirmation.

Snapshots are gitignored and stay in the local working tree; they do
not merge with the config.

## What you do NOT do

- You do not run schema-mutation tools while on a dry-run branch.
  `foundry_config_create_*` and the memory-schema tools refuse there
  by design.
- You do not nest dry-runs (deeper nesting under `dry-run/` is refused).
- You do not commit the snapshot directory by hand. If a particular
  snapshot must be preserved beyond the local checkout, copy it out
  first, then delete the original via `foundry_snapshot_delete`.
