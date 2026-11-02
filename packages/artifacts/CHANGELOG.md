# Changelog

## 0.3.0

- Add a durable local SQLite adapter set behind the new `./sqlite` subpath export:
  `sqlite.ts`, `sqlite-store.ts`, `sqlite-commit.ts`, `sqlite-management.ts`,
  `sqlite-activation.ts` and `local-blob.ts` implement the same port interfaces as
  the Postgres adapters and the S3 blob store, backed by the builtin `node:sqlite`
  driver (no new dependency) and the local filesystem with sha256 digest
  verification on put, get and strict delete.
- Cover bindings, intents, idempotency, ACL, lifecycle, publication state, refcounts,
  the commit coordinator with the same transactional semantics and release CAS, and
  the activation store. Multi-statement units run in one serialized writer
  transaction (`BEGIN IMMEDIATE`); that isolation is stronger than the Postgres
  READ COMMITTED baseline while the observable port behaviour is unchanged.
- Prove parity with one parameterized conformance suite executed against both the
  Postgres and the SQLite backends, including restart durability, concurrent
  writers, CAS conflicts and the refcount/GC edges.
- The root and portable entries stay free of `node:sqlite` and `better-sqlite3`;
  import the local adapters only through `@sentropic/artifacts/sqlite`.
- Artifacts 0.3.0 widens the cluster-mesh peer range to `>=0.2.0 <0.4.0`
  (cluster-mesh 0.26.0-dev.6); the API keeps its pinned APP-P1 profile digest and
  requalifies the APP-P1 manifest digest for this version.

## 0.2.6

- Integrate part 1 with the source reads, sharing, terminal deletion, masking and
  summaries published in 0.2.5. Apply `0005_metadata.sql` after 0004; it adds
  editorial metadata and nullable release authors/lineage without backfilling history.
- Add version history and revert as a new release on the same stable URL, preserving
  current metadata and ACLs. The v2 profile uses `targetReleaseId` and paginated history.
- Add full-bundle or exactly-once text edits, metadata on ensure/publish, and
  transactional release CAS, metadata, references, quota and receipts.
- Separate trusted `profileRevisionId`, `requireExpectedCurrentReleaseId` and
  `resultEnvelopeVersion`. Compatible bindings keep root results; strict v2 retains
  commit state, replay status and typed failures through mcp-platform 0.4.1.
- Replay historical receipts before enforcing new preconditions or preparing edits.
  Missing strict preconditions use the R2 `precondition_required` message and details.

IMMO activates part 1 only after its qualified input and result switchovers.
Artifacts 0.2.6 stays inside the existing cluster-mesh `>=0.2.0 <0.3.0` range;
the API consumes the workspace package and retains its pinned APP-P1 profile.

## 0.2.5

- D1: Read verified author manifests and file bytes for the current or a selected
  release, with path selection, source authorization, bounded snapshots and
  separate provenance. Reject purged releases and mismatched record digests.
- D2: Grant or revoke named read access and delete artifacts terminally with
  host-approved confirmation, transactional receipts and idempotent replay.
  Mask artifacts outside the caller's visibility as `not_found`.
- D4: Enrich get/list results with binding names, dates, current release IDs,
  digests, stable/pinned URLs, permissions and available optional metadata.

Apply `0004_terminal_controls.sql` after migrations 0001–0003 before enabling
the management capabilities.
