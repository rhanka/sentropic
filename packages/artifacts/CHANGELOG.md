# Changelog

## 0.2.8

- Content hosts use a single UUID label: `https://<id>.<base>/` resolves server-side,
  either an artifact id (serves its current release) or a release id (serves that
  frozen version). `parseContentHost` now returns `{ kind: 'id', id }` for exactly one
  UUID label and nothing else; the former `<id>.pinned.<base>` form, two-label hosts and
  foreign bases do not route.
- Unknown ids return a uniform 404: the artifact and release lookups always both run,
  and "no such artifact" and "no such release" share the same response body and timing
  class, without revealing which kind exists. Digest verification and the deny rules
  (service workers, traversal) are unchanged.
- One wildcard per base at the edge: the `*.pinned.<base>` TLS host and ingress rule are
  removed from the prod and preprod artifact-content overlays. No legacy fallback; immo
  handles 301 redirects for its old hosts on its side.
- Rename decision (recorded): the `pinnedUrl` field is renamed to `versionUrl` in the
  `publicationUrls` hook, the summary, versions and source-read outputs and the result
  schema, now holding `https://<releaseId>.<base>/`. The converged contract allows the
  rename: no consumer outside `packages/artifacts` references `pinnedUrl`/`stableUrl`
  (verified by grep over ui/contracts/e2e/api/cluster-mesh), and every in-package
  consumer is updated atomically in this release.

## 0.2.7

- Fix the `artifacts_get_source` wire payload that broke page editing in claude.ai:
  files are no longer returned as a JSON integer array (`bytes: Array.from(bytes)`).
  Text mime types (the canonical `TEXT_MIME_PATTERN`) come back as `text` with
  `encoding: "utf8"`; every other file — including non-UTF-8 "text" — as `base64`
  with `encoding: "base64"`. Size and digest verification still run on the raw
  bytes before encoding. An 816-byte page now serializes to a few KiB instead of
  blowing the tool-result budget.
- `get_source` (and the conflict `currentSource`) no longer embeds any authoring
  guide; the result carries only a `guideRef` (`{tool: "artifacts_get_api_guide",
  version}`) naming the tool and version to fetch it from.
- Per-call budgets are unchanged: at most 32 files and 262144 decoded bytes; the
  2 MiB serialized MCP result budget still holds for the full snapshot.
- Tool schema (`artifacts_get_source` description, v2 result schema source files),
  the API guide text and the README source section describe the text/base64
  encoding and the guide reference.

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
