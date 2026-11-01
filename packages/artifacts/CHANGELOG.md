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
## 0.2.6

- Add `artifacts_list_versions`: release history of one artifact — per release
  the id, created at, author principal, state, whether it is current, and a
  content digest. Read scope, like `artifacts_get`.
- Add `artifacts_revert`: make an earlier release current again by creating a
  NEW release that copies the earlier content, so the artifact URL stays
  stable and history only grows. A purged target release is refused with a
  typed `gone` error. Write scope, idempotent per principal like publish.
- Add optimistic concurrency to `artifacts_publish` and `artifacts_revert`:
  optional `expectedCurrentReleaseId`; on mismatch the call returns a typed
  `conflict` error (HTTP 409) carrying the current release id and content
  digest so the caller can re-read and merge. Without the field, behaviour is
  unchanged.
- Add display metadata `title`, `description` and `icon` (one short word) on
  `artifacts_ensure` and `artifacts_publish`; returned by `artifacts_get` and
  `artifacts_list`. Persisted in the new `artifacts.artifacts.metadata`
  JSONB column (migration 0004).
- `artifacts_publish` accepts optional `edits: [{path, oldStr, newStr}]`
  applied to the current release's text files; `oldStr` must occur exactly
  once per file, otherwise a typed `edit_mismatch` error (HTTP 422) is
  returned and nothing changes. `files` becomes optional when `edits` is
  given; the edited files become the new release through the same commit path.
- `artifacts_get_source` now returns the current release's file contents
  (text files decoded) for editing; covered by new tests.
