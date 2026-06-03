# Fix: chat persistence write-order FK race (chat_stream_events / chat_generation_traces)

## Objective
Eliminate the deterministic-under-load FK race where `chat_stream_events.message_id` (and `chat_generation_traces.session_id`/`assistant_message_id`) reference a `chat_messages`/`chat_sessions` row that is not (or no longer) committed — causing `insert ... violates foreign key constraint` → job failure → `chat-tools` AI shard flaking. Guarantee the parent message/session row exists for the whole window any stream event or generation trace references it.

## Scope / Guardrails
- Owning area: `packages/chat-core` runtime (checkpoint/finalization/messages) + the API adapters `api/src/services/chat/*` it drives.
- Make-only workflow, no direct Docker commands. Tests on `ENV=test-fixrace` only, never dev.
- One migration max in `api/drizzle/*.sql` (only if a deferred/ordering constraint change is truly required — prefer code ordering over schema change).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/chat-core/src/**`
  - `packages/chat-core/tests/**`
  - `api/src/services/chat/**`
  - `api/src/services/chat-trace.ts`
  - `api/tests/ai/chat-tools.test.ts`
  - `api/tests/**` (only persistence/race regression tests)
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/ci.yml`
  - app rebrand / unrelated source
- **Conditional Paths**:
  - `packages/chat-core/package.json` (version bump — required if `src/**` changes; FIXRACE-EX1)
  - `api/drizzle/*.sql` (max 1, only if a constraint-ordering migration is unavoidable; FIXRACE-EX2)

## Feedback Loop
- FIXRACE-EX1: bump `@sentropic/chat-core` version (patch) since `src/**` changes — enforce-package-bump gate. Approved by plan.
- FIXRACE-Q1: confirm root path — suspected `runtime-checkpoint.ts:223` `deleteAfterSequence` truncation racing with in-flight `streamBuffer.append(messageId)` / `chat-trace` insert; OR `insertMany` sequence-conflict swallow leaving message absent. Status: open until the repro pins it.

## Mode
- Mono-branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: worktree off `origin/main` (`f1c2807e`, post-#240 trigger fix). Forensics: `docs/uat/2026-06-03-chat-tools-fk-forensics.md` (on BR-14e worktree) — FK race reproduced 5/5 locally, intermittent in CI; pre-existing (exists on main), exposed by chat-ui path-filter change.
- [ ] **Lot 1 — Deterministic repro (systematic-debugging)**
  - [ ] Add/scope a failing test proving the FK violation deterministically (chat message lifecycle: insert assistant → append stream events → checkpoint truncate; assert no orphan event/trace). Run on `ENV=test-fixrace`.
- [ ] **Lot 2 — Minimal fix**
  - [ ] Enforce ordering/atomicity: the assistant `chat_messages` row (and session) is committed before any `chat_stream_events`/`chat_generation_traces` insert that references it; and `deleteAfterSequence` truncation does not orphan in-flight events. Prefer code-level ordering (await commit boundary, or transactional insert+events) over schema change.
  - [ ] Re-run the repro green; run `make test-api ENV=test-fixrace` (esp. AI shard) + `make test-chat-core`.
- [ ] **Lot N — Validate + PR**
  - [ ] Full gates; bump `@sentropic/chat-core`; PR with BRANCH.md body; merge-commit; remove BRANCH.md.

## Notes
- This is the RACE half of the corrective set; the TRIGGER half (`fix/ci-ai-shard-trigger`, PR #240) is MERGED, so this branch's chat-core changes now correctly retrigger the API integration + AI shard.
- BR-14e (`chore/sentropic-codebase-finalization`) rebases on main after this merges, then finalizes green.
