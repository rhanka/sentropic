# Frozen storage alignment reference

This bounded extract records the source governing C0 and subsequent comments storage work. It supplies no new implementation, host acknowledgement or review verdict. It supersedes earlier proposals in the specification, plans and historical treatment extracts where they conflict.

Source: `L3a-spec-v4.1-frozen.md`, SHA-256 `c7111c9e7293ee270a0b4dde277f1cfc40fa3c863c3915c6f9ccdd6935c46294`, from the graphify live-git-indexing design. Sections below identify the original text; this extract is not the complete frozen specification.

## Contract and qualification boundaries

- §9.6 preserves M1 fields, signatures, hashes and exports. Supplemental metadata and module admission/transport settings stay outside canonical records. CommonMark qualification and operational bounds remain carried reserves.
- §9.6 and §17.4 say `@sentropic/comments/conformance` is not an existing export. M4-I needs a digest-pinned packaged oracle; distribution scope, export location and executable packaging remain `unverified`. The frozen [M1 manifest](../contract/contract-v1.json) pins the internal conformance corpus and leaves the exact cluster-mesh registration/export path undeclared. The separate [C0 manifest](../contract/storage-module-v1.json) declares oracle-packaging requirements.
- The [M1 receipt](../contract/freeze-receipt.md) records owner closure at source `7b8e5daf022cc58819dfdfae43cd89a703a82f96`, documentary anchor `90e7a9fd89c58178aa889d83dee7b1c3099f08ca`, with both frozen files preserved at closure commit `2dabe25ce`. It does not claim manifest confirmation or host acknowledgement. OWNER-D1 handoff evidence remains separate from M1 closure.
- §11.3 adopts an unverified transport profile: 64 KiB canonical fragment-manifest/root, 512 KiB canonical payload, 50 prepare/commit items, 256 KiB canonical request manifest, 1 MiB complete encoded request/page, default/maximum page counts 50/100, and no time-based cursor TTL. Whole histories have no fragment-sized ceiling; one record plus framing must fit. Ordinary pages count records, fragment pages count complete envelopes; both include the response envelope/cursor. Qualify escaping and multibyte encoding.
- §11.3 keeps host-injected body/segment/profile bounds (proposed 64/16/16 KiB) and the five module admission settings separate from frozen M1.

## Ownership, paths and independent gates

| Frozen reference | Required allocation or gate |
|---|---|
| §17.1 / §17.4 P lots | Cluster-mesh owns the reusable backend at `packages/cluster-mesh/src/storage/postgres/*.ts`, storage tests at `packages/cluster-mesh/tests/storage/postgres-*.spec.ts`, and assets at `packages/cluster-mesh/assets/storage/postgres/`. Hosts inject drivers and migration scheduling. Actual staffing, plan amendments and qualification remain unverified. |
| §17.2 C0 | Exit proof is the compatibility manifest and unchanged M1 source hashes. |
| §17.2 C1a / §16.2 | K3/K4/P1/P2u/M1; the comments/Postgres root uses staged visibility from C1a. Run the unchanged M1 corpus; K2b's getter/page denial case must pass before exit. |
| §9.3 / §16.2 | Covered or disposed full getters throw `CanonicalCommandError('denied')`; `readChainPage` returns `inaccessible`, before and after disposal. Absence remains distinct. |
| §9.4 / §16.2 M2-W | `comments-router.spec.ts` proves operational-service routing and refusal of forged HTTP tombstone/`purge-outcome` submissions without effects. |
| §17.2 C1b / §17.4 | Comments owns query/projection code and PG projection assets `assets/storage/postgres/comments/{001-projections.sql,manifest.json}`. P2b-M/P3 qualify host-history attachment through `postgres-migrations.spec.ts` and `host-history.spec.ts`. |
| §17.2 / §17.5 | Formal M2 entry requires the reviewed common contract and qualified Postgres profiles actually consumed. C3 separately qualifies comments on SQLite; live generations/Q and optional restore witness R do not gate comments/Postgres delivery. |
| §17.2 C4 / §16.2 | Comments owns fragment/root/continuation declarations, import/export and recovery. `comments-import.spec.ts` proves imported tombstone/barrier publication in the same unit. M4-I repeats the installed long-history round trip and C1a/C2/M2-W proofs with staged units active. |
| §14.5 | Comments is an optional peer reached through its selected leaf. Root/storage and disabled imports evaluate neither that peer nor backend drivers. |

## Required plan alignment (§18.2)

Comments owns domain event meaning; the kernel owns journal allocation/replay. The package journal is the default; Sentropic's existing outbox is an optional qualified application binding. Projection assets and host-history attachment use one migration authority.

C4's explicit transport-extension inventory (§11.2) is `prepareImportFragment`, `inspectPreparedImport`, `commitPreparedImport`, `prepareExportBoundary`, `continueExport`, `readExportFragments`, and `recoverBatchReceipts`. These operations do not extend `CanonicalCommandStore` or overload `exportId`, `snapshotBoundary` or idempotency fields. C4a owns `transport-contracts.ts`, `fragment-codec.ts`, `boundary-codec.ts`, vectors and `transport-v1.json`; C4b/C4c and M3-S own the remaining services under §17.4.

Keep registration and canonical Hono API in M2, C4/import/export and remaining services in M3, and SQLite qualification in C3. Preserve separate M5-S conversion/cutover and exact-delivery authority. No mandatory restore witness or backup/restore rehearsal enters the Immo delivery path.
