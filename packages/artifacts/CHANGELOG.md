# Changelog

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
