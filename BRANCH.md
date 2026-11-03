# Feature: cm-a4-gaps lot G2 — P2 F12 boundary resolution over CM stores

## Objective
Build lot G2 of design a4-cm-gaps-r2 (P2, A4 item 3 / F12): a new CM boundary port and domain factory (`createTenantBoundaryPortV1`, `createIdentityBoundaryDomainV1`) resolving tenant boundaries over the CM tenancy stores, plus the `boundary_resolution` row of the new 1.2.0 composition-descriptor bundle. The frozen 1.0 surface (`createBoundaryDomain`, `ValidatedMembershipPort`) is retained untouched; the app seam deletion is lot G6, not this branch.

## Scope / Guardrails
- Scope limited to the packages/cluster-mesh contract/test files listed below plus the package version bump.
- Make-only workflow, no direct Docker commands; the single Docker lock `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md` is taken PER COMMAND via `flock`.
- Branch development in worktree `tmp/worktrees/a4-gap-G2`, branch `feat/cm-a4-gaps-g2-boundary` from `origin/main` (A2.0b merged as 812d1f053, cluster-mesh 0.26.0-dev.6).
- Automated tests on `ENV=test-a4-G2` only, `ENV` always LAST; `make down ENV=test-a4-G2` after.
- All new text in English. No secrets read, printed, logged or committed. No `[skip ci]`. Commits via `make commit MSG="..."` only, <=150 lines, selective staging. `make scope-check` before every commit.
- Design pins: `.tmp/cm-identity-agents/a4-cm-gaps-r2.md` sha256 `283cab237a4a2630c9a545e312399469af307adcca0b95feec7cdbf016e2058b` (§3.1–§3.4 shared rules, §5 P2, §10.0 stacking, §10.3 G2 row); owner answers 2026-10-30 sha256 `e2fd123857d6ad3dab088bbc6f9cf6748fcd8fde3a79fb98541ab7f95b9fe185` (Q-K=A, Q-WS1, Q-IDP1 — referenced only, no G2 dependency). Base: `origin/main` 88078a995; published npm `@sentropic/cluster-mesh` 0.25.0.
- Version: 0.26.0-dev.7 (next dev after main's 0.26.0-dev.6; strictly greater than published 0.25.0).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/identity-contracts/boundary-resolution.ts`
  - `packages/cluster-mesh/src/identity-contracts/composition-descriptors.ts`
  - `packages/cluster-mesh/src/identity-contracts/index.ts` (additive export lines only)
  - `packages/cluster-mesh/tests/boundary-resolution.spec.ts`
  - `packages/cluster-mesh/package.json` (version bump)
  - `package-lock.json` (BR-G2-EX1: one-line workspace version sync via `make lock-root`)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` + `package-lock.json` (BR-G2-EX2: 4-line dev-version pin sync, repo bump precedent 45e961c8e / 4ed0b4009)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `deploy/**`
  - `.github/**`
  - `packages/cluster-mesh/src/**` except the three allowed `identity-contracts` files (frozen 1.0 and A2.0b bundles untouched)
  - `packages/cluster-mesh/tests/**` except `tests/boundary-resolution.spec.ts` and the two BR-G2-EX2 fixture files (frozen suites stay unmodified)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [x] BR-G2-EX1: synchronize only the `packages/cluster-mesh` workspace version line in the root lockfile after the dev bump (`make lock-root`). Reason: CI gate "train package versions match the root lockfile". Impact: version metadata only. Rollback: revert `package-lock.json` together with the version bump. Note: `make lock-root` also rewrote the pre-existing `packages/mcp-platform` drift (workspace 0.4.1 vs lockfile 0.4.0 inherited from main); those two hunks were reverted to keep this diff inside the declared exception.
- [x] BR-G2-EX2: sync the `0.26.0-dev.6` → `0.26.0-dev.7` pin in `tests/packaging/fixtures/selected/package.json` (1 line) and `package-lock.json` (3 lines). Reason: `validate-cluster-mesh (source installed major)` / `(lazy stateful install)` fail on `prepare-artifacts.spec.ts` "frozen fixture must pin a stable release tarball" when the workspace dev version diverges from the fixture pin; repo bump precedent 45e961c8e and 4ed0b4009 sync exactly these 4 lines. Impact: fixture metadata only, no test logic. Rollback: revert the two fixture files together with the version bump.
- [x] PostgreSQL first run of the new spec showed 3 tests timing out at the 5000ms default under heavy shared-host load (sibling G-lot lanes holding the Docker lock); no assertion failed. Same head + same command rerun: 16/16 passed. Recorded as a proven transient; no timeout increase, no assertion change.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** — single CM lot, one PR.
- Rationale: one bounded path list per design §10.3; no sub-workstreams.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, design §3/§5/§10, owner answers, COMMON-RULES.
  - [x] Worktree `tmp/worktrees/a4-gap-G2` on `feat/cm-a4-gaps-g2-boundary` from `origin/main`; this `BRANCH.md` written.
  - [x] Confirm command style: `make ... ENV=test-a4-G2` last; `flock` per Docker command.
- [ ] **Lot 1 — Tests first: `tests/boundary-resolution.spec.ts` per design §5.4**
  - [x] Port resolves the exact record for `member` and `admin` roles; every miss returns `null`.
  - [x] Domain throws `TenantBoundaryError` on every miss; frozen-path equivalence field-by-field; store errors propagate; domain userId re-check; empty tenantId/tid refusal.
  - [x] One shared scenario over in-memory doubles, SQLite and PostgreSQL stores; descriptor row assertions.
- [ ] **Lot 2 — Implementation**
  - [x] `src/identity-contracts/boundary-resolution.ts` (port + domain factories).
  - [ ] `src/identity-contracts/composition-descriptors.ts` (1.2.0 bundle, `boundary_resolution` row).
  - [x] `src/identity-contracts/index.ts` additive export lines.
- [ ] **Lot 3 — Gates**
  - [x] `flock <lock> make typecheck-cluster-mesh build-cluster-mesh pack-cluster-mesh ENV=test-a4-G2` — all EXIT=0.
  - [x] `flock <lock> make test-cluster-mesh SCOPE=tests/boundary-resolution.spec.ts ENV=test-a4-G2` — 12 passed, 4 skipped (PostgreSQL describe, no CM_PG_URL), no type errors.
  - [x] Same spec with `CM_PG_URL` via `cluster-mesh-pg-up`/`cluster-mesh-pg-down` — first run 3x 5000ms timeouts under a loaded shared host (no assertion failure), rerun 16/16 passed; recorded as load-induced transient, no timeout or assertion change.
  - [x] Frozen suites unmodified and green: `tests/boundaries.spec.ts` 6/6, `tests/conformance/h2a-contract.spec.ts` 10/10, `tests/identity-resolution.spec.ts` 10/10.
  - [x] `make scope-check` PASS before each commit; commits <=150 lines via `make commit`; version bump 0.26.0-dev.7 + `make lock-root`; pushed after every few commits (crash safety).
  - [x] Rebased onto `origin/main` 4fb18ef88 with `git rebase -X theirs` (merge-tree showed BRANCH.md as the sole conflict); 5 commits replayed, cluster-mesh sources untouched by the rebase; post-rebase gate: 0.26.0-dev.7 > published 0.25.0.
  - [ ] `make down ENV=test-a4-G2` at the end
- [ ] **Lot 4 — PR & CI**
  - [ ] Push final head, open a READY PR (`gh pr create`, body from this `BRANCH.md`), run one CI, record head/result in `.tmp/rv/a4-gap-G2.md`. Do not merge.
