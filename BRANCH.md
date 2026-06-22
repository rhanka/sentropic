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
- **Conditional Paths**: none.

## Feedback Loop
- `acknowledge` (BR70-CI1 conductor-GO'd): "wire tests/{artifact-store,object-registry,outbox,services,resource-plane} into a suite + re-validate (BR-52/59/60 unit green-by-absence → run for real)". Done for the 4 dirs that exist; `resource-plane` has no test dir (noted).
- `attention` (FIRST REAL RUN = 3 distinct findings surfaced, #356 run 27929797428): the wiring worked — the suites ran for real and revealed:
  1. **object-registry (BR-59) = GREEN** ✓.
  2. **outbox (BR-60, MINE) = RED**: real test-ISOLATION bug. 5/18 fail with bidirectional pollution (`expected 'failed' got 'dispatched'`, `expected 0 to be ≥1`, stale-reclaim got 'dispatched') — the 6 outbox test files pass in isolation (single-file, BR-60 dev) but interfere when run as one `vitest run tests/outbox` process (shared outbox table / dispatcher, no per-test scoping). FIX (mine): isolate per test (unique aggregate keys + truncate-before, or scoped dispatcher). Do NOT skip.
  3. **artifact-store (BR-52, MINE) = RED**: 4/12 `LocalFsArtifactStore` tests fail in CI (round-trip/delete/path-traversal) while passing locally → a CI filesystem/cwd gap (LocalFs path differs under `/workspace`). FIX (mine): make the LocalFs root deterministic/writable in CI (os.tmpdir/unique).
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
