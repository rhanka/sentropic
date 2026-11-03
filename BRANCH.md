# feat(cm-a4-gaps-g5): P6 replica sync, CM half (identity_replica_sync contract bundle 1.2.0)

## Objective
Build lot G5 of the binding design `.tmp/cm-identity-agents/a4-cm-gaps-r2.md` (sha256 283cab237a4a2630c9a545e312399469af307adcca0b95feec7cdbf016e2058b), §10.6 with §9.1/§9.3/§9.4/§9.5/§9.6: the CM replica-sync contract (`createIdentityReplicaSyncV1`, `createIdentityReplicaExporterV1`) over the A2.0b custody bundle, host-generic per §3.5, both profiles per §3.3, plus the `identity_replica_sync` composition-descriptor row and the two new error codes.

## Validation evidence and acceptance boundary
- [ ] Tests written first: `packages/cluster-mesh/tests/identity/replica-sync.spec.ts` covering every §9.5 CM bullet (round trip, replay no-op, convergence, email collision, credential rules, consent rules, retired fence, non-propagation, digest tampering, missing profile, foreign-host fixture per §3.5) on `describe.each(['sqlite','postgres'])` plus cross-profile export→sync.
- [ ] `make typecheck-cluster-mesh` and `make build-cluster-mesh` clean with ENV=test-a4-G5.
- [ ] New spec green on SQLite: `flock .tmp/packets/DOCKER-LOCK.md make test-cluster-mesh SCOPE=tests/identity/replica-sync.spec.ts ENV=test-a4-G5`, then `make down ENV=test-a4-G5`.
- [ ] Same spec green under the PostgreSQL vitest config: `flock .tmp/packets/DOCKER-LOCK.md make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-test SCOPE=tests/identity/replica-sync.spec.ts ENV=test-a4-G5`, then `make down ENV=test-a4-G5` and `cluster-mesh-pg-down`.
- [ ] Frozen identity suites unmodified and green (full `cluster-mesh-identity-test` campaign if time allows; at minimum the scoped spec on both profiles plus typecheck).
- [ ] `make scope-check` before every commit; commits via `make commit MSG="..."` only, each under 150 lines; branch pushed to origin after each few commits (crash safety).
- [ ] Package bump per repo rule: `packages/cluster-mesh/package.json` 0.26.0-dev.6 → 0.26.0-dev.7 (> published 0.25.0).
- [ ] READY PR opened from `feat/cm-a4-gaps-g5-replica-sync`, one CI run observed and recorded in `.tmp/rv/a4-gap-G5.md`. Do not merge.

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh` identity contracts/storage/tests + package version, per design §10.6.
- Base: `origin/main` (A2.0b merged at 812d1f053, cluster-mesh 0.26.0-dev.6). Design §10.0 stacking: CM lots branch from origin/main now that PR #882 has merged; G1 (P4 finders) has not landed, so consent reads use the journal `findConsentCore` primitive and the lot adds `listConsentsForUserCore` to both journals (§3.3 sanctions adding a missing primitive to both profiles in the same lot). No copy of G1's finder is landed.
- Make-only workflow, one Docker build at a time under the flock in `.tmp/packets/DOCKER-LOCK.md` (taken PER COMMAND), no direct docker/npm on host.
- Branch development in isolated worktree `tmp/worktrees/a4-gap-G5`.
- Automated test campaigns on dedicated environment `ENV=test-a4-G5` (last argument), never root dev; `make down ENV=test-a4-G5` after each stack.
- All new text in English. No secrets. No `[skip ci]`. No human-effort/time estimates.
- Owner answers binding (owner-answers-20261030.md): Q-K=A, Q-WS1=delete with workspace, Q-IDP1=case-by-case deletion, no transfer tool — none change the G5 CM contract (G5 builds in simulation mode per §12).
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/identity-contracts/replica-sync.ts` (new)
  - `packages/cluster-mesh/src/identity-contracts/composition-descriptors.ts` (new, `identity_replica_sync` row only)
  - `packages/cluster-mesh/src/identity-contracts/custody-errors.ts` (two codes: `identity_sync_conflict`, `identity_sync_invalid`)
  - `packages/cluster-mesh/src/identity-contracts/index.ts` (additive export line)
  - `packages/cluster-mesh/src/storage/identity/replica-sync.ts` (new)
  - `packages/cluster-mesh/src/storage/identity/custody-journal-postgres.ts` (`listConsentsForUserCore` only)
  - `packages/cluster-mesh/src/storage/identity/custody-journal-sqlite.ts` (`listConsentsForUserCore` only)
  - `packages/cluster-mesh/src/storage/identity/index.ts` (additive export line)
  - `packages/cluster-mesh/tests/identity/replica-sync.spec.ts` (new)
  - `packages/cluster-mesh/package.json` (version bump)
  - `package-lock.json` (root lockfile version parity for the `packages/cluster-mesh/package.json` bump; refreshed via `make lock-root`, enforced by the CI `changes` job)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (packaging-fixture pin sync for the version bump; see BR-G5-EX2)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (same fixture sync)
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
  - every other path outside Allowed Paths
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR-G5-EX1 (scope addition, not a conditional-path exception): root `package-lock.json` added to Allowed Paths. Reason: the CI `changes` job requires `packages/cluster-mesh/package.json` and the root lockfile to carry the same version ("refresh the root lockfile through Make"); the 0.26.0-dev.7 bump is incomplete without it. Impact: one-line lockfile diff (`packages/cluster-mesh` workspace version field only), refreshed via `flock .tmp/packets/DOCKER-LOCK.md make lock-root ENV=test-a4-G5`. Rollback: revert the lockfile line together with the package.json bump.
- BR-G5-EX2 (scope addition): `packages/cluster-mesh/tests/packaging/fixtures/selected/package.{json,lock.json}` added to Allowed Paths. Reason: the version bump to 0.26.0-dev.7 makes the fixture pin stale; `tests/packaging/prepare-artifacts.spec.ts` (run by the `validate-cluster-mesh` CI lanes) requires the selected fixture to pin the exact candidate tarball, and the lazy packaging lane runs `npm ci` against that lock. Impact: four-line fixture diff (dev.6 → dev.7), same shape as G4's BR-G4-EX2 and main's 5f438ea30. Rollback: revert the fixture lines together with the package.json bump. `api/package-lock.json` is intentionally untouched (G4 precedent; no CI gate reads it). Also retained the BRLOCK-EX1 `review_by` line in this BRANCH.md (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).
- G1 (P4 `oauthTenantStoreV1` finders) is not on origin/main; this lot deliberately does not land a copy of the finder (design §10.4 stack-absorption rule). Consent reads go through the custody journal primitives; the stack absorbs G1 on rebase.
- Q-IDP1 disposition (case-by-case preprod-only account deletion) is an ops/G7 concern; G5 builds and tests in simulation mode per design §12.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`, with at least one success on the same commit and same command; never amend tests with additive timeouts. Record command + failing test file + signature here if any.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single CM lot on one branch; one final test cycle)
- Rationale: one bounded lot, no sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, COMMON-RULES.md, design a4-cm-gaps-r2.md §3/§9/§10.0/§10.6, owner-answers-20261030.md.
  - [x] Create isolated worktree `tmp/worktrees/a4-gap-G5` from `origin/main`, branch `feat/cm-a4-gaps-g5-replica-sync`, write this `BRANCH.md`.
  - [x] Capture Makefile targets: `typecheck-cluster-mesh`, `build-cluster-mesh`, `test-cluster-mesh SCOPE=...`, `cluster-mesh-pg-test`/`cluster-mesh-identity-test` via `packages/cluster-mesh/tests/storage/postgres.mk`, `scope-check`, `commit`, `down`.
  - [x] Environment mapping: `ENV=test-a4-G5` last argument; Docker flock `.tmp/packets/DOCKER-LOCK.md` per command.
- [ ] **Lot 1 — Tests first**
  - [ ] Write `tests/identity/replica-sync.spec.ts` (both profiles + cross-profile + foreign-host fixture).
  - [ ] Lot gate: spec compiles (typecheck) and fails against missing implementation only for the right reason.
- [ ] **Lot 2 — Contract**
  - [ ] `src/identity-contracts/replica-sync.ts` (records, ports, factory signatures per §9.1).
  - [ ] `composition-descriptors.ts` with `IDENTITY_COMPOSITION_CONTRACT_VERSION = '1.2.0'` and the `identity_replica_sync` row.
  - [ ] `custody-errors.ts`: add `identity_sync_conflict`, `identity_sync_invalid` fixed messages.
  - [ ] `index.ts` additive export.
  - [ ] Lot gate: typecheck clean.
- [ ] **Lot 3 — Storage implementation**
  - [ ] `listConsentsForUserCore` on both journals.
  - [ ] `src/storage/identity/replica-sync.ts`: validate/syncBatch/syncBatchInTransaction + exporter, host-generic via `identityTransactionHost(tx)`.
  - [ ] `storage/identity/index.ts` additive export.
  - [ ] Lot gate: new spec green on SQLite, then PostgreSQL config; typecheck + build clean.
- [ ] **Lot 4 — Version bump, commits, push, PR, CI**
  - [ ] Bump `packages/cluster-mesh/package.json` to 0.26.0-dev.7.
  - [ ] Atomic `make commit` commits (<150 lines each), `make scope-check` before each, push to origin after each few commits.
  - [ ] Open READY PR, observe one CI run, record result in `.tmp/rv/a4-gap-G5.md`. Do not merge.
