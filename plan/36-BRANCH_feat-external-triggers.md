# Branch Plan Stub: BR-30 External Triggers

Current coordination source:

- `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` (§1 cartography, §10.8 async externally-triggered flows, §11 delivery cadence)
- `spec/SPEC_VOL_EXTERNAL_TRIGGERS.md` (to be authored in BR-23 PR #148 scope)

Branch:

- BR-30 `feat/external-triggers`
- Worktree (when launched): `tmp/feat-external-triggers`

Ordering rule:

- BR-30 runs after BR-26 (`feat/flow-runtime-extract`) merges, because every trigger source kicks off a `@sentropic/flow` DAG with idempotency keys and durable replay (§10.8).
- BR-30 may be folded into BR-26 if its incremental cost is small at integration time; otherwise it ships standalone.

Scope summary:

- Introduce a `TriggerSource` port and reference implementations: webhook (HTTP POST), schedule (cron-like), email-in (IMAP/SMTP gateway), file-watch (local + cloud bucket).
- Each trigger constructs a typed payload, derives an `IdempotencyKey`, and invokes a flow run via `@sentropic/flow`.
- Owns retry/backoff and dedup-window policy at the trigger boundary (not in flow).
- Out of scope: marketplace gating of triggers (that lives in BR-27) and UI configuration surface (deferred).
- Wire protocol: trigger events emit through `@sentropic/events` as `flow.trigger.*` envelopes for audit.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Inventory current ad-hoc trigger code in `api/src/services/` (cron jobs, webhook handlers) to migrate behind the port.
- Define the `TriggerSource` port signature and minimum 1 reference adapter per kind.
