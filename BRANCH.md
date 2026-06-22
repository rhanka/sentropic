# Feature: CI coverage for green-by-absence foundation test suites (BR70-CI1)

## Objective
Close the CI-coverage gap the conductor flagged: the foundation service test directories `api/tests/{artifact-store,object-registry,outbox,services}` (the BR-52 artifact-store, BR-59 object-registry, BR-60 outbox unit/integration tests + service tests) are **green-by-absence** — NO `test-api-unit-integration` matrix suite runs them (the matrix only covers smoke/unit/queue/ai/security/limit/endpoints, and `make test-api-<suite>` → `npm run test:<suite>` which only existed for those). They run only under the bare `npm test` (never invoked in CI). Wire them in so BR-52/59/60 tests actually execute on every api change. NO test code is modified — this only makes the existing tests run.

## Scope / Guardrails
- Additive only: 4 `test:<dir>` npm scripts (mirror `test:unit` = `vitest run tests/<dir>`) + 4 `test-api-unit-integration` matrix entries.
- Reuse the EXISTING `test-api-%` Makefile pattern + `up-api-test-ci` stack — no Makefile change.
- `resource-plane` is intentionally NOT added: it has no `api/tests/resource-plane/` dir (BR-70 tests live elsewhere); the conductor's list was approximate.
- Make-only; all new text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json` (4 additive `test:<dir>` scripts)
  - `.github/workflows/ci.yml` (4 additive matrix entries in `test-api-unit-integration`)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `api/src/**`, `api/tests/**` (do NOT modify the tests — only run them; a real failure is fixed by the owning lane, not by editing the test away)
  - `packages/**`, `deploy/**`
- **Conditional Paths (allowed only with explicit BR70CI1-EXn exception)**:
  - `api/src/index.ts` (BR70CI1-EX1 — gate the outbox dispatcher autostart; the root-cause fix to make BR-60's tests runnable. Additive flag, prod/dev behaviour unchanged; rollback = remove the `if` guard).
  - `docker-compose.test.yml` (BR70CI1-EX2 — set `OUTBOX_DISPATCHER_AUTOSTART=false` in the test api env. Test-stack-only; rollback = remove the env line).
  - `api/src/services/artifact-store/local-fs-artifact-store.ts` (BR70CI1-EX3 — mkdir the meta sidecar's parent dir in `put`; the root-cause fix for the latent BR-52 LocalFs bug. Additive single mkdir; rollback = remove the mkdir line).
  - `api/tests/outbox/outbox-dispatcher-recovery.test.ts` (BR70CI1-EX4 — CORRECT a wrong assertion, NOT a skip: after the EX1/EX2 dispatcher fix, the 1 remaining red was the test expecting a stale row to stay 'pending' after a full sweep. The product is correct — `runDispatchSweep` reclaims THEN dispatches in one pass (recover+deliver, by design, shipped BR-60). The test assumed two separate sweeps. Corrected to assert the reclaim via `result.staleReclaimed>=1` + the real end-state 'dispatched'. The reclaim-vs-fail distinction is still verified (vs the at-ceiling test asserting `result.failed>=1`/'failed').).

## Feedback Loop
- `acknowledge` (BR70-CI1 conductor-GO'd): "wire tests/{artifact-store,object-registry,outbox,services,resource-plane} into a suite + re-validate (BR-52/59/60 unit green-by-absence → run for real)". Done for the 4 dirs that exist; `resource-plane` has no test dir (noted).
- `attention` (FIRST REAL RUN = 3 distinct findings surfaced, #356 run 27929797428): the wiring worked — the suites ran for real and revealed:
  1. **object-registry (BR-59) = GREEN** ✓.
  2. **outbox (BR-60, MINE) = RED → ROOT CAUSE VERIFIED + FIXED** (systematic-debugging): NOT a test-isolation/parallelism bug (vitest runs serial here, maxForks=VITEST_MAX_WORKERS=1). The real cause: the api-test stack boots the REAL `outboxDispatcher` singleton (`index.ts:196`, gated only by `NODE_ENV !== 'test'` — but the test stack runs `NODE_ENV=development` per `docker-compose.dev.yml`, so the gate misses it). That BACKGROUND dispatcher (LISTEN outbox_pending + 10s sweep) runs in the api SERVER process; the vitest tests run in a SEPARATE exec process sharing the same DB, so they cannot stop the singleton. On each test write (→ in-txn NOTIFY), the background dispatcher pre-empts the row before the test's own `runDispatchSweep()` — explaining ALL 5 bidirectional failures (round-trip/producer see 0 dispatched; ceiling/recovery see 'dispatched' instead of 'failed'/'pending'). advisory-lock/ordering pass because they assert order/lock properties indifferent to which dispatcher runs. FIX (root, not symptom): gate the dispatcher autostart behind `OUTBOX_DISPATCHER_AUTOSTART !== 'false'` (`index.ts`) + set `OUTBOX_DISPATCHER_AUTOSTART=false` in `docker-compose.test.yml` api env. Prod/dev unset → unchanged. CI-verified (no test skipped).
  3. **artifact-store (BR-52, MINE) = RED → ROOT CAUSE VERIFIED + FIXED**: NOT a cwd gap — a real latent PRODUCT bug (never executed = green-by-absence). `LocalFsArtifactStore.put` writes the blob under `<root>/blobs/...` (mkdir -p'd) but the meta sidecar under the SEPARATE `<root>/meta/...` subtree WITHOUT mkdir-ing its parent → `writeFile` ENOENTs (`/tmp/.../meta/documents/...json: no such file or directory`) for ANY key (even flat). FIX (root): `fs.mkdir(dirname(metaPath), {recursive:true})` before writing the sidecar in `local-fs-artifact-store.ts`. The 4 failing tests are exactly the put→read-back ones; not-found/checksum-reject/default-bucket passed (no successful write).
  4. **services (NOT mine) = DROPPED from this PR**: `tests/services/` is a cross-lane grab-bag (`catalog/*`, `flow/*` — chat/catalog/flow lanes), 15/326 fail on STALE expectations (`expected 31 tools got 11`, "Lot 7" tool-count). Wiring it surfaced OTHER lanes' green-by-absence debt — out of scope for BR70-CI1 (foundation CI). Removed the `services` matrix entry + `test:services` script; **routed to the conductor** to task the catalog/flow lanes.
- `acknowledge` (39etc concurrency): 39etc owns a separate ci.yml PR (Lot 2 publish paths-filter). This PR touches a DIFFERENT section (test matrix) → low collision risk; coordinate if a conflict surfaces.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism (≥1 success same commit+command); never add timeouts; analyze vs `main`. (These are unit/integration, not AI — failures are real.)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (one additive CI-config change)
- [ ] **Multi-branch**

## UAT Management (in orchestration context)
- No UI. Validation = the PR's CI runs the 4 new suites for real; green = coverage restored. A red suite = a real finding to diagnose (above).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Scoping**
  - [x] Worktree `tmp/ci-coverage` from `origin/main` (9f1797703); `cp ../../.env .env`.
  - [x] Confirmed the gap: matrix suites vs `api/tests/*` dirs; `test-api-%` → `npm run test:<suite>`; only smoke/unit/queue/ai/security/limit/endpoints had scripts.

- [x] **Lot 1 — wire the suites**
  - [x] `api/package.json`: +`test:artifact-store`/`test:object-registry`/`test:outbox`/`test:services` (= `vitest run tests/<dir>`).
  - [x] `.github/workflows/ci.yml`: +4 matrix entries in `test-api-unit-integration`.

- [ ] **Lot N — Final validation**
  - [ ] PR; CI runs the 4 new suites. If green → coverage restored, merge (D2, my infra/CI scope). If red → diagnose (real bug vs stack/migration gap), fix or flag; never skip the test.
  - [ ] On green merge: report conductor (BR70-CI1 done) + remove BRANCH.md.
