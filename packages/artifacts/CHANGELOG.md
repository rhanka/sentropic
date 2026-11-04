# Changelog

## 0.2.13

- G2 MCP sharing tools: new read-only tools `artifacts_lookup_people`
  (approved-caller guard, directory search returning opaque `userRef`s with
  masked `emailHint`s, homonyms never silently resolved) and
  `artifacts_list_access` (mode, owner, grant list; readers see only their own
  entry; admin management visibility exception). Both ship with static,
  frozen-at-publication definitions; every pre-existing tool definition keeps
  its exact bytes (CI tools/list snapshot extended to the new tools).
- New `PrincipalDirectoryPort` (search, `userRef` → internal resolution,
  inverse projection). `artifacts_set_access` accepts opaque `userRef`s in
  `principalId` alongside the `sentropic:` sentinels; resolution happens inside
  the commit transaction after visibility and the management right, so the
  `commandHash` (computed on the payload as provided) never leaks a resolution.
- Every model-visible output is projected through the directory: `ownerId` and
  `grants[].principalId` of `artifacts_get`/`artifacts_list`/`artifacts_ensure`,
  the `artifacts_set_access` receipt, and both new tools — no internal
  principal id or full email reaches a model payload. Without a port, the new
  tools answer `capability_unavailable` (sentinels keep working).
- Single `person_not_shareable` 422 error merging the four non-shareable
  causes (unknown, inactive, unapproved, out-of-scope), evaluated at §2.3 step
  4 after visibility and the management right; grant rows gain `createdAt`
  (read from the existing `artifact_access.created_at`, no new migration).
- Shipped radar profile gains the `set_access`, `lookup_people` and
  `list_access` operation profiles (the four-tool radar selection itself is
  unchanged).
## 0.2.12

- Bounded concurrency in multi-file publication blob staging (#art-conc, P1):
  `publishFinalized` no longer issues one `putBlob` per file in a sequential
  loop and `verifyStagedBlobs` no longer issues one `getBlob` per file
  sequentially. Both now run through a shared worker pool with a default of 6
  in-flight operations, configurable via `blobConcurrency` on the publication
  service deps and clamped to at most 8 (`MAX_BLOB_CONCURRENCY`), so no
  unbounded parallelism is possible. On slow S3 hosts (e.g. OVH BHS at
  1.1–1.5 s per request) a 30-file `artifacts_publish` now takes about
  ceil(n/k) round trips instead of n, staying inside the host blob budget
  instead of returning 503 `provider_unavailable`.
- The pool keeps the sequential loop's guarantees: all-or-nothing publication
  (intent, pins, cleanup and finalization paths unchanged), the same
  per-operation error projection (the first fatal error is rethrown unchanged,
  so provider error codes and failure mapping are identical), and one shared
  deadline across the whole batch when `blobDeadlineMs` is configured — no new
  blob operation starts after it, and expiry classifies exactly like a
  provider timeout (503 `provider_unavailable`). MCP tool definitions are
  byte-identical.

## 0.2.10

- G1 sharing access model: artifacts carry an explicit `access_mode`
  (`restricted` by default, `platform`, `public`) managed through
  `artifacts_set_access` with sentinel transitions (`grant sentropic:platform`
  degrades public→platform, `revoke sentropic:platform` on public is a no-op).
  `restricted` mode allows at most one nominative `source` (collab) grant, and
  widening the mode while a `source` grant is live is rejected. Migration
  `0006_sharing.sql` is additive: `access_mode` column with CHECK, legacy
  `is_public=true` backfilled to `platform` (zero artifacts become `public`),
  an append-only `artifact_access_events` audit table (UPDATE/DELETE rejected by
  trigger) and the Q1 schema guards (partial unique index, mode/grant triggers).
- Sharing policy is double-locked: profile rule `allowPublicSharing` (absent ⇒
  false, covered by `profileDigest`) AND a runtime `SharingPolicyPort` resolved
  fail-closed inside the commit transaction; public anonymous reads require the
  policy to allow them. Approval freshness is enforced on read paths (suspension
  cuts the next read, reactivation resumes automatically).
- D1: `set_access` visibility closes the existence oracle — a non-reader actor
  gets `not_found` unless it is an approved platform admin of the same storage
  scope; the management right itself (owner, or admin-reduce-only) is still
  decided inside the transaction (403 otherwise).
- D2: `0006_sharing.sql` deterministically dedupes legacy multi-`source` grants
  before the unique index (oldest `created_at`, tie-break `principal_id` stays
  `source`; later duplicates demote to `read`; no row deleted), and
  `putArtifactAcl` demotes a stale `source` grant to `read` when rewriting a
  non-restricted ACL.
- MCP tool definitions stay byte-identical (new fields only, never edits).
- 0.2.10 stays inside the existing cluster-mesh `>=0.2.0 <0.3.0` peer range
  (conductor allocation: #896=0.2.9, #901=0.2.10, #891=0.2.11; merge order
  896 > 901 > 891).

## 0.2.9

- Make every `artifacts_*` MCP tool definition byte-stable across deployments,
  package versions and profile switches: descriptions, input schemas, output
  schemas, idempotency and gates are compile-time constants in
  `ARTIFACTS_TOOL_DEFINITIONS` (`src/mcp-core.ts`). The active profile still
  selects the exposed tool set and constrains every invocation server-side,
  and stays visible in manifest audit metadata and typed result details — never
  inside a tool definition. Hosts such as claude.ai key per-tool "Always allow"
  permissions on definition bytes, so approvals now survive upgrades and profile
  switches. The APP-P1 manifest pin still covers the definitions, so the pin
  is stable too.
- Add tools/list snapshot tests (`packages/artifacts/tests/tools-list-snapshot.test.ts`,
  `packages/mcp-platform/tests/tools-list-snapshot.test.ts`) that fail on any
  tool-definition change unless the checked-in snapshot is deliberately
  regenerated.

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
