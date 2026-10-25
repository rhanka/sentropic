# Feature: Publication adversarial qualification (#861 L8a)

## Objective
- [x] Deliver the r2 publication boundary matrix and explicit defect evidence on real PostgreSQL and S3-compatible storage.

## Scope / Guardrails
- [x] Spec r2 S4/L8a, sections 3.2 and 6.3; Q1/Q2/Q3/Q4 read.
- [x] Worktree `tmp/worktrees/861-L8a`; branch `feat/artifacts-861-L8a`.
- [x] Base integration `34d467972`; merged L6 `e67a978f9` without rebase.
- [x] ENV `test-861-l8a`; API_PORT=13338, UI_PORT=9538, MAILDEV_UI_PORT=5438.
- [x] Shared Docker flock; Compose-only existing targets; teardown after every step; no Python.
- [x] Specific-file staging; make commit; fewer than 150 authored lines per commit.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/tests/commit-publication-boundary.integration.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/src/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] L6 changes are inherited merge ancestry; no authored product changes.

## Feedback Loop
- [x] D1, owner L4: `packages/artifacts/src/server/publication.ts:463` records attempts without invocationId. Ordinary test failed on the missing durable field; retained as `[known failure D1]` with `it.fails`.
- [x] D2, owner L4: `packages/artifacts/src/server/publication.ts:481` does not invoke coordinator preparationTestHooks around S3. Ordinary test observed only five coordinator points and none of the three S3 points; retained as `[known failure D2]` with `it.fails`.
- [x] Full ordinary run: 24 passed / 2 failed / 0 skipped on real PG/MinIO; failures are D1/D2, with JSON receipt `tmp/l8a-results.json`.
- [x] Final runtime run: 24 passed / 2 expected fail / 0 skipped; test source SHA-256 `fe5fed84e2f511b68ec50fec349a676208480ec341247703ac854a064a0fdd42`; JSON SHA-256 `a8e3f2bd810c0a7bc399ccaa8279e5ff6619b05ac85354d67de7a5538f90ede1` at `tmp/l8a-final-results.json`.
- [x] Dedicated strict test compilation identified three untyped query results; corrected only their TypeScript row annotations.
- [x] Radar read-only pins: A1 `f2b6c25cc9458ec285d6d4f620a55dad8c30f909`, A2 `b104ae90a28a5581e8eabd15f12acb58558d3396`, PR908 `e2e9515ea41baebf5539743f0cfa0dea750d072c`, main `2dbde92e9a6c532abe4f9e7bed8ed9a9b381d530`.
- [x] Radar A1 commit-probe SHA-256 `9b0f7e0d374e47b10fb855c13edd832be480f7faf148f1dd94569265300228a2`; finalization SHA-256 `577dd2e21575b08ee5740280fa7cee12cde7586b85db09f1dfbbe92b023dcf75`; runner SHA-256 `a0090dd397de94e52be3811dec02543c2de8c2f18a47bd388acb5f385b77d3fa`.
- [x] Radar pinned lock SHA-256 `6caab914f246e0b7cc2c665724a07ef979ea1fa8edf7d8105a5ff475a6b8092f`; baseline artifacts is 0.1.2, not a packed-candidate receipt. Original checkout is read-only; runner uses an A1 git archive in this lane's scratch directory and Compose project `test-861-l8a`.
- [x] Radar Q1 blockers at pinned helper `api/tests/integration/artifacts-provider-contract.helpers.ts:501` and `:526`: coordinator registration and host composition unconditionally raise `[missing-contract]`. Required cleanup observer/scheduler is also absent. Owner: Radar composition maintainer and L4; acceptance: replace named joints, retain all assertions, rerun enabled suites against L8d's strict packed tuple.
- [x] Radar A2 does not contain `api/tests/integration/artifacts-provider-failures.spec.ts`; no Q2 file digest is fabricated. Q2 receipt remains with L8c/Radar.
- [x] Enabled Radar baseline run completed: commit-probe 4 passed; finalization Q1 31 failed (29 missing 0.2 contracts, 2 explicit H3 not-covered failures), 0 skipped. Strict pinned `npm ci` and migrations succeeded. This reproduces baseline limitations; packed/published qualification remains blocked on the candidate tuple and the named Q1 joints.
- [x] BASE #910 `ccb91aea` retired the route still called by Radar `packages/immo-mcp/src/data-source.ts:316`; current-main runs must account for CT-3/CT-9.
- [x] Missing Radar H3 quota/admission integration remains explicitly not covered; generic provider tests cannot qualify Q4 activation.
- [x] Temporary Make overlay selects the existing isolated Compose runner for this lane and host harness for scope checks.
- [x] First run: all eight expiry denials and eight real-lock cases reached their invariants; corrected replay comparisons to the public receipt, excluding internal transaction timestamps.

## AI Flaky tests
- [x] No AI-dependent cases or timeout increases.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: independent L8a qualification; integration owns product corrections and tuple changes.

## UAT Management (in orchestration context)
- [x] Package qualification only; consumer UAT belongs to the integrated tuple.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read lock, rules, template, specification and Radar pins; mechanical branch check passed.
  - [x] Create worktree from integration and merge L6.
- [x] **Lot 1 — Publication boundary matrix**
  - [x] Add `packages/artifacts/tests/commit-publication-boundary.integration.test.ts` with real PG/S3 fixture.
  - [x] Add expiry denial/retry/replay matrix at eight publication waits with independent DB/S3 reads.
  - [x] Add same-key two-process S3 races for identical and changed commands; one receipt and quota charge.
  - [x] Exercise policy/lifecycle serialization, purge claims and bounded shared-blob cleanup via explicit GC; automatic cleanup scheduling is not proven.
  - [x] Add real S3 shared/exclusive cleanup, durable purge claims and preparation invocation attribution assertion.
  - [x] Add real PG key/quota/policy/ACL/lifecycle lock waits and both writer orders.
  - [x] Keep demonstrated product defects D1/D2 as known-failure tests with file:line evidence; no product edits.
- [ ] **Lot 2 — Qualification and handoff**
  - [x] Run scoped integration tests, strict test typecheck and scoped ESLint under the shared lock; all non-known-failure checks passed.
  - [x] Pin hashes and run Radar baseline commit-probe/finalization suites read-only; record missing candidate prerequisites.
  - [x] Merge integration `be22b0563` after its L6 merge lands; no rebase.
  - [ ] Scope-check each commit, push, open draft PR targeting `feat/immo-861-integration`.

## Validation commands and receipts
- [x] Runtime command: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f /tmp/861-l8a-ops.mk -o build-artifacts test-artifacts-integration SCOPE='tests/commit-publication-boundary.integration.test.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose --reporter=json --outputFile=../../tmp/l8a-final-results.json' API_PORT=13338 UI_PORT=9538 MAILDEV_UI_PORT=5438 ENV=test-861-l8a`.
- [x] Quality command: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f Makefile -f /tmp/861-l8a-ops.mk sh-api API_PORT=13338 UI_PORT=9538 MAILDEV_UI_PORT=5438 ENV=test-861-l8a`, stdin `sh /workspace/tmp/861-l8a-run.sh quality`; result `QUALITY_OK`: production compilation, strict standalone test compilation, scoped ESLint.
- [x] Compose qualification image: `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`; Compose file SHA-256 `b4e609883e1f77eaf64672f34661df4058054177a652c376c8dbffde04412e95`.
- [x] Authored test SHA-256 after three type-only query annotations: `5585183a684284d74d9ef957b3368e0e6dde52fc73dfb692531126dfcca10964`.
- [x] Radar baseline command from `tmp/radar-l8a`: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f tools/artifact-host.mk -f /tmp/861-l8a-radar-ops.mk test-api SCOPE='api/tests/integration/artifacts-commit-probe.spec.ts api/tests/integration/artifacts-finalization-authorization.spec.ts --maxWorkers=1 --no-file-parallelism' ARTIFACTS_PROVIDER_ACCEPTANCE=1 API_PORT=13338 UI_PORT=9538 MAILDEV_UI_PORT=5438 ENV=test-861-l8a`.
- [x] Radar baseline JSON SHA-256 `706b4027770ea50c388a06c15df1ce728d711aa6c551a4e0180476897f37911e`; log SHA-256 `7fee88269e687c7cca0b51ae1b1ba1696c12d641437c2fa75c21ce831c663570`, under `tmp/radar-l8a/tmp/artifact-host/test-861-l8a/`.
- [x] Mechanical branch/scope checks passed; all authored commits change fewer than 150 lines. Merge commits preserve their two parents; `.track/events.jsonl` is byte-identical in both parents and the integration merge.
