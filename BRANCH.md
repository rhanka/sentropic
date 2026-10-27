# Feature: W1.c compose the shared PostgreSQL activation store

## Objective
- [ ] Compose the upstream activation adapter with the trusted app pool, opaque scope, at-most-60-second ticket/flow policy and W1.a migration receipt.

## Scope / Guardrails
- [x] Owner dispatch: W1.c of `.tmp/app-switch-week/plan-v2.md`; draft delivery, green CI, no merge or live activation.
- [x] Worktree `tmp/worktrees/app-w1c`, branch `feat/app-cm-w1c`, base W1.a `139729e99`; merge only, never rebase.
- [x] Preserve W1.a's exact `@sentropic/artifacts` 0.2.1 API pin; UP-T owns all package implementation, exports, SQL and conformance vectors.
- [x] No host PostgreSQL activation algorithm, duplicate SQL, app authority proof, route mounting or live activation; W3.a retains current-authority proof.
- [x] Make-only development; lock every build/test/start with `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`, release between steps and run matching down.
- [x] Dedicated `ENV=test-app-w1c` last in every make command; API/UI/Maildev UI ports 8793/5179/1086; check ownership before starting services.
- [x] Tests first; atomic commits below 150 lines via `make commit MSG="..."`; selective staging and scope-check before each commit; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/activation-storage.ts`
  - `api/tests/api/artifacts-host-activation-store.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/src/services/artifacts/host-storage.ts`
  - `api/src/db/run-migrations.ts`
  - `api/drizzle/**`
  - `api/package.json`
  - `api/package-lock.json`
  - `package.json`
  - `package-lock.json`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Exception process: record BR-W1C-EXn, rationale, impact and rollback before any scope expansion.

## Feedback Loop
- [ ] UP-T-1 — blocked; owner: #861 Sol release integrator. The published artifacts 0.2.1 archive lacks the PostgreSQL activation adapter/export, companion browser-flow port, activation SQL asset and imported conformance vectors. Its adapters are only postgres, postgres-commit and s3; its migrations are only 0001_artifacts, 0002_lifecycle and 0003_coordinator. W1.a also records UP-T as open.
- [x] Evidence: registry exact-version metadata and all 117 tarball entries inspected on 26 October 2026; archive retained at root `.tmp/app-switch-week/artifacts-0.2.1-w1c.tgz`, SHA-256 `fb2887d206bcaf7d5e4d85ad14173ffd3cce700e239dabf540150383c7bfe28f`. Package `testing.d.ts` exports publication barriers and purge helpers, with no activation vectors; `content/grants.d.ts` supplies TicketStore and an in-memory double, with no durable browser-flow port.
- [ ] UP-T-1 closure: integrator delivers reviewed, published adapter/flow/export/SQL/vector contracts and immutable asset hash, plus W1.a executor installation receipt. Reconcile the successor package pin through its owning branch; do not patch released 0.2.1 or implement the algorithm in this host.
- [ ] After UP-T-1 closure, freeze actual upstream export names and consume them unchanged; demonstrate exported adapter availability and run imported vectors on the host executor before claiming W1.c ready.
- [x] PR routing: owner requests feat/app-cm-integration; inherited W1.a records main as its CI-trigger-only PR base. Verify the available CI trigger when delivery becomes executable; no merge authorized to either base.

## AI Flaky tests
- [x] No AI tests or accepted flakes in this lot; no timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one author for W1.c; package ownership remains upstream.

## UAT Management (in orchestration context)
- [x] Backend storage composition only; no web, Chrome or VSCode surface change. No root-dev UAT or live activation.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read Docker lock first, full owner plan, MASTER/workflow/testing, template and W1.a; create worktree on the assigned base; `harness check branch` passes.
- [ ] Lot 1 — First add `api/tests/api/artifacts-host-activation-store.test.ts`: trusted pool/opaque scope composition, explicit ticket and flow expiry at most 60 seconds, invalid policy refusal, installed asset hash/receipt refusal, and imported UP-T conformance vectors through the W1.a executor. Run the scoped red tests before service implementation.
- [ ] Lot 2 — Add `api/src/services/artifacts/activation-storage.ts`, consuming only frozen package ports and W1.a receipt; no SQL algorithm, migrations, request authority, cookie or live activation.
- [ ] Lot 3 — Run scoped activation tests and `api/tests/api/artifacts-host-migrations.test.ts` regressions on test-app-w1c, API typecheck/lint; inspect logs and down after each step. No UI/E2E/AI tests apply to this unmounted composition.
- [ ] Lot 4 — Review the exact implementation diff, reconcile findings, scope-check each selective commit, push, create draft PR with this file as body and verify green exact-head CI. Report PR number, head SHA and CI URL; do not merge.
