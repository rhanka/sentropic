# SPEC_EVOL — BR-59 registry-v0 (branch `feat/registry-v0`)

> Branch consolidation spec (consolidate → tests → DELETE pre-merge). Implements the ARCH-19 / SPEC_EVOL_DATA_ARCHITECTURE **object type registry v0 + the envelope contract** (DD-decided design; this is implementation, no re-study). scope:foundations (claude:scale EXECUTIF). Builds on BR-60 (the `control` schema + control-schema.ts exist).

## 0. Authority / guardrails (mandate)
- D2 = execution within scope:foundations. **NO published-`@sentropic/*` contract mutation.** The new `@sentropic/ubo-contracts` package is **`private: true` (UNPUBLISHED, DD6)** — npm publication deferred until the envelope is proven; so it is NOT a published-contract surface (no ARCH-12/D11 gate). NO `ui/**`, no tenant-model change (tenant semantics for storage are gated on ARCH-11 — NOT touched here), no prod config.
- Merge → preprod only.

## 1. Frame & ratified constraints
- **DD1=B** (data:442): generic `business_objects` ONLY for registered custom/agentic types + resolver/envelope-union-view/declared-queryable-indexes; first-party tables stay. The **storage** lots (`business_objects` = BR-61) are GATED on `envelope.tenantId` ← ARCH-11 → **OUT of BR-59**.
- **DD7** (data:196): typed reference fields = lookup vs containment, cardinality, on-delete policy — **IDs, not DB FKs**.
- **DD10** (data:185): the UBO object envelope — `id`, `objectType`, **scope** (binding-defined map; Sentropic binding = tenantId+workspaceId), `payloadSchemaVersion`, `deletedAt`, CAS `version`, `IdempotencyKey`, `origin`, lineage.
- **DD6** (data:232): the envelope + registry wire format live in a **separate in-repo package, publication deferred**.
- **Control-namespace** (data:168-176): the registry table is a control-plane resident → `control` schema (exists via BR-60), no cross-namespace FK, CHECK discipline, DD9 isolation columns.

## 2. V0 slice (IN) vs deferred (OUT)
**IN (this lot):**
1. **`@sentropic/ubo-contracts`** — NEW package, **`private: true`**, types-only (no runtime deps), consumed by `api/`:
   - `ObjectEnvelope` (DD10 shape).
   - `ObjectTypeDefinition` (registry wire format: `objectType`, `jsonSchema`, `declaredQueryableFields: string[]`, `typedReferenceFields: TypedReference[]`, `classification`, `schemaVersion`, `status`).
   - `TypedReference` (DD7: `{ field, targetType, kind: 'lookup'|'containment', cardinality: 'one'|'many', onDelete: 'restrict'|'cascade'|'setnull' }`).
   - `FieldClassification` (PII/secret flags per field path).
   - pure guards (`isObjectEnvelope`, `isObjectTypeDefinition`, …), no zod runtime dep (mirror @sentropic/comments style).
   - Wire `api/` to consume it via the root workspace (the architecture "real consumption" rule — the registry service below imports it).
2. **`control.object_type_definitions`** table (in `api/src/db/control-schema.ts`, next to `event_outbox`, control-stream migration): `object_type` text (unique), `tenant_id` text (nullable = global/first-party type; DD9 isolation when set), `json_schema jsonb`, `declared_queryable_fields jsonb` (paths; index-generation is BR-61, not here), `typed_reference_fields jsonb`, `classification jsonb`, `schema_version int not null default 1`, `status` text (`draft|active|deprecated`, CHECK), `created_at`, `updated_at`. UNIQUE(object_type[, tenant_id]); CHECK discipline; no cross-namespace FK.
3. **`ObjectTypeRegistry` port + `PgObjectTypeRegistry` adapter** (`api/src/services/registry/**`): `register(def)`, `get(objectType, tenant?)`, `list(tenant?)`, `update(objectType, patch)`, `deprecate(objectType)`. **Validation on register/update**: the `jsonSchema` is a well-formed JSON Schema; `typedReferenceFields` reference declared shapes; `declaredQueryableFields` exist in the schema; reject near-duplicate/unbounded type churn (basic caps — the "registry pollution" guard, data:376).
4. **Tests** (`api/tests/registry/**` + `packages/ubo-contracts/tests/**`): registry CRUD + validation (reject malformed schema / bad ref / unknown queryable field); type guards round-trip; control-stream migration applies.

**OUT (deferred — BR-61 / later, NAMED):**
- `business_objects` storage table + resolver port + envelope-union view + generated/expression indexes (BR-61, gated on ARCH-11 tenant semantics).
- Actual index generation from `declaredQueryableFields`.
- npm publication of `@sentropic/ubo-contracts` (DD6 — deferred until envelope proven).
- OpenERP shape-mining co-design (DD3, gated).

## 3. Scope (BRANCH.md formalizes)
- **Allowed**: `packages/ubo-contracts/**` (new private package), `api/src/db/control-schema.ts` (+ the `object_type_definitions` table), `api/drizzle/control/**` (new control migration), `api/src/services/registry/**` (new), `api/package.json` + root `package.json`/`package-lock.json` (workspace wiring for the new package — via `make install-api` / `make lock-root` if needed; if the lockfile/workspace wiring needs a Makefile/db-target seam → `BR59-EX1` + STOP), `api/tests/registry/**`, `spec/SPEC_EVOL_REGISTRY_V0.md` (this, deleted pre-merge), `BRANCH.md`.
- **Forbidden**: published `@sentropic/*` package mutation (contracts/comments/chat/etc.), `ui/**`, `Makefile`, `docker-compose*`, `deploy/**`, `.cursor/rules/**`, the `business_objects` table (BR-61), any tenant-model change. Beyond Allowed → `BR59-EXn` + STOP.
- **Conditional**: workspace/lockfile wiring for the new package may require `make lock-root` or a CI publish-lane skip (the package is private → no publish lane needed; if CI enforces a lane, `BR59-EX1`).

## 4. Acceptance
- `@sentropic/ubo-contracts` (private) builds + exports the envelope/registry/typed-ref types + guards; `api/` imports it through the workspace (real consumption proven).
- `control.object_type_definitions` exists via the control migration stream (applies after public + the BR-60 control migration); full DDL + CHECK + DD9 columns + no cross-namespace FK.
- `ObjectTypeRegistry` CRUD + validation works (rejects malformed schema / bad typed-ref / unknown queryable field; basic pollution caps); proven by tests.
- `make typecheck-api lint-api test-api build-api ENV=test-registry-v0` green; control migrations apply on a fresh DB; 0 regression; NO published-package mutation (grep-proven); NO business_objects table.
