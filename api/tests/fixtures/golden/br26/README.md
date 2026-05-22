# BR-26 Golden Traces

Regression fixtures locking the behavior of the current flow runtime
(`todo-orchestration.ts` + `queue-manager.ts` + `gate-service.ts`) before
the façade extraction (BR-26 Lot 4..8).

Each `.jsonl` file is a sequence of JSON objects, one per line:

```
{ "kind": "input",       ... }            // line 1 — scenario input + seed data
{ "kind": "event",       ts, runId, ... } // intermediate — runtime events in order
...
{ "kind": "final_state", runId, ... }     // last line — terminal snapshot
```

Schema (per kind):

- `input`:
  - `fixtureId` — string identifier (matches filename without extension).
  - `scenario` — short human description.
  - `workspaceType` — workspace type used by the seed catalog.
  - `seed` — arbitrary seed payload (workflow definition, tasks, transitions, initial state).
  - `expectations` — high-level assertions documented for the replay harness.
- `event`:
  - `ts` — ISO timestamp (normalized to `__TS__` for comparison).
  - `runId` — execution run id (normalized to `__RUN_ID__`).
  - `taskKey` — workflow task key.
  - `taskInstanceKey` — fanout instance key (`"main"` for non-fanout tasks).
  - `eventType` — one of `run_started`, `task_started`, `task_completed`,
    `task_failed`, `state_merged`, `gate_evaluated`, `run_paused`,
    `run_resumed`, `run_cancelled`, `job_enqueued`, `job_retried`,
    `job_dlq`, `chat_tool_call`, `chat_tool_result`, `chat_completed`,
    `state_resumed`.
  - `payload` — event-specific data (JSON).
  - `sequence` — monotonically increasing integer per `runId`.
- `final_state`:
  - `runId` — normalized to `__RUN_ID__`.
  - `status` — terminal status (`completed`, `failed`, `cancelled`, `paused`).
  - `workflowRunState` — final `workflow_run_state.state` JSON snapshot.
  - `taskResults` — array of `{taskKey, taskInstanceKey, status, attempts}`.
  - `assertions` — invariants the replay harness must verify.

Normalization rules used by `golden-loader.ts`:
- All `ts` values become `__TS__`.
- All `runId` values become `__RUN_ID__`.
- All values matching `/^[a-f0-9-]{20,}$/` become `__ID__`.
- `payload.attempts` integers are preserved.
- `sequence` integers are preserved.

Fixtures (6 total):

| # | File                                  | Scenario                                                 |
|---|---------------------------------------|----------------------------------------------------------|
| 1 | `chat-tool-loop-3turns.jsonl`         | Chat session with tool-loop length 3 + completion        |
| 2 | `fanout-join-2orgs.jsonl`             | Parallel workflow runs across 2 orgs + join              |
| 3 | `approval-gated-pause-resume.jsonl`   | Gate evaluation triggers pause → approval → resume       |
| 4 | `queue-retry.jsonl`                   | Transient failure → retry → success                      |
| 5 | `resume-after-crash.jsonl`            | `workflow_run_state` reload + resume from checkpoint     |
| 6 | `cancel-mid-loop.jsonl`               | Cancel signal interrupts loop, state finalized           |

Re-run after each BR-26 slice (Lot 4..8) to prove byte-identical behavior.
