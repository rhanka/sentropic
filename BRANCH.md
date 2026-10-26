# Feature: RFC 8693 token exchange for the radar preprod workload client

## Objective
- [ ] Register `immo-mcp-workload` through the existing preprod sync using a named Kubernetes Secret; qualify the exchange-only policy for radar.

## Scope / Guardrails
- [x] Worktree `tmp/worktrees/idp-token-exchange`, branch `feat/idp-token-exchange-preprod`, from `origin/main`; harness branch check passed.
- [x] `ENV=test-idp-token-exchange` last; shared Docker flock and teardown; no Python, deployment, secret minting or production changes.
- [x] No schema, package source or discovery change: live preprod now advertises RFC 8693 unconditionally.
- [x] Dedicated local ports: API 9845, UI 6045, Maildev UI 1945; verified free before startup.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `deploy/k8s/overlays/preprod/idp-identity-sync/**`
  - [x] `deploy/ci/idp-identity-sync/import-job.tmpl.yaml`
  - [x] `deploy/ci/idp-identity-sync/bundle-checks.mjs`
  - [x] `deploy/ci/idp-identity-sync/services-test.sh`
  - [x] `deploy/ci/idp-identity-sync/sql-test.sh`
  - [x] `deploy/ci/idp-identity-sync/CRED_CYCLE.md`
  - [x] `deploy/ci/idp-identity-sync/README.md`
  - [x] `api/src/scripts/oauth-provision-exchange-client.ts`
  - [x] `deploy/k8s/README.md`
  - [x] `api/tests/api/auth/oauth-token-exchange.test.ts`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `deploy/k8s/overlays/prod/**`
  - [x] `.track/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `.github/workflows/**`
  - [x] `api/drizzle/*.sql`
- [x] **Exception process**: record reason, impact and rollback before editing a conditional or forbidden path.

## Feedback Loop
- [x] BR770-EX1: preprod `deploy/k8s/**` sync and runbook changes; rationale: register radar's missing workload and support Secret rotation; impact: preprod imports only, no prod change; rollback: revert the sync ConfigMap/Job references and revoke the workload through the owner credential process.
- [x] BR770-EX2: `deploy/ci/idp-identity-sync/{README,CRED_CYCLE}.md` and `api/src/scripts/oauth-provision-exchange-client.ts`; rationale: one preprod creation path; impact: prevent manual preprod provisioning and document Secret-driven rotation; rollback: restore these files and disable the sync registration before reverting the guard.
- [x] Existing policy rewrites the exact preprod MCP/API audiences but skips missing workload rows; register before its invariant snapshot.
- [x] Author metadata: codex / gpt-6.1-sol / high; external reviews require repository reviewer authorization.

## AI Flaky tests
- [x] No live AI dependency in this scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; single author, no delegated implementation or cherry-pick.

## UAT Management (in orchestration context)
- [x] No UI change; preprod acceptance remains an owner action after rollout.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Read-only diagnosis**
  - [x] Read Docker lock, rules, radar aadc5291 runbook steps 3–4 and server-http.ts; inspect CI deploy and live discovery.
- [x] **Lot 1 — Workload registration and rotation**
  - [x] Validate 64 lowercase hex characters without a newline; hash in the importer before psql; only the hash reaches SQL.
  - [x] Make the named-Secret sync the only preprod creation/rotation path; preserve revoked state without blocking identity sync.
  - [x] Evolve `deploy/ci/idp-identity-sync/services-test.sh` and `sql-test.sh`: invalid inputs, registration, rollback, replay, rotation and revocation.
  - [x] Gate: `make test-idp-sync-selftest ENV=test-idp-token-exchange` passed (47 checks).
  - [x] Gate: `make test-idp-sync-sql ENV=test-idp-token-exchange` passed, including statement-log secrecy, rotation rollback/commit and revoked-row sync.
- [x] **Lot 2 — Policy regression**
  - [x] Test preprod allowed exchange, public/unregistered denial, wrong subject/target audiences and client_credentials denial in `api/tests/api/auth/oauth-token-exchange.test.ts`.
  - [x] Extend exact subject-audience and missing/form/dual-credential refusals; use a public synthetic 64-hex fixture.
  - [x] Gate: `make test-api-endpoints SCOPE=tests/api/auth/oauth-token-exchange.test.ts API_PORT=9845 UI_PORT=6045 MAILDEV_UI_PORT=1945 ENV=test-idp-token-exchange` passed (18 tests) through the CI toolbox and branch-file mounts.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Align `deploy/ci/idp-identity-sync/{README,CRED_CYCLE}.md` and `deploy/k8s/README.md`: metadata check, one preprod writer, 90-day rotation with schedule pause, revocation and protected owner handoff.
  - [x] No temporary feature spec or package source/version change; no UI/e2e surface or live AI dependency.
- [ ] **Lot N — Final validation**
  - [x] Scoped IdP checks and API typecheck/lint pass; generic provisioning refuses the preprod API context with a synthetic fixture; dedicated-stack teardown uses Make only.
  - [x] Scope-check every atomic commit under 150 changed lines; selective staging and Make commits without attribution trailers.
  - [ ] Push and use this complete file as draft PR #770 body; verify CI green on the head and report its SHA.
  - [ ] Owner-only after review: merge, mint/handoff the credential, deploy, sync dry-run/commit and qualify radar. No deployment or secret creation in this author task.
