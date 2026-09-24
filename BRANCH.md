# Feature: Truthful CI E2E qualification

## Objective
- [ ] Make CI report every Playwright failure and qualify previously omitted suites.

## Scope / Guardrails
- [x] Worktree `tmp/ci-e2e-truthful`, branch `fix/ci-e2e-truthful`, baseline `75032fc85`.
- [x] Docker/make only; no local E2E; E2E runs exclusively in GitHub CI.
- [x] Unit environment `ci-truthful`, API `9166`, UI `5366`, Maildev UI `1266`; ENV last.
- [x] No assertion weakening, timeout increases, new skips, merge, or changes to parallel shell work.
- [x] Record every existing assertion change in `TEST_CHANGES.md` for independent review.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `TEST_CHANGES.md`
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `e2e/**`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/chat-ui/src/**`
  - `ui/src/lib/components/ChatWidget.svelte`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/src/**`
  - `ui/src/**`
- **Exception process**:
  - [x] Declare evidence, impact, and rollback before minimal product fixes.

## Feedback Loop
- [x] BRCI-EX1 — owner-authorized Makefile and `.github/workflows/ci.yml` exception: “E2E green in CI” requires truthful failure propagation, DOM execution, and complete selection. Impact: formerly green checks may fail; CI executes additional tests. Rollback: revert these changes.
- [x] Aggregation verified in Docker with simulated first/last failures, all successes, and scoped failure; all 55 numbered specs match, including five `09-*` specs. No local E2E executed.
- [x] Presence failure-only diagnostics read the API snapshot and rendered avatar titles without altering assertions; CI uses explicit `e2e-ci` / `e2e-vscode-ci` environments.

## AI Flaky tests
- [x] No exemptions accepted. All test invocations block CI.
- [x] Any proposed exemption requires the exact command, allowlisted spec, provider/network/model signature, same-commit successful execution, and user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] Mono-branch implementation; independent test review owned by the orchestrator.

## UAT Management (in orchestration context)
- [x] CI-only E2E evidence; no local browser qualification or root dev services.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, template, audit final qualification and CI inventory.
  - [x] Verify branch and mechanical harness branch gate.
  - [x] Re-verify CI masking, omitted DOM suite, and omitted spec prefixes.
- [ ] **Lot 1 — Truthful CI**
  - [x] Aggregate invocation exit codes and print a final group summary.
  - [x] Remove E2E continue-on-error and preserve the five matrix jobs.
  - [x] Run `test-chat-ui-dom`; include `07_comment_assistant` and all `09-*`.
  - [x] Validate node and DOM suites using make and isolated unit ports: 1015 node tests and 204 DOM tests passed.
- [ ] **Lot 2 — Hidden failure investigation**
  - [x] `e2e/tests/02-auth-oauth-revoke.spec.ts:18`: stored covering grant bypasses consent correctly; fixture now requests `prompt=consent`, preserving every assertion. CI retest pending.
  - [ ] `e2e/tests/01-organizations-detail.spec.ts:279`: inspect presence predicate and lock retry.
  - [ ] `e2e/tests/08-document-summary-formats.spec.ts:28`: inspect PDF failed status.
  - [x] `e2e/tests/05-i18n.spec.ts:184`: stale “use cases” warning strings conflict with shipped “initiatives” translations; corrected exact text, registered for independent review. CI retest pending.
  - [ ] Apply only evidenced product/fixture fixes and register assertion changes.
  - [x] Diagnose new 09 failures from run 35952497610: scope both multi-tool queue polls to the created workspace; align steering timeline locator with the shipped spacing class. CI retest pending.
- [ ] **Lot 3 — Docs consolidation**
  - [ ] Record root causes, test changes, and unresolved risks.
- [ ] **Lot 4 — Final validation**
  - [ ] Run scope gate before each atomic make commit.
  - [ ] Push and open draft PR with this file as its English body; do not merge.
  - [ ] Read actual per-group Playwright passed/failed/flaky/skipped summaries in CI logs.
  - [ ] Deliver report at `.h2a/runs/ci-truthful-build-astra/REPORT.md`.
