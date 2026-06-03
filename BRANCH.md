# Feature: chat-ui P6 — wired composer auto-grow (opt-in)

## Objective
Promote radar P6 auto-grow composer behavior from the app into `@sentropic/chat-ui` as an additive, opt-in enhancement. The existing `ChatComposer` API is preserved; new props (`autoGrow`, `baseHeight`, `containerHeight`) default to today's behavior.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/src/components/ChatComposer.svelte`, its `.svelte.d.ts`, a new `packages/chat-ui/src/utils/composer-autosize.ts`, tests, `package.json`, and `export-manifest.json`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-chatui-composer-wired-p6`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/components/ChatComposer.svelte`
  - `packages/chat-ui/src/components/ChatComposer.svelte.d.ts`
  - `packages/chat-ui/src/utils/composer-autosize.ts`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/tests/composer-autosize.spec.ts`
  - `packages/chat-ui/tests/composer-wired.dom.spec.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/src/**`
  - `packages/chat-ui/src/components/ChatComposerWired.svelte` (new component not chosen — opt-in props preferred)
  - All other packages
- **Conditional Paths (allowed only with explicit exception)**:
  - `spec/SPEC_EVOL_CHATUI_WAVE_A.md` (read only — no modification needed)
  - `.github/workflows/**` (not touched)
- **Exception process**:
  - No exceptions declared for this branch.

## Approach — opt-in props (not a new component)
The `ChatComposer` shell can absorb the auto-grow behavior cleanly with three new opt-in props:
- `autoGrow?: boolean` (default `false`) — preserves existing behavior when unset
- `baseHeight?: number` (default `40`) — floor height for auto-grow computation
- `containerHeight?: number` (default `0`) — container cap for auto-grow computation

Rationale: the shell already manages `maxHeight` as a style binding; adding a reactive `autoGrowMaxHeight` derived from `computeAutosizeResult` is a minimal, non-invasive change. A new `ChatComposerWired.svelte` would duplicate the template and create two entry points to maintain. App consumers (`ChatConversation`, `ChatWidget`, etc.) are unaffected — their existing `maxHeight` prop still drives height when `autoGrow` is not passed.

The pure logic (`computeAutosizeResult`) is extracted to `utils/composer-autosize.ts` for node-testability.

## Feedback Loop
- none

## AI Flaky tests
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single lot, single test cycle, lib-only Tier-0)
- Rationale: single package change, no cross-branch dependency, no app changes.

## UAT Management (in orchestration context)
- **Mono-branch**: lib-only Tier-0 change — no runtime UAT needed (no app change). PR + CI gates are the acceptance criteria.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read workflow.md, MASTER.md, subagents.md, testing.md, SPEC_EVOL_CHATUI_WAVE_A.md
  - [x] Verify worktree on correct branch: `feat/chatui-composer-wired-p6`
  - [x] Read ChatComposerWrapper.svelte (app wiring, 38 lines)
  - [x] Read ChatComposer.svelte (shell, 84 lines) and .svelte.d.ts
  - [x] Read export-manifest.json, package.json, vitest.dom.config.ts
  - [x] Read existing DOM test patterns (model-selector.dom.spec.ts, chat-conversation.dom.spec.ts)
  - [x] Confirm make targets: typecheck-chat-ui, build-chat-ui, pack-chat-ui, test-chat-ui, test-chat-ui-dom

- [x] **Lot 1 — Implementation**
  - [x] Create `packages/chat-ui/src/utils/composer-autosize.ts` (pure helper, node-testable)
  - [x] Add opt-in props to `ChatComposer.svelte` (autoGrow, baseHeight, containerHeight)
  - [x] Update `ChatComposer.svelte.d.ts` with new props
  - [x] Bump `package.json` version 0.6.0 → 0.7.0
  - [x] Add `./utils/composer-autosize` export to `package.json`
  - [x] Update `export-manifest.json` (_version, new subpath, ChatComposer _propSnapshot)
  - [x] Write `tests/composer-autosize.spec.ts` (node, pure helper)
  - [x] Write `tests/composer-wired.dom.spec.ts` (jsdom, ChatComposer with autoGrow)
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui`
    - [x] `make build-chat-ui` + `make pack-chat-ui`
    - [x] `make test-chat-ui` (node; existing + new composer-autosize.spec.ts)
    - [x] `make test-chat-ui-dom` (jsdom; existing + new composer-wired.dom.spec.ts)

- [x] **Lot 2 — Final validation + commit + push + PR**
  - [x] Create/update BRANCH.md
  - [x] Commit (selective git add, make commit, <150 lines)
  - [x] `git push origin feat/chatui-composer-wired-p6`
  - [x] `gh pr create` (base main, body = BRANCH.md, additive Tier-0)
  - [x] Report (done, checks, PR, feedback loop, scope adherence, read set)
