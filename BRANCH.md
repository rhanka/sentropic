# Feature: ARCH-11 G1a Tenant Re-key Data Completion

## Objective
- [x] Complete only the residual G1a `control.event_outbox` re-key; preserve G1b+ aliases and reuse `resolveTenant`.

## Scope / Guardrails
- [x] Base assessment confirms G1a points 1-6 already exist on `main` at `df797880a`.
- [x] Base assessment confirms `resolveTenant` and cluster-mesh deny-as-missing wiring already exist.
- [x] Re-key only proven aliases in the column plus `envelope.tenant.tenantId` and `envelope.scope.tenantId`.
- [x] Leave unresolved rows, absent JSONB paths, and unrelated JSONB unchanged.
- [x] Keep UBO and Resource Plane contract types unchanged because no UBO persistence table exists.
- [x] Keep all seven application alias sites unchanged for G1b+.
- [x] Use make-only commands, isolated `ENV=arch11g1a`, explicit staging, and sub-150-line commits.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**
  - [x] `BRANCH.md`
  - [x] `api/drizzle/control/0006_arch11_outbox_tenant_rekey.sql`
  - [x] `api/drizzle/control/meta/_journal.json`
  - [x] `api/tests/api/tenancy/arch11-outbox-rekey.test.ts`
  - [x] `api/tests/api/tenancy/arch11-tenant-data.test.ts`
- [x] **Forbidden Paths (must not change in this branch)**
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] Existing G1b+ tenant resolution and application alias sites under `api/src/**`
  - [x] `packages/ubo-contracts/**` and `api/src/services/resource-plane/**`
- [x] **Conditional Paths**
  - [x] `api/src/db/control-schema.ts`, `api/drizzle/*.sql`, `.github/workflows/**` only with an explicit exception.
- [x] **Exception process**
  - [x] No conditional or forbidden path changed; no `ARCH11-G1A-EXn` required.

## Feedback Loop
- [x] Owner EVOL is authoritative; source gap: no persisted UBO table exists, so no UBO row re-key applies.
- [x] Clear isolated root-owned `node_modules` only via `make clean-node-modules`; focused rerun is green.
- [x] Replace the G1a backfill test's global one-second race with an assertion on the versioned migration statement.

## AI Flaky tests
- [x] Accept no deterministic or security failure as flaky; record eligible nondeterminism with owner sign-off.

## Orchestration Mode
- [x] **Mono-branch** on `feat/arch11-g1a`, without construction sub-agent or review phase.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Assessment and exact scope**
  - [x] Read `rules/MASTER.md`, workflow, testing rules, and the full ARCH-11 EVOL.
  - [x] Verify branch; confirm existing G1a-G1c, resolver, and the residual outbox carrier on `main`.
  - [x] Gate: `make scope-check ENV=arch11g1a`.

- [x] **Lot 1 — Residual DATA re-key**
  - [x] Add one idempotent control migration for legacy alias rows.
  - [x] Re-key column and embedded tenant/UBO scope copies through `workspaces.tenant_id` only.
  - [x] Commit migration SQL and control journal atomically with this branch plan.
  - [x] Gate: `make db-migrate API_PORT=9055 UI_PORT=5255 MAILDEV_UI_PORT=1155 REGISTRY=local ENV=arch11g1a`.
  - [x] Add focused integration coverage in `api/tests/api/tenancy/arch11-outbox-rekey.test.ts`.
  - [x] Gate: focused test, `make scope-check ENV=arch11g1a`, and `harness check scope`.

- [ ] **Lot 2 — Final validation and delivery**
  - [x] Gate: `make build`, `make typecheck`, and `make lint` with `ENV=arch11g1a` last.
  - [x] Gate: `make test` smoke, unit, endpoints, queue, and security categories are green.
  - [x] Source gap: local AI tests require provider secrets supplied only by `.github/workflows/ci.yml:953-978`.
  - [x] Verify branch scope mechanically and verify no application alias site changed.
  - [ ] Push, open the owner-requested PR without merging, and verify green CI.
  - [ ] Write the report and send valid `sentropic.h2a` envelopes to drumbeat and infra.
