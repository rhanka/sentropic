# Feature: T4a storage — CM artifacts DB/S3 placement (CMF-1, S1, S2, S3)

## Objective
Additive preprod-safe CM artifact storage: install package 0009-0013, harden blob bridge, add DB/composite placement 0014, placement-migrate tool. T3 remains isolated on its qualified immutable digest; this PR does not perform a cutover.

## Deployment isolation and operational prerequisites
- T3 pins API/IdP image `sha256:405a2759af42d54e1bf24d60032bb3ca9ff5d5375def353d9fbb5fd5da0de1ce`, built from `4625a94bc5d971a361efbe9639ce59cf242c1a13` (successful CI run 42942234207). That commit's `host-storage.ts` only installs 0001-0008; it does not install 0009-0014. The package can contain SQL assets without running them.
- Main deploys through `ci.yml:deploy-preprod` and `make k8s-deploy-preprod`, using a namespace-scoped credential and the `preprod-a4` overlay (`sentropic-preprod`). It cannot deploy into production `sentropic` or alter T3's immutable image.
- API startup installs 0009-0014 transactionally under the existing advisory lock, with content hashes and prefix receipts. DDL is additive/idempotent; 0014 defaults existing blob placement to `object`. Default placement stays `s3`; this PR neither sets cutover flags nor migrates existing bytes.
- Builder VM and build-pool removal changes no storage contract: DB/S3 placement and verified blob reads/writes are independent of the execution backend. V8 owns future builds; no builder deployment or provisioning is part of this PR.
- CMF-1o owner prerequisite: provision the RustFS `artifacts` write principal in the Secret Store, without exposing credentials. k8s prerequisites: measure the corpus, resize PostgreSQL PVC beyond 1 Gi and RustFS beyond 5 Gi in place as required, verify namespace quotas and storage-class expansion, and qualify an off-PVC object backup/restore with `s5cmd`. The former four-builder-pod quota belongs to the retired builder plan and is not a storage prerequisite.
- No cluster or production action is authorized in this lane. No merge is performed; operational cutovers and owner gates remain separate.

## Scope / Guardrails
- Scope limited to CM artifact storage, additive only, flag-gated, preprod-safe.
- One migration max in `api/drizzle/*.sql` (none here; package migrations only).
- Make-only workflow, no direct docker/npm.
- Root workspace reserved for dev/UAT, branch in isolated worktree.
- Test campaigns on ENV=test-t4a-storage only, ENV last.
- UAT identical HEAD rule respected.
- English only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/**`
  - `api/tests/api/artifacts-*.ts`
  - `api/tests/api/cmf-s2-blob-placement.test.ts`
  - `api/tests/api/cmf-s3-placement-migrate.test.ts`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/tests/api/mcp-workspaces-list-dispatch.test.ts`
  - `api/src/scripts/cm-placement-migrate.ts`
  - `api/src/index.ts`
  - `packages/artifacts/src/adapters/**`
  - `packages/artifacts/src/adapters/db-blob.ts`
  - `packages/artifacts/src/adapters/composite-blob.ts`
  - `packages/artifacts/src/server/blob-bridge.ts`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/server/gc.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/migrations/0014_db_blob_placement.sql`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/package.json`
  - `packages/artifacts/CHANGELOG.md`
  - `package-lock.json`
  - `api/package-lock.json`
  - `apps/artifact-content/src/**`
  - `apps/artifact-content/tests/**`
  - `deploy/ci/artifact-content/object-store/artifact-content-db-role.sql`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/src/storage/artifact-blob.ts`
  - `packages/cluster-mesh/src/storage/index.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `package-lock.json`
  - `api/package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID BRxx-EXn in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- BRT4a-R3 (package release follow-through): aligning the provider version changes the APP-P1 manifest digest. Reproduced locally: 23 registry tests refused the old 0.2.27 pin. Recompute the 0.2.28 manifest with the unchanged `mcp:tools:invoke` projection, update the API pin and installed/dispatch fixtures, retain historical digest assertions, and qualify registry tests before pushing.
- BRT4a-R3 verification: registry 25/25, physical installed/bundled registry 2/2, workspace dispatch 14/14 PASS. APP-P1 digest computed from built 0.2.28: `b7d6d576986acc1256b6b23c988f70d5496eb9e93b7cb697cc37649b8bea5262`.
- BRT4a-R2 (CI 43546569187, resolved in source): the packed consumer compared provider version 0.2.27 with package 0.2.28. Align `ARTIFACTS_PROVIDER_VERSION` to 0.2.28, rebuild the archive and regenerate its selected-fixture integrity. Verification: the existing packed-consumer probe, unchanged.
- BRT4a-R2 verification: `make probe-artifacts-packed-consumer` PASS (packed example, core, consumer and adapters); guarded archive sha256 `047e744b9d4593e2f49293df87eb610b8d01b2667a4361ee5e92534171c4b831`.
- BRT4a-R1 (rebase integration, resolved): main added a private builder cache using UUID manifest keys under `builder-cache/`, while the placement composite only accepts artifact digest keys. Keep `productPrivateCacheBlobs` on the existing private object store; artifact DB/S3 placement remains scoped to artifact blobs. Evidence: `cache-storage.ts` writes a UUID manifest and `createPostgresBlobPlacements` refuses that key.
- BRT4a-EX3 (2026-11-13 rebase): preserve main cluster-mesh dev.26 and current dependencies; release storage as artifacts 0.2.28 and cluster-mesh dev.27, above registry pins. Regenerate selected archive integrity from the guarded package archive through make; synchronize workspace locks. Impact: packaging metadata only. Rollback: revert this metadata commit. Builder VM/pool removal does not change the DB/S3 storage contract; builder execution belongs to V8.
- BRT4a-EX2 (CI gate fix, scope exception for 4 version-bump files): `enforce-package-bump` failed after the `origin/main` rebase (T5a merged cluster-mesh `0.26.0-dev.24`, equal to the branch version while the branch carries cluster-mesh src changes from `474cd8db1`) — dev.24 → dev.25 bump + root/api lock sync + fixture tgz rename + CHANGELOG entry, mirroring `d35d00f93`. Impact: version strings only, no behavior. Rollback: revert the bump commit; the gate returns to the same single failure.
- BRT4a-EX1 (CI fix, scope exception for 3 packaging files outside Allowed Paths): `validate-cluster-mesh (source|lazy)` failed on `prepare-artifacts.spec.ts` — the selected fixture pinned `@sentropic/artifacts` 0.2.26 while the branch bumped the candidate to 0.2.27 (package-bump gate). Reason: PR CI must be green before the T3-gated merge; the fixture follow-up is the smallest blocking fix, no behavior change. Impact: `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` + `fixtures/selected/package{,-lock}.json` only; integrity `sha512-a/6mzB+...8cA==` computed from the branch-HEAD pack (`make pack-publishable-manifest PACKAGE=artifacts`, PASS, sha256 8d77d2...). Rollback: revert the fix commit; CI returns to the same single-test failure.

## AI Flaky tests
- Recorded (run 42989330672, head `6cccbce64`): `test-e2e (5)` → `e2e/tests/00-ai-generation.spec.ts` « devrait générer des cas d'usage… » — Timeout 60 s sur POST `/api/v1/initiatives/generate` après erreur fournisseur « Impossible de créer un brouillon de dossier » ; 37 passed / 1 failed / 1 skipped dans le shard. Signature = non-déterminisme fournisseur/réseau (fichier allowlisté). Re-run non tenté (pas de re-run CI sans commit : COMMON-RULES) ; le train re-qualifiera sur la branche train. Sign-off owner requis au merge (gate T3 de toute façon).
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Four storage wagons in one additive PR, single train, no independent CI per wagon.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UAT on sub-branches; no UI changes in this train.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/t4a-storage`.
  - Push branch before UAT.
  - Switch back to worktree after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 8 — Astra FIX R2**
  - [x] Reproduce and fix partial deletion errors and maintenance enumeration across placement modes (composite-blob.test.ts).
  - [ ] Qualify image rollback, real transactional GC, host paging, migration contention and process crash recovery.
  - [x] Reproduce GC lock timeout inside BEGIN and pass the owning transaction through deletion.
  - [x] Freeze a627f54e5 migration runner; reproduce its startup failure with 0009-0014 receipts.
  - [x] Replace the claimed mid-batch test with an actual SIGKILL after durable verified copies, before the switch; resume without a cursor (cmf-s3-placement-migrate.test.ts).
  - [x] Reproduce unbounded host S3 requests and S3-only maintenance enumeration; delegate keyset pages through both wrappers and collect both configured stores.
  - [x] Qualify offline data-preserving image rollback/resume and bounded migration DDL under contention (artifacts-host-migrations.test.ts).
  - [ ] Push verified head, await CI, append FIX R2 report and remove isolated volumes.
- [ ] **Lot 7 — Rebase and qualify exact head (2026-11-13)**
  - [x] Rebase on origin/main; preserve prior uncommitted metadata in a stash.
  - [x] Verify T3 candidate 4625a94b installs only 0001-0008; preprod deployment is namespace-scoped.
  - [x] Verify published versions (artifacts 0.2.27, cluster-mesh latest 0.25.0), guarded 0.2.28 archive tuple, 36 package tests, 39 API tests and scope gate.
  - [x] Regenerate and validate P1 through make memory-l5-pack (2 artifacts, 44 contracts); local receipt .tmp/cm-t4a-p1.json, sha256 b1a7324c6e9eda944d8f89a8ee1ee202f156fe16c88084bd020e6eef28ddc238.
  - [ ] Push PR branch, update PR isolation evidence, await exact-head green CI; do not merge.
  - [ ] Write French report and completion marker; remove isolated test volumes.
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules/MASTER.md, workflow.md, testing.md, COMMON-RULES.md.
  - [x] Read spec CM_FIRST_ARTIFACTS.md §2-§7 and §6.2, plan r3, verdict r3 ADOPT WITH AMENDMENTS.
  - [x] Create worktree tmp/worktrees/t4a-storage on feat/t4a-cm-artifact-storage from origin/main 7a352bb4d.
  - [x] Verify branch feat/t4a-cm-artifact-storage.
  - [x] ENV=test-t4a-storage, API_PORT=8947 UI_PORT=5347 MAILDEV_UI_PORT=1247.
  - [x] Validate scope boundaries, no EXn needed.
- [x] **Lot 1 — CMF-1 schema 0009-0013 in CM + grants**
  - [x] Extend artifactMigrationAssets with 0009-0013 sha256 receipts.
  - [x] Extend requiredRelations with upload_pages, git_bindings, live drafts, attach intents, invitations.
  - [x] API tests: extend artifacts-host-migrations.test.ts (fresh DB, idempotent rerun, no row changed).
  - [x] Lot gate: typecheck-api PASS, artifacts-host-migrations 19/19 (scoped, ENV=test-t4a-storage).
- [x] **Lot 2 — CMF-S1 blob bridge ArtifactBlobPort**
  - [x] Harden S3 putBlob create-only If-None-Match + digest verify + read-back verify.
  - [x] Harden local putBlob buffer clone + create-only + bounded listKeys continuation.
  - [x] Bounded listKeys pages with scope-bound integrity-tagged continuation.
  - [x] Tests: identical retry idempotent, different bytes refused, wrong digest fails closed, bounded pages.
  - [x] Lot gate: typecheck-artifacts PASS, blob-bridge 8/8 + composite-blob 8/8 (scoped, ENV=test-t4a-storage).
- [x] **Lot 3 — CMF-S2 migration 0014 + composite placement**
  - [x] Package migration 0014_db_blob_placement.sql (placement, blob_bytes, upload_staging_bytes).
  - [x] Composite db+s3 adapter + advisory digest lock coordination (deferred delete sides).
  - [x] Artifact-content wired composite read + db-role SELECT grants.
  - [x] Tests: contract Postgres/SQLite, db/s3/db+s3 round-trips, refusal unknown mode, existing rows read object.
  - [x] Lot gate: typecheck-api PASS, cmf-s2-blob-placement 4/4 (scoped, ENV=test-t4a-storage).
- [x] **Lot 4 — CMF-S3 placement-migrate tool**
  - [x] placement-migrate both directions, AP-3 counts, per-batch tx switch, resume cursor, never deletes source.
  - [x] Tests: rehearsal copy equal digests, source intact, resume after crash.
  - [x] Lot gate: typecheck-api PASS, cmf-s3-placement-migrate 4/4 (scoped, ENV=test-t4a-storage).
- [x] **Lot 5 — Historical validation before the 2026-11-13 rebase**
  - [x] Typecheck impacted (typecheck-artifacts + typecheck-api PASS).
  - [x] Retest API scoped suites (cmf-s2 4/4, cmf-s3 4/4, host-migrations 19/19).
  - [x] Retest package suites scoped (blob-bridge 8/8, composite-blob 8/8).
  - [x] Patch bump @sentropic/artifacts 0.2.26 -> 0.2.27 + lock sync (this lane ships a PR, so CI enforce-package-bump applies; stays in the 0.2.x cluster-mesh pin; no other lock churn).
  - [x] Final gate step 1 superseded: historical fixture and AI-provider failures were resolved; run 43072344980 was green on dee7dcfb8. Lot 7 qualifies the rebased head. The former T3 merge restriction is lifted by the immutable-image and namespace isolation evidence above.
  - [ ] Final gate step 2: French report .tmp/rv/t4a-storage.md.
  - [ ] make down-volumes ENV=test-t4a-storage.
- [x] **Lot 6 — FIX round 3 (Argon r2 BLOCKER/MAJOR closure, additive only)**
  - [x] MAJOR 5: store-level bounded keyset paging (`listKeysPaged` on memory/db/sqlite/s3/composite + verified delegation, sealed keyset cursors, byte-budget cut with keyset replay); bridge delegates, fallback kept for foreign stores.
  - [x] BLOCKER 2: SQLite blob placement contract tests (upgrade backfill `object`, idempotence, `blob_bytes` CRUD + verify + strict delete + scope prefix, keyset paging walk, writer records `placement`).
  - [x] BLOCKER 3: artifact-content db/db+s3 round-trip reads + lifecycle GC collect over the placement composite (both sides cleaned under the digest lock, referenced retained).
  - [x] MAJOR 6: local-blob concurrent create-only race test; s3 `StartAfter`/`MaxKeys` paging unit test.
  - [x] Typecheck impacted (typecheck-artifacts + typecheck-api PASS, lint-api 0 errors); scoped suites green (bridge 14/14, composite 12/12, s3 3/3, sqlite 7/7, cmf-s2 9/9, cmf-s3 7/7, host-migrations 19/19, artifact-content 170/170).
  - [x] Push rebased branch, CI green, French report, down-volumes, do NOT merge.
  - [x] Bump cluster-mesh dev.24 → dev.25 for enforce-package-bump (BRT4a-EX2); re-run packaging alignment; push; CI green.
