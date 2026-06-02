# Feature: WP-CHAT Wave-A A1a — @sentropic/chat-ui-core extraction

## Objective
Extract framework-pure modules (`state/*`, `utils/*`, `renderers/registry`) into a new `@sentropic/chat-ui-core@0.1.0` package. Replace each moved file in `@sentropic/chat-ui` with a verbatim re-export shim so the A0a export-surface + projection-golden tests stay green unchanged (non-breaking proof). Additive, no behavior change.

## Scope / Guardrails
- Scope limited to `packages/chat-ui-core/**` (new package), `packages/chat-ui/src/**` (shims), `packages/chat-ui/package.json` (version bump + new dep), `packages/chat-ui/vitest.config.ts` (new — alias for test resolution), `spec/SPEC_EVOL_CHATUI_WAVE_A.md`, `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md`, `BRANCH.md`.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-chatui-core-extract`.
- Automated tests run via `make test-chat-ui ENV=test-chatui-core`, never on `ENV=dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- `packages/chat-ui/tests/**` and `packages/chat-ui/export-manifest.json` MUST NOT change — they are the regression oracle.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui-core/**` (new package — all files)
  - `packages/chat-ui/src/**` (turn moved modules into thin re-export shims)
  - `packages/chat-ui/package.json` (version 0.2.0 + dep on chat-ui-core)
  - `packages/chat-ui/vitest.config.ts` (new — alias to resolve @sentropic/chat-ui-core in tests)
  - `packages/chat-ui/tsconfig.json` (if path alias needed for typecheck)
  - `spec/SPEC_EVOL_CHATUI_WAVE_A.md`
  - `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/src/**`
  - `packages/chat-ui/tests/**`
  - `packages/chat-ui/export-manifest.json`
  - `root package.json` (workspaces config)
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `packages/chat-ui/tsconfig.json` — allowed if path alias needed for TypeScript resolution; no EXn required as it is within the allowed package scope
- **Exception process**:
  - A1a-EX1: `packages/chat-ui/vitest.config.ts` (NEW FILE — not forbidden; needed to inject `@sentropic/chat-ui-core` alias into vitest resolution so the test-chat-ui Docker container resolves the new package without Makefile changes). Rationale: the `test-chat-ui` make target only symlinks `vitest` and `svelte` into the ephemeral Docker node_modules. Tests import directly from `../src/state/...` etc. After extraction, those shims import `@sentropic/chat-ui-core` — without an alias vitest cannot resolve the package. A `vitest.config.ts` alias (`@sentropic/chat-ui-core` → `../chat-ui-core/src`) is the only zero-Makefile solution. Impact: minimal — only affects test-time resolution, not production imports. Rollback: delete the file.
  - A1a-EX2: `Makefile` (ADDITIVE wiring ONLY — add `build-chat-ui-core`/`typecheck-chat-ui-core` targets; add `@sentropic/chat-ui-core` symlink wiring to `typecheck-chat-ui`, `build-chat-ui`, `typecheck-cowork-desktop`, `test-cowork-desktop`, `build-cowork-desktop`, `package-desktop-windows`; no unrelated Makefile edits). Rationale: CI `validate-chat-ui` and `validate-cowork-desktop` fail TS2307 because the typecheck Docker containers do not resolve intra-workspace `@sentropic/*` packages without explicit symlinks — same pattern as `@sentropic/chat-ui`/`@sentropic/cowork-bridge` wiring already present. Impact: additive only; no existing behaviour changed. Rollback: revert the added symlink lines.

## Feedback Loop
- A1a-FL1 `attention` (STEP 1 scoping result): `test-chat-ui` Makefile target only symlinks `vitest@4.0.18` and `svelte@5.55.7` into the ephemeral Docker node_modules. Tests import directly from `../src/state/`, `../src/utils/`, `../src/renderers/registry` — they will fail if shim files resolve through `@sentropic/chat-ui-core` without module resolution. Resolution chosen: add `packages/chat-ui/vitest.config.ts` with a `resolve.alias` mapping (within allowed paths). Exception declared as A1a-EX1. No Makefile change needed.
- A1a-EX2 `exception` (BR-A1a-EX2 — Makefile wiring for `@sentropic/chat-ui-core` resolution): CI jobs `validate-chat-ui` (`typecheck-chat-ui`) and `validate-cowork-desktop` (`typecheck-cowork-desktop`) fail with TS2307 because the Docker typecheck containers only symlink external npm packages (typescript/svelte) and not intra-workspace siblings. Pattern mirrored: same `ln -sfn ../../../<pkg> node_modules/@sentropic/<pkg>` technique used by `typecheck-cowork-desktop` for `@sentropic/chat-ui` and `@sentropic/cowork-bridge`. Changes (ADDITIVE only): (1) add `typecheck-chat-ui-core` + `build-chat-ui-core` targets; (2) add `@sentropic/chat-ui-core` symlink to `typecheck-chat-ui` + `build-chat-ui`; (3) add `@sentropic/chat-ui-core` symlink to `typecheck-cowork-desktop`, `test-cowork-desktop`, `build-cowork-desktop`, `package-desktop-windows` (including a secondary symlink in `../chat-ui/node_modules/@sentropic/` so tsc resolves chat-ui-core from chat-ui's real path); (4) fix 12 shim import specifiers in `packages/chat-ui/src/` to drop `.js` suffix matching chat-ui-core's `exports` keys; (5) fix `packages/chat-ui/src/stores/chatWidgetLayout.ts` `.js` suffix. Rationale: resolution mechanism requires intra-workspace symlinks in the ephemeral Docker node_modules — no external network needed. Impact: minimal — only affects typecheck/build container resolution, not npm-published package semantics. Rollback: revert Makefile edits + shim `.js` suffix restores previous state.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as flaky accepted. Not applicable here (pure unit tests, no AI calls).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single package extraction, single test cycle, no parallel workstreams)
- Rationale: A1a is a single additive refactor with one test gate. No independent sub-workstreams.

## UAT Management
- **Mono-branch**: package-level gate only (`make test-chat-ui`). No app UAT in this lot — app build + chat e2e is the Tier-1 owner gate (post-PR).
- UAT is deferred to the PR owner gate (app build resolution + full chat e2e).

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules: `workflow.md`, `MASTER.md`, `subagents.md`
  - [x] Verify worktree branch: `git -C tmp/feat-chatui-core-extract branch --show-current` = `feat/chatui-core-extract`
  - [x] Read spec: `spec/SPEC_EVOL_CHATUI_WAVE_A.md` §2/§2.1 (export ownership matrix)
  - [x] STEP 1 scoping: inspect root `package.json` (workspaces), `ui/package.json` (file: deps), Makefile test target, imports in state/utils/renderers modules
  - [x] Linking approach: root uses npm workspaces (`packages/*`); `ui/package.json` uses `file:../packages/chat-ui` — new package `chat-ui-core` will use same `file:` pattern for `chat-ui` dep. For vitest resolution, add `vitest.config.ts` alias (A1a-EX1).
  - [x] Baseline test: `make test-chat-ui ENV=test-chatui-core` = 174 tests, 22 files, all passed
  - [x] Confirm scope boundaries and declare A1a-EX1

- [x] **Lot 1 — Create @sentropic/chat-ui-core@0.1.0 package**
  - [x] Create `packages/chat-ui-core/` directory structure
  - [x] Create `packages/chat-ui-core/package.json` (mirror chat-ui shape, no svelte peer dep)
  - [x] Create `packages/chat-ui-core/tsconfig.json` (mirror chat-ui tsconfig)
  - [x] Move `state/*` (6 files) into `packages/chat-ui-core/src/state/`
  - [x] Move `utils/*` (4 files) into `packages/chat-ui-core/src/utils/`
  - [x] Move `renderers/registry.ts` into `packages/chat-ui-core/src/renderers/`
  - [x] Move `ChatWidgetDisplayMode` type OUT of `stores/chatWidgetLayout.ts` into `packages/chat-ui-core/src/state/chatWidgetShell.ts` (break the cross-package edge)
  - [x] Update `chatWidgetShell.ts` (in core) to remove the store import
  - [x] Update intra-package imports in moved files (relative paths within core)
  - [x] Create `packages/chat-ui-core/src/index.ts` barrel re-exporting all moved exports
  - [x] Lot gate (core package standalone):
    - [x] Verify all moved files: zero `svelte`/`svelte/store` imports
    - [x] Verify intra-core imports all resolve correctly (no dangling `../stores/` references)

- [x] **Lot 2 — Update @sentropic/chat-ui façade (shims + version)**
  - [x] Replace each moved source file in `packages/chat-ui/src/` with a verbatim re-export shim (`export * from '@sentropic/chat-ui-core/<subpath>.js'`)
  - [x] Special case: `state/chatWidgetShell.ts` shim re-exports all of core's chatWidgetShell (incl. ChatWidgetDisplayMode)
  - [x] Update `stores/chatWidgetLayout.ts`: re-exports `ChatWidgetDisplayMode` from core, keeps Svelte writable store for subpath contract
  - [x] Bump `packages/chat-ui/package.json` version to `0.2.0`, add `"@sentropic/chat-ui-core": "file:../chat-ui-core"` dependency
  - [x] Add `packages/chat-ui/vitest.config.ts` with `resolve.alias` for `@sentropic/chat-ui-core` → `../chat-ui-core/src` (A1a-EX1)
  - [x] Lot gate: `make test-chat-ui ENV=test-chatui-core`
    - [x] Existing: `tests/export-surface.spec.ts` (70 tests) — passed UNCHANGED
    - [x] Existing: `tests/projection.golden.spec.ts` (20 tests) — passed UNCHANGED
    - [x] Existing: `tests/chat-projection.test.ts` (6 tests) — passed
    - [x] Existing: `tests/chat-draft.test.ts` (4 tests) — passed
    - [x] Existing: `tests/chat-widget-layout.test.ts` (5 tests) — passed
    - [x] Existing: `tests/stream-message-projection.test.ts` (3 tests) — passed
    - [x] Existing: `tests/stream-message-smoothing.test.ts` (3 tests) — passed
    - [x] Existing: `tests/renderer-registry.test.ts` (6 tests) — passed
    - [x] Existing: `tests/chat-attachments.test.ts` (3 tests) — passed
    - [x] All 22 test files passed, 174 tests total — identical to baseline

- [x] **Lot 3 — Docs + commit + PR**
  - [x] Commits (12 total): core package scaffold + all state/utils/renderers modules committed atomically; façade shims + vitest.config.ts + package.json 0.2.0 + BRANCH.md in one refactor commit
  - [x] Spec files `spec/SPEC_EVOL_CHATUI_WAVE_A.md` + `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md` were already committed in the A0a baseline (b8277393) — no additional commit needed
  - [x] `git push origin feat/chatui-core-extract` — pushed 12 commits ahead of main
  - [x] PR #213: https://github.com/rhanka/sentropic/pull/213 — base `main`, title tagged `[Tier-1 — needs owner gate: app build + chat e2e]`
  - [x] Confirmed PR NOT merged

## Deferred (out-of-scope for A1a)
- `stores/localTools` state-machine extraction (A1b) — keep as-is
- `client/*` move — keep in chat-ui façade
- `hosts/*` move — keep in chat-ui façade
- App-consuming wiring (`ui/package.json` file: dep on chat-ui-core) — Tier-1 owner gate
- Bootstrap publish of `@sentropic/chat-ui-core@0.1.0` to npm — post-PR owner task
- A0b DOM/visual harness (BR-EXn Makefile required)
- A3 radar P1-P3 primitives
