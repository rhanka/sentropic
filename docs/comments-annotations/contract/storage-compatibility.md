# Comments Generic Storage Port Compatibility & Extension Manifest (C0)

Date: 2026-10-12  
Specification: L3a v4.1 frozen §17 row C0, §17.4  
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
3. **Transaction Callback**: Zero-argument transaction signature `transaction<T>(fn: () => Promise<T>): Promise<T>` is preserved.
4. **Router Factory Signature**: `CanonicalRouterFactory` entrypoint is preserved without change.
5. **Error Vocabulary**: Closed frozen error set (`invalid-command`, `unauthorized`, `stale-revision`, `conflict`, `not-found`, `denied`, `capacity-exceeded`, `internal-error`) is preserved.
6. **No Contract-v2**: No mandatory lifecycle `contract-v2` is required or introduced; operational service policies live outside the raw persistence layer.

---

## 3. Storage Module Boundaries

The division of responsibilities between `@sentropic/comments` and `@sentropic/cluster-mesh` is defined as follows:

| Dimension | `@sentropic/comments` (Contract Authority) | `@sentropic/cluster-mesh` (Storage Port & Module) |
|---|---|---|
| **Identity & Scope** | Canonical entities, anchors, quantizer, revision hashing | Multi-tenant isolation, workspace bindings, `StorageScope` |
| **Persistence Core** | 24-method command store interface | Generic storage SPI, SQLite & Postgres kernel drivers |
| **Transactions** | Logical transaction boundary declaration | ACID atomicity, commit-time CAS, generation fencing |
| **Visibility & Barriers** | Lifecycle events (`tombstone`, `purge-intent`, `purge-outcome`) | Immediate read barriers (`visibility-barriers-v1`), outbox |
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

### 4.2 Transport and Continuation Protocol (`transport-v1`)
- **Staged Units**: Large units (threads exceeding 512 KiB or 1 MiB) are split into hash-chained sub-units. Staged sub-units remain invisible to all readers until an atomic linearization root publication point.
- **Explicit Continuation**: Paged export and resync use an explicit continuation envelope. Transport continuation fields must **not** be smuggled into or overload frozen M1 DTO fields (`snapshotBoundary`, `exportId`, `idempotencyKey`).

### 4.3 Named Query Profiles (L3a §9.5)
Three named projection queries are registered for module access:
1. `by-resource`: Discussions and annotations filtered by complete resource tuple (`tenantId`, `workspaceId`, `namespace`, `kind`, `id`).
2. `scope-chain-index`: Bounded enumeration of typed chain keys and current heads.
3. `retained-headers`: Identity, revision link, and review/audit inspection without loading full payload bytes.

These queries return module query DTOs and do not substitute for frozen full-record DTOs.

### 4.4 Capacity Descriptor Policy
The 10-field frozen `CapacityDescriptor` in `@sentropic/comments` is not mutated. Additional transport settings (such as `defaultRecords = 50`, `cursorTtlSeconds = null`, and `unitCapacity = 'units'`) are declared as supplemental module configuration outside the canonical record.

### 4.5 Packaging and Conformance Oracle
- The test conformance runner and vectors are packaged as a digest-pinned oracle artifact (`@sentropic/comments/conformance`).
- Installed consumer proofs (`M4-I`) import the packaged oracle rather than local file checkouts, verifying isolation and dependency closure without modifying frozen M1 exports.

---

## 5. Confirmation Deltas (G1–G5 Alignment)

This specification incorporates the findings resolved in `.h2a/l3a/l3a_v4_confirmation.md`:
- **G1**: Getters on barrier-covered or eliminated content throw `CanonicalCommandError('denied')`; `readChainPage` yields `inaccessible`.
- **G2**: Canonical HTTP router routes through operational services; no direct `appendLifecycleEvent` exposure.
- **G3**: C0 exit evidence explicitly requires compatibility manifest and unchanged M1 source hashes.
- **G4**: Visibility root discipline (`staged-units-v1`) is active from C1a on the comments/Postgres root.
- **G5**: Imported tombstone state commits an immediate barrier within the same published unit.
