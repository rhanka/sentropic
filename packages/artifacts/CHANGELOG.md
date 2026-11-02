# Changelog

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
