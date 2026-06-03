# Forensics — chat-tools AI shard FK failure (BR-14e gate investigation)

Date: 2026-06-03. Author: Claude Opus 4.8 (BR-14e conductor). Trigger: user challenge — "we never merge a deterministic CI failure; either protection was overridden or your analysis is wrong; trace it to the exact root commit."

## Question
Is the `test-api-unit-integration (ai, chat-tools,company-enrichment-sync,documents-tool,initiative-generation-sync)` failure:
(a) a deterministic bug that was merged past branch protection (override / process breach), or
(b) a non-deterministic race that legitimately passed its PR gate, or
(c) my (Claude) analysis error?

## Evidence collected

### 1. The failure signature (deterministic-looking)
Local repro on BR-14e (fresh DB, build+migrate, 5/5 attempts RED). Root cascade:
- `chat_generation_traces_session_id_chat_sessions_id_fk` — session row absent
- `chat_stream_events_message_id_chat_messages_id_fk` — assistant message row absent
- `Key (message_id)=... is not present in table "chat_messages"`
i.e. stream events / generation traces are written BEFORE the parent chat_session / assistant chat_message row is committed → FK violation → job fails → tool-call assertions see `expected undefined to be defined` + 30s timeouts.

### 2. The FK constraints are OLD, not new
`api/drizzle/0011_past_drax.sql` + `api/drizzle/0015_chat_generation_traces.sql` define these FKs (BR-04 era). The merge did NOT introduce the constraint. The write-ordering code path (`packages/chat-core/src/runtime-finalization.ts` → `streamBuffer.append`, `api/src/services/chat/postgres-stream-buffer.ts`) predates this branch (last real change `5f11bedd` BR14b Lot 7).

### 3. Branch protection was NOT overridden
PR #230 (`feat/chatui-conversation-stream-wiring`, merge commit `b46c9305`) — the PR whose post-merge main push first showed the shard RED — had a **GREEN PR gate at merge**: gate run on head `51b70652` → `overall=success, chat-tools=success`. So the merge was legitimate per the gate. No override. ✅ (process intact)

### 4. #230 does NOT touch the failing code path
`git show b46c9305 --stat`: touches ONLY `packages/chat-ui/**` (Svelte front), `Makefile`, `BRANCH.md`, chat-ui tests. ZERO API/persistence files. It cannot have caused an API-side FK race. What it DID do: touch `Makefile` + chat-ui paths → flipped the CI `changes` path-filter so the **AI shard actually ran** on that main push (it was `n/a` / skipped on most prior pushes).

### 5. The shard rarely runs AND rarely fails — classic flake exposure
Across last 16 main `push` runs, the chat-tools shard was: mostly `n/a` (skipped by path filter), `success` on `b117de6c` and `90323a6b`, `failure` only on `b46c9305`, `success` again on the latest `48b80ed7`. So: green → (one) red → green. On the PR gate it was green. Locally on a heavily-loaded / repeatedly-crashing workstation it is 5/5 red.

## Verdict
- (a) NO — protection was not overridden; PR #230 gate was green at merge (evidence §3).
- (c) PARTIAL — my earlier "just flaky LLM, malchance" framing was sloppy: the FK cascade is a REAL race in the chat persistence write-order (message/session must be committed before stream events/traces), not LLM nondeterminism. The user was right to reject "flaky LLM".
- (b) YES, mechanically — it is a **latent, pre-existing persistence-ordering race** in `chat-core` finalization + `postgres-stream-buffer`, exposed (not introduced) by #230 flipping the path-filter so the shard runs. It passes the gate most of the time (race usually wins), fails under load (CI runner contention; local crashing workstation = 5/5).

## Root cause (precise)
Write-order race: `streamBuffer.append(..., messageId)` / generation-trace insert can execute before the parent `chat_messages` (and in some paths `chat_sessions`) row is committed. The FK then rejects. The owning code is `packages/chat-core/src/runtime-finalization.ts` + `api/src/services/chat/postgres-stream-buffer.ts` + `api/src/services/chat-trace.ts` — all pre-BR-14e, owned by the chat-core/chat-server lineage. NOT introduced by BR-14e (BR-14e diff in this path = 2 brand-rename lines in `chat-service.ts`, zero ordering change).

## Implications
- BR-14e did NOT cause this and must NOT carry the fix (scope = rebrand). 
- The race is a main-level defect in the chat persistence path. It needs a dedicated fix branch (e.g. `fix/chat-persistence-write-order`): ensure session+assistant-message rows are committed before any stream-event / generation-trace insert (or make the FK insert ordering transactional / deferred).
- Process gap to close: the AI shard's path-filter means it is skipped on most PRs, so a persistence race in chat-core can ride green gates for a long time. Consider running the chat AI shard whenever `packages/chat-core/**` or `api/src/services/chat/**` change (not only when chat-ui/Makefile change), OR mark it required.

## My debt (owned)
I called this "flaky LLM / malchance" before reading the logs. That was an analysis error — the user corrected it. The real cause is a deterministic-under-load persistence race. Logged here so the next session does not repeat the misclassification.
