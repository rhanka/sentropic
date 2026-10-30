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
  - `api/Dockerfile`
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
- [x] BR1-EX3: API image compilation needs the new runtime's neutral UI type peer, while visual workspace inputs remain excluded from API identity; install pinned published build peers transiently and remove them after core compilation. Rollback restores the original core build RUN.
- [x] API build closure reproduced: hiding the absent visual workspace yields TS2307 for runtime peer contracts. Fix only the API builder's compilation dependency; server root and runtime execution stay unchanged.
- [x] API isolated build now passes the exact Dockerfile core build RUN with the visual workspace hidden; published build peers are removed by its EXIT trap.
- [x] Prepared P1 qualification passes UI typecheck, 533 unit/206 DOM tests, cowork desktop 52/bridge 27 tests, 217 manifest/25 policy tests, both guarded packs and installed-pair payload/remount/permission proof. #819 integration still waits for #836 merge.
- [x] Review F2 accepted: derive the qualification archive from guarded pack outputs so future core version bumps need no workflow path change.
- [x] Review F1 contested: chat-server's unchanged ^0.1.2 intentionally resolves published core 0.1.7; no server-root code/API changed. Updating an unrelated release's dependency is outside this packaging migration; core/runtime tests and clean archive probe directly qualify 0.2.0.
- [x] Merge origin/main c37662a20 without rebase; only BRANCH.md conflicts, keep this plan; inbound changes are W0 documentation, no Track/source changes.
- [x] Qualification passes for exact chat-core archive d4914ccbd260d09e074332f980d162e0e2c0e9a08ba15abc980f326501bee0cd: root without optional peers, all runtime entries with published peers.
- [x] Runtime/core 692 tests, manifest guard 217 tests, expected-CI/DAG 33 tests pass; source/build unchanged by main integration.
- [x] Packaging implementation slice 9 committed with mechanical scope validation.
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
- [x] **Lot 1 — Runtime sources and package contract**
  - [x] Relocate source and tests into chat-core runtime directories without behavior changes.
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
  - [x] Export compiled runtime entrypoints/types and reserve registry-verified minor version 0.2.0 above npm 0.1.7.
  - [x] Adapt source imports, fixtures, build/test dependencies and workspace lock metadata.
  - [x] Preserve existing chat-core root exports without browser runtime initialization.
- [x] **Lot 2 — Publication and validation wiring**
  - [x] Delete standalone package metadata/scripts, Make targets, workflow lane and manifest catalogs.
  - [x] Retain runtime behavior, package manifest, packed install and existing core gates.
  - [x] Document new public imports and unchanged release/ownership gates in chat-core README.
- [ ] **Lot 3 — Qualification and review**
  - [x] Core typecheck/build and 692 core/runtime tests pass; permission/replay/history/transport/optional modules retained; 81.05% line coverage.
  - [x] Run manifest guard and CI policy tests; pack and qualify exact chat-core archive.
  - [ ] Obtain complementary review and resolve findings.
  - [ ] Run make scope-check before every commit; verify final diff and clean up test environment.
- [ ] **Lot 4 — Draft PR and downstream update**
  - [x] Open draft PR #836 to main using this plan; exact-head CI remains pending.
  - [ ] Adapt all #819 imports/dependencies to chat-core/runtime and the new minor.
  - [ ] After packaging PR merges, merge origin/main into #819; never rebase.
  - [ ] Monitor #819 CI to green; report both PR links and heads.
