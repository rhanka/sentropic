# Hotfix: chat persistence write-order FK race (chat-tools flake)

## Objective
Eliminate the deterministic-under-load FK race where a `chat_stream_events`/`chat_generation_traces` INSERT references a `chat_messages`/`chat_sessions` parent row that was deleted (cascade) mid-flight — causing `violates foreign key constraint` (pg `23503`) → chat job crash → the `chat-tools` AI shard flaking. No global roadmap branch number (born mid-flight from the BR-14e CI investigation).

## Scope / Guardrails
- Scope limited to the Postgres adapter boundary that owns the FK: `api/src/services/chat/postgres-stream-buffer.ts` + `api/src/services/chat-trace.ts`, plus a real-Postgres regression test.
- No database migration (the FKs already declare `ON DELETE CASCADE`; the fix is code-level error handling, not schema).
- Make-only workflow; tests on `ENV=test-fixrace`, never `ENV=dev`.
- Branch worktree `tmp/fix-chat-persistence`.

## Root cause (FIXRACE-Q1, resolved)
The FKs `chat_stream_events.message_id`, `chat_generation_traces.{session_id,assistant_message_id}` are all `ON DELETE CASCADE` (schema lines 462/498/501), so checkpoint truncation (`deleteAfterSequence`, runtime-checkpoint.ts:223) CANNOT orphan — Postgres cascades children atomically. The real race: a parent `chat_messages`/`chat_sessions` row is deleted while the generation job is still flushing stream events / traces (in the AI shard, the `cleanupAuthData` afterEach does `db.delete(users)` → cascade session→messages→events while an in-flight/leftover job keeps appending). The post-cascade `append(...,messageId)` / `writeChatGenerationTrace(...)` then throw an UNHANDLED FK `23503`, crashing the job → tool-call assertions fail + timeout.

## Fix
At the two adapter insert sites, treat the specific parent-FK `23503` (`chat_stream_events_message_id_chat_messages_id_fk`, `chat_generation_traces_session_id_chat_sessions_id_fk`, `..._assistant_message_id_chat_messages_id_fk`) as a benign no-op (the `ON DELETE CASCADE` parent — and thus this child — is already gone; writing a now-orphaned row is meaningless). Constraint-name-scoped: any other FK / error still `throw`s. Public method contracts preserved; chat-core stays DB-agnostic (handling lives at the Postgres boundary). Reused the pre-existing `findPgError` helper.

## Verification
- Deterministic repro `api/tests/api/chat-persistence-write-order.test.ts` (real Postgres FK, no LLM): RED 2/2 (`23503`) → GREEN 2/2 after fix.
- `chat-tools` AI shard: GREEN on PR #242 CI (now triggered thanks to the `fix/ci-ai-shard-trigger` path-filter widening, PR #240 merged), zero `23503` across runs.
- `make test-pkg-chat-core` 245/245; `make test-api-endpoints` 495/495. No regressions.
- Residual CI reds during validation were external (OpenAI quota exhaustion + SCW registry pull timeout), cleared on rerun after quota recharge.

## Forensics
Full investigation (process gap + root cause) in `docs/uat/2026-06-03-chat-tools-fk-forensics.md`. The trigger half (`fix/ci-ai-shard-trigger`, PR #240) widened the CI `api:` path-filter to include `packages/{chat-core,events,contracts}` so chat runtime changes retrigger the integration + AI shards.

## Status
DONE — PR #242, merged to main. BR-14e (`chore/sentropic-codebase-finalization`) rebases on the post-#240/#242 main to finalize green.
