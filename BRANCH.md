# Feature: Security autofix S2a Make scan adapter

## Objective
- [ ] Deliver the credential-free `security-daily-scan` Make adapter and raw scan orchestration from approved spec r4 section 9; estimate 3–5 h, dependency S1 approval.

## Scope / Guardrails
- [x] Owner authorized implementation on 2026-10-26; draft PR to main stacked on S1 #732, no merge.
- [x] Base: corrected S1 head `76c745d5a89eaa8362a914d07604d563489b9f67`, including the merge of main `365e8b313`; S2a changes only this plan before approval.
- [x] Work only in `tmp/worktrees/sec-s2a` on `feat/security-autofix-s2a`.
- [ ] Use Make targets only, zero Python, no AI commit trailers, selective staging and `make commit`; each new commit stays below 150 changed lines.
- [ ] Use the shared Docker lock for every image build, container start and test; release it between steps and clean with locked `make down ENV=test-sec-s2a` after each step.
- [x] Pass `ENV=test-sec-s2a` last; run fixture targets without application services or host port bindings.
- [ ] Preserve the public-repository model, required PR gates, vulnerability register, disabled auto-fix and L5 class.
- [ ] No scheduler, credentials, collector, publication, repair, merge actor or runtime activation.
- [ ] Keep image/DB qualification in S2b and native Rust SAST qualification in S2c; unqualified surfaces remain explicit blockers.
- [ ] Keep the root worktree and all other sessions' containers, volumes and environments untouched.
- [ ] Use English for repository text and keep all implementation changes within the paths below.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/daily/scan.mjs`
  - `scripts/security/daily/scan.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.security/**`
  - `api/Dockerfile`
  - `ui/Dockerfile`
  - `packages/**`
  - `tools/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (SECDAILY-EX1, only the two adapter recipes below)
- **Exception process**:
  - [ ] Declare any additional exception with rationale, impact and rollback in this feedback loop before editing.

## Feedback Loop
- [x] SECDAILY-EX1 predeclared by approved r4 for S2a: edit only `security-daily-scan` and `test-security-daily` recipes in `Makefile`; reuse the existing pinned credential-free Node test lane. Impact: explicit raw scanner orchestration and its regression target; existing gates and deploy recipes remain unchanged. Rollback: revert these adapter recipes and scan files, keeping activation disabled.
- [x] S1 dependency: owner confirms Opus r2 approval of corrected #732 head `76c745d5a`.
- [ ] Track import belongs to the designated writer; this worktree updates only the mergeable `BRANCH.md` source.

## AI Flaky tests
- [ ] Expect deterministic fixture tests only; treat any failure as blocking and do not increase timeouts or accept AI flakiness.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one bounded adapter lot with serial tests under the shared Docker lock.
- [ ] **Multi-branch**: not needed for this scope.

## UAT Management (in orchestration context)
- [ ] Web app UAT: not applicable; no user-facing or application runtime change.
- [ ] Chrome plugin UAT: not applicable; no extension change.
- [ ] VSCode plugin UAT: not applicable; no extension change.
- [ ] Operator UAT: inspect a fixture scan receipt for source SHA, all severities, explicit gaps, public backlog and unchanged source/register bytes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Admission and baseline**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `rules/security.md`, the Docker lock and approved spec r4 sections 3/4/9.
  - [x] Verify the S1 dependency head, `harness check branch`, scope boundaries and SECDAILY-EX1 before editing.
  - [x] Inventory existing Make scan/parser entrypoints; reuse S1 schema/inventory helpers without changing their safety contract.
  - [ ] Capture source/register byte identities and the source SHA for unchanged-main assertions.
- [ ] **Lot 1 — Raw scan orchestration, `scan.mjs` and `scan.test.mjs`**
  - [x] Enumerate three images explicitly, root/workspace and independent UI/kit lockfiles including dev dependencies, and discovered source/hash consumers.
  - [x] Capture raw output before compliance; run audit/scan commands without repair or publication and preserve accepted exceptions in the public queue.
  - [ ] Validate reports with S1 fail-closed checks; keep command errors, missing reports, unsupported formats, missing images and unqualified SAST as coverage gaps.
  - [ ] Record exact source, scanner/database identities, component/path, all severity flags and coverage; retain identical flags between comparable scans.
  - [x] In `scan.test.mjs`, assert source/register bytes remain unchanged, registered findings remain queued, explicit toolbox/locks coverage and independent locks include dev dependencies.
  - [x] In `scan.test.mjs`, reject empty/malformed/partial/error reports and verify missing surfaces or SAST qualification prevent complete-clean receipts.
  - [x] In `scan.test.mjs`, assert identical scan flags and bounded credential-free command invocation through injected fixture runners.
  - [ ] Register the suite in the existing required `scripts/ci/publishable-ci-wiring.test.mjs` entrypoint without editing workflow filters or permissions.
  - [ ] Lot gate: scoped scan regression tests through the existing `make test-publishable-manifests SCOPE=scripts/security/daily/scan.test.mjs ENV=test-sec-s2a`, locked, followed by scoped teardown.
- [ ] **Lot 2 — Make adapter and parser compatibility**
  - [ ] Add only the thin `security-daily-scan` and `test-security-daily` targets under SECDAILY-EX1; use existing removable container tooling.
  - [ ] Keep scanner/DB/provenance qualification explicitly pending S2b and native SAST pending S2c; do not reuse Python SAST in the daily lane.
  - [ ] In `scan.test.mjs`, assert Make recipe wiring, fail-closed exit behavior and explicit coverage; do not start live scan stacks as fixture assertions.
  - [ ] Run locked `make test-security-daily ENV=test-sec-s2a` and existing `make test-security-parser ENV=test-sec-s2a`, with locked teardown after each.
  - [ ] API/UI/E2E tests: not applicable to this adapter-only change; no app service stack required.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Record commands, result counts, immutable head, coverage blockers and operator fixture receipt in this plan; keep the approved spec unchanged.
  - [ ] Confirm every diff hunk serves S2a and S2b/S2c/S3 work remains deferred.
- [ ] **Lot N — Final validation**
  - [ ] Run S1 plus scan and required wiring suites through the existing pinned Node Make target, locked, then clean the scoped environment.
  - [ ] Verify `harness check branch`, `make scope-check ENV=test-sec-s2a`, clean diff formatting and each new commit below 150 changed lines with no AI trailer.
  - [ ] Update the S2a PR from this plan, push only when implementation is requested, and verify CI on its exact head.
  - [ ] Report head SHA, CI URL and remaining S2b/S2c blockers; do not activate scanners or merge as part of plan preparation.
