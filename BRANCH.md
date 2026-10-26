# Feature: Security autofix S1 inventory and contract

## Objective
- [x] Resume #732 as approved S1 inventory and contract, integrating the binding r4 owner amendment.

## Scope / Guardrails
- Scope limited to S1 inventory and contract only.
- No service, schedule, credential or merge activation.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/sec-lot1`.
- Automated test campaigns run on dedicated environments (`ENV=test-sec-lot1`), never on root `dev`.
- UAT qualification worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Zero Python in automation.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.security/security-fix.json`
  - `scripts/security/daily/schema.mjs`
  - `scripts/security/daily/inventory.mjs`
  - `scripts/security/daily/schema.test.mjs`
  - `scripts/security/daily/inventory.test.mjs`
  - `.github/workflows/ci.yml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/ci.yml` (SECDAILY-S1-EX1 only)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [x] SECDAILY-S1-EX1: permit only an S1 test step in the existing manifest-validation CI job; required to exercise the new contract in public CI. No schedule, permissions, gate selection or image change. Rollback removes this test step; implementation stays disabled.
- [x] Integration: merge `origin/main` at `ab981b16dfe4769d0dd44443f4d459a375848a8d`; retain S1 plan and all 342 prior Track events. Scope-check includes incoming main files; the independent harness check against `origin/main` limits authored changes to S1.
- [x] Approved-r4 alignment: tests first for exact register matching, all-severity inventory, separate own-code scope, bounded grouping, complete dated reconciliation and discovered lock/hash consumers.
- [x] Tests-first evidence: existing 14 tests passed; expanded S1 suite reproduces nine contract/inventory failures before implementation (22 tests, 13 pass, 9 fail).
- [x] Contract alignment: all-severity public inventory, disabled exact own-code paths, separate automatic reconciliation, exact exception joins and explicit current-main L5 compatibility blocker.
- [x] Grouping alignment: stable lock-set/defect/image identities, visible no-upstream-fix units, severity/expiry/age order, explicit estimates and strict repository/class/size bounds.
- [x] Reconciliation alignment: distinct consecutive UTC daily full scans, immutable source/image/database identities, fresh databases and exact unchanged registered path/platform/lineage/flags/policy; pre-merge proof remains a separate S5a guard.
- [x] Discovery alignment: enumerate independent lockfiles with dev dependencies and tracked source/hash consumers; fail on unreadable trees, symlinks and exhausted discovery bounds rather than silently truncating coverage.
- [x] Backlog alignment: raw all-severity findings remain queued, unresolved unmatched rows remain verification-pending, expiry is computed from current rows and malformed/missing/errored reports cannot produce clean state.
- [x] Current-register boundary: normalize the real YAML document without inferring missing affected identities; current main has 68 unresolved rows (60 due November 20, seven expired, one due October 30), distinct from the historical 67-row fixture. Register bytes remain unchanged.
- [x] Receipt boundary: require digest-qualified scanner/policy identities and full severity coverage for absence evidence; join GHSA/CVE aliases without relaxing the affected path/version/image match. Legacy container candidates remain pending qualification.
- [x] Reconciliation regression: current-register integration checks preserve its actual pending rows without freezing the count in CI; a removal-only document fixture proves legitimate future reconciliation does not require test edits.
- [x] Malformed-report regression: Trivy result rows and finding identities are validated, so a valid outer envelope cannot turn missing/partial nested findings into a clean report.
- [x] Coverage alignment: discover package/app/script/tool source roots and workspace manifests, verify the three image stages, enumerate reviewed hash consumers and expose missing locks/unknown consumers/SAST qualification as blockers.
- [x] Identity hardening: malformed aliases and ambiguous/empty key components fail closed; source defects may use an explicit stable defect identity. Local editor-rule symlinks are excluded from application surface discovery.
- [ ] Independent review: harness selection failed because no reachable exact-model catalog establishes two eligible Claude-hosted models; dossier retained in `.tmp/daily-sec-fix/s1-review-dossier.md`. No consensus or merge readiness claimed.
- [x] SECDAILY-EX6 inventory: `api/Dockerfile` (`ci-tools` and `ci-esbuild`) is the existing approved toolbox path; S1 does not modify it or introduce an image.
- `owner-all-public` / `acknowledge`: binding owner decision (OWNER-REQUEST.md 2026-10-23 disclosure section) supersedes the spec private-scan design. No private scan repo, everything runs in the public repos, fix PRs are public and auto-merged after other-model review and green CI. S1 contract adapted accordingly.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: S1 is a single isolated contract and inventory unit with no orthogonal sub-branches.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/sec-lot1`.
  - Push branch before UAT.
  - [x] Web app, Chrome and VSCode UAT are not applicable to pure security inventory helpers.
  - Switch back to `tmp/worktrees/sec-lot1` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/worktrees/sec-lot1` from `origin/main` on branch `feat/security-autofix-s1`.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Define environment mapping (`ENV=test-sec-lot1`) for this branch.
  - [x] Confirm command style: `make ... ENV=test-sec-lot1` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare exceptions if needed.
  - [x] Resolve existing toolbox path `api/Dockerfile` (`ci-tools`, `ci-esbuild` stages) as inventory fact for SECDAILY-EX6.
- [x] **Lot 1 — S1 contract `.security/security-fix.json`**
  - [x] Declare inventory surfaces (three images, root/UI/kit locks, SAST roots, derived pins).
  - [x] Declare HIGH/CRITICAL severity contract with identical flags before/after and reconciliation.
  - [x] Declare raw/register join with 67-row expiry split (60 due 2026-11-20, 7 expired).
  - [x] Declare grouping into remediation units and bounded lots (3 units, 10 files, 150 lines).
  - [x] Declare exact automatic scope from spec section 7 with exclusion list.
  - [x] Integrate P3-1 credential naming (read-only access on the public repository, owner all-public decision).
  - [x] Integrate P3-4 bumpGate manual class for published package dependency edits.
  - [x] Declare N=2 reconciliation rule with reset conditions.
  - [x] Declare kill switches and rate limits.
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec-lot1`
    - [x] `make commit MSG="..." ENV=test-sec-lot1` with selective `git add`
- [x] **Lot 2 — S1 modules `scripts/security/daily/schema.mjs` and `inventory.mjs`**
  - [x] Implement schema validation for contract, findings, units, lots, reconciliation evidence.
  - [x] Implement inventory of locks, images, SAST roots, derived-pin consumers.
  - [x] Implement raw/register join, grouping, lot batching, reconciliation streak check.
  - [x] Implement bumpGate manual classification hook.
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec-lot1`
    - [x] `make test-publishable-manifests SCOPE="scripts/security/daily/schema.test.mjs scripts/security/daily/inventory.test.mjs" ENV=test-sec-lot1`
- [x] **Lot 3 — S1 tests `schema.test.mjs` and `inventory.test.mjs`**
  - [x] Cover three images, root/UI/kit locks, 67-row expiry split, seven stale-container candidates.
  - [x] Cover N=2 complete-scan fixture, severity flags, aliases, malformed data.
  - [x] Cover P3-1 credential fields and P3-4 manual class.
  - [x] Cover owner all-public decision (no private scan repo or storage).
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec-lot1`
    - [x] `make test-publishable-manifests SCOPE="scripts/security/daily/schema.test.mjs scripts/security/daily/inventory.test.mjs" ENV=test-sec-lot1`
- [x] **Lot N-1 — Docs consolidation**
  - [x] Contract records r4, disabled activation and the current L5 compatibility blocker; source planning documents remain unchanged.
- [ ] **Lot N — Final validation**
  - [x] Typecheck and lint not applicable to plain Node security scripts.
  - [x] Retest S1 suites via `make test-publishable-manifests SCOPE="scripts/security/daily/schema.test.mjs scripts/security/daily/inventory.test.mjs" ENV=test-sec-lot1` after approved-r4 corrections: 24 pass, no failures or skips; official existing pinned Node image, shared Docker lock and scoped teardown.
  - [x] Final gate step 1: update existing draft #732 using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run and verify branch CI green.
  - [ ] Final gate step 3: do not merge, report PR number, head SHA, CI URL.
