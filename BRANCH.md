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
  - `api/tests/api/cluster-mesh-streams-cutover.test.ts`
  - `package-lock.json`
  - `api/package-lock.json`
- **Exception process**:
  - [x] Declare evidence, impact, and rollback before minimal product fixes.

## Feedback Loop
- [x] BR600-EX3 — PDF failure in CI 35953479640 is missing `@napi-rs/canvas`, causing `DOMMatrix is not defined`. Both lockfiles omit pdfjs-dist 5.5.207 optional dependencies present in registry metadata. Allow restoring that dependency closure in both lockfiles; impact: PDF.js Node polyfills installed in production; rollback: revert lockfile repair. Generated platform records exceed the usual 150-line commit budget and stay atomic to preserve a complete dependency graph.
- [x] BR600-EX2 — presence startup race proven in CI 35953479640: both POST presence requests precede SSE connection; A retains its one-user snapshot. Allow `api/src/routes/namespaces/streams.ts` and its cutover regression test to send an initial heartbeat after LISTEN is ready. Impact: existing presence clients immediately reannounce on connection; rollback: revert this change.
- [x] BR600-EX1 — owner-authorized Makefile and `.github/workflows/ci.yml` exception: “E2E green in CI” requires truthful failure propagation, DOM execution, and complete selection. Impact: formerly green checks may fail; CI executes additional tests. Rollback: revert these changes.
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
  - [x] CI 35953479640 proves presence startup notification loss; initial SSE heartbeat and regression added. Lock-on-leave fixture isolates its departing user from parallel SSE sessions; CI verification pending.
  - [x] Push presence changes for parallel CI qualification while the isolated local API image finishes building; scoped regression gate remains pending and is not claimed passed.
  - [ ] `e2e/tests/08-document-summary-formats.spec.ts:28`: inspect PDF failed status.
  - [x] Restore the missing PDF.js optional dependency closure; Docker Node 24 Alpine clean workspace npm ci then production prune extracts 312 characters from the real PDF fixture. CI summary verification pending.
  - [x] `e2e/tests/05-i18n.spec.ts:184`: stale “use cases” warning strings conflict with shipped “initiatives” translations; corrected exact text, registered for independent review. CI retest pending.
  - [ ] Apply only evidenced product/fixture fixes and register assertion changes.
  - [x] Diagnose new 09 failures from run 35952497610: scope both multi-tool queue polls to the created workspace; align steering timeline locator with the shipped spacing class. CI retest pending.
  - [x] Replace the multi-tool fixture's local Gemini quota workaround with the OpenAI model already exercised in CI; retain every behavior assertion and document the rejected Gemini credential separately. CI verification pending.
- [ ] **Lot 3 — Docs consolidation**
  - [ ] Record root causes, test changes, and unresolved risks.
- [ ] **Lot 4 — Final validation**
  - [ ] Run scope gate before each atomic make commit.
  - [ ] Push and open draft PR with this file as its English body; do not merge.
  - [ ] Read actual per-group Playwright passed/failed/flaky/skipped summaries in CI logs.
  - [ ] Deliver report at `.h2a/runs/ci-truthful-build-astra/REPORT.md`.
