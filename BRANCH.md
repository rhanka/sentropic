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
  - `scripts/ci/publishable-ci-wiring.test.mjs`
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
- [x] Retire the inherited S1 completion checklist before declaring S2a; implementation remains on hold.

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
