# BRANCH — feat/registry-v0 (BR-59 registry-v0)

- Branch: `feat/registry-v0`
- Mode: mono-branch
- Baseline: origin/main @ beeb3f90d
- Scope: foundations (claude:scale EXECUTIF) — ARCH-19 object-type registry v0 + UBO envelope contract (private pkg). Builds on BR-60 (`control` schema).

## Allowed Paths
- [x] `packages/ubo-contracts/**` (new PRIVATE package)
- [x] `api/src/db/control-schema.ts` (add `object_type_definitions`)
- [x] `api/drizzle/control/**` (new control migration)
- [x] `api/src/services/registry/**` (registry port + adapter)
- [x] `api/package.json` + root `package.json`/`package-lock.json` (workspace wiring)
- [x] `api/tests/registry/**`, `packages/ubo-contracts/tests/**`
- [x] `spec/SPEC_EVOL_REGISTRY_V0.md` (deleted pre-merge), `BRANCH.md`

## Forbidden Paths
- [x] published `@sentropic/*` mutation, `ui/**`, `Makefile`, `docker-compose*.yml`, `deploy/**`, `.cursor/rules/**`, `business_objects` table (BR-61), tenant-model change

## Conditional Paths
- [x] lockfile/workspace wiring via `make lock-root` (existing target) — if it needs a Makefile edit → `BR59-EX1` + STOP

## Lots
- [ ] **Lot 1 — `@sentropic/ubo-contracts` private package + api wiring**
  - [x] package.json (private) + tsconfig + src/types.ts + src/guards.ts + src/index.ts + README
  - [x] api/package.json dep `file:../packages/ubo-contracts`
  - [ ] root lockfile regen (`make lock-root`)
  - [ ] commit
- [ ] **Lot 2 — `control.object_type_definitions` table** (control-schema.ts + control migration)
- [ ] **Lot 3 — `ObjectTypeRegistry` port + `PgObjectTypeRegistry` adapter** + validation
- [ ] **Lot 4 — tests** (guards round-trip; registry CRUD + validation; control migration applies)
- [ ] **Lot N — gates** (`make typecheck-api lint-api test-api build-api ENV=test-registry-v0`)

## Feedback Loop
- none

## Deferred to BR-61
- `business_objects` storage + resolver + envelope-union view + generated indexes (gated on ARCH-11).
- npm publication of `@sentropic/ubo-contracts` (DD6, deferred until envelope proven).
