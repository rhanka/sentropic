# Feature: Agents surface L-C — wire AgentsList into the app on real sessions + jobs

## Objective
- [ ] Mount `@sentropic/chat-ui`'s `AgentsList` in the web app, driven by the sessions + jobs that already exist on dev data — the first version the owner can UAT (owner decision 2026-07-30, option A).
- [ ] Restore the withheld `AgentsList` export now that a real app consumer makes the `primitive` classification defensible (closes CHAT-AGENTS-BLK2).

## Scope / Guardrails
- [ ] No breaking rename in this branch. The tab stays as-is; `ChatWidgetTab` is untouched. The rename is L-A′, a separate owner-gated release AFTER the shell handover.
- [ ] No design of the api feed. Perennial agents, CLI transcripts and cross-workspace need the api gap closed (same as BR-39l) — out of scope. The scope toggle renders disabled-with-reason.
- [ ] Real data only: the list is driven by the existing `/chat/sessions` rows and the queue jobs. No fixture feed in the app.
- [ ] Make-only, Docker-first. `ENV` last. Root `dev` reserved for owner UAT.
- [ ] Touching `ui/**` → run the FULL `make test-ui` before push, not just the changed file.
- [ ] All new text English; owner UAT in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
- `ui/src/lib/chat/agents-feed-adapter.ts` (new — host-side `AgentsFeedPort` impl)
- `ui/src/lib/components/ChatWidget.svelte` (mount point + agents-list pager navigation)
- `ui/tests/chat/agents-feed-adapter.test.ts` (agents feed projection regressions)
- `ui/tests/components/chat/ChatWidget-agents-list.test.ts` (pager wiring contract)
  - `ui/src/locales/en.json`, `ui/src/locales/fr.json` (agents-surface labels)
- `packages/chat-ui/src/components/AgentsList.svelte` (UAT-1 list presentation)
- `packages/chat-ui/src/components/ChatSessionsBar.svelte`, `packages/chat-ui/src/components/ChatSessionsBar.svelte.d.ts` (optional host Back navigation)
- `packages/chat-ui/src/state/agentsEntry.ts` (UAT-1 session status semantics)
  - `packages/chat-ui/package.json`, `packages/chat-ui/export-manifest.json`, `packages/chat-ui/chat-ui-reference-validation.json` (public contract)
- `packages/chat-ui/tests/chat-sessions-bar.dom.spec.ts` (Back control DOM contract)
- `packages/chat-ui/tests/agents-list.dom.spec.ts`, `packages/chat-ui/tests/agents-list-source.test.ts` (UAT-1 list contracts)
- `packages/chat-ui/tests/agents-entry.test.ts` (session status ladder)
  - `packages/chat-ui/tests/chat-conversation.spec.ts` (version pin only)
  - `packages/chat-ui/tests/documents-module.spec.ts` (version pin only)
  - `packages/chat-ui/tests/chat-core-host.spec.ts` (version pin only)
  - `BRANCH.md`
- **Allowed Paths (e2e evolution — owner GO 2026-07-31)**:
  - `e2e/tests/03-chat.spec.ts` (session-bar title selector → stable `[data-chat-sessions-heading]`; chooser popover → agents list Back→list→select/New-session, tests 846/891/972)
  - `e2e/tests/09-run-steering-core.spec.ts` (session-bar title selector → stable `[data-chat-sessions-heading]`)
  - `e2e/tests/08-chat-workspace-switch.spec.ts`, `e2e/tests/08-chat-checkpoint-restore.spec.ts` (session switch evolves from the removed chooser popover → Back→list→select)
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `api/**` (no api change — the feed gap is a separate lane)
- `packages/cowork-bridge/**`
- **Conditional Paths**: `.github/workflows/**` (none expected)

## Feedback Loop
- `attention` — the api feed gap (perennial agents, CLI transcripts R12, cross-workspace R10) is NOT closed here; those parts render disabled/absent with a stated reason, never faked. This is the honest boundary of the first UAT.
- `fixed` — the delegated mount (Codex gpt-5.6-terra) shipped a DEAD D5 merge: it passed `$queueStore.jobs` raw, but the store types job `data` as `any` and only `chat_message` jobs carry `data.sessionId` (api `ChatMessageJobData`), which `loadJobs()` deliberately keeps in the store. Raw jobs → no top-level `sessionId` → the merge no-ops → a chat turn would appear twice. Its wiring test was a source-grep that PINNED the buggy line and could not catch it. Fixed with `queueJobsToAppJobs` (lifts `data.sessionId`, unit-tested + an end-to-end no-duplication test in `ui/tests/chat/agents-feed-queue-jobs.test.ts`); the wiring test now asserts the fixed plumbing and rejects the raw form. Fail-first re-proven. Caught by reading the code, not the report.
- `fixed` — CI group-c (03) was red because the pager host removed the session chooser popover but `03-chat.spec.ts` still opened it via `ensureSessionMenuOpen` (tests 846/891/972, serial-skipped after 846). Migrated to the agents list (`goToAgentsList`, mirroring the green 08 pattern): 846 asserts the created `data-agent-entry-id` row, 891 uses the always-visible conversation-bar delete then checks the list stays operable + the row is gone, 972 starts fresh via the list's New-session action. Verified locally on `ENV=e2e-lc` (real OpenAI): **846 ✓ 891 ✓ (3/3 attempts each)**.
- `attention` (allowlist, non-blocking) — `03-chat.spec.ts:985` "attache une image … vision (BR38a-FB2)" failed locally at `expect(uploadRes.ok())` (line 1046): API `POST /api/v1/documents → 500`, cause `XMinioStorageFull` (HTTP 507) — the local host `/` was 100% full so e2e-lc MinIO refused the write. This is a LOCAL disk artifact, not my change (the migrated setup at 997-999 passed and the test reached the upload) and not AI nondeterminism. CI provisions a fresh MinIO volume, so the upload succeeds there. 03-chat is on the AI-flaky allowlist; the residual vision assertion remains allowlisted. Owner sign-off tracked at merge.

## Plan / Todo (lot-based)
- [x] **Slice 1 — host-side feed adapter (pure, testable)**
  - [x] `agents-feed-adapter.ts`: map app `ChatSession[]` + queue `Job[]` → `AgentsEntry[]`; status mapping; `lastActivityAt` from job `completedAt??startedAt??createdAt`; `chat_message` jobs merged into their session, not shown as their own row (D5).
  - [x] `ui/tests/chat/agents-feed-adapter.test.ts`: mapping, the chat_message merge, and buildAgentsListRows integration. Fail-first verified.
- [x] **Slice 2 — mount + list-as-default nav**
  - [x] Mount `AgentsList` in `ChatWidget.svelte` behind the host-mode predicate (D13); selecting a row opens the session; the list is the default landing view where allowed.
  - [x] Scope toggle rendered disabled-with-reason (D7).
  - [x] `ui/tests/components/chat/ChatWidget-agents-list.test.ts`: source wiring covers adapter rows, default view, selection, actions, labels, relative time, and disabled scope.
  - [x] `make test-ui` FULL — green.
- [x] **Slice 3 — restore the export + classify**
  - [x] Re-add `./components/AgentsList.svelte` to `package.json` + `export-manifest.json`; add a `primitive` entry to `chat-ui-reference-validation.json` with `dogfoodedBy: ["ui/src/lib/components/ChatWidget.svelte"]` (now a real consumer). Bump chat-ui minor.
  - [x] `make test-chat-ui ENV=test-lc` — reference-validation green.
- [x] **Slice 4 — return-to-list pager navigation (hybrid view mounting)**
  - [x] Add optional `ChatSessionsBar` Back callback + visible ArrowLeft label; bump the additive package API to 0.32.0.
  - [x] Replace the interim outer Back row with a short logical CSS slide, omit the session chooser only in pager hosts, and keep `sidePreference()` out of navigation.
  - [x] Remount the list on each show to refresh its design-system row registry while keeping the conversation and `ChatPanel` mounted; lock the hybrid structure with a fail-first regression test.
  - [x] Restore focus to the conversation heading/list row and announce pager view changes; cover the package DOM contract and host wiring.
  - [x] Run the chat-ui, DOM, typecheck, and full UI gates; prove the display toggle fails first when the list is not hidden.
- [ ] **Slice 5 — UAT prep**
  - [ ] Integrate on root `ENV=dev` with the owner's data, give the UAT objectives (the visible surface: renamed-or-not tab, list items, status wheel, pending tag, R9 order, scope toggle disabled-with-reason). Real UAT is WITH the owner.
- [ ] **Slice 6 — UAT-1 agents-surface polish (F2–F7, F9–F11 only)**
  - [x] Adapter: translated job names, resumeable-session semantics, compact activity formatter.
  - [x] Chat UI list: DS icons/actions/menu/status/relative-time polish.
  - [x] Chat UI sessions bar: icon-only Back control.
  - [ ] Host: fixed scope header, DS new-session action, translated job labels, FR/EN compact-time labels.
