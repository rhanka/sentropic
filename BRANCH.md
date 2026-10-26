# fix(artifacts): 0.2.2 listKeys prefix parity (memory = S3)

## Objective
- [ ] Make memory and S3 listKeys reject the same invalid prefixes through one validator.
- [ ] Release a compatible patch at 0.2.2; push a PR with green CI and do not merge.

## Scope / Guardrails
- [x] Base: origin/main; branch: fix/artifacts-0.2.2-listkeys-parity.
- [x] Worktree: tmp/worktrees/artifacts-022; make-only; no Python.
- [x] ENV=test-artifacts-022 always last; shared Docker flock for every build/test/cleanup.
- [x] Compose qualification has no host ports; no API/UI/Maildev services are started.
- [x] Keep packages/artifacts/l0-freeze byte-identical; no breaking API changes.
- [x] Selective staging; make commit only; each commit below 150 changed lines.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/blob-prefix.ts`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/adapters/s3.ts`
  - `packages/artifacts/tests/s3.integration.test.ts`
  - `packages/artifacts/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/artifacts/l0-freeze/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR022-EX1)
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record rationale, impact and rollback before editing conditional paths.

## Feedback Loop
- [x] BR022-EX1: acknowledge; owner: code author; 2026-10-26. Add test-artifacts-022 to existing Compose ENV selectors only. Required by the requested ENV and Docker lock; no recipe changes. Rollback: remove that ENV from the selectors.

## AI Flaky tests
- [x] No AI/provider tests in this package fix; no flaky acceptance requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one code author; independent review through harness when available.

## UAT Management (in orchestration context)
- [x] Package-only change; web, Chrome and VSCode UAT not applicable.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read Docker lock, project rules, template and relevant harness skills.
  - [x] Create worktree from origin/main; mechanical harness branch check passed.
  - [x] Identify existing Compose test, lint, typecheck, freeze and cleanup targets.
  - [x] Enable requested ENV in existing disposable Compose lane.
- [ ] **Lot 1 — Regression first**
  - [ ] Add a shared memory/S3 case matrix in tests/s3.integration.test.ts.
  - [ ] Exercise empty, embedded '..', valid matching and unmatched prefixes on real MinIO.
  - [ ] Observe memory regression failures before changing production code.
- [ ] **Lot 2 — Shared validation and patch version**
  - [ ] Add one shared prefix validator; both stores call it before enumeration/I/O.
  - [ ] Reuse typed invalid_request errors, preserve message, add stable invalid_blob_prefix code.
  - [ ] Verify published registry version and bump package.json to 0.2.2.
  - [ ] Re-run parity, unit suite, integration suite, lint, typecheck and frozen types.
- [ ] **Lot 3 — Review and delivery**
  - [ ] Review every diff hunk; resolve blocking findings.
  - [ ] Confirm l0-freeze unchanged and scope-check before each commit.
  - [ ] Push and open PR to main using this file as PR body.
  - [ ] Verify enforce-package-bump and all CI checks on exact head SHA.
  - [ ] Tear down isolated stack; report PR number, head SHA and CI URL.
  - [x] Do not merge or remove BRANCH.md for merge preparation.
