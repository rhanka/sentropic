# Feature: Security autofix S1 inventory and contract

## Objective
Implement S1 inventory and contract for autonomous daily security fixes with seats.

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
  - `api/Dockerfile`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [x] Integration: merge `origin/main` at `ab981b16dfe4769d0dd44443f4d459a375848a8d`; retain S1 plan and all 342 prior Track events. Scope-check includes incoming main files; the independent harness check against `origin/main` limits authored changes to S1.
- [ ] Approved-r4 alignment: tests first for exact register matching, all-severity inventory, separate own-code scope, bounded grouping, complete dated reconciliation and discovered lock/hash consumers.
- [x] Tests-first evidence: existing 14 tests passed; expanded S1 suite reproduces nine contract/inventory failures before implementation (22 tests, 13 pass, 9 fail).
- [x] Contract alignment: all-severity public inventory, disabled exact own-code paths, separate automatic reconciliation, exact exception joins and explicit current-main L5 compatibility blocker.
- [x] Grouping alignment: stable lock-set/defect/image identities, visible no-upstream-fix units, severity/expiry/age order, explicit estimates and strict repository/class/size bounds.
- [x] Reconciliation alignment: distinct consecutive UTC daily full scans, immutable source/image/database identities, fresh databases and exact unchanged registered path/platform/lineage/flags/policy; pre-merge proof remains a separate S5a guard.
- `SECDAILY-EX6-note` / `attention`: toolbox path `api/Dockerfile` is listed in Allowed Paths as read-only inventory reference only, no modification in S1. It fixes the exact existing approved toolbox path (`ci-tools` and `ci-esbuild` stages) that S2c exception SECDAILY-EX6 depends on.
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
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
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
  - [x] No spec consolidation needed for S1 contract branch.
- [ ] **Lot N — Final validation**
  - [x] Typecheck and lint not applicable to plain Node security scripts.
  - [x] Retest S1 suites via `make test-publishable-manifests SCOPE="scripts/security/daily/schema.test.mjs scripts/security/daily/inventory.test.mjs" ENV=test-sec-lot1` (14 pass).
  - [ ] Final gate step 1: create draft PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run and verify branch CI green.
  - [ ] Final gate step 3: do not merge, report PR number, head SHA, CI URL.
