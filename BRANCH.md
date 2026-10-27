# feat(security): add daily scan adapter (S2a)

## Objective
- [x] Deliver the credential-free `security-daily-scan` Make adapter and raw scan orchestration from approved spec r4 section 9; estimate 3–5 h, dependency S1 approval.

## Scope / Guardrails
- [x] Owner authorized implementation on 2026-10-26; draft PR to main stacked on S1 #732, no merge.
- [x] Base: corrected S1 head `76c745d5a89eaa8362a914d07604d563489b9f67`, including the merge of main `365e8b313`; merge updates only, never rebase.
- [x] Work only in `tmp/worktrees/sec-s2a` on `feat/security-autofix-s2a`.
- [x] Use Make targets only, zero Python, no AI commit trailers, selective staging and `make commit`; each new commit stays below 150 changed lines.
- [x] Use the shared Docker lock for every image build, container start and test; release it between steps and clean with locked `make down ENV=test-sec-s2a` after each step.
- [x] Pass `ENV=test-sec-s2a` last; run fixture targets without application services or host port bindings.
- [x] Preserve the public-repository model, required PR gates, vulnerability register, disabled auto-fix and L5 class.
- [x] No scheduler, credentials, collector, publication, repair, merge actor or runtime activation.
- [x] Keep image/DB qualification in S2b and native Rust SAST qualification in S2c; unqualified surfaces remain explicit blockers.
- [x] Keep the root worktree and all other sessions' containers, volumes and environments untouched.
- [x] Use English for repository text and keep all implementation changes within the paths below.

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
  - [x] Declare any additional exception with rationale, impact and rollback in this feedback loop before editing.

## Feedback Loop
- [x] PR786 P2-4, author, resolved: eagerly materialize sorted per-row register joins with exact-match paths and pending reasons; map manifest paths only to one exact scanner/component/version node. Legacy identities and ambiguous nodes remain pending. Real-register and reversed-order regressions pass; locked daily suite passes 110 tests.
- [x] PR786 P2-3, author, resolved: capture HEAD once and refuse tracked, staged or untracked changes before launching the scanner; Git failures also abort. Shell-guard regressions pass in the 13-test scoped scan suite.
- [x] PR786 P2-2, author, resolved: keep the complete npm repair target as name@version plus its major-bump flag; reject malformed targets. The langium/mermaid regression preserves mermaid@11.17.2; scoped scan suite passes 12 tests.
- [x] PR786 P2-1, author, resolved: emit only a package's own advisories at affected installed versions; retain npm carrier graph and severities as context. Langium/mermaid with two lodash-es versions is covered; locked daily suite passes 107 tests. Reuse the pinned semver tool from the existing fixture lane.
- [x] SECDAILY-EX1 predeclared by approved r4 for S2a: edit only `security-daily-scan` and `test-security-daily` recipes in `Makefile`; reuse the existing pinned credential-free Node test lane. Impact: explicit raw scanner orchestration and its regression target; existing gates and deploy recipes remain unchanged. Rollback: revert these adapter recipes and scan files, keeping activation disabled.
- [x] S1 dependency: owner confirms Opus r2 approval of corrected #732 head `76c745d5a`.
- [x] S2A-F1, author, resolved: native npm rejected user/global config both pointing to `/dev/null` (double-loading config); use a distinct absent global config in scratch. Native-version regression preserves credential isolation.
- [x] S2A-F2, author, resolved: real npm reports contain cyclic dependency references; traverse without revisiting, require reachable advisory evidence and retain each advisory severity. Independent lock audits preserve repository-relative local-link metadata inside scratch; outside-repository links fail closed.
- [x] Validation: locked `make test-security-daily ENV=test-sec-s2a` passes 106 tests, including real native npm version resolution; initial missing-module and F1/F2 regressions were observed failing before their fixes.
- [x] Parser compatibility: locked `make test-security-parser ENV=test-sec-s2a` passes all five cases; no parser/compliance or existing gate edit.
- [x] Runtime identity: reuse existing `MEMORY_L5_NODE_IMAGE`, `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`; no image build, new image, Python, Docker socket, source write or application service.
- [x] Operator smoke: locked `make security-daily-scan ENV=test-sec-s2a` on immutable code head `2f95bb0735725f46da1efc3d97dd46f4dd3c7097` audits all seven locks successfully and retains 251 affected-path/advisory findings (12 HIGH, 196 MEDIUM, 43 LOW); 68 unresolved register rows remain (7 expired, 61 unexpired). This is an author-branch smoke, not qualified main/pilot evidence.
- [x] Smoke receipt: ignored `tmp/security-daily/receipt.json`, SHA-256 `99d546935dcb376acd169d04f099aa6d8405994823771f8861877055bc00331e`; source/register hashes and raw reports retained. Make exits 2 from scanner exit 1 as required for `incomplete-scan`; all source input hashes remain unchanged.
- [x] Register bytes: SHA-256 `837f27b85ed9c20b0efd9f8fde10fb30533a87558ab23d4e65fe41d96a6df787`; policy SHA-256 `cb3f56d654fc59dcd30f1cee13af372ec037df7b70483405bb610420394b0bff`; both and every lock remain identical to S1.
- [x] Coverage handoff: S2b 4–6 h qualifies immutable Trivy/image/IaC/DB evidence; S2c 6–12 h qualifies native Rust SAST; S3 4–6 h follows S2c for the public workflow/collector. Inventory additionally exposes missing qualified locks for `apps/auth-idp/package.json`, `tools/scw-tem-mock/package.json`, `ui/vscode-ext/package.json`; no false complete-clean receipt.
- [x] Independent S2a review remains pending: local harness selection failed because this session has no live model catalog and h2a presence lacks exact models; no peer was dispatched and no consensus is claimed. Ignored dossier: `tmp/security-daily/review.md`.
- [x] Track import belongs to the designated writer; this worktree updates only the mergeable `BRANCH.md` source.

## AI Flaky tests
- [x] Expect deterministic fixture tests only; treat any failure as blocking and do not increase timeouts or accept AI flakiness.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one bounded adapter lot with serial tests under the shared Docker lock.
- [ ] **Multi-branch**: not needed for this scope.

## UAT Management (in orchestration context)
- [x] Web app UAT: not applicable; no user-facing or application runtime change.
- [x] Chrome plugin UAT: not applicable; no extension change.
- [x] VSCode plugin UAT: not applicable; no extension change.
- [x] Operator UAT: inspect a fixture scan receipt for source SHA, all severities, explicit gaps, public backlog and unchanged source/register bytes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Admission and baseline**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `rules/security.md`, the Docker lock and approved spec r4 sections 3/4/9.
  - [x] Verify the S1 dependency head, `harness check branch`, scope boundaries and SECDAILY-EX1 before editing.
  - [x] Inventory existing Make scan/parser entrypoints; reuse S1 schema/inventory helpers without changing their safety contract.
  - [x] Capture source/register byte identities and the source SHA for unchanged-main assertions.
- [x] **Lot 1 — Raw scan orchestration, `scan.mjs` and `scan.test.mjs`**
  - [x] Enumerate three images explicitly, root/workspace and independent UI/kit lockfiles including dev dependencies, and discovered source/hash consumers.
  - [x] Capture raw output before compliance; run audit/scan commands without repair or publication and preserve accepted exceptions in the public queue.
  - [x] Validate reports with S1 fail-closed checks; keep command errors, missing reports, unsupported formats, missing images and unqualified SAST as coverage gaps.
  - [x] Record exact source, scanner/database identities, component/path, all severity flags and coverage; retain identical flags between comparable scans.
  - [x] In `scan.test.mjs`, assert source/register bytes remain unchanged, registered findings remain queued, explicit toolbox/locks coverage and independent locks include dev dependencies.
  - [x] In `scan.test.mjs`, reject empty/malformed/partial/error reports and verify missing surfaces or SAST qualification prevent complete-clean receipts.
  - [x] In `scan.test.mjs`, assert identical scan flags and bounded credential-free command invocation through injected fixture runners.
  - [x] Register the suite in the existing required `scripts/ci/publishable-ci-wiring.test.mjs` entrypoint without editing workflow filters or permissions.
  - [x] Lot gate: scoped scan regression tests through the existing `make test-publishable-manifests SCOPE=scripts/security/daily/scan.test.mjs ENV=test-sec-s2a`, locked, followed by scoped teardown.
- [x] **Lot 2 — Make adapter and parser compatibility**
  - [x] Add only the thin `security-daily-scan` and `test-security-daily` targets under SECDAILY-EX1; use existing removable container tooling.
  - [x] Keep scanner/DB/provenance qualification explicitly pending S2b and native SAST pending S2c; do not reuse Python SAST in the daily lane.
  - [x] In `scan.test.mjs`, assert Make recipe wiring, fail-closed exit behavior and explicit coverage; do not start live scan stacks as fixture assertions.
  - [x] Run locked `make test-security-daily ENV=test-sec-s2a` and existing `make test-security-parser ENV=test-sec-s2a`, with locked teardown after each.
  - [x] API/UI/E2E tests: not applicable to this adapter-only change; no app service stack required.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Record commands, result counts, immutable head, coverage blockers and operator fixture receipt in this plan; keep the approved spec unchanged.
  - [x] Confirm every diff hunk serves S2a and S2b/S2c/S3 work remains deferred.
- [ ] **Lot N — Final validation**
  - [x] Run S1 plus scan and required wiring suites through the existing pinned Node Make target, locked, then clean the scoped environment.
  - [x] Verify `harness check branch`, `make scope-check ENV=test-sec-s2a`, clean diff formatting and each new commit below 150 changed lines with no AI trailer.
  - [ ] Update the S2a PR from this plan, push the owner-authorized draft stacked on S1 #732, and verify CI on its exact head.
  - [ ] Report head SHA, CI URL and remaining S2b/S2c blockers; keep runtime activation disabled and do not merge.
