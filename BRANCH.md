# Feature: Gate retain-daily-identities on the application change filter

## Objective
- [x] Keep main CI green on application-inert pushes: `retain-daily-identities` (ci.yml BR-81, landed in 5657601b1) must not download the `api-image`/`ui-image` artifacts on a push to main whose change set did not build them (only `idp_sync` matched on the deploy-only repin 7853c483e, run 42464809504, job 128681924495, `Artifact not found for name: api-image` → ci-gate red on main).

## Scope / Guardrails
- [x] Branch fix/ci-retain-daily-identities from origin/main 7853c483e; worktree tmp/worktrees/ci-retain-daily; ENV=test-ci-retain-daily.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns, no [skip ci].
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.github/workflows/ci.yml`
  - `scripts/ci/ci-expected-results.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `apps/**`
  - `packages/**`
  - `scripts/**`
  - `deploy/**`
  - `spec/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: diagnosis evidence — run 42464809504 job log line "##[error]Unable to download artifact(s): Artifact not found for name: api-image"; `build-api-image`/`build-ui` succeeded with every work step skipped (their step-level `if` requires `ui || api || global == 'true'`), matched filter was `idp_sync` only; all five earlier push runs since 5657601b1 had application changes and retain-daily-identities green, so the defect was latent until the deploy-only repin merge.
- [x] `acknowledge`: consumer `scripts/ci/live-provider-receipt.mjs` (select) skips runs without the retained `live-provider-{api,ui}-identity` artifacts, so a legitimately skipped retain job keeps the previous qualified tuple; the identity artifacts and their consumers are untouched.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**
- Rationale: one workflow gating fix with its CI-expected tests; one CI.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one owner-urgent fix PR, one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Gate the retain job**
  - [x] `retain-daily-identities` adds `changes` to `needs` and requires the same disjunction as the build upload steps (`needs.changes.outputs.ui/api/global == 'true'`) on a push to main; deploy-only pushes now skip the job and ci-gate stays green.
  - [x] Regression test `should retain daily identities only on main pushes that build the images` in `scripts/ci/ci-expected-results.test.mjs`; negative control verified (fails on the ungated `if`).
  - [x] Lot gate: `harness check branch` C1 pass before work; `harness check scope` clean after staging.
- [x] **Lot 2 — Verification**
  - [x] `make ci-capacity-policy test-ci-expected-results test-ci-tested-tree test-ci-static ENV=test-ci-retain-daily` (scoped to the parsers of the live ci.yml): 29 + 11 + 3 pass, 0 fail, shapeValid true.
  - [x] Selection replay with run 42464809504 context (`idp_sync`-only push, api/ui/global false) via `make ci-expected-manifest`: `retain-daily-identities` `selected: false`; with `api: true`: `selected: true`.
  - [x] Negative control: reverting the gate to the old `if` fails exactly the new regression test (28 pass / 1 fail), restored after.
  - [x] `make down-volumes ENV=test-ci-retain-daily` after the suites.
- [ ] **Lot 3 — PR**
  - [ ] PR « fix(ci): gate retain-daily-identities on the application change filter », CI green on the exact head, GLM review via .tmp/packets/run-vibe.sh, merge by s-conductor.
