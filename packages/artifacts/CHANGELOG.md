# Changelog

## 0.2.19

- Route `artifacts_fetch_app_source`, `artifacts_git_attach` and `artifacts_git_publish`
  through `createHttpArtifactApp` and the MCP executor (G0 v3 §1.3; A-LIVE v2 S03).
  `createGitToolService` composes the injected binding store, registry, code-rights,
  GitPort and build executor ports; a missing port is a closed 503 refusal.
- `assertArtifactsTransportProfile` admits the three tools. Existing catalogue
  entries are byte-identical; `artifacts_list_app_sources` stays unrouted.
- `git_attach` checks the current code right on every path before any registry or
  forge call, and admits every executor through the host build port at attach.
- Additive migration `0012_git_attach_intents.sql`: a durable attach intent written
  before `createBranch` keeps a crash retry deterministic, and the attach event of a
  created branch carries `branchCreated: true` (A-LIVE v2 §5.3.1).
- The served authoring guide describes the git-backed path and the current caps.

## 0.2.18

- Export the canonical MIME helpers through `server/mime` and the generic
  reader-consent service, typed refusal, navigation and neutral screen through
  `server/consent-grant`; the app retains its existing grant behavior.
- Add scope-bound Git bindings, a closed host repository registry, durable
  Postgres lifecycle and replay records, and immutable release-index readers.
  Git metadata is projected only with the caller's current repository code right.
- Add the GitHub GitPort with injected cluster-mesh installation leases,
  SHA-pinned reads, bounded source pagination and atomic multi-file commits.
  Commits retain server-resolved human authorship and an App committer.
- Export build descriptor and locked dependency validation through
  `@sentropic/artifacts/server/build-contract`. Validation executes no build
  or lifecycle script; executor and live activation keep their separate gates.
- Integrate SG0-app, SG1, GB1 and SG2 on one release train after 0.2.17.
  Existing MCP definitions and the APP-P1 four-tool selection are unchanged.
  SQLite Git-binding parity and real forge qualification remain separate lots.

## 0.2.17

- Application assets carry the worker's own same-origin/no-eval CSP; HTML inline hashes stay confined to HTML responses.
- Application content mode (host-configured, owner decision 05/11): the
  generic host offers `safe` (historic strict regime, default, bit-for-bit
  unchanged) and `application` (binding J1.0 policy: same-origin workers,
  runtime-injected styles, history fallback to `index.html` for
  extensionless HTML navigations). Service workers stay refused in both
  modes; a missing asset stays 404, never the fallback. The policy lives in
  one constant so the conductor can relay adjustments.
- Generic extension to MIME map: `.geojson` → `application/json`,
  `.mjs` → `text/javascript`, `.woff2` → `font/woff2`; `.wasm` →
  `application/wasm` and `.pbf` → `application/x-protobuf` stay mapped as
  the owner asked. No `wasm-unsafe-eval` in any served policy.
- Generic grant contract (J1.3b): first-party grant route wired to
  `grantWithFreshRights`, neutral host-parameterizable consent screen,
  typed 403 `{ code, scopeId, retryable: false }` with a single prescribed
  screen navigation, scopes and versions host-declared.
- No MCP tool definition changes (the 17 pre-existing definitions stay
  byte-identical). Stays in `0.2.x` (cluster-mesh peer `>=0.2.0 <0.3.0`).

## 0.2.16

- Upload channel integrity, fail-closed (immo preprod, OVH S3 403): the
  presigned PUT no longer announces `x-amz-checksum-sha256`. The digest is
  declared at commit, so the checksum header could never be signed at
  `create_upload` time, and strict S3 implementations refuse presigned PUTs
  carrying an unsigned `x-amz-*` header (`AccessDenied`, headers present but
  not signed). `create_upload` now returns exactly the signed header set
  (`content-type` + exact `content-length`) in `requiredHeaders`, with no
  `checksumHeader` field; the client (agent SDK/CI and the browser upload
  page) sends exactly those headers and nothing else. Signing the checksum
  instead would have required the digest at create time, i.e. a change to the
  frozen `artifacts_create_upload` input schema; it also depends on S3
  checksum support that the repo's minio double does not guarantee, while a
  plain PUT works on OVH and minio alike (immo verified the headerless PUT
  returns 200 on preprod).
- `commit_upload` no longer trusts the declared digest alone: it re-reads the
  staged bytes and re-verifies size, SHA-256 and MIME server-side, and any
  mismatch now refuses with a typed `UploadVerificationError` (mapped to
  `verification_failed` at the HTTP layer with the same public reasons),
  deletes the staged object, closes the session, and pins nothing — a
  poisoned upload can never be retried into a release. The CAS read-back
  mismatch path deletes the suspect blob too.
- No MCP tool definition changes (the 17 pre-existing definitions stay
  byte-identical); only the `create_upload` response shape loses the
  `checksumHeader` field. Stays in `0.2.x` (cluster-mesh peer `>=0.2.0
  <0.3.0`).

## 0.2.15

- R1: every model-visible userRef projection emits the opaque `unknown` value
  when the directory entry is missing instead of falling back to the raw
  internal id (`sub`): `projectUserRef`, `list_access` grants and owner,
  the `set_access` receipt, and the `list_versions` v1 author (plus the v2
  `authorPrincipalId`). No MCP tool definition changes.
- R5: `assertShareable` enforces the approved-principal gate on `grant` only;
  `revoke` stays allowed for dormant (suspended or deleted) principals as the
  expected cleanup step. Revoking an absent grant is a no-op success.

## 0.2.14

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
- Artifacts 0.2.14 stays inside the cluster-mesh peer range `>=0.2.0 <0.3.0`;
  the API keeps its pinned APP-P1 profile digest and requalifies the APP-P1
  manifest digest for this version.
- Union fix on the train: the SQLite management unit, store ACL paths and the
  `artifact_access_events` audit table follow the G2 sharing port
  (`SetAccessOutput.accessMode`/`changed`, `recordEvent`, authoritative
  `access_mode` with `is_public` as projection).

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
- Files parity LOT 1: a local agent can publish large dossiers with the bytes
  outside the model. New tools `artifacts_create_upload`,
  `artifacts_commit_upload` and `artifacts_publish_bundle` (static
  definitions, frozen at birth; the 17 pre-existing tool definitions are
  byte-identical, pinned by sha256 in the tests).
- Upload sessions are durable rows (migration `0007_uploads.sql` ALTERs the
  existing `artifacts.uploads` table: artifact/scope/owner binding,
  `expires_at`, `staged_files`) with a presigned signed PUT per session. A
  SigV4 presigned PUT cannot carry a content-length range, so the signature
  binds the EXACT declared Content-Length plus `content-type`, the PUT must
  carry `x-amz-checksum-sha256` (S3 validates the body, BadDigest on
  mismatch), and `commit_upload` re-verifies size, SHA-256 digest and MIME
  server-side before pinning. Open sessions per principal are quota-bounded
  (8) and an enforced sweeper (gc.ts) expires stale sessions and deletes their
  staging objects.
- Server maxima are hard ceilings: 255 files per release, 16 MiB per file,
  64 MiB per release; profile limit keys (`releaseFilesMax`,
  `releaseFileBytesMax`, `releaseTotalBytesMax` on the publish operation) may
  only move below them and default to the inline values. The MIME ceiling
  (17 types) is enforced at profile compile time, and every file — inline or
  uploaded — is validated at commit: magic bytes for binary types, strict
  UTF-8 for text, script/handler/external-reference-free SVG.
- `artifacts_publish_bundle` publishes one atomic release from the union of
  inline files, `{path, uploadId}` assets and `{path, digest, size, mimeType}`
  CAS assets, reusing the 0.2.12 bounded blob pool and `verifyStagedBlobs`;
  one missing or digest-mismatched asset fails the whole publish and commits
  nothing. The strict-profile writer ban does not cover the upload tools (they
  mutate no release pointer). `artifacts_get_source` keeps its frozen
  maxItems 32 ceiling; server-side caps only move below the frozen schema.
- Persistent reader consent (lot 1a): consent rows per (reader account,
  artifact, scope, scope version) with a pure evaluator and Gate B helper;
  the reader screen is skipped only when a live consent at the current scope
  version meets fresh rights, suspension or withdrawn share refuses despite
  consent. One new MCP tool `artifacts_revoke_reader_consent`
  (self-revocation only, static definition frozen at birth; the 17
  pre-existing tool definitions are byte-identical) plus control-origin
  list/revoke API routes; revocation takes effect on the next call. Host
  migration `0008_reader_consent.sql` (additive, train-numbered from the
  reviewed `sql/reader-consent.sql` body); immo screen binding and silent
  renew land in lot 1b.

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
