# @sentropic/ubo-contracts (private, unpublished)

Universal Business Object (UBO) contracts — **types only**, zero runtime deps:

- **`ObjectEnvelope`** — the DD10 object envelope (binding-defined `scope` map, `payloadSchemaVersion`, CAS `version`, `origin`, `lineage`, soft `deletedAt`). Deliberately distinct from the published `@sentropic/contracts` `EventEnvelope` (DD10 rejected a fixed `tenant: TenantContext` scope).
- **`ObjectTypeDefinition`** — the ARCH-19 object-type registry wire format (`jsonSchema`, `declaredQueryableFields`, `typedReferenceFields`, `classification`, `schemaVersion`, `status`).
- **`TypedReference`** — DD7 reference semantics (lookup vs containment, cardinality, ID-level `onDelete` — never a DB foreign key).

**UNPUBLISHED (DD6)**: `"private": true`; npm publication is deferred until the envelope is proven (BR-61 storage + a real consumer). Consumed in-repo by `api/` via the workspace.
