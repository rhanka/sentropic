# Feature: Fold the client runtime into chat-core

## Objective
- [ ] Publish the existing client runtime through `@sentropic/chat-core/runtime` using chat-core's established OIDC publisher.

## Scope / Guardrails
- [x] Packaging decision supplied by conductor; P0 ownership and P1/P2/P5/U0 gates unchanged.
- [x] Branch `feat/chat-runtime-into-core` from `origin/main`; worktree `tmp/feat-chat-runtime-into-core`.
- [x] No UI implementation in runtime; views receive injected ports and import runtime types only.
- [x] Remove the standalone package, publisher, bootstrap and catalog entries without aliases.
- [x] ENV=test-chat-p1 last; API_PORT=8796 UI_PORT=5196 MAILDEV_UI_PORT=1096.
- [x] Serialize Docker with `.tmp/packets/DOCKER-LOCK.md`; make down after qualification.
- [x] Make targets only; no Python, dev tests, rebase, force push or manual publication.
- [x] Atomic make commits at most 150 changed lines, excluding unchanged renames; no AI trailers.
- [x] Preserve root changes and Track single-writer custody; no Track writes.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/chat-runtime/**`
  - `packages/chat-core/**`
  - `package-lock.json`
  - `scripts/ci/**`
  - `spec/CHAT_MIGRATION_P1.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `.cursor/rules/**`
  - `docker-compose*.yml`
  - `api/src/**`
  - `ui/src/**`
  - `packages/chat-ui/src/**`
  - `spec/CHAT_MIGRATION_P0*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] BR1-EX1: conductor explicitly requires Makefile package build/test/pack/publish rewiring; impact limited to runtime integration; rollback restores standalone targets.
  - [x] BR1-EX2: conductor explicitly requires workflow publisher/filter/bootstrap removal and unchanged validation gates under chat-core; rollback restores runtime lane.

## Feedback Loop
- [x] Packaging implementation slice 8 committed with mechanical scope validation.
- [x] Packaging implementation slice 7 committed with mechanical scope validation.
- [x] Packaging implementation slice 6 committed with mechanical scope validation.
- [x] Packaging implementation slice 5 committed with mechanical scope validation.
- [x] Packaging implementation slice 4 committed with mechanical scope validation.
- [x] Packaging implementation slice 3 committed with mechanical scope validation.
- [x] Packaging implementation slice 2 committed with mechanical scope validation.
- [x] Owner instruction: find another plan with no interactive npm login; use existing chat-core OIDC custody.
- [x] #819 is `feat/chat-convergence-p1b` at `7a5285c26`; migrate after preparing this draft; merge origin/main only after this PR merges.
- [x] Review author metadata: host codex; requested model gpt-6.1-sol; effort high.

## AI Flaky tests
- [x] No AI provider acceptance requested by this packaging migration.

## Orchestration Mode (AI-selected)
- [x] Multi-branch sequence: runtime packaging draft then existing #819 consumer adaptation; merge only.

## UAT Management (in orchestration context)
- [x] Packaging qualification is automated; personal owner U0 and transfer GO remain separate gates.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read master/workflow/testing, P0 boundary, manifests and publication targets.
  - [x] Create isolated worktree and pass mechanical harness branch check.
- [ ] **Lot 1 — Runtime sources and package contract**
  - [ ] Relocate source and tests into chat-core runtime directories without behavior changes.
  - [x] Relocation slice 11 committed as unchanged source/test moves.
  - [x] Relocation slice 10 committed as unchanged source/test moves.
  - [x] Relocation slice 9 committed as unchanged source/test moves.
  - [x] Relocation slice 8 committed as unchanged source/test moves.
  - [x] Relocation slice 7 committed as unchanged source/test moves.
  - [x] Relocation slice 6 committed as unchanged source/test moves.
  - [x] Relocation slice 5 committed as unchanged source/test moves.
  - [x] Relocation slice 4 committed as unchanged source/test moves.
  - [x] Relocation slice 3 committed as unchanged source/test moves.
  - [x] Relocation slice 2 committed as unchanged source/test moves.
  - [x] Relocation slice 1 committed as unchanged source/test moves.
  - [ ] Export compiled runtime entrypoints/types and reserve registry-verified minor version.
  - [ ] Adapt source imports, fixtures, build/test dependencies and workspace lock metadata.
  - [ ] Preserve existing chat-core root exports without browser runtime initialization.
- [ ] **Lot 2 — Publication and validation wiring**
  - [ ] Delete standalone package metadata/scripts, Make targets, workflow lane and manifest catalogs.
  - [ ] Retain runtime behavior, package manifest, packed install and existing core gates.
  - [ ] Document new public imports and unchanged release/ownership gates.
- [ ] **Lot 3 — Qualification and review**
  - [ ] Run core typecheck/build and all existing core/runtime tests, including permission/replay/history/transport/optional modules.
  - [ ] Run manifest guard and CI policy tests; pack and qualify exact chat-core archive.
  - [ ] Obtain complementary review and resolve findings.
  - [ ] Run make scope-check before every commit; verify final diff and clean up test environment.
- [ ] **Lot 4 — Draft PR and downstream update**
  - [ ] Open draft PR to main using this plan; monitor exact-head CI to green.
  - [ ] Adapt all #819 imports/dependencies to chat-core/runtime and the new minor.
  - [ ] After packaging PR merges, merge origin/main into #819; never rebase.
  - [ ] Monitor #819 CI to green; report both PR links and heads.
