# Feature: Fix retained live-draft outage qualification

## Objective
- [x] Make the retained encrypted draft outage conformance deterministic across calendar dates while preserving the specified unavailable and expiry outcomes.

## Scope / Guardrails
- [x] Isolated worktree `tmp/worktrees/artifacts-live-drafts`, branch `fix/artifacts-live-drafts-outcome`, base `12af1431a2b4b6e80b08ae3f997bd51b34da612a`.
- [x] Make-only, Docker-first; Docker commands use the shared docker-slot wrapper; no timeout increases.
- [x] Environment `test-artifacts-drafts`; API_PORT=9685, UI_PORT=5885, MAILDEV_UI_PORT=1785 checked free with `ss -ltn`.
- [x] No dev environment, clean-all, merge, or unrelated changes.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No scope exception required.

## Feedback Loop
- [x] Track source is this branch file; import remains with the conductor as designated single writer; no concurrent `.track` writes.

## AI Flaky tests
- [x] No AI tests or flaky acceptance apply.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, independent read-only code review; no integration or cherry-pick.

## UAT Management (in orchestration context)
- [x] No UI surface changes; memory and Postgres conformance qualify the behavior.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Reproduce and establish contract**
  - [x] Read master, workflow, testing, common packet, draft source, conformance fixture and live-tools contract.
  - [x] Mechanical `harness check branch` passes.
  - [x] Reproduced memory (8 pass, 1 fail) and Postgres (10 pass, 1 fail) on origin/main through scoped make targets.
  - [x] `391c2fa76cdc9b55c29e71465ae3393979e28fc0` introduced the key-outage vault without the fixture clock; its real clock expires the November 6 draft on November 13 at 12:00 UTC before key access.
  - [x] `docs/live-tools.md:51` specifies seven-day retention and prior revision preservation on save failure; production expiry precedence is correct.
- [x] **Lot 1 — Minimal deterministic qualification fix**
  - [x] Share the injected fixture clock with the key-outage vault in `packages/artifacts/tests/fixtures/live-draft-conformance.ts`.
  - [x] Preserve exact unavailable assertion and revision rollback checks; keep expiry conformance unchanged.
  - [x] `make test-artifacts -o build-artifacts SCOPE=tests/live-drafts.test.ts API_PORT=9685 UI_PORT=5885 MAILDEV_UI_PORT=1785 ENV=test-artifacts-drafts`: 9 passed; reused unchanged build produced during baseline reproduction.
  - [x] `make test-artifacts-integration -o build-artifacts SCOPE=tests/live-drafts.integration.test.ts API_PORT=9685 UI_PORT=5885 MAILDEV_UI_PORT=1785 ENV=test-artifacts-drafts`: 11 passed.
- [ ] **Lot 2 — Final validation and handoff**
  - [x] Two independent Astra high code reviews (contract/root cause and regression/minimality): APPROVE, no blocking findings; assertions and production behavior unchanged.
  - [x] Package source unchanged; version bump not applicable.
  - [x] Mechanical `make scope-check` passes C2; `git diff --check` passes before atomic `make commit`.
  - [ ] Push and open PR with this file as body; CI green on exact head; do not merge.
  - [x] `make down-volumes API_PORT=9685 UI_PORT=5885 MAILDEV_UI_PORT=1785 ENV=test-artifacts-drafts`; `make ps` confirms no remaining services.
  - [ ] Write French report and completion marker under `.tmp/rv/artifacts-live-drafts-fix`.
