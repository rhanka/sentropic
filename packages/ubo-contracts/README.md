# @sentropic/ubo-contracts

Universal Business Object (UBO) contracts — **types only**, zero runtime deps:

- **`ObjectEnvelope`** — the DD10 object envelope (binding-defined `scope` map, `payloadSchemaVersion`, CAS `version`, `origin`, `lineage`, soft `deletedAt`). Deliberately distinct from the published `@sentropic/contracts` `EventEnvelope` (DD10 rejected a fixed `tenant: TenantContext` scope).
- **`ObjectTypeDefinition`** — the ARCH-19 object-type registry wire format (`jsonSchema`, `declaredQueryableFields`, `typedReferenceFields`, `classification`, `schemaVersion`, `status`).
- **`TypedReference`** — DD7 reference semantics (lookup vs containment, cardinality, ID-level `onDelete` — never a DB foreign key).

Published as an ESM library. Install with `npm install @sentropic/ubo-contracts` and import contracts and guards from `@sentropic/ubo-contracts`.

## Releases

First publication uses the owner-operated [web bootstrap](../../scripts/publish/README.md); later releases use CI trusted publishing.
