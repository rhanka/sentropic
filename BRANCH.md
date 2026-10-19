# Fix: PR 700 CI failures after MCP-L5 Lot 1 qualification

## Objective
- [ ] Resolve the failing API AI and E2E jobs at 945bbcf67195e56db9583b795fe74fc2a37551b0, push the repairs and report HEAD without merging.
- [x] Preserve the completed Lot 1 implementation and immutable P1; its full plan remains at 945bbcf67^:BRANCH.md.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/memory-mcp-l5-lot1, branch feat/memory-mcp-l5-lot1; git pull --ff-only current and harness check branch PASS.
- [x] Slot BR-125: API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725; ENV=test-feat-memory-mcp-l5 or ENV=e2e-feat-memory-mcp-l5, always last.
- [x] Make-only Docker execution, one build at a time; atomic commits via make commit, no attribution.
- [x] Owner authorized branch CI repair and push; do not merge.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`.
  - [x] L5-EX4: `api/src/services/context-initiative.ts`, `api/tests/unit/context-initiative-detail-contract.test.ts`.
  - [x] L5-EX4: `api/src/services/lock-service.ts`, `api/tests/unit/lock-service.test.ts`.
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `rules/**`, `.track/**`, `.security/**`, `plan/**`, `PLAN.md`.
  - [x] All other paths, including package sources, frozen P1 artifacts, UI sources and CI workflows.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None.
- [x] **Exception process**:
  - [x] L5-EX4 authorized by the owner's CI repair request on 2026-10-19: permit the four exact API paths above previously outside Lot 1 scope. Rationale: logs prove PostgreSQL NUL rejection and concurrent same-owner acquisition returning 409. Impact: normalize generated strings and preserve same-owner lock idempotence. Rollback: revert the two bounded fixes and tests; no schema or package change.

## Feedback Loop
- [x] CI run 39187155345 API job 117857240980: executive-summary-auto.test.ts:104 fails after initiative detail persistence rejects NUL, PostgreSQL 22P05, not a runner/network failure.
- [x] Same run E2E job 117858620902: 05-usecase-detail.spec.ts:690 expects 201, receives 409; two initial acquisitions in workspace c86c7448-a1f5-4e93-9fd5-400b470226eb return 201/409 within one millisecond. The unique-insert collision path does not recognize the same owner.
- [x] ci-gate is downstream of those two failed jobs; no independent failure.

## AI Flaky tests
- [x] No waiver, retry or timeout increase; repair the demonstrated application defects.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single writer, no delegated implementation or branch integration.

## UAT Management (in orchestration context)
- [x] Existing lock/presence E2E scenario exercises the user workflow; no UI change.

## Plan / Todo (lot-based)
- [x] **Lot 0: evidence and constraints**
  - [x] Read failing logs using gh run view --log-failed; empty output required direct GitHub job-log API retrieval.
  - [x] Read service paths and existing tests, reserve isolated ports and inspect running services.
- [x] **Lot 1: generated initiative text**
  - [x] Reproduce NUL propagation in context-initiative-detail-contract.test.ts with scalar, list and nested strings: all three added cases fail before the fix.
  - [x] Strip decoded NUL while preserving Unicode, whitespace and literal escape text; scoped suite PASS, 5 tests covering raw, wrapped and repaired JSON.
- [x] **Lot 2: lock acquisition race**
  - [x] Reproduce concurrent same-owner acquisition in lock-service.test.ts: original service reports one success and seven false conflicts.
  - [x] Recognize the persisted owner after an insert collision; scoped lock suite PASS, 7 tests including same-owner concurrency and other-owner refusal; commit the bounded service correction with its regression.
- [ ] **Lot 3: final verification and push**
  - [x] API typecheck and lint PASS (0 lint errors); NUL regression suite 5/5 and lock suite 7/7 PASS after reproducing both failures.
  - [x] Exact failing AI slice PASS locally: make test-api-ai SCOPE='tests/ai/chat-sync.test.ts tests/ai/executive-summary-auto.test.ts tests/ai/comment-assistant.test.ts', 10/10 tests, including automatic executive summary generation.
  - [ ] Run API typecheck/lint and targeted API suites; run existing E2E group 05/07 on built artifacts or verify CI.
  - [ ] Run make scope-check before each commit; inspect the complete repair diff.
  - [ ] Push, monitor CI, report cause, fix and exact HEAD; do not merge.
