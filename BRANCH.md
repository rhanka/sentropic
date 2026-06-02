# Feature: chat-ui ModelSelector P1 (additive lib export)

## Objective
Add a reusable `ModelSelector` Svelte component and `model-selection` pure-logic util to `@sentropic/chat-ui` as new additive exports. Librarizes the provider/model selector inline in `AppChatPanel.svelte` (lines 4159-4243, 5827-5849 on main). No app changes, no headless-core, no Makefile changes.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/` new files and manifest/package.json additions.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) — must remain stable.
- Branch development in isolated worktree `tmp/feat-chatui-model-selector-p1`.
- Automated test campaigns on dedicated environments, never root `dev`.
- `ENV=<env>` as last argument in all `make` commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/components/ModelSelector.svelte` (new)
  - `packages/chat-ui/src/utils/model-selection.ts` (new)
  - `packages/chat-ui/package.json` (ADD two new exports subpaths + bump version minor)
  - `packages/chat-ui/export-manifest.json` (ADD two new subpaths — additive only)
  - `packages/chat-ui/tests/model-selection.spec.ts` (new)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/src/**` (app retrofit is a separate later branch)
  - All other packages
- **Conditional Paths**: none required
- **Exception process**: none needed (no conditional paths touched)

## Feedback Loop
- `deferred` (A0b-DOM): DOM/render tests for ModelSelector.svelte deferred to `feat/chatui-a0b-dom-visual-harness` (A0b jsdom harness). Component covered by typecheck for now. Owner: Wave A plan.

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
  - [x] Read mandatory rules files and spec (workflow, MASTER, subagents, testing, SPEC_EVOL_CHATUI_WAVE_A §4 P1).
  - [x] Confirm worktree on `feat/chatui-model-selector-p1` (verified: `git -C tmp/feat-chatui-model-selector-p1 branch --show-current` = feat/chatui-model-selector-p1).
  - [x] Confirm export manifest + existing tests (A0a gates must stay green).
  - [x] Re-validate AppChatPanel.svelte line ranges on main: parse/handler/fallback/width at lines 4159-4243; markup `<select id="chat-model-selection">` at lines 5827-5849.
  - [x] Define scope: no dev stack needed (pure lib, node tests only).

- [x] **Lot 1 — Pure logic util + component + exports + tests**
  - [x] Write `packages/chat-ui/src/utils/model-selection.ts`: types + parse/format/group/fallback/width helpers.
  - [x] Write `packages/chat-ui/src/components/ModelSelector.svelte`: native `<select>`, grouped `<optgroup>`, fallback, auto-width, i18n resolver, change event.
  - [x] Write `packages/chat-ui/src/components/ModelSelector.svelte.d.ts`: props type + default export.
  - [x] Bump `packages/chat-ui/package.json` version to `0.2.0` (minor — new feature).
  - [x] Add two export subpaths to `packages/chat-ui/package.json` exports map.
  - [x] Add two subpath entries to `packages/chat-ui/export-manifest.json` (additive, no existing entries touched).
  - [x] Write `packages/chat-ui/tests/model-selection.spec.ts`: parse, group, fallback, width — node env.
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui` — PASS
    - [x] `make build-chat-ui` — PASS
    - [x] `make pack-chat-ui` — PASS
    - [x] `make test-chat-ui` — PASS (A0a export-surface + projection-golden + new model-selection tests)

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No spec EVOL file to integrate (SPEC_EVOL_CHATUI_WAVE_A.md lives in spec/ and is the Wave A master spec — do not delete).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck: `make typecheck-chat-ui`
  - [ ] Build: `make build-chat-ui`
  - [ ] Pack: `make pack-chat-ui`
  - [ ] Test: `make test-chat-ui`
  - [ ] Version bumped: `packages/chat-ui/package.json` → `0.2.0` (minor, new exports added).
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: verify branch CI on that PR.
  - [ ] Final gate step 3: once CI OK, commit removal of `BRANCH.md`, push, merge.
