# Fix: Normalize Nested Undici Socket Errors

## Objective
Normalize a nested, case-insensitive `UND_ERR_SOCKET` cause as a retryable network error without exposing arbitrary nested cause data.

## Scope / Guardrails
- Scope limited to `@sentropic/llm-mesh` error normalization and exact package tests.
- Make-only build, test, version-audit, and commit workflow.
- Branch worktree: `.tmp/llm-mesh-und-err-socket`.
- Automated tests use `ENV=test-llm-mesh-underr`, never `ENV=dev`.
- Ports are reserved as `API_PORT=9480`, `UI_PORT=5680`, `MAILDEV_UI_PORT=1580` if a stack-capable target is required.
- `ENV=test-llm-mesh-underr` is the last argument in every make command.
- No provider API calls, publication, push, PR, merge, tag, or release.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/errors.ts`
  - `packages/llm-mesh/tests/errors.test.ts`
  - `packages/llm-mesh/package.json`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - All other packages and application/runtime/UI paths
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.security/**`
  - Secrets and deployment manifests
- **Conditional Paths**:
  - None.
- **Exception process**:
  - Declare `BR-UND-EXn` in `## Feedback Loop` before touching any path outside the allowed list.

## Feedback Loop
- [x] **BR-UND-F1 — LOW — Direct undici socket errors**
  - [x] Reproduce Fable review finding: a top-level `UND_ERR_SOCKET` stayed non-retryable.
  - [x] Classify the exact top-level code through the same bounded allow-list traversal.
  - [x] Keep nested code promotion intentionally disabled; consumers use `retryReason: network`.
  - [x] Verify the focused seven-test regression suite passes.

## AI Flaky tests
- No provider/network/model calls are authorized; all tests must be hermetic and deterministic.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**
- [ ] **Multi-branch**
- Rationale: one package-local defect with one focused implementation and regression suite.

## UAT Management (in orchestration context)
- No UI surface is changed; package-local automated verification is the acceptance surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read repository rules, roadmap, package README, and LLM mesh specifications.
  - [x] Create the isolated worktree from `origin/main` and run `harness check branch`.
  - [x] Open `harness debug` and `harness test` acts.
  - [x] Confirm scope, environment, ports, and Make-only targets.
- [x] **Lot 1 — Failing regression tests**
  - [x] Add direct nested-cause, case-insensitive, unknown-code, and cycle-safe assertions.
  - [x] Add a hermetic local HTTP/SSE abrupt-close regression if supported by the package test harness.
  - [x] Run the exact test and confirm the expected pre-fix failure.
- [x] **Lot 2 — Minimal normalization fix**
  - [x] Add bounded, cycle-safe nested cause inspection for exact `UND_ERR_SOCKET` only.
  - [x] Preserve the outer normalized message/code/cause contract without copying nested text or fields.
  - [x] Re-run the exact regression test.
- [x] **Lot 3 — Publication metadata**
  - [x] Run the supported registry version audit target.
  - [x] Bump `@sentropic/llm-mesh` to the next valid patch and update the required lock manifest.
- [x] **Lot 4 — Final validation**
  - [x] Run `make lint-llm-mesh ENV=test-llm-mesh-underr`.
  - [x] Run `make typecheck-llm-mesh ENV=test-llm-mesh-underr`.
  - [x] Run the exact test and full `make test-llm-mesh ENV=test-llm-mesh-underr`.
  - [x] Run `make build-llm-mesh ENV=test-llm-mesh-underr` and `make pack-llm-mesh ENV=test-llm-mesh-underr`.
  - [x] Run `make scope-check ENV=test-llm-mesh-underr` before every commit.
  - [x] Run final `harness check scope` and `harness check branch`.
