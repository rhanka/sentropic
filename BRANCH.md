# Feature: T4a storage — CM artifacts DB/S3 placement (CMF-1, S1, S2, S3)

## Objective
Additive preprod-safe CM artifact storage: install package 0009-0013, harden blob bridge, add DB/composite placement 0014, placement-migrate tool. One PR, merge only after T3.

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
  - `packages/artifacts/src/adapters/**`
  - `packages/artifacts/src/adapters/db-blob.ts`
  - `packages/artifacts/src/adapters/composite-blob.ts`
  - `packages/artifacts/src/server/blob-bridge.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/migrations/0014_db_blob_placement.sql`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/package.json`
  - `package-lock.json`
  - `api/package-lock.json`
  - `apps/artifact-content/src/**`
  - `apps/artifact-content/tests/**`
  - `deploy/ci/artifact-content/object-store/artifact-content-db-role.sql`
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
- None yet.

## AI Flaky tests
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
- [ ] **Lot 5 — Final validation**
  - [x] Typecheck impacted (typecheck-artifacts + typecheck-api PASS).
  - [x] Retest API scoped suites (cmf-s2 4/4, cmf-s3 4/4, host-migrations 19/19).
  - [x] Retest package suites scoped (blob-bridge 8/8, composite-blob 8/8).
  - [x] Patch bump @sentropic/artifacts 0.2.26 -> 0.2.27 + lock sync (this lane ships a PR, so CI enforce-package-bump applies; stays in the 0.2.x cluster-mesh pin; no other lock churn).
  - [ ] Final gate step 1: open PR with BRANCH.md body, CI green, do NOT merge (T3 gate).
  - [ ] Final gate step 2: French report .tmp/rv/t4a-storage.md.
  - [ ] make down-volumes ENV=test-t4a-storage.
