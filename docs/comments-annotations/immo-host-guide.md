# Immo host integration with the comments M2 candidate

The candidate pair is `@sentropic/cluster-mesh@0.19.0` and the unchanged optional peer `@sentropic/comments@0.3.0`. Keep the exact archive and installed lock with the [qualification evidence](evidence/installed-module.md). Publication and real-data delivery are separate owner actions.

## Schema verification and operator re-attestation

Fingerprints cover tables and functions created by the selected package assets, including their columns,
constraints and indexes. Shared host schemas are supported: unrelated host tables/functions are excluded.
Changes to module-owned objects must come from reviewed package assets. Startup verifies receipts and DDL;
it never runs migrations or re-attests automatically. A mismatch raises exported `PgSchemaDriftError`
with `condition: 'schema-drift'`, `expectedFingerprint` and `actualFingerprint`.

After every host migration, run `verifyPgInstallation` before reopening application traffic. Unrelated
DDL requires no receipt change. Restore unexpected module drift or apply a reviewed package migration.

For a PostgreSQL major upgrade, keep a backup of the database and host receipts, stop writers, acquire
the host migration lock, and verify on the source server before upgrading. Verify again on the target
major: PostgreSQL may change the textual rendering of catalog definitions. If verification differs:

1. Install the exact same package assets and layout names into a clean reference database on the target
   PostgreSQL major, through `applyPgMigrations`. Its final receipt supplies the `referenceFingerprint`.
2. Compare the upgraded module DDL with that reference. Resolve actual drift before proceeding. Never
   copy the failing database's `actualFingerprint` into the approval as a substitute for this reference.
3. In one host-owned serializable transaction under the migration lock, call `reattestPgInstallation`
   with `previousFingerprint` from the saved latest receipt, the independently obtained
   `referenceFingerprint`, `hostMigrationId`, 64-character SHA-256 `hostChecksum`, and an audit `reason`.
4. Implement optional `PgHostHistory.reattest(session, attestation)` to compare-and-swap the latest
   receipt fingerprint and append the full `PgSchemaAttestation` to the host's append-only operator audit
   in that same session. Preserve every original migration identity, checksum and version. A failed CAS
   must throw. The module re-verifies the persisted result before the transaction can commit.
5. Reopen the module and exercise a saved M1 page cursor using the existing host secret before traffic.
   On failure, roll back the host transaction; use the database backup for an upgrade rollback.

`postgres-reattest.spec.ts` exercises changed historical fingerprints, wrong previous approvals,
successful target-reference attestation, unrelated host DDL and refusal of actual module table drift.

## Inject execution and migrate through the host

Every durable Postgres root requires a nonempty `cursorSecret`, including generic storage roots.
Load it from host secret storage, retain it across restarts and share it between all replicas of the
same installation. A random key per process breaks retained M1 page cursors. Keep the old key for the
lifetime of those cursors; changing this single-key configuration invalidates them explicitly as
`incomplete` with no continuation. Memory K3 retains its existing optional ephemeral configuration.

Import `createCommentsModule` and `createCommentsPostgresStorage` from `@sentropic/cluster-mesh/comments`, and `loadPgAssets`, `applyPgMigrations` from `@sentropic/cluster-mesh/storage/postgres`.

The host implements `InjectedPgDriver.transaction(options, operation)`. It acquires one SQL session, begins the requested serializable read-only/read-write transaction, invokes `operation({execute(statement)})`, and commits or rolls back. Enforce `deadlineMs`, release the session, and preserve an uncertain COMMIT outcome as such. Each statement is `{text, values}` with bound parameters. A single connection is sufficient; the module reuses an active same-scope session. Driver dependencies belong to the host.

Use existing host migration ownership and history. `PgHostHistory.read(session)` returns ordered package migration receipts; `complete(session, receipt)` records each receipt in that same transaction. Under the host's migration lock:

Keep receipts in chronological application order, keyed by asset `id`. Each core/module chain has
its own `order` and `fromVersion`/`toVersion`; these numbers are not global host positions. Comments
001 explicitly depends on core 006, and a later core 007 can install after comments without rewriting
their receipts. Keep a separate host application ordinal if the host needs one.

Immo's `drizzle.__drizzle_migrations(hash, created_at)` and `radar_migration_steps` cannot represent
the full `PgMigrationReceipt`. Add a host-owned receipt table in the host migration, for example:

```sql
CREATE TABLE host_cluster_mesh_receipts (
  application_ordinal bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id text UNIQUE NOT NULL,
  receipt jsonb NOT NULL
);
```

Implement `read` ordered by `application_ordinal`, and `complete` inserting the exact asset ID and
full receipt JSON under the host lock/session. Preserve chain identity, checksums, status and schema
fingerprint. Link `hostMigrationId`/`hostChecksum` to the host migration; this is a host receipt store,
not another module-owned migration scheduler. Keep re-attestation's append-only operator audit too.

```ts
const assets = await loadPgAssets({ comments: true });
await driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 5000 }, session =>
  applyPgMigrations(session, layout, assets, hostHistory,
    { id: hostMigrationId, checksum: hostMigrationChecksum }));
```

`layout` supplies `dataSchema`, `projectionSchemas: {comments: ...}` and `outboxSchema`. Schemas must already exist. The package does not schedule migrations or maintain a parallel host ledger. It verifies asset hashes, dependency/order receipts and actual schemas before opening storage. The qualified fixture uses one schema; split data/projection schemas are separately covered by source tests.

```ts
const storage = await createCommentsPostgresStorage({
  driver, layout, history: hostHistory, cursorSecret: hostSecrets.commentsCursorKey,
  services: { capacity, capabilities, resolver, decisions, clock },
});
const module = createCommentsModule({ storage: storage.adapter(), capacity });
```

Use the same frozen `capacity` and authority ports for storage/module/HTTP composition. The selected internal work profile requires 1024 records, 128 appends and 4 MiB for one native operation; smaller hosts explicitly refuse this profile. Transport limits remain independently smaller. Capability checks must implement the host policy against every complete resource tuple; synthetic fixtures granting all capabilities are test-only.

## Bind verified invocation authority

Only the host issues grants with `storage.bindNew(grant)`. A grant includes token, `moduleId: 'comments'`, exact tenant/workspace scope, verified principal, operations, issuer/policy/authority revisions, module authority and invocation/lease lifetime. Persisted issuance survives runtime reconstruction; `storage.revoke(token)` remains effective after reopening. Never derive a grant from request-body scope or let a client choose grant operations.

```ts
await storage.bindNew(grant);
await module.withContext(grant, async () => {
  const head = await module.store.getAnnotationHead(grant.scope, annotationId);
  // Native services use the same issued context and recheck final authority.
});
```

All 24 frozen store methods remain available. The raw store is a trusted persistence port; expose operational services/HTTP to clients. M1 transactions use `module.store.transaction().run(async () => ...)`, with pending reads and rollback-only error propagation. Barrier-covered/disposed full getters throw `denied`.

The module executes arbitrary `transaction().run` callbacks once. On PostgreSQL SQLSTATE `40001`,
the host may retry the whole transaction with a finite bound, for example three attempts, using the
original command/idempotency keys. The callback must contain replay-safe database work; perform
external effects only after a known commit or through the transactional outbox. A classified error
has `condition: 'contention'`, `retryable: true`, `sqlState: '40001'`. Do not retry an uncertain COMMIT
as a new command; recover the original receipt instead. Only immutable internal flushes retry inside
the module. `postgres-transactions.spec.ts` qualifies the once-only callback/finite flush policy.

For HTTP, compose `createCanonicalCommentsNamespaceModule` from `@sentropic/cluster-mesh/compose/comments` using a real `createClusterMeshModules()`, full `createClusterMeshRuntime()` and `createClusterMeshPlugin()`. Supply `{enabled, generationId, module, ports, router: {capacity}, resolveGrant}`. `ports` is `{store: module.store, capabilities, resolver, decisions}`. `resolveGrant(verifiedInvocation)` resolves/issues host authority; the namespace checks principal, workspace, generation and invocation lifetime on every route. Disabled composition does not evaluate the optional peer. The installed fixture is an executable example: `packages/cluster-mesh/tests/storage/installed-namespace.mjs`.

The exact frozen `createCanonicalCommentsRouter(ports, {capacity})` factory is also exported from `./comments` and `./comments/hono`. Its caller must establish an issued module context. It offers annotation/thread/comment revision/head/page routes and lifecycle commands, with server registration and full-envelope byte limits. There is no raw append or caller-supplied physical purge completion. Dedicated review/submission/assignment service APIs remain outside this delivery scope.

## Prepare, commit and recover an import

Freeze the source inventory and mapping before sending fragments. Build the unchanged M1 `CanonicalBatchImportRequest`: scope, batch ID, canonical import manifest/hash, admitted unit metadata/dependencies/payload digests, expected mapping version and stable command idempotency key. `commentsAdmissibleManifestDigest(units)` commits sorted declared unit identities/dependencies; `commentsUnitPayloadDigest(unitId, records)` commits ordered typed M1 hashes. Every full M1 record hash is checked independently. Source completeness remains the converter's responsibility.

Bind `CommentsImportBinding` with version `comments-transport-v1`, stable operation ID, exact request, selected `unitIds`, immutable source boundary, actual target resource tuples and required capabilities. `commentsImportBindingDigest(binding)` binds all fields. One coherent group contains at most 50 selected units; dependencies outside it require previously committed receipts for this same frozen request. A history may span many fragments.

Batch receipt recovery is capped at 50 committed operations/groups, independently of `capacity.batchUnits`.
The query reads at most 51 rows and returns typed `capacity-exceeded` if the batch exceeds 50; there is
no receipt-recovery pagination. Group units so each batch uses at most 50 operations, or partition into
separate batch IDs before import. This operation cap is distinct from the per-group 50-unit limit.

The trusted writer provisions a `WriterFence` through `storage.provisionFence(grant, fence)`. Persist this fence with the conversion operation; a superseded fence cannot accept even an identical fragment retry.

For each bounded payload, call `createCommentsFragment(manifest, records)` and `module.services.prepareImportFragment({binding, fragment, fence})` inside `withContext`. Manifest fields are scope, operation ID, binding digest, unit ID, decimal ordinal, predecessor fragment hash and `terminal: null`. Ordinals start at `'0'`. An identical retry returns its original acknowledgement; changed bytes/binding/gaps refuse. Progress has no canonical visibility.

The last fragment has empty payload, `unitId: null`, and `terminal: {fragmentCount, unitRoots}`. `fragmentCount` includes this terminal fragment; each root is `{unitId, records, payloadDigest}`. Only this verified terminal acknowledgement yields a `CommentsPreparedReference`. Persist it together with the original request and fence. `inspectPreparedImport({scope, operationId, bindingDigest})` recovers accepted progress/reference.

```ts
const result = await module.withContext(grant, () =>
  module.services.commitPreparedImport({ request, prepared, fence,
    limits: { maxRecords: 64, maxAppends: 16, maxEncodedBytes: 524288 } }));
if (result.state === 'preparing') {
  // Persist/requeue another bounded call; nothing has published yet.
} else {
  const receipt = result.receipt; // CommentsCompleteReceipt
  // Retain canonical unit receipts/snapshot, typed roots and kernel receipt.
}
```

Schedule another bounded call while preparing. Runtime restart preserves progress. A publication atomically exposes data, bindings, receipts, operation audit and journal. After commit-before-response loss, call `recoverBatchReceipts({scope, batchId, manifestHash})` under a current read grant for the original principal. It returns complete original receipts including registration/root evidence. Never count fragment acknowledgements, a partial group or a historical imported purge claim as successful physical completion.

## Export and authorized readback

Call `prepareExportBoundary({scope, exportId, selections, operationKeys?}, continuation?)` until `state === 'prepared'`, persisting the returned preparation continuation between bounded calls. The result contains actual frozen root/heads through `boundaryDigest`, a typed `unitRoot`, and an unchanged M1 export `request`. New writes do not extend that boundary.

Use `readExportFragments(boundary.request, cursor, limit)` for whole transport fragments or `continueExport(boundary.request, cursor, limit)` for M1 canonical-record pages. Pass each returned `nextCursor` separately; do not alter frozen DTO fields. Preserve ordinal/predecessor/digest order and verify the final terminal root/count. End-of-page alone is not proof of a complete source export. Retained boundaries/cursors have no time-only expiry; missing erased bytes explicitly report incomplete/denied instead of silently truncating.

Operational reads, export pages and receipt recovery recheck current scope/resource authority; personal lifecycle preferences and restricted audit audiences are enforced. A source-to-destination copy/transfer requires explicit mapped identities/hashes and preserved attribution/derivation audit. Confirm destination commit/readback first. Source retirement is a separate authorized lifecycle command; destination success grants no source deletion authority.

The [transport vectors](contract/transport-v1.json) pin escaped/multibyte framing. Manifest/root limit is 64 KiB; payload 512 KiB; batch manifest 256 KiB; complete request/page 1 MiB; default/maximum page count 50/100. Whole logical histories have no fragment-sized ceiling. Oversized individual records, deep profiles and excess targets/segments are explicit admission refusals. The [installed evidence](evidence/installed-module.md) records the tested tuple and practical bounds.
