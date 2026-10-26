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

## Historical objective

## Objective
Fix `wait-llm-gateway-mesh-dependency` so a semver range dependency resolves before publishing llm-gateway.
- [x] Migrate zod 3.25.76 to zod >=4.6.6 across api, UI dependency trees, and packages, closing HIGH memory-exhaustion advisory GHSA-mrhx-c7xc-m3w5.

## Scope / Guardrails
- Scope limited to registry wait for gateway mesh dependency plus the merged zod v4 migration (no feature changes).
- One migration max in `api/drizzle/*.sql` (if applicable; none expected).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktrees (`tmp/worktrees/ci-gateway-wait`, `tmp/worktrees/sec-zod4`).
- Automated test campaigns run on dedicated environments (`ENV=test-ci-gateway-wait`, `ENV=test-sec-zod4`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- 0 Python in repos and jobs. One Docker build at a time machine-wide.

## Branch Scope Boundaries (MANDATORY)
- **Inherited allowlist (reference only)**:
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json` (root workspace lock sync for packages/* bumps)
  - `package.json` (root, `overrides` pin only — forces the single v4 line tree-wide)
  - `api/src/**`
  - `api/tests/api/organizations.test.ts` (PR #752 autosave status regression)
  - `api/tests/unit/zod-validator.test.ts` (PR #752 validation response contract)
  - `api/tests/unit/gateway-package-version.test.ts` (candidate gateway version evidence)
  - `api/tests/unit/google-drive-oauth.test.ts` (deterministic tamper test blocking CI)
  - `packages/auth-hono/**`
  - `packages/auth-ui/package.json` (auth-hono 0.17 peer support)
  - `packages/llm-gateway/package.json` (auth-hono 0.17 peer support)
  - `packages/cluster-mesh/package.json` (auth-hono 0.17 peer support)
  - `packages/cluster-mesh/src/modules/catalog.ts` (auth-hono 0.17 runtime preflight support)
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts` (candidate version assertions)
  - `packages/cluster-mesh/tests/modules/registry.spec.ts` (auth-hono runtime version boundary)
  - `packages/comments/**`
  - `packages/skills/**`
  - `packages/cluster-mesh/tests/packaging/**` (Zod resolution in the frozen consumer)
  - `packages/cluster-mesh/tests/storage/comments-deps.package.json`
  - `packages/cluster-mesh/tests/storage/postgres.mk` (standalone consumer Zod resolution)
  - `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`
  - `docs/comments-annotations/contract/package-zod4-migration.json`
  - `.security/vulnerability-register.yaml`
  - `.security/audit-allowlist.json`
  - `BRANCH.md`
  - `Makefile` (BR01-EX1, BR01-EX2: Zod pins and Compose-safe verification; gateway mesh range wait)
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-pack.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/publishable-classification.test.mjs`
  - `.github/workflows/ci.yml` (BR01-EX4: skills validation lane)
- **Inherited denylist (reference only)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Inherited conditional list (reference only)**:
  - `Makefile`
  - `packages/cluster-mesh/packaging.mk`
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**` (except the allowed ci.yml exception)
  - `ui/**`
  - `e2e/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

