# Feature: chat-ui ChatContextProvider P3 (additive lib export)

## Objective
Add a domain-neutral `ChatContextProvider` interface, `ChatContextEntry` type, `createNoopChatContextProvider()` factory, and a `ContextChips` Svelte component to `@sentropic/chat-ui` as new additive exports. Librarizes the opaque `contextProvider: unknown` contract from `ChatPanel.svelte`. No app changes, no headless-core, no Makefile changes, no `ChatPanel.svelte` prop typing (stays `unknown` — separate breaking-change step).

## Scope / Guardrails
- Scope limited to `packages/chat-ui/` new files and manifest/package.json additions.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) — must remain stable.
- Branch development in isolated worktree `tmp/feat-chatui-context-provider-p3`.
- Automated test campaigns on dedicated environments, never root `dev`.
- `ENV=<env>` as last argument in all `make` commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/state/chat-context.ts` (new)
  - `packages/chat-ui/src/components/ContextChips.svelte` (new)
  - `packages/chat-ui/src/components/ContextChips.svelte.d.ts` (new)
  - `packages/chat-ui/package.json` (ADD two new exports subpaths + bump version minor 0.3.0 → 0.4.0)
  - `packages/chat-ui/export-manifest.json` (ADD two new subpaths — additive only)
  - `packages/chat-ui/tests/chat-context.spec.ts` (new)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/src/**` (app retrofit is a separate later branch)
  - `packages/chat-ui/src/components/ChatPanel.svelte` (prop stays `unknown`)
  - All other packages
- **Conditional Paths**: none required
- **Exception process**: none needed (no conditional paths touched)

## Feedback Loop
- `deferred` (radar sign-off): `neg:chat-librarization-radar` not yet signed off — PR opened with `[Tier-1 — needs radar sign-off on ChatContextEntry shape]` prefix. Orchestrator holds merge pending cross-repo sign-off. Owner: radar team / orchestrator. Date: 2026-06-02.
- `deferred` (A0b-DOM): DOM/render tests for ContextChips.svelte deferred to `feat/chatui-a0b-dom-visual-harness` (A0b jsdom harness). Component covered by typecheck for now. Owner: Wave A plan.
- `deferred` (lastUsedAt mapping): app uses epoch number; neutral uses ISO-8601 string. Adapter trivial — proven in assignability test. No breaking change. Owner: retrofit branch.

## AI Flaky tests
- N/A (no AI tests in this branch)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (additive lib-only; single gate cycle)
- Rationale: single orthogonal additive task, no service stack needed.

## UAT Management (in orchestration context)
- Mono-branch: no UI UAT (lib-only additive; no app changes in this branch).
- Gates are local `make` commands only (typecheck + build + pack + test).

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules files and spec (workflow, MASTER, subagents, testing, SPEC_EVOL_CHATUI_WAVE_A §4 P3).
  - [x] Confirm worktree on `feat/chatui-context-provider-p3`.
  - [x] Read app's `ui/src/lib/chat/context-provider.ts` to derive the neutral superset shape.
  - [x] Read P1/P2 reference files (ModelSelector.svelte, model-selection.ts, MessageActions.svelte, MessageActions.svelte.d.ts, message-actions.spec.ts) to align pattern.
  - [x] Confirm export manifest + existing tests (A0a gates must stay green).
  - [x] Confirm excluded: `ChatPanel.svelte` prop typing, route detection, entity-label loading.
  - [x] Define scope: no dev stack needed (pure lib, node tests only).

- [x] **Lot 1 — Interface + component + exports + tests**
  - [x] Write `packages/chat-ui/src/state/chat-context.ts`: `ChatContextEntry`, `ReadableStore<T>`, `ChatContextProvider`, `createNoopChatContextProvider()`.
  - [x] Write `packages/chat-ui/src/components/ContextChips.svelte`: presentational chip row, injected provider + labels + onRemove + onChipClick callbacks, active/used CSS classes, ARIA.
  - [x] Write `packages/chat-ui/src/components/ContextChips.svelte.d.ts`: `ContextChipsProps` + default export.
  - [x] Bump `packages/chat-ui/package.json` version to `0.4.0` (minor — new feature).
  - [x] Add two export subpaths to `packages/chat-ui/package.json` exports map.
  - [x] Add two subpath entries to `packages/chat-ui/export-manifest.json` (additive, no existing entries touched).
  - [x] Write `packages/chat-ui/tests/chat-context.spec.ts`: no-op provider, ChatContextEntry structural, ChatContextProvider contract, Sentropic→neutral assignability proof — node env.
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui` — PASS
    - [x] `make build-chat-ui` — PASS
    - [x] `make pack-chat-ui` — PASS
    - [x] `make test-chat-ui` — PASS (A0a export-surface + projection-golden + model-selection + message-actions + new chat-context tests)

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No spec EVOL file to integrate (SPEC_EVOL_CHATUI_WAVE_A.md lives in spec/ and is the Wave A master spec — do not delete).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck: `make typecheck-chat-ui`
  - [ ] Build: `make build-chat-ui`
  - [ ] Pack: `make pack-chat-ui`
  - [ ] Test: `make test-chat-ui`
  - [ ] Version bumped: `packages/chat-ui/package.json` → `0.4.0` (minor, new exports added).
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: verify branch CI on that PR.
  - [ ] Final gate step 3: once CI OK + radar sign-off, commit removal of `BRANCH.md`, push, merge.
