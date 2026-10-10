# Fix: Refresh the IdP importer before OAuth client sync

## Objective
- [ ] Prevent a stale four-file importer from rejecting the five-file OAuth client export, and exercise export, manifest validation and committed client import together.

## Scope / Guardrails
- [x] Worktree: `tmp/idp-client-sync-manifest`; branch: `fix/idp-client-sync-manifest`; base: `origin/main`.
- [x] Make-only, Docker-first, one Docker build at a time; `ENV=test-idp-sync-manifest` last.
- [x] Disposable containers have no published ports or cluster access; no compose stack is needed.
- [x] Preserve secret isolation, allowlists, host rewrites, fail-closed validation, DRY_RUN, CONFIRM and idempotent audit counts.
- [x] Stop at an open PR to main with green CI; no merge or real prod/preprod sync.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/ci/idp-identity-sync/**`
  - `deploy/k8s/overlays/prod/idp-identity-sync/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare rationale, impact and rollback in Feedback Loop before any exception.

## Feedback Loop
- [x] Root cause: CI run 38028913504 failed `publish-api-image` and skipped `deploy-preprod`; the last successful deployment (37962663359, commit 30a2362) expects four files. Sync run 38028949094 installed the five-file exporter and imported through that stale ConfigMap.

## AI Flaky tests
- [x] No AI-dependent tests in scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; implementation and integration in this worktree.

## UAT Management (in orchestration context)
- [x] Automated acceptance only; live operator acceptance remains with s-conductor.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and evidence**
  - [x] Read rules, pipeline sources, fixtures and branch template; `harness check branch` passes.
  - [x] Confirm the source validator already accepts five files and trace the skipped preprod rollout.
- [x] **Lot 1 — Import delivery regression**
  - [x] Extend `run.selftest.mjs` to require the matching preprod bundle before Job creation and reject bundle-apply failure; reproduce the missing-delivery assertion before fixing it.
  - [x] Update `run.mjs` to refresh only `deploy/k8s/overlays/preprod/idp-identity-sync` before applying the import Job.
  - [x] Update pipeline README to explain same-checkout importer delivery.
  - [x] Scoped gate: `make test-idp-sync-selftest ENV=test-idp-sync-manifest` (46 PASS).
- [ ] **Lot 2 — Export-to-import manifest acceptance**
  - [ ] Extract the existing prod export command into `export-prod.sh`, mounted by the prod SQL ConfigMap and invoked by the CronJob.
  - [ ] Update `bundle-checks.mjs` and `sql-test.sh` to execute that exact export command and checksum generation.
  - [ ] Commit through the real import wrapper, assert `clients_upserted=1`, and verify the imported immo client and idempotent rerun.
  - [ ] Retain malformed, missing, extra, duplicate and tampered manifest rejection coverage.
  - [ ] Acceptance: public PKCE, no prod secret, external callback and rewritten preprod resource in the committed row and real authorize handler.
  - [ ] Gate: `make test-idp-sync-sql ENV=test-idp-sync-manifest` includes `sql-test.sh`, `clients-test.sh` and `authorize.selftest.mjs`.
- [ ] **Lot 3 — Final validation and handoff**
  - [ ] Node/shell syntax and pipeline bundle checks; mechanical `make scope-check` before each atomic commit.
  - [ ] Review every diff hunk, preserve all #799/#658 invariants and resolve findings.
  - [ ] Push and create PR to main using this plan as the English PR body; post the execution plan comment.
  - [ ] Wait for CI on the PR head, fix failures, update PR body and write `.h2a/report.md` with PR/head/check evidence and open questions.
