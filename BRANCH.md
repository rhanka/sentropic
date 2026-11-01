# Feature: IdP OAuth refresh token — lots 1–3

Opted-in MCP clients can renew a one-hour access token within a rotating 15-day refresh family. Explicit local offline consent, atomic rotation and durable revocation remove the hourly connector relogin while preserving the absolute family deadline.

## Objective
- [ ] Deliver rotated OAuth refresh families capped at 15 days, preserving 1-hour access tokens, in one draft PR to main.

## Scope / Guardrails
- [x] Implement merged `spec/SPEC_EVOL_IDP_OAUTH_REFRESH_TOKEN.md` and its reconciliation amendment; no design changes.
- [x] Worktree `tmp/worktrees/idp-refresh`; branch `feat/idp-refresh-token`; ENV `test-idp-refresh`.
- [x] Ports: API 9590, UI 5790, Maildev UI 1690; Docker under `.tmp/packets/DOCKER-LOCK.md` flock; one local suite at a time.
- [x] One new additive control migration after main's final migration; refresh rows remain separate from identity tables.
- [x] Make-only; tests first; selective staging; `make commit`; each commit under 150 lines; three ordered commit groups.
- [x] One CI run on the final review-ready head; draft PR; wait for completion; no merge.
- [x] D-R1, D-R2, D-R3 use the proposed defaults: **pending owner ratification**.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/config/env.ts`
  - `api/src/db/schema.ts`
  - `api/src/services/auth/**`
  - `api/src/services/session-manager.ts`
  - `api/src/services/tenant*`
  - `api/src/routes/auth/**`
  - `api/src/routes/namespaces/oauth-ingress.ts`
  - `api/src/scripts/oauth-register-client.ts`
  - `api/tests/**`
  - `api/drizzle/**`
  - `packages/auth-hono/**`
  - `packages/auth-ui/**`
  - `deploy/ci/idp-identity-sync/**`
  - `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql`
  - `docs/oauth-client-rotation.md`
  - `docs/**restore**`
  - `scripts/**restore**`
  - `spec/DATA_MODEL.md`
  - `package-lock.json`
  - `api/package-lock.json`
  - `ui/package-lock.json`
  - `Makefile`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/client-policy.sql`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql`
  - `deploy/k8s/overlays/preprod/patch-auth-idp-config.yaml`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (one migration only)

## Feedback Loop
- [x] BRIR-EX1: extend only test-auth-ui tool dependencies to render the mandated real Svelte consent component; impact limited to that test target; rollback restores the prior isolated tool list.
- [x] BRIR-EX2: add mandatory refresh invalidation after supported database restore targets, before reopening token traffic; impact is fail-closed restore completion; rollback restores prior target recipes.
- [x] BRIR-EX3: retire PR #868's temporary preprod 15-day access TTL when deploying these lots, as that override requires; restore the binding 1-hour access TTL and leave prod unchanged.
- [x] Track source ready for designated-writer import under owner item `01M588EA0X3RQPCATVR987CFB4`; concurrent `.track` writes are reserved to the conductor.
- [x] A4 identity cutover may land in parallel; no identity-table redesign or new account/session references.
- [x] D-R1: require a new authorize flow at day 15; D-R2: browser logout preserves consented offline MCP families; D-R3: non-null required_acr remains ineligible — **pending owner ratification**.

## AI Flaky tests
- [x] No provider-backed test or flaky exception planned.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; sequential implementation and verification of lots 1–3.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Persistence, consent and sync**
  - [x] Add migration, schema, refresh transaction port, client/user/anchor lock ordering and TTL.
  - [x] Preserve grant_types during registration/rotation; keep offline evidence local during sync and invalidate removals/rekeys.
  - [x] Tests first: `api/tests/unit/auth/oauth-state-adapter.refresh.test.ts`, `api/tests/unit/oauth-register-client.test.ts`, `api/tests/scripts/idp-identity-sync.test.ts`.
  - [x] Gate: PostgreSQL races/failure rollback and `api/tests/unit/drizzle-journal-integrity.test.ts`.
- [x] **Lot 2 — Protocol and consent UI**
  - [x] Add live-policy predicate, resource-aware offline consent, sealed epoch/audience, initial issuance and atomic rotation.
  - [x] Enforce one digest, absolute cap and wire errors; advertise refresh only for opted-in clients.
  - [x] Tests first: `packages/auth-hono/tests/oauth/refresh-token-flow.test.ts`, `packages/auth-hono/tests/oauth/authorize-offline-access.test.ts`.
  - [x] Tests first: `packages/auth-ui/tests/oauth-consent.test.ts`, `packages/auth-ui/tests/oauth-consent-rendering.test.ts`, `api/tests/api/auth/oauth-refresh.integration.test.ts`.
  - [x] Gate: protocol, host and visible consent suites; independent T−1/T/T+1 fixtures.
  - [x] Rendered-component acceptance: client, issuer, concrete/default audience, exact offline scopes, 15-day continuation and withdrawal scope. Native claude.ai preprod UAT belongs to Lots 0/5.
- [x] **Lot 3 — Revocation and security**
  - [x] Join all revoke/policy/account/tenant/consent/security-generation writers to serialization; opaque revoke/introspection, no resurrection and DR invalidation.
  - [x] Tests first: `packages/auth-hono/tests/oauth/revoke-introspect-refresh.test.ts`; PostgreSQL lifecycle and initial-creation races in adapter suite; host security integration.
  - [x] Make only the governed preprod public PKCE immo-mcp row eligible; assert preprod divergence and unchanged prod row.
  - [x] Gate: PostgreSQL reuse/rotation/revocation races, registration/sync suites, affected typecheck/lint and package version checks.
- [ ] **Delivery**
  - [ ] Review code, address findings, keep each commit under 150 lines, run scope-check before each commit.
  - [ ] Create draft PR with this file as body and 3–6 step first comment; one final-head CI run and wait for completion.
  - [ ] Write `.tmp/rv/idp-refresh.md`: PR, head, CI, every §9 group and preprod apply steps (sync row, deploy); stop without merging.

## Validation and rollout
- Auth-hono: full existing suite plus scoped protocol/security additions; real compiled Svelte consent rendering and auth-ui regression suite.
- PostgreSQL: deterministic separate-connection barriers in both orders, concurrent HTTP rotation/reuse, linked-JTI revocation, code/signing/insert/commit rollback, retention and restore invalidation.
- Registration and SQL sync self-tests assert preprod divergence and unchanged prod policy; journal integrity checks the single new control migration `0013_oauth_refresh_tokens` after `0012_app_artifact_host`.
- Deploy the migration/runtime to every preprod replica, then use governed identity sync (`ALLOWED_CLIENTS=immo-mcp`, dry-run then approved apply) to opt in the public PKCE row. PR #868's temporary access TTL is reset to 3600 by this rollout.
- Package candidates: auth-hono 0.18.0 > registry 0.17.0; auth-ui 0.9.0 > registry 0.8.0, rechecked after rebase.
- D-R1, D-R2 and D-R3 remain **pending owner ratification**. Lots 0/4/5 and production activation are outside this PR.
