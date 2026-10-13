# Comments Generic Storage Port Compatibility & Extension Manifest (C0)

Date: 2026-10-12  
Specification: L3a v4.1 frozen §17.2 row C0, §17.4  
Deliverables:
- Manifest: [`storage-module-v1.json`](storage-module-v1.json)
- Specification note: [`storage-compatibility.md`](storage-compatibility.md)
- Test boundary: [`packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`](../../../packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts)

---

## 1. Objective and Context

Under the owner decision of 2026-10-11 (`M2-DELTA` / `G2 amendment`), **storage and API implementation of the comments model are placed in the `cluster-mesh` package as a module**, while **`@sentropic/comments` retains semantic and contract authority**.

Lot **C0** of the frozen L3a v4.1 storage-port specification establishes:
1. **Preservation of frozen M1 contracts**: zero modification to frozen M1 source files, exports, record kinds, store methods, or error vocabulary.
2. **Compatibility manifest (`storage-module-v1.json`)**: formal declaration of module identity, required storage profiles, extension capabilities, query profiles, and transport boundaries.
3. **Exact packaging and transport declarations**: explicit declarations for chained staged units, continuation envelopes, and the packaged conformance oracle.
4. **Exit evidence**: test suite (`comments-contract-boundaries.spec.ts`) that pins the SHA-256 of all M1 source files and verifies compatibility boundaries.

---

## 2. Frozen-M1 Preservation

The baseline contract for comments is frozen at commit `7b8e5daf022cc58819dfdfae43cd89a703a82f96` on branch `feat/comments-annotations-model` (PR #663):

- **Contract Manifest**: [`contract-v1.json`](contract-v1.json) (SHA-256: `e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0`)
- **Freeze Receipt**: [`freeze-receipt.md`](freeze-receipt.md) (SHA-256: `095e1d50f4c64ddc7254ca7e86f10582e4d1c2f153ec5173c79cb62818dc92cb`)
- **Hash Version**: `revision-hash-v1` (vector SHA-256: `26ee62b09d22f39438c344a9223564f08e696eeba95ddd0558f357407a40f0c0`)

### Invariants Preserved Without Modification
1. **Store Methods**: All 24 methods on `CanonicalCommandStore` remain unchanged.
2. **Record Kinds**: All 11 canonical record kinds (`annotation-revision`, `thread-structure-revision`, `comment-revision`, `review-event`, `prepared-submission-manifest`, `import-manifest`, `unit-receipt`, `batch-receipt-snapshot`, `lifecycle-event`, `operation-audit-event`, `conversion-report`) remain unchanged.
3. **Transaction Handle**: Driver-agnostic `CanonicalTransactionHandle` opened by `transaction()` with `run<T>(operation: () => Promise<T>)` (`packages/comments/src/command-store.ts:151-154`) is preserved.
4. **Router Factory Signature**: `CanonicalRouterFactory` entrypoint is preserved without change.
5. **Error Vocabulary**: Two exact frozen sets are preserved — command errors `cas-conflict`, `idempotency-conflict`, `denied`, `invalid-command`, `not-found` (`packages/comments/src/commands.ts: CanonicalCommandError`) and wire errors `unauthenticated`, `denied`, `not-found`, `conflict`, `invalid-request`, `capacity-exceeded`, `incomplete` (`packages/comments/src/command-store.ts: CANONICAL_WIRE_ERROR_CODES`). Transport failures use the transport boundary, never an undeclared `CanonicalWireError` code (§9.6, §15).
6. **No Contract-v2**: No mandatory lifecycle `contract-v2` is required or introduced; operational service policies live outside the raw persistence layer.

---

## 3. Storage Module Boundaries

The division of responsibilities between `@sentropic/comments` and `@sentropic/cluster-mesh` is defined as follows:

| Dimension | `@sentropic/comments` (Contract Authority) | `@sentropic/cluster-mesh` (Storage Port & Module) |
|---|---|---|
| **Identity & Scope** | Canonical entities, anchors, quantizer, revision hashing | Multi-tenant isolation, workspace bindings, `StorageScope` |
| **Persistence Core** | 24-method command store interface | Generic storage SPI, SQLite & Postgres kernel drivers |
| **Transactions** | Logical transaction boundary declaration | ACID atomicity, commit-time CAS, authority fencing and root publication |
| **Visibility & Barriers** | Lifecycle events (`tombstone`, `purge-intent`, `purge-outcome`) | Immediate read barriers (`visibility-barriers-v1`), default package journal; optional qualified app outbox binding |
| **Large Units** | Unit manifest & payload DTOs | Staged units protocol (`staged-units-v1`), atomic root publication |
| **Queries** | Domain query signatures | Registered projection assets, index queries (`by-resource`, etc.) |
| **API Exposure** | Neutral HTTP port declarations | Module runtime composition, canonical Hono routes (`M2-W`) |

---

## 4. Extension & Capability Declarations

### 4.1 Storage Profiles (K1 / K2a Alignment)
As defined in `packages/cluster-mesh/src/storage/profiles.ts`, comments declares distinct profile claims per operational stage:
- **`m1-adapter`**: `atomic-units-v1`, `immutable-chains-v1`, `immutable-boundaries-v1`
- **`comments-operational`**: `m1-adapter` + `scope-outbox-v1`, `visibility-barriers-v1`
- **`comments-c4`**: `comments-operational` + `staged-units-v1`
- **`comments-purge`**: `comments-operational` + `purge-jobs-v1`, `fenced-writers-v1`

### 4.2 Transport and Continuation Protocol (`transport-v1`, qualification `unverified`)
- **Staged Units**: Large units (threads exceeding 512 KiB or 1 MiB) are split into hash-chained sub-units. Staged sub-units remain invisible to all readers until an atomic linearization root publication point.
- **Explicit Continuation**: Paged export and resync use an explicit continuation envelope. Transport continuation fields must **not** be smuggled into or overload frozen M1 DTO fields (`snapshotBoundary`, `exportId`, `idempotencyKey`).
- **Transport Limits** (adopted CA values, frozen L3a v4.1 §11.3): fragment manifest or unit/group root 64 KiB canonical bytes; fragment payload 512 KiB canonical bytes; prepare/commit items per request 50; request batch manifest 256 KiB canonical bytes; complete encoded request 1 MiB; default page count 50; maximum page count 100; complete encoded page 1 MiB; time-based comments cursor TTL none.
- **Byte Units & Record Framing** (§11.3): Fragment/root/payload/manifest limits count canonical bytes; request/page limits count the complete encoded envelopes. Whole histories have no fragment-sized ceiling. A record plus required framing must fit an individual fragment.
- **Paging Semantics** (§11.3): Ordinary pages count canonical records; fragment pages count complete fragment envelopes. Both count the full response envelope and cursor toward byte limits.
- **Proposed Host-Injected Bounds** (§11.3): Existing M1 body/segment/profile bounds remain host-injected; CA proposed values are 64 KiB, 16 KiB, and 16 KiB respectively.
- **Transport Qualification Requirement** (§11.3): Transport qualification must include escaping and multibyte encoding.
- **Module Admission Settings** (§11.3): 64 segments/body, 64 mentions/body, profile depth 8, 32 targets/annotation, 128 shapes/annotation. These declarations add no fields to frozen M1.
- **Incompatibility Rule**: A smaller deployment limit must be advertised as incompatibility with this profile, not silently redefine it.
- **Module Extension Operations** (§11.2, proposed — not additions to `CanonicalCommandStore`): `prepareImportFragment`, `inspectPreparedImport`, `commitPreparedImport`, `prepareExportBoundary`, `continueExport`, `readExportFragments`, `recoverBatchReceipts`.

### 4.3 Named Query Profiles (L3a §9.5)
Three named projection queries are registered for module access:
1. `by-resource`: Discussions and annotations filtered by complete resource tuple (`tenantId`, `workspaceId`, `namespace`, `kind`, `id`).
2. `scope-chain-index`: Bounded enumeration of typed chain keys and current heads.
3. `retained-headers`: Identity, revision link, and review/audit inspection without loading full payload bytes.

These queries return module query DTOs and do not substitute for frozen full-record DTOs.

### 4.4 Capacity Descriptor Policy
The frozen `CapacityDescriptor` in `@sentropic/comments` is not mutated. Supplemental module paging settings (`defaultRecords = 50`, `cursorTtlSeconds = null`) are declared as module configuration outside the canonical record.

### 4.5 Packaging and Conformance Oracle (qualification `unverified`)
- The test conformance runner and vectors are consumed as a digest-pinned packaged oracle artifact for installed qualification.
- `@sentropic/comments/conformance` is not an existing export (frozen L3a v4.1 §9.6); its export location and executable packaging are `unverified` (§17.4). Any new comments-package export follows its change protocol separately.
- Installed consumer proofs (`M4-I`) import the packaged oracle rather than local file checkouts, verifying isolation and dependency closure without modifying frozen M1 exports (`mutatesFrozenM1Exports: false`).

---

## 5. Frozen specification cross-references

The [tracked source extract](../evidence/storage-alignment.md) pins the governing document's digest. These requirements trace directly to frozen L3a v4.1 §17.2 row C0 and the sections below; they are not G-numbered items in §17.4.

- **§9.3 / §16.2**: Barrier-covered or disposed full getters throw `CanonicalCommandError('denied')`; `readChainPage` yields `inaccessible`, before and after disposal.
- **§9.4 / §16.2 M2-W**: Canonical HTTP routes use operational services; router tests reject raw lifecycle bypass and forged tombstone/`purge-outcome` effects.
- **§17.2 C0**: Exit proof requires the compatibility manifest and unchanged M1 source hashes.
- **§17.2 C1a**: K4/P2u visibility roots are active from C1a on the comments/Postgres root.
- **§16.2 C4**: `comments-import.spec.ts` proves imported tombstone and immediate barrier publication in the same unit.
