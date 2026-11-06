# Feature: GB1 build contract validation

## Objective
- [x] Validate the frozen G0 v3 descriptor from an exact-commit snapshot without executing code.

## Scope / Guardrails
- [x] Binding inputs: G0-FROZEN-v3.md §4, converged-r2 GB1, owner-decisions-2026-11-05-live.md.
- [x] Worktree `tmp/worktrees/gb1`, branch `feat/git-artifact-gb1`, initially from `origin/main`.
- [x] Target `train/artifacts-0.2.18`; rebase onto it when available; do not merge.
- [x] Wagon: no version bumps, lock regeneration, APP-P1 or L5 changes.
- [x] Ephemeral Sentropic builder is the future executor; GB1 only validates.
- [x] Docker commands through `.tmp/packets/docker-slot.sh`; make-only; ENV last.
- [x] Dedicated `ENV=test-gb1`; API_PORT=9355 UI_PORT=5555 MAILDEV_UI_PORT=1455; no services required.
- [x] Commits under 150 lines through `make commit`; scope-check before each commit.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/build-*.ts`
  - `packages/artifacts/src/server/failures.ts`
  - `packages/artifacts/package.json`
  - `packages/artifacts/tests/build-contract.test.ts`
  - `packages/artifacts/tests/fixtures/build-contract/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `package-lock.json`
- **Conditional Paths**: none.

## Feedback Loop
- [x] Track single-writer: this file is the mergeable source for conductor import; this lane does not write `.track/`.
- [x] Review: one consolidated review on the train per owner wagon rule.
- [ ] Train branch absent at initialization; rebase and target it before handoff.

## AI Flaky tests
- [x] No provider-dependent tests or accepted flakes.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: independent GB1 wagon, integrated by the train conductor.

## UAT Management (in orchestration context)
- [x] Pure validation module; acceptance through scoped contract tests; no browser surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read binding rules and contract; mechanically verify branch; retrieve Immo PR #1012 descriptor.
- [x] **Lot 1 — Descriptor and typed refusals**
  - [x] Closed descriptor, safe paths, named script, missing lock/script, receipt types and exported validator.
- [x] **Lot 2 — Locked dependency and install policy**
  - [x] Refuse external dependencies and registry escapes; allow pinned repository workspace links.
  - [x] Host-owned exact package/version/integrity allowlist; `npm ci --ignore-scripts` default.
- [ ] **Lot 3 — Validation and handoff**
  - [x] Added Immo fixture and typed rejection vectors in `tests/build-contract.test.ts`.
  - [x] Tightened script names, pinned closure and receipt types; corrected compile-time failure mapping.
  - [x] Scoped acceptance: 36 tests passed with package compilation; lint passed with zero errors.
  - [x] `make test-artifacts SCOPE=tests/build-contract.test.ts ENV=test-gb1` (includes package compilation).
  - [x] `make lint-artifacts ENV=test-gb1`; frozen tools/list regression.
  - [ ] Cleanup `make down-volumes ENV=test-gb1`; push; one READY PR; CI green; report `.tmp/rv/gb1.md`.
