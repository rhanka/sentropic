# Feature: Preprod IdP access-token TTL palliative (15 days)

## Objective
Make the already-applied live preprod IdP setting `OAUTH_ACCESS_TOKEN_TTL_SEC=1296000` (15 days) survive `deploy-preprod` by declaring it in the preprod auth-idp ConfigMap strategic-merge overlay. Palliative for the hourly MCP relogin. Owner decision 2026-11-01 (option (a)), risks explicitly accepted: global to all preprod clients, and a leaked token cannot be revoked by resource servers validating via JWKS. PREPROD ONLY: prod overlays are untouched and keep the code default 3600. To be reverted to 3600 when IdP refresh lots 1-3 (`spec/SPEC_EVOL_IDP_OAUTH_REFRESH_TOKEN.md`) are deployed in preprod.

## Scope / Guardrails
- Scope limited to the preprod auth-idp ConfigMap overlay key.
- Prod overlays must not change; a request to change them on this branch is refused and reported.
- No migration (`api/drizzle/*.sql`).
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/worktrees/preprod-ttl`.
- No Docker compose stack in this lane; the targeted gates are one-off `docker run` containers. `ENV=test-*` for every test command, always last.
- No package `src/**` change, so no `enforce-package-bump` version bump applies.
- CI lockfile-lane policy acknowledged (review_by=2026-11-30T00:00:00Z); installs resolve committed tool profiles or frozen consumer closures.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/preprod/patch-auth-idp-config.yaml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `deploy/k8s/overlays/prod/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file) — not used
  - `.github/workflows/**` — not used
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- Manifest selftest survey (verification, no exception needed): no selftest asserts the preprod auth-idp ConfigMap keys — `deploy/ci/artifact-content/bundle.selftest.mjs` asserts the `api` and `artifact-content` ConfigMaps and Deployment images, `deploy/ci/idp-identity-sync/idp-sync.selftest.mjs` asserts the sync bundles and Ingress hosts, and `deploy/ci/idp-identity-sync/session-preflight.selftest.mjs` asserts base Deployment refs. Nothing to update; the deploy manifest selftests run unmodified as the regression gate.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one preprod-only ConfigMap key; single branch, single CI.

## UAT Management (in orchestration context)
- **Mono-branch**: no UAT on this branch. The owner already accepted the change and applied it live via kubectl; acceptance for this PR is the rendered-overlay parity with that live state, proven by the deploy manifest selftests.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Confirm isolated worktree `tmp/worktrees/preprod-ttl` on branch `chore/preprod-idp-ttl-palliative` from `origin/main`.
  - [x] `harness check branch` PASS (C1).
  - [x] Confirm mechanism: strategic-merge patch on ConfigMap `auth-idp` (`envFrom` of the IdP Deployment); base and prod overlays set no `OAUTH_ACCESS_TOKEN_TTL_SEC`, code default 3600 (`api/src/config/env.ts`, consumed by `api/src/routes/auth/oauth.ts`).
  - [x] Survey manifest selftests: none asserts the preprod auth-idp ConfigMap keys (see Feedback Loop).

- [x] **Lot 1 — Preprod TTL palliative key**
  - [x] Add `OAUTH_ACCESS_TOKEN_TTL_SEC: "1296000"` to `deploy/k8s/overlays/preprod/patch-auth-idp-config.yaml` with the palliative comment (owner decision 2026-11-01, revert to 3600 with refresh lots 1-3).
  - [x] Do not touch `deploy/k8s/overlays/prod/**`.

- [ ] **Lot 2 — Final validation**
  - [x] `make test-idp-sync-selftest ENV=test-preprod-ttl` — 70 PASS, 0 failures.
  - [x] `make test-artifact-content-manifests ENV=test-preprod-ttl` — 54 PASS, 0 failures.
  - [x] `make test-idp-sync-sql ENV=test-preprod-ttl` — PASS.
  - [x] `make scope-check`
  - [x] `make test-ci-lockfile-installs ENV=test-ci-manifests` (BRLOCK-EX1 acknowledgment present, 11 pass)
  - [ ] `make commit MSG="chore(preprod): 15-day IdP access-token TTL palliative"`
  - [ ] Push branch, create PR with this `BRANCH.md` as body, one CI run, wait completed.
  - [ ] Stop without merging (owner-accepted, reviewed on the PR).
