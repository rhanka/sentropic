# Feature: RFC 8693 token exchange for the radar preprod workload client

## Objective
- [ ] Register `immo-mcp-workload` through the existing preprod sync using a named Kubernetes Secret; qualify the exchange-only policy for radar.

## Scope / Guardrails
- [x] Worktree `tmp/worktrees/idp-token-exchange`, branch `feat/idp-token-exchange-preprod`, from `origin/main`; harness branch check passed.
- [x] `ENV=test-idp-token-exchange` last; shared Docker flock and teardown; no Python, deployment, secret minting or production changes.
- [x] No schema, package source or discovery change: live preprod now advertises RFC 8693 unconditionally.
- [x] Historical plans inherited from main below are reference only and authorize no work on this branch.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/**`
  - `deploy/ci/idp-identity-sync/import-job.tmpl.yaml`
  - `deploy/ci/idp-identity-sync/bundle-checks.mjs`
  - `deploy/ci/idp-identity-sync/services-test.sh`
  - `deploy/ci/idp-identity-sync/sql-test.sh`
  - `deploy/ci/idp-identity-sync/CRED_CYCLE.md`
  - `deploy/ci/idp-identity-sync/README.md`
  - `api/src/scripts/oauth-provision-exchange-client.ts`
  - `deploy/k8s/README.md`
  - `api/tests/api/auth/oauth-token-exchange.test.ts`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `deploy/k8s/overlays/prod/**`
  - `.track/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`
- [x] **Exception process**: record reason, impact and rollback before editing a conditional or forbidden path.

## Feedback Loop
- [x] BR770-EX1: preprod `deploy/k8s/**` sync and runbook changes; rationale: register radar's missing workload and support Secret rotation; impact: owner-triggered preprod imports only, no prod change; rollback: revert the sync ConfigMap/Job references and revoke the workload through the owner credential process.
- [x] BR770-EX2: `deploy/ci/idp-identity-sync/{README,CRED_CYCLE}.md` and `api/src/scripts/oauth-provision-exchange-client.ts`; rationale: one preprod creation path; impact: prevent manual preprod provisioning and document Secret-driven rotation; rollback: restore these files and disable the sync registration before reverting the guard.
- [x] Existing policy rewrites the exact preprod MCP/API audiences but skips missing workload rows; register before its invariant snapshot.
- [x] Author metadata: codex / gpt-6.1-sol / high; external reviews require repository reviewer authorization.

## AI Flaky tests
- [x] No live AI dependency in this scope.

## Orchestration Mode (AI-selected)
- [x] Single author; no delegated implementation.

## UAT Management (in orchestration context)
- [x] No UI change; preprod acceptance remains an owner action after rollout.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Read-only diagnosis**
  - [x] Read Docker lock, rules, radar aadc5291 runbook steps 3–4 and server-http.ts; inspect CI deploy and live discovery.
- [x] **Lot 1 — Workload registration**
  - [x] Add local Secret-backed registration and references in both preprod Job sources; preserve existing IDs and hashes.
  - [x] Test `services-test.sh` registration, invalid secret, mismatch, rollback, idempotence and unrelated-client preservation.
  - [x] Gate: `make test-idp-sync-selftest` (47 checks) and `make test-idp-sync-sql` passed; disposable containers removed; teardown requested.
- [x] **Lot 2 — Policy regression**
  - [x] Test preprod allowed exchange, public/unregistered denial, wrong subject/target audiences and client_credentials denial in `api/tests/api/auth/oauth-token-exchange.test.ts`.
  - [x] Gate: 11 canonical-route tests passed using `createIdpApp()` and the verified main toolbox; `make down` completed.
- [x] **Lot 3 — Operator handoff and draft PR**
  - [x] Document owner secret minting, radar handoff, dry-run, rollout and acceptance in `deploy/k8s/README.md`.
  - [x] Scope-check each atomic commit under 150 lines; push; draft PR #770 opened; CI monitored and SHA/ETA recorded in the external report. Full CI and independent review remain pending before merge.

## Historical main plans (reference only)
