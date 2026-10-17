# Feature: Fix artifact activation ticket binding (FL-ACT)

## Objective
- [ ] Bind each activation ticket to one subject, artifact, release, channel and expiry; refuse activation of any other revision.

## Scope / Guardrails
- [x] Baseline: `origin/main` at `1472d961e098908e64ef60b83835af357888d031` (#679).
- [x] Worktree: `tmp/worktrees/artifacts-activation-binding`; branch: `fix/artifacts-activation-binding` (mechanical harness check passed).
- [x] Make-only container tooling; no image rebuild unless required by the existing target; never merge or publish.
- [x] Dedicated `ENV=test-artifacts-fl-act`, always last; no application services or exposed ports required by unit/content tests.
- [x] Preserve root dev/UAT and unrelated work; English source/docs; selective staging and `make commit`; commits at most 150 lines.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**: `packages/artifacts/**`, `BRANCH.md`, `package-lock.json` (only the required artifacts workspace version update).
- [x] **Forbidden Paths (must not change in this branch)**: `Makefile`, `docker-compose*`, `.github/**`, `.cursor/rules/**`, consumers and unrelated packages.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**: none beyond the packet's allowed paths.
- [x] **Exception process**: record `BRxx-EXn` reason, impact and rollback before any scope expansion; none authorized.

## Feedback Loop
- [x] FL-ACT-READ: `acknowledge` — packet's `.cursor/rules/*.mdc` paths are absent; loaded consolidated equivalents in `rules/`; owner: branch agent, 2026-10-17.
- [x] Requested delivery report is an ignored runtime artifact at `.h2a/build/artifacts_fl_act_report.md`, outside the committed implementation diff.
- [x] FL-ACT-NPM: `acknowledge` — container `npm view @sentropic/artifacts version` returned public-registry E404; retain packet's explicit 0.1.1 candidate; owner: branch agent, 2026-10-17.

## AI Flaky tests
- [x] No AI tests or timeout changes; deterministic in-memory tests only for the affected activation surface.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**: one owner, no integration or cherry-pick required.
- [ ] **Multi-branch**: not applicable.

## UAT Management (in orchestration context)
- [x] Package-only transport-free behavior; automated handler journeys provide qualification; web app, Chrome and VSCode surfaces unchanged.
- [x] No root dev/UAT campaign or browser/domain/TLS changes required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and RED reproduction**
  - [x] Read rules, template, README/TODO/PLAN context, ticket service, handler, routing and existing tests.
  - [x] Verify branch mechanically and inspect `make ps-all ENV=test-artifacts-fl-act` before any package execution (no services).
  - [x] Update existing `packages/artifacts/tests/content.e2e.test.ts`: issue for r1, republish r2, attempt activation on the stable origin; assert 401 and no cookie.
  - [x] RED gate: `make test-artifacts SCOPE=tests/content.e2e.test.ts ENV=test-artifacts-fl-act`; confirmed 200 instead of 401 before changing source (1 failed, 1 passed).
  - [x] Commit RED test and detailed plan after `make scope-check ENV=test-artifacts-fl-act`.
- [x] **Lot 1 — Exact activation binding and patch version**
  - [x] Update `packages/artifacts/src/content/grants.ts`: mandatory release/channel binding at issuance and redemption; subject/artifact checks and single-use semantics preserved; expiry refused at its boundary.
  - [x] Update `packages/artifacts/src/content/handler.ts`: redeem against resolved release and origin channel.
  - [x] Update existing `packages/artifacts/tests/content.e2e.test.ts` activation helper to issue explicit release/channel tickets.
  - [x] Query published npm version through container Make tooling (E404); bump `packages/artifacts/package.json` from 0.1.0 to 0.1.1 and synchronize only its lock workspace version.
  - [x] GREEN gate: `make test-artifacts SCOPE=tests/content.e2e.test.ts ENV=test-artifacts-fl-act` (2 passed).
  - [x] Commit fix after `make scope-check ENV=test-artifacts-fl-act`.
- [ ] **Lot 2 — Binding negatives and automated UAT**
  - [ ] Update existing `packages/artifacts/tests/content-grants.test.ts`: wrong subject/artifact/release/channel, missing binding, exact expiry, retry after mismatch, replay and concurrent redemption.
  - [ ] Update existing `packages/artifacts/tests/content.e2e.test.ts`: channel/release mismatch denies cookie; valid pinned r1 remains usable after stable republish; successful redemption remains single-use.
  - [ ] API/package tests: only the two existing content test files above are updated; no new test file or API application tests.
  - [x] UI tests: existing/updated/new files: none; no UI change.
  - [x] Browser E2E tests: existing/updated/new files: none; content journey is in-memory through `test-artifacts SCOPE=tests/content.e2e.test.ts`.
  - [ ] Scoped gate: `make test-artifacts SCOPE=tests/content-grants.test.ts ENV=test-artifacts-fl-act`.
  - [ ] UAT: publish r1; issue its stable ticket; publish r2; redeem old ticket on stable; verify 401 and absent Set-Cookie.
  - [ ] UAT: issue pinned r1 ticket; attempt stable/channel or r2 redemption; verify denial; retry pinned r1; verify activation and r1 bytes.
  - [ ] UAT: change subject/artifact or advance clock to expiry; verify rejection; redeem valid ticket once and refuse replay.
  - [ ] Commit regression coverage after `make scope-check ENV=test-artifacts-fl-act`.
- [ ] **Lot 3 — Docs consolidation**
  - [ ] Update `packages/artifacts/README.md` to document explicit release/channel ticket binding and expiry; no temporary spec required for this bounded fix.
- [ ] **Lot 4 — Final validation and delivery**
  - [ ] `make typecheck-artifacts ENV=test-artifacts-fl-act` and `make lint-artifacts ENV=test-artifacts-fl-act`.
  - [ ] `make test-artifacts ENV=test-artifacts-fl-act` (all unit tests) and `make test-artifacts SCOPE=tests/content.e2e.test.ts ENV=test-artifacts-fl-act` (content journey).
  - [x] Database/S3 integration and application/browser suites are outside the unchanged storage/UI surfaces; CI runs required selected gates.
  - [ ] Review exact diff, package version and scope; record review evidence or any unavailable review prerequisites.
  - [ ] Push `fix/artifacts-activation-binding` without merging/publishing; create PR using this file as body; post a 3–6 step plan comment.
  - [ ] Watch branch CI to completion and resolve failures within authorized scope.
  - [ ] `make down ENV=test-artifacts-fl-act` and `make ps ENV=test-artifacts-fl-act`; retain BRANCH.md because merging is forbidden.
  - [ ] Write `.h2a/build/artifacts_fl_act_report.md`: changes, RED/GREEN, checks/CI, feedback, risks, scope and read set.
