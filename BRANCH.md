# Feature: chat-ui P4 — SessionList + HTTP-backed history restore

## Objective
Deliver radar P4: a `SessionList.svelte` component and an HTTP-backed session/history projection module in `@sentropic/chat-ui`, so a host (radar) can list sessions and restore conversation history over HTTP (no Postgres) — fixing "loses history on reload". Additive, lib-only (Tier-0).

## Scope / Guardrails
- Scope limited to `packages/chat-ui/src/components/SessionList.svelte` (+ `.svelte.d.ts`), `packages/chat-ui/src/state/sessionList.ts`, `packages/chat-ui/package.json`, `packages/chat-ui/export-manifest.json`, `packages/chat-ui/tests/session-list.spec.ts`, `packages/chat-ui/tests/session-list.dom.spec.ts`, and `BRANCH.md`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-chatui-http-session-adapter-p4`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/components/SessionList.svelte`
  - `packages/chat-ui/src/components/SessionList.svelte.d.ts`
  - `packages/chat-ui/src/state/sessionList.ts`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/tests/session-list.spec.ts`
  - `packages/chat-ui/tests/session-list.dom.spec.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/src/**`
  - `packages/chat-core/**`
  - All other packages
- **Conditional Paths (allowed only with explicit exception)**:
  - `spec/SPEC_EVOL_CHATUI_WAVE_A.md` (read only)
  - `.github/workflows/**` (not touched)
- **Exception process**:
  - No exceptions declared for this branch.

## Design notes
- `@sentropic/chat-core` is NOT a direct dependency of `@sentropic/chat-ui` (not in peerDependencies). The history projection (`projectRestoredTimeline`) replicates the minimal pure projection locally rather than importing `buildChatHistoryTimeline` from chat-core. The canonical function in `packages/chat-core/src/history.ts` is the reference; changes there should be mirrored. This avoids introducing a new dependency and keeps the lib browser-friendly.
- The transport (`packages/chat-ui/src/client/transport.ts`) already provides `fetchBootstrap` — the host wires transport calls to `projectRestoredTimeline`. No new server code is needed.
- `SessionList.svelte` is fully presentational: no app stores, no routing, no Postgres. The host injects `sessions` (from `projectSessionList()`), `onSelect`, and optionally `onDelete`.

## Feedback Loop
- **deferred**: Host wiring (transport → SessionList) is the host's job; app/radar adoption deferred to the consuming side. The component and helpers are ready for consumption.

## AI Flaky tests
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single lot, single test cycle, lib-only Tier-0)
- Rationale: single package change, no cross-branch dependency, no app changes.

## UAT Management (in orchestration context)
- **Mono-branch**: lib-only Tier-0 change — no runtime UAT needed (no app change). PR + CI gates are the acceptance criteria.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify worktree on correct branch: `feat/chatui-http-session-adapter-p4`
  - [x] Read workflow.md, MASTER.md, subagents.md, testing.md, SPEC_EVOL_CHATUI_WAVE_A.md §4 P4
  - [x] Read transport.ts (existing HTTP surface), chat-core history.ts (buildChatHistoryTimeline), chat-core session-port.ts (ChatSessionRow)
  - [x] Read export-manifest.json, package.json, vitest.dom.config.ts
  - [x] Read existing DOM test patterns (model-selector.dom.spec.ts, chat-conversation.dom.spec.ts)
  - [x] Confirm make targets: typecheck-chat-ui, build-chat-ui, pack-chat-ui, test-chat-ui, test-chat-ui-dom
  - [x] Confirm: @sentropic/chat-core not in peerDependencies → replicate minimal projection

- [x] **Lot 1 — Implementation**
  - [x] Create `packages/chat-ui/src/state/sessionList.ts` (pure helpers: projectSessionList, projectRestoredTimeline, types)
  - [x] Create `packages/chat-ui/src/components/SessionList.svelte` (presentational, label-resolver, onSelect/onDelete)
  - [x] Create `packages/chat-ui/src/components/SessionList.svelte.d.ts`
  - [x] Bump `package.json` version 0.7.0 → 0.8.0
  - [x] Add `./components/SessionList.svelte` + `./state/sessionList` exports to `package.json`
  - [x] Update `export-manifest.json` (_version, new subpaths)
  - [x] Write `tests/session-list.spec.ts` (node, pure helpers — list sorting, history restore)
  - [x] Write `tests/session-list.dom.spec.ts` (jsdom, SessionList renders entries, active highlight, onSelect/onDelete)
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui`
    - [x] `make build-chat-ui` + `make pack-chat-ui`
    - [x] `make test-chat-ui` (node; existing + new session-list.spec.ts)
    - [x] `make test-chat-ui-dom` (jsdom; existing + new session-list.dom.spec.ts)

- [x] **Lot 2 — Final validation + commit + push + PR**
  - [x] Create/update BRANCH.md
  - [x] Commit (selective git add, make commit, <150 lines)
  - [x] `git push origin feat/chatui-http-session-adapter-p4`
  - [x] `gh pr create` (base main, body = BRANCH.md, additive Tier-0)
  - [x] Report (done, checks, PR, feedback loop, scope adherence, read set)
