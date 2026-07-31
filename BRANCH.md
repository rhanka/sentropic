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
  - `ui/src/lib/components/ChatWidget.svelte` (mount point + list-as-default nav)
  - `ui/tests/agents-feed-adapter.spec.ts` (new)
  - `ui/src/locales/en.json`, `ui/src/locales/fr.json` (agents-surface labels)
  - `packages/chat-ui/package.json`, `packages/chat-ui/export-manifest.json`, `packages/chat-ui/chat-ui-reference-validation.json` (restore the export + classify)
  - `packages/chat-ui/tests/chat-conversation.spec.ts` (version pin only)
  - `packages/chat-ui/tests/documents-module.spec.ts` (version pin only)
  - `packages/chat-ui/tests/chat-core-host.spec.ts` (version pin only)
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `api/**` (no api change — the feed gap is a separate lane)
  - `packages/chat-ui/src/**` (the package code is already shipped in 0.30.0; this lot only restores an export)
  - `packages/cowork-bridge/**`
- **Conditional Paths**: `.github/workflows/**` (none expected)

## Feedback Loop
- `attention` — the api feed gap (perennial agents, CLI transcripts R12, cross-workspace R10) is NOT closed here; those parts render disabled/absent with a stated reason, never faked. This is the honest boundary of the first UAT.

## Plan / Todo (lot-based)
- [ ] **Slice 1 — host-side feed adapter (pure, testable)**
  - [ ] `agents-feed-adapter.ts`: map app `ChatSession[]` + queue `Job[]` → `AgentsEntry[]`; status mapping (job processing→running, pending→idle, completed→done, failed→failed; sessions→idle); `lastActivityAt` from job `completedAt??startedAt??createdAt`; `chat_message` jobs merged into their session, not shown as their own row (D5).
  - [ ] `ui/tests/agents-feed-adapter.spec.ts`: mapping, the chat_message merge, and buildAgentsListRows integration on the projected entries. Fail-first verified.
- [x] **Slice 2 — mount + list-as-default nav**
  - [x] Mount `AgentsList` in `ChatWidget.svelte` behind the host-mode predicate (D13); selecting a row opens the session; the list is the default landing view where allowed.
  - [x] Scope toggle rendered disabled-with-reason (D7).
  - [x] `ui/tests/components/chat/ChatWidget-agents-list.test.ts`: source wiring covers adapter rows, default view, selection, actions, labels, relative time, and disabled scope.
  - [x] `make test-ui` FULL — green.
- [ ] **Slice 3 — restore the export + classify**
  - [ ] Re-add `./components/AgentsList.svelte` to `package.json` + `export-manifest.json`; add a `primitive` entry to `chat-ui-reference-validation.json` with `dogfoodedBy: ["ui/src/lib/components/ChatWidget.svelte"]` (now a real consumer). Bump chat-ui minor.
  - [ ] `make test-chat-ui ENV=test-lc` — reference-validation green.
- [ ] **Slice 4 — UAT prep**
  - [ ] Integrate on root `ENV=dev` with the owner's data, give the UAT objectives (the visible surface: renamed-or-not tab, list items, status wheel, pending tag, R9 order, scope toggle disabled-with-reason). Real UAT is WITH the owner.
