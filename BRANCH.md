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
  - `api/src/scripts/cm-placement-migrate.ts`
  - `packages/artifacts/src/adapters/**`
  - `packages/artifacts/src/server/blob-bridge.ts`
  - `packages/artifacts/src/server/composite-blobs.ts`
  - `packages/artifacts/src/server/placement-migrate.ts`
  - `packages/artifacts/migrations/0014_db_blob_placement.sql`
  - `packages/artifacts/tests/**`
  - `apps/artifact-content/src/**`
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
  - [ ] Lot gate: typecheck-api, scoped test file.
- [ ] **Lot 2 — CMF-S1 blob bridge ArtifactBlobPort**
  - [ ] Harden S3 putBlob create-only If-None-Match + digest verify + read-back verify.
  - [ ] Harden local putBlob buffer clone + create-only + bounded listKeys continuation.
  - [ ] Bounded listKeys CommonBoundedPage both adapters.
  - [ ] Tests: identical retry idempotent, different bytes refused, wrong digest fails closed, bounded pages.
  - [ ] Lot gate: typecheck, scoped package tests.
- [ ] **Lot 3 — CMF-S2 migration 0014 + composite placement**
  - [ ] Package migration 0014_db_blob_placement.sql (placement, blob_bytes, upload_staging_bytes).
  - [ ] Composite db+s3 adapter + advisory digest lock coordination.
  - [ ] Artifact-content wired composite read + db-role SELECT grants.
  - [ ] Tests: contract Postgres/SQLite, db/s3/db+s3 round-trips, refusal unknown mode, existing rows read object.
  - [ ] Lot gate: typecheck, scoped tests.
- [ ] **Lot 4 — CMF-S3 placement-migrate tool**
  - [ ] placement-migrate both directions, AP-3 counts, receipts, resume cursor, never deletes source.
  - [ ] Tests: rehearsal copy equal digests, source intact, resume after crash.
  - [ ] Lot gate: typecheck, scoped tests.
- [ ] **Lot 5 — Final validation**
  - [ ] Typecheck and lint impacted.
  - [ ] Retest API scoped suites.
  - [ ] Retest package suites scoped.
  - [ ] Bumped packages/artifacts version patch (train rule: no bump per OPTIM? verify; wagon lanes do NOT bump — integration lane bumps once).
  - [ ] Final gate step 1: open PR with BRANCH.md body, CI green, do NOT merge (T3 gate).
  - [ ] Final gate step 2: French report .tmp/rv/t4a-storage.md.
  - [ ] make down-volumes ENV=test-t4a-storage.
