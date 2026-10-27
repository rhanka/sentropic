# Feature: W1.c compose the shared PostgreSQL activation store

## Objective
- [ ] Compose the upstream activation adapter with the trusted app pool, opaque scope, at-most-60-second ticket/flow policy and W1.a migration receipt.

## Scope / Guardrails
- [x] Owner dispatch: W1.c of `.tmp/app-switch-week/plan-v2.md`; draft delivery, green CI, no merge or live activation.
- [x] Worktree `tmp/worktrees/app-w1c`, branch `feat/app-cm-w1c`; merge W1.d `8729aff22` and W2.b `d0ce8aeb0` as assigned; no rebase.
- [x] Owner supersedes the old pin: consume published `@sentropic/artifacts` 0.2.3; UP-T owns implementation, SQL and conformance vectors.
- [x] No host PostgreSQL activation algorithm, duplicate SQL, app authority proof, route mounting or live activation; W3.a retains current-authority proof.
- [x] Make-only development; lock every build/test/start with `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`, release between steps and run matching down.
- [x] Dedicated `ENV=test-app-w1c` last in every make command; API/UI/Maildev UI ports 8793/5179/1086; check ownership before starting services.
- [x] Tests first; atomic commits below 150 lines via `make commit MSG="..."`; selective staging and scope-check before each commit; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/activation-storage.ts`
  - `api/tests/api/artifacts-host-activation-store.test.ts`
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json`
  - `api/src/services/artifacts/host-storage.ts`
  - `api/tests/api/artifacts-host-migrations.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/src/db/run-migrations.ts`
  - `api/drizzle/**`
  - `package.json`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Exception process: record BR-W1C-EXn, rationale, impact and rollback before any scope expansion.

## Feedback Loop
- [x] BR-W1C-EX1 — owner-authorized dependency bump and required registration: pin 0.2.3 in API/root locks, append upstream activation asset and required relations to W1.a's executor configuration, update migration regression counts. No executor algorithm or SQL changes; rollback is reverting W1.c registration and dependency delta before activation.
- [x] Base-only merges imported W1.d/W2.b unchanged; scope-check reported inherited paths outside W1.c. Authored commits are checked separately after both merges.
- [ ] UP-T-2 — registry 0.2.3 archive has the PG adapter/SQL/hash, but no activation conformance export or vector files among 122 entries. Host tests can run; imported activation vectors require an upstream publication. Do not claim that gate passed.
- [x] UP-T-1 — adapter/flow/SQL/hash availability resolved by published 0.2.3 and the owner-requested API pin; imported activation vectors remain UP-T-2.
- [x] Evidence: registry exact-version metadata and all 117 tarball entries inspected on 26 October 2026; archive retained at root `.tmp/app-switch-week/artifacts-0.2.1-w1c.tgz`, SHA-256 `fb2887d206bcaf7d5e4d85ad14173ffd3cce700e239dabf540150383c7bfe28f`. Package `testing.d.ts` exports publication barriers and purge helpers, with no activation vectors; `content/grants.d.ts` supplies TicketStore and an in-memory double, with no durable browser-flow port.
- [x] UP-T-1 closure: package adapter uses `createPostgresActivationStore`, SQL asset `@sentropic/artifacts/sql/0001_activation.sql`, SHA-256 `13767c826a62aa5f880809ca2ebc60bdc638b2e59f983e195d4351356b282d8b`; host only composes those contracts.
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
- [x] Lot 1 — Host tests first in `api/tests/api/artifacts-host-activation-store.test.ts`: namespace/TTL/receipt, authority delegation, expiry, restore and uncertain commit. Scoped red on missing `activation-storage` import, `/tmp/w1c-red-2.log`, before implementation. Imported vectors remain UP-T-2.
- [ ] Lot 2 — Add `api/src/services/artifacts/activation-storage.ts`, consuming only frozen package ports and W1.a receipt; no SQL algorithm, migrations, request authority, cookie or live activation.
- [ ] Lot 3 — Run scoped activation tests and `api/tests/api/artifacts-host-migrations.test.ts` regressions on test-app-w1c, API typecheck/lint; inspect logs and down after each step. No UI/E2E/AI tests apply to this unmounted composition.
- [ ] Lot 4 — Review the exact implementation diff, reconcile findings, scope-check each selective commit, push, create draft PR with this file as body and verify green exact-head CI. Report PR number, head SHA and CI URL; do not merge.
