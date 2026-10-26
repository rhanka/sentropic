# Feature: W1.d artifact host jobs and recovery composition

## Objective
- [x] Compose bounded private-artifact maintenance and closed-serving recovery through unchanged #861 ports.

## Scope / Guardrails
- [x] Owner dispatch W1.d, plan-v2 read in full; tests first, draft PR, green CI, no merge or deployment.
- [x] Branch `feat/app-cm-w1d`, worktree `tmp/worktrees/app-w1d`, base W1.b `8fca05df3`; merge only, never rebase.
- [x] Consume artifacts 0.2.1 unchanged; no package, migration, manifest or lock authoring.
- [x] Make-only; Docker build/start/test under `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; down after every step.
- [x] `ENV=test-app-w1d` last; API/UI/Maildev UI 8795/5181/1088; no owner environments.
- [x] Atomic authored commits under 150 lines, selective staging, scope-check then `make commit`; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/lifecycle.ts`
  - `api/tests/api/artifacts-host-recovery.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/**`
  - `.track/**`
  - `api/src/db/**`
  - `api/drizzle/**`
  - `**/package*.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/src/services/artifacts/composition.ts`
- [x] Exception process: declare BR01-EXn with rationale, impact and rollback before expansion.

## Feedback Loop
- [x] BR01-EX1: `/tmp/app-w1d-recovery-race-red.log` proves a concurrent W1.b publication returns 201 but loses bytes to GC. Wire preparation refs to unchanged upstream `createPostgresClaimGuardedRefs` in `composition.ts`; impact limited to pin/reference exclusion with maintenance; rollback reverts this wiring and keeps jobs disabled. No package algorithm change.
- [ ] W1.c-dependent post-restore activation invalidation is drafted against UP-T PR #782 import path `@sentropic/artifacts/adapters/postgres-activation`, `PostgresActivationStore.cleanup/invalidate`; finalize host wiring and real adapter recovery proof when artifacts 0.2.3 publishes and W1.c lands. No copied PG algorithm or runtime import of an unpublished module.
- [ ] W3/W5 must fence all writers/readers, retire pre-restore grant signing authority and reconcile current denials before reopening; W1.d supplies composition only.
- [ ] W3 storage wiring must supply `createPrivateArtifactStorage` with bucket-scoped GetPublicAccessBlock permission and a qualified private S3 endpoint; unsupported privacy checks refuse, with no runtime fallback.
- [x] PR base `feat/app-cm-integration` is outside this inherited workflow's PR triggers; use CI workflow_dispatch on the pushed exact head with bootstrap publication disabled.

## AI Flaky tests
- [x] No AI tests, accepted flakes or increased timeouts.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one author; independent review before handoff, merge-only integration.

## UAT Management (in orchestration context)
- [x] Backend-only; web, Chrome and VSCode journeys remain W3/W4/W5; no root UAT stack.

## Plan / Todo (lot-based)
- [x] Lot 0: read lock, plan, MASTER/workflow/testing/API rules, README/TODO/template; create worktree and mechanically check branch.
- [x] Lot 1: `api/tests/api/artifacts-host-recovery.test.ts` first; red run on missing lifecycle composition, `/tmp/app-w1d-red.log`.
- [x] Lot 2: `lifecycle.ts` private S3 and bounded preparation cleanup/collection; PG references, pins, failure retries and maintenance denial tested in the recovery file.
  - [x] Initial seven recovery cases pass, `/tmp/app-w1d-green-2.log`; fixtures use upstream `sha256:` digest codec.
- [x] Lot 3: recovery fence orders activation invalidation and grant-key retirement before reopening; failure remains closed; expiry independent of cleanup, using upstream grant verifier.
  - [x] Recovery/race tests first: 7 passed, 6 expected failures (missing recovery port and published bytes erased), `/tmp/app-w1d-recovery-race-red.log`.
  - [x] All 16 recovery cases pass; API typecheck passes; lint has 0 errors/219 warnings, `/tmp/app-w1d-recovery-green.log`.
- [x] Lot 4: 48/48 recovery/publication/migration tests, API typecheck/lint, healthy HTTP 200 runtime logs, down, empty Compose ps and PASS C2; `/tmp/app-w1d-final.log`.
- [ ] Lot 5: draft PR against `feat/app-cm-integration`, exact BRANCH.md body, independent review, push and exact-head green CI; report W1.c remainder; do not merge.
