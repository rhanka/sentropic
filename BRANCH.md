# Feature: ARCH-11 G1a Tenant Re-key Data Completion

## Objective
- [ ] Complete only the residual G1a `control.event_outbox` re-key; preserve G1b+ aliases and reuse `resolveTenant`.

## Scope / Guardrails
- [x] Base assessment confirms G1a points 1-6 already exist on `main` at `df797880a`.
- [x] Base assessment confirms `resolveTenant` and cluster-mesh deny-as-missing wiring already exist.
- [x] Re-key only proven aliases in the column plus `envelope.tenant.tenantId` and `envelope.scope.tenantId`.
- [x] Leave unresolved rows, absent JSONB paths, and unrelated JSONB unchanged.
- [x] Keep UBO and Resource Plane contract types unchanged because no UBO persistence table exists.
- [x] Keep all seven application alias sites unchanged for G1b+.
- [ ] Use make-only commands, isolated `ENV=arch11g1a`, explicit staging, and sub-150-line commits.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**
  - [ ] `BRANCH.md`
  - [ ] `api/drizzle/control/0006_arch11_outbox_tenant_rekey.sql`
  - [ ] `api/drizzle/control/meta/_journal.json`
  - [ ] `api/tests/api/tenancy/arch11-outbox-rekey.test.ts`
- [ ] **Forbidden Paths (must not change in this branch)**
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
  - [ ] Existing G1b+ tenant resolution and application alias sites under `api/src/**`
  - [ ] `packages/ubo-contracts/**` and `api/src/services/resource-plane/**`
- [ ] **Conditional Paths**
  - [ ] `api/src/db/control-schema.ts`, `api/drizzle/*.sql`, `.github/workflows/**` only with an explicit exception.
- [ ] **Exception process**
  - [ ] Declare `ARCH11-G1A-EXn` before changing any conditional or forbidden path.

## Feedback Loop
- [x] Owner EVOL is authoritative; source gap: no persisted UBO table exists, so no UBO row re-key applies.

## AI Flaky tests
- [ ] Accept no deterministic or security failure as flaky; record eligible nondeterminism with owner sign-off.

## Orchestration Mode
- [x] **Mono-branch** on `feat/arch11-g1a`, without construction sub-agent or review phase.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Assessment and exact scope**
  - [x] Read `rules/MASTER.md`, workflow, testing rules, and the full ARCH-11 EVOL.
  - [x] Verify branch; confirm existing G1a-G1c, resolver, and the residual outbox carrier on `main`.
  - [x] Gate: `make scope-check ENV=arch11g1a`.

- [ ] **Lot 1 — Residual DATA re-key**
  - [x] Add one idempotent control migration for legacy alias rows.
  - [x] Re-key column and embedded tenant/UBO scope copies through `workspaces.tenant_id` only.
  - [x] Commit migration SQL and control journal atomically with this branch plan.
  - [x] Gate: `make db-migrate API_PORT=9055 UI_PORT=5255 MAILDEV_UI_PORT=1155 REGISTRY=local ENV=arch11g1a`.
  - [ ] Add focused integration coverage in `api/tests/api/tenancy/arch11-outbox-rekey.test.ts`.
  - [ ] Gate: focused test, `make scope-check ENV=arch11g1a`, and `harness check scope`.

- [ ] **Lot 2 — Final validation and delivery**
  - [ ] Gate: `make build`, `make typecheck`, `make lint`, and `make test` with `ENV=arch11g1a` last.
  - [ ] Verify branch scope mechanically and verify no application alias site changed.
  - [ ] Push, open the owner-requested PR without merging, and verify green CI.
  - [ ] Write the report and send valid `sentropic.h2a` envelopes to drumbeat and infra.
