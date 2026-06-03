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
- FIXRACE-EX1: NOT APPLICABLE / WITHDRAWN. The minimal fix lives entirely in the API adapter layer (`api/src/services/chat/postgres-stream-buffer.ts` + `api/src/services/chat-trace.ts`); `packages/chat-core/src/**` was NOT modified. The `enforce-package-bump` gate triggers only on `packages/<pkg>/src/**` changes, so no chat-core version bump is required (public surface unchanged). The orphan-reference handling belongs at the Postgres adapter boundary that actually owns the FK, keeping chat-core transport/DB-agnostic.
- FIXRACE-Q1: RESOLVED. Root cause = orphaned-reference INSERT, not truncation orphaning. The FKs `chat_stream_events.message_id`, `chat_generation_traces.{session_id,assistant_message_id}` are all `ON DELETE CASCADE` (schema lines 462/498/501), so `deleteAfterSequence` (checkpoint) cannot orphan — Postgres cascades the children. The real race: a parent `chat_messages`/`chat_sessions` row is deleted while the generation job is still flushing stream events / traces (in the AI shard, `cleanupAuthData` afterEach does `db.delete(users)` → cascade session→messages→events/traces while an in-flight or leftover job keeps appending). The post-cascade `postgresStreamBuffer.append(...,messageId)` / `writeChatGenerationTrace(...)` then throw an UNHANDLED FK `23503` (`chat_stream_events_message_id_chat_messages_id_fk` / `chat_generation_traces_session_id_chat_sessions_id_fk`), crashing the job → tool-call assertions fail + 30s timeout. Reproduced deterministically 2/2 in `api/tests/api/chat-persistence-write-order.test.ts` (real Postgres FK, no LLM). Suspect `runtime-checkpoint.ts:223` (truncation) DISPROVEN by the cascade declaration.

## Mode
- Mono-branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: worktree off `origin/main` (`f1c2807e`, post-#240 trigger fix). Forensics: `docs/uat/2026-06-03-chat-tools-fk-forensics.md` (on BR-14e worktree) — FK race reproduced 5/5 locally, intermittent in CI; pre-existing (exists on main), exposed by chat-ui path-filter change.
- [x] **Lot 1 — Deterministic repro (systematic-debugging)**
  - [x] Added `api/tests/api/chat-persistence-write-order.test.ts`: real-Postgres FK repro (no LLM). Asserts a stream event / generation trace referencing an already-cascade-deleted parent must NOT crash the write. RED 2/2 with `chat_stream_events_message_id_chat_messages_id_fk` + `chat_generation_traces_session_id_chat_sessions_id_fk` (code `23503`). In-memory store cannot model the FK, so this is correctly an `api/tests/**` integration test on `ENV=test-fixrace`.
- [x] **Lot 2 — Minimal fix**
  - [x] Treat the specific parent-FK `23503` as a benign no-op (the `ON DELETE CASCADE` parent — and thus the child — is gone; nothing to keep) in `postgres-stream-buffer.ts` (`append` + `appendAtomically`) and `chat-trace.ts` (`writeChatGenerationTrace`). Constraint-name matched so only the message/session parent FKs are swallowed; all other errors still throw. Public contract preserved (methods still return normally). No schema change (FKs already cascade).
  - [x] Re-run the repro green; ran the chat-tools AI shard ≥3× consecutively + `make test-pkg-chat-core` + `make test-api-endpoints` regressions.
- [ ] **Lot N — Validate + PR**
  - [ ] Full gates; bump `@sentropic/chat-core`; PR with BRANCH.md body; merge-commit; remove BRANCH.md.

## Notes
- This is the RACE half of the corrective set; the TRIGGER half (`fix/ci-ai-shard-trigger`, PR #240) is MERGED, so this branch's chat-core changes now correctly retrigger the API integration + AI shard.
- BR-14e (`chore/sentropic-codebase-finalization`) rebases on main after this merges, then finalizes green.
