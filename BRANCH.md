# Feature: Auth Modules Roadmap Registration

## Objective
Register the BR-39 auth-module extraction pair in the Sentropic roadmap: BR-39a for the reusable frontend auth package and BR-39b for the optional Hono backend package.

## Scope / Guardrails
- Scope limited to roadmap and branch-plan documentation.
- No application code, package source, build workflow, Docker, npm dependency, or test implementation changes in this branch.
- The implementation branches are documented as `plan/39a-BRANCH_feat-auth-ui-sdk.md` and `plan/39b-BRANCH_feat-auth-hono-kit.md`.
- `spa-transpose-cv` is referenced as a downstream consumer, but no sibling repository files are modified from this branch.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/chore-auth-modules`.
- Automated test campaigns are not required for this docs-only branch; validation is diff and markdown structure inspection.
- In every `make` command, the concrete branch environment value must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `plan/39a-BRANCH_feat-auth-ui-sdk.md`
  - `plan/39b-BRANCH_feat-auth-hono-kit.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `package-lock.json`
  - `plan/NN-BRANCH_*.md` except the two BR-39 files listed in Allowed Paths
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `TODO.md` only if the conductor requires a separate user-facing TODO entry.
  - `spec/**` only if the roadmap update cannot describe the auth extraction cleanly.
- **Exception process**:
  - Declare exception ID `BR39plan-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- No open blockers.
- Cadrage decision: split the work into BR-39a `feat/auth-ui-sdk` and BR-39b `feat/auth-hono-kit`.
- Rationale:
  - BR-39a directly serves `spa-transpose-cv` by making the login/register/passkey/device screens reusable through injected transports.
  - BR-39b stays dependent and optional, because backend extraction needs storage/session ports and should not block frontend parity.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Not applicable for this docs-only branch unless CI unexpectedly runs AI tests.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: this branch only registers future branch plans. The implementation work itself is split into future BR-39a and BR-39b branches.

## UAT Management (in orchestration context)
- No runtime UAT for this docs-only roadmap branch.
- Development worktree: `tmp/chore-auth-modules`.
- Branch ports: none reserved; no services should be started.
- Test envs: none required.
- Root UAT env: not used.

## Plan / Todo (lot-based)
- [x] **Lot 0 - Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/conductor.md`, `rules/subagents.md`, `README.md`, `TODO.md`, `PLAN.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm root `main` is aligned with `origin/main`.
  - [x] Create isolated worktree `tmp/chore-auth-modules` from `origin/main`.
  - [x] Confirm scope boundaries and no conditional path exception is needed.

- [x] **Lot 1 - Roadmap registration**
  - [x] Add `plan/39a-BRANCH_feat-auth-ui-sdk.md` from the branch template with file-level scope, ports, lots, tests, UAT, package publication notes, and `spa-transpose-cv` consumer constraints.
  - [x] Add `plan/39b-BRANCH_feat-auth-hono-kit.md` from the branch template with backend route/service scope, ports, lots, tests, UAT, package publication notes, and dependency on BR-39a.
  - [x] Update `PLAN.md` status, pending branch list, catalog, dependency graph, scheduling, environment slots, and source specifications for BR-39a/BR-39b.
  - [x] Lot gate:
    - [x] `git -C /home/antoinefa/src/sentropic/tmp/chore-auth-modules diff --cached --check`
    - [x] `git -C /home/antoinefa/src/sentropic/tmp/chore-auth-modules diff --cached --stat`

- [ ] **Lot N - Final validation**
  - [x] Verify only `BRANCH.md`, `PLAN.md`, `plan/39a-BRANCH_feat-auth-ui-sdk.md`, and `plan/39b-BRANCH_feat-auth-hono-kit.md` changed.
  - [x] Commit roadmap registration with `make commit MSG="docs: register auth module extraction branches"`.
  - [x] Create/update PR using this `BRANCH.md` text as PR body.
  - [ ] Verify branch CI or document that no CI was triggered for docs-only changes.
  - [ ] Once gates are OK, commit removal of `BRANCH.md`, push, and merge with merge commit only.
