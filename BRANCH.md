# Feature: Governed client_credentials service client provisioner

## Objective
- [ ] Provide a governed, idempotent path to register a `client_credentials` service client (`service_clients` row + CM tenant binding) through a one-off Job and a Make target, replacing the « out-of-band » procedure.

## Scope / Guardrails
- [x] Branch feat/oauth-service-client-provisioner from origin/main 8ee9c24ef; worktree tmp/worktrees/svc-client-provisioner; ENV=test-svc-client.
- [x] Wagon: pushed branch only, no PR, no version bump, no lock regeneration; rides train 1b.
- [x] Make only; no Python, no attribution trailers, no CI skips; commits under 150 lines.
- [x] Never print a secret: the script logs no plaintext and no hash.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/auth/service-client-provisioning.ts`
  - `api/src/scripts/oauth-register-service-client.ts`
  - `api/tests/unit/oauth-register-service-client.test.ts`
  - `api/package.json`
  - `deploy/k8s/base/37-oauth-register-service-client-job.yaml`
  - `deploy/k8s/base/15-networkpolicy.yaml`
  - `scripts/ci/oauth-service-client-job.test.mjs`
  - `docs/secrets.md`
  - `deploy/ci/idp-identity-sync/CRED_CYCLE.md`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/*/src/**`
  - `api/drizzle/*.sql`
  - `package-lock.json`
- **Conditional Paths (allowed with declared exception)**:
  - `Makefile` under BRSVC-EX1.

## Feedback Loop
- [x] BRSVC-EX1: additive target `oauth-register-service-client-job` and the Job render test added to the default `test-publishable-manifests` list. Rollback: delete the target and the list entry; the Job yaml stays valid for direct kubectl apply.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- [x] Rationale: one wagon, integrated by the train lane.

## UAT Management (in orchestration context)
- [ ] Preprod run of the immo client after the train 1b image deploy (ops lane).

## Plan / Todo (lot-based)
- [x] Lot 1: pure env parser and provisioning planner with unit tests.
- [x] Lot 2: script entrypoint, dist build, Job manifest, network policy.
- [x] Lot 3: Make target, Job render test, docs/secrets.md procedure with the 90-day cycle.
- [ ] Lot N: scoped checks green (`make test-api-unit SCOPE=tests/unit/oauth-register-service-client.test.ts ENV=test-svc-client`, `make test-publishable-manifests SCOPE=scripts/ci/oauth-service-client-job.test.mjs ENV=test-svc-client`, `make typecheck-api ENV=test-svc-client`); branch pushed.
