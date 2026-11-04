# Feature: Files parity LOT 1 — signed-PUT uploads + publish_bundle in @sentropic/artifacts (LotAi dossier)

## Objective
Ship LOT 1 of the files-parity design (design-r1.md §B/§D, review files-design-large4_r1.md CHANGES applied): a MIME ceiling with magic-byte/UTF-8/SVG validation, profile release-budget keys with server maxima (255 files / 16 MiB per file / 64 MiB per release), durable upload sessions with presigned signed PUT (exact Content-Length + checksum header bound, size/digest re-verified at commit), `artifacts_create_upload`/`artifacts_commit_upload` wired end to end, and a new `artifacts_publish_bundle` tool (inline files + uploadId assets + CAS) reusing the #907 bounded pool and `verifyStagedBlobs`. Pre-existing MCP tool definitions stay byte-identical (pinned hash `6589d593…04b2c` for the 17 names); the new tool is frozen at birth.

## Scope / Guardrails
- Scope limited to `packages/artifacts` (src, migrations, tests, README, CHANGELOG, package.json), the mechanical lockfile sync (`package-lock.json`, `api/package-lock.json`), the APP-P1 pin sites (`api/src/services/mcp/cluster-registry.ts` + the two api registry tests), the 0007 migration asset pin (`api/src/services/artifacts/host-storage.ts`), the L5 P1 manifest (`tools/memory-mcp-l5/artifacts/**`, BR01-EX5-style) and the cluster-mesh selected packaging fixture re-pin (BR01-EX3-style).
- MCP tool definitions of the 17 pre-existing tools stay byte-identical; only `ARTIFACTS_PROVIDER_VERSION` moves to 0.2.13 and one new tool definition is appended. The tools/list snapshot JSON is regenerated (delete + re-run) in the same change; the acceptance test pins the pre-existing hash.
- Review corrections (binding): 0007 ALTERs the existing `artifacts.uploads` (0001:60-70); gc.ts gains an enforced staging sweeper over an `expires_at` column with a test; the presigned PUT binds an exact Content-Length (declared size) plus the checksum header in the SigV4 signature (no content-length range exists in presigned PUTs) and commit re-verifies size and digest; the strict-profile ban drops BOTH `artifacts_create_upload` and `artifacts_commit_upload` (neither mutates a release pointer); the frozen `artifacts_get_source` `maxItems: 32` is NOT changed — server-side caps only move below the frozen schema, larger listings stay with the new tools (documented).
- Make-only workflow; one Docker lock per make command (`flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make ...`), never nested; tests on `ENV=test-files-lot1` only, ENV always last; `make down-volumes ENV=test-files-lot1` at the end. No `[skip ci]` anywhere. This lot has MAX priority on the Docker lock (owner).
- Branch development happens in worktree `tmp/worktrees/files-parity-lot1` (branch `feat/artifacts-files-parity-lot1` from `origin/fix/artifacts-publish-bounded-concurrency`, PR #907 / 0.2.12). PR base is main; the conductor rebases after #907 merges.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/**` (src, migrations, tests, snapshots, README, CHANGELOG, package.json, docs)
  - `package-lock.json` and `api/package-lock.json` — mechanical lockfile sync of the 0.2.13 version bump only (version-string-only diffs, same pattern as ddbe7b65e); explicit allowed wins over the `api/**` forbidden glob
  - `Makefile` — locked-tools `@aws-sdk/s3-request-presigner` dep sync on the artifacts lanes only (`build-artifacts`, `typecheck-artifacts`, `test-artifacts-integration` lines); explicit allowed wins over the `Makefile` forbidden glob, version-string-only pattern
  - `scripts/ci/tool-locks.json` — two appended tool-lock entries for the presigner key sets above (generated through the lane Node image, same pinned versions); append-only, no existing entry touched
  - `packages/cluster-mesh/tests/storage/cold-workspace.sh` — one-line presigner addition to the workspace tool install (same pinned version) plus its shallow tool-lock entry; without it every cluster-mesh/api lane typecheck of `packages/artifacts` fails, so `origin/main` would break at merge; explicit allowed wins over unknown
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/src/services/artifacts/host-storage.ts` (0007 migration asset pin only)
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/src/**` except the two files above
  - every other packages/cluster-mesh path stays out of scope (classified unknown); only the BR01-EX3-style files are conditional below
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `tools/memory-mcp-l5/artifacts/**` (L5 P1 manifest regen, BR01-EX5 precedent)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (fixture re-pin)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (fixture re-pin)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (fixture integrity re-pin)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- L5 P1 manifest (`tools/memory-mcp-l5/artifacts/**`): after `make lock-root` carries 0.2.13, regenerate through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (never hand-editing digests); previous manifest+sidecar retained in `artifacts/history/`. Precedent: #907 c5d219f8f.
- Cluster-mesh packaging fixture re-pin: `fixtures/selected/package.json` + `package-lock.json` re-pinned to the workspace candidate version through the packaging make flow (`make pack-candidate-siblings` + `refresh-lazy-package-lock`), hardcoded archive integrity updated in `artifacts-tuple.spec.ts`. Precedent: #907 c5d219f8f / bfbdd78df.
- APP-P1 manifest digest recomputed through make (build-artifacts + computeManifestDigest over the RADAR manifest) and re-pinned in `cluster-registry.ts` + the two api registry tests. Precedent: #907 386313531.
- `api/src/services/artifacts/host-storage.ts`: register `migrations/0007_uploads.sql` with its sha256 in `artifactMigrationAssets` so the host journal applies it (0001 already creates `artifacts.uploads`; 0007 ALTERs it per the review).

## AI Flaky tests
- Acceptance rule: no AI-flaky tests are involved; all tests here are deterministic (memory doubles, fixed digests).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- Rationale: one cohesive lot inside one package plus mechanical pin/lock/manifest sync; no parallel sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface change; package-level vitest lanes only (`make test-artifacts`, scoped api registry tests) on `ENV=test-files-lot1`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, design-r1.md, BRIEF.md decisions, review files-design-large4_r1.md.
  - [x] Worktree `tmp/worktrees/files-parity-lot1` on `feat/artifacts-files-parity-lot1` from `origin/fix/artifacts-publish-bounded-concurrency`; `harness check branch` PASS C1.
  - [x] Capture pre-existing tools/list definitions hash: sha256 `6589d5930620ea12e5b185a8b72e2657e08a2c32e9b5943a7d0e4e89aa304b2c` (17 names, canonical sorted JSON of the checked-in snapshot).
  - [x] Confirm command style: `flock .tmp/packets/DOCKER-LOCK.md make ... ENV=test-files-lot1` (ENV last, one flock per command).
  - [x] Version allocation: 0.2.13 (0.2.12 = #907 base); post-bump gate `npm view @sentropic/artifacts version` < 0.2.13.

- [ ] **Lot 1 — MIME ceiling, validation, limits**
  - [x] `server/mime.ts`: `SERVER_MIME_CEILING` (17 types), magic-byte table (png/jpeg/gif/webp/avif/pdf/woff/woff2/ttf/otf/mp4/webm/ico), `validateFileBytes(mimeType, bytes)` — magic check, strict UTF-8 for text types, SVG script/handler/external-ref refusal.
  - [x] `server/publication-limits.ts`: `SERVER_MAX_FILES_PER_RELEASE=255`, `SERVER_MAX_FILE_BYTES=16 MiB`, `SERVER_MAX_TOTAL_BYTES=64 MiB`, `SERVER_MAX_UPLOAD_SESSIONS_PER_PRINCIPAL=8`; `DEFAULT_PUBLICATION_LIMITS` = 255/16 MiB/64 MiB; `publicationLimits` clamps/validates against the server maxima.
  - [x] Profile: release-budget keys `releaseFilesMax`/`releaseFileBytesMax`/`releaseTotalBytesMax` (optional, default to inline values, ceiling-checked at compile); `rules.mimeTypes` ⊆ ceiling check; get_source frozen-32 documentation comment.
  - [x] `content/headers.ts`: `sandbox` CSP on SVG + PDF; HTML CSP gains `font-src 'self'`, `media-src 'self'`.
  - [x] Lot gate: `make typecheck-artifacts` + `make lint-artifacts` green (ENV=test-files-lot1; required 2 continuation fixes: http.ts bundle-manifest cast, command.identity.commandHash).

- [ ] **Lot 2 — Migration 0007 + durable sessions + sweeper**
  - [x] `migrations/0007_uploads.sql`: ALTER `artifacts.uploads` ADD `artifact_id`, `storage_scope_id`, `owner_id`, `expires_at` (+ state CHECK extended with 'expired', precedent 0002); backfill pre-existing rows to discarded; CREATE `artifacts.staged_files`; index on (state, expires_at).
  - [x] `server/uploads.ts` rewrite: `UploadSessionStore` port + memory double, session service (create with per-principal open-session quota 8, get, commit, expire), `UploadSignerPort` (signs content-type + exact content-length + x-amz-checksum-sha256), staging key helpers (`artifacts/<scope>/staging/<uploadId>`), TTLs (URL ≤ 600 s, session 24 h).
  - [x] `server/gc.ts`: `createUploadSweeper` — expires stale sessions (state open + expires_at < now): delete staging keys, mark expired; test included.
  - [x] `adapters/s3-uploads.ts`: staging key pattern guard + S3 signer via `@aws-sdk/s3-request-presigner` (new optional peer/dev dep) + staging store ops.
  - [ ] Lot gate: unit tests green (1 fixed: wrong-size PUT probe used a same-length body; 3 remaining: snapshot regen + 2 acceptance failures under diagnosis).

- [x] **Lot 3 — Wiring: profile, command identity, mcp-core, http** (continuation fixes: bundle-manifest cast, command.identity.commandHash; typecheck green)
  - [x] `profile/contracts.ts`: append `artifacts_publish_bundle` to `ARTIFACT_CAPABILITY_NAMES`.
  - [x] `profile/index.ts`: strict-profile ban drops create_upload AND commit_upload; ceiling checks; routes `/uploads/create`, `/uploads/commit`, `/publish_bundle`; idempotency for publish_bundle; compile-time MIME subset.
  - [x] `profile/schemas.ts` + `validation.ts`: publish_bundle schema (files inline + assets uploadId/CAS forms + required expectedCurrentReleaseId), create_upload maxSize clamp, normalization (union duplicate paths, ≥1 entry, inline budget on files).
  - [x] `server/command-identity.ts`: operations += `commit_upload`, `publish_bundle` (frozen L0 types operation as string — safe).
  - [x] `mcp-core.ts`: static frozen definition for `artifacts_publish_bundle` (appended, static description), IDEMPOTENT_WRITERS += publish_bundle, mutability append, executor cases for the three tools; version 0.2.13.
  - [x] `http.ts`: transport allowlist += 3; handlers — create_upload (owner-only, MIME ∈ profile, maxSize ≤ min(releaseFileBytesMax, server ceiling), quota, presigned PUT output), commit_upload (session bound to artifact+owner+scope, read staged once, verify size+digest, MIME validation, promote to CAS blob via bounded pool + verifyStagedBlobs, pin `upload:<uploadId>`, staged_files row, delete staging, idempotency via command identity), publish_bundle (union release budget, re-verify every referenced digest, coordinator finalize like publish, receipt + files[] with origin).
  - [x] Lot gate: typecheck + targeted tests.

- [x] **Lot 4 — Docs + snapshot + acceptance tests** (`make test-artifacts` 553/553 green)
  - [x] `templates.ts` guide: « import an existing page » section (ensure → create_upload → signed PUT → commit_upload → publish_bundle).
  - [x] `README.md`: limits text corrected (255/16 MiB/64 MiB defaults + server maxima, inline vs release budgets, presigned PUT flow, get_source frozen 32 ceiling note).
  - [x] Regenerated `tests/snapshots/tools-list-catalogue.json` (delete + re-run, +201/-0 lines); acceptance test pins pre-existing hash `6589d593…04b2c`.
  - [x] New `tests/files-parity-lot1.test.ts`: 41 files / 9.7 MB via signed PUTs only (zero file bytes in any MCP payload), screenshots served on single-label host, wrong size/digest refused at commit, bundle with one missing asset commits nothing, sweeper expires stale sessions, strict profile compiles with upload tools selected, oversized PUT refused by signed content-length. Continuation fixes: v2-envelope unwrap helper (strict), digest-compare instead of 250 KiB toEqual (10 s → 169 ms).
  - [x] Rewrote `tests/uploads.test.ts` for the new session service; updated `http-uploads-templates.test.ts` route list; updated `transport-world.ts` fixture with memory upload ports.
  - [x] Lot gate: `make test-artifacts ENV=test-files-lot1` green (52 files / 553 tests).

- [x] **Lot 5 — Version 0.2.13, locks, pins, manifests** (APP-P1 digest cross-checked: 0.2.12 recomputed exactly; pack deterministic across rebuilds)
  - [x] `packages/artifacts/package.json` 0.2.13, `mcp-core.ts` version, CHANGELOG entry.
  - [x] `make lock-root` + api lock mirror (version + presigner peer/devDeps); cluster-mesh fixture re-pinned to the local 0.2.13 pack (integrity `sha512-bhPrb…CQ==`, deterministic); `make memory-l5-pack STAGE=pre-candidate ...` → manifest `c6bfabb3…` with 0.2.12 `1c740385` retained in `history/`.
  - [x] APP-P1 pin recompute + re-pin `cluster-registry.ts` + two api tests; 0007 asset sha256 in `host-storage.ts`.
  - [x] `make scope-check` PASS C2 (before/during/after the commit sequence); scoped api tests green in-lane (`app-mcp-registry` 25 tests + `app-mcp-installed` 2 tests, stack on `MAILDEV_UI_PORT=1180` — the other lane holds :1080).

- [x] **Lot 6 — Verify, push, PR, report** (PR #910 READY, CI run 41777185872, no merge)
  - [x] `make test-artifacts ENV=test-files-lot1` full green (553/553); `make test-artifacts-integration ENV=test-files-lot1` (migration proof incl. 0007); `make down-volumes ENV=test-files-lot1`.
  - [x] Commits ≤150 lines via `make commit` (19 commits); pushed; READY PR #910 opened (base main) with BRANCH.md body; one CI.
  - [x] Report to `.tmp/rv/files-parity-lot1.md` with the exact immo call sequence. Do not merge.

## Feedback Loop items
- Makefile dep sync: the three artifacts lanes install `@aws-sdk/s3-request-presigner` next to `@aws-sdk/client-s3` via `locked-tools.mjs` (new optional peer/dev dep of `@sentropic/artifacts` 0.2.13, used only by `adapters/s3-uploads.ts`). Rollback: drop the presigner from those three lines and from `package.json` deps. No behavior change to any other lane.
