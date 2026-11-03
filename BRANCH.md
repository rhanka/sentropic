# feat(cluster-mesh): G4 atomic standalone workspace deletion (P5, composition bundle 1.2.0)

## Objective
Build lot G4 of the A4 cluster-mesh binding design r2 (`.tmp/cm-identity-agents/a4-cm-gaps-r2.md`, sha256 283cab23…): the P5 piece `createAtomicWorkspaceDeletionV1` — a host-generic, all-or-rollback coordinator that deletes one standalone workspace with its CM identity rows and enqueues connector-grant revocations scoped to the workspace, on both SQLite and PostgreSQL.

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh` identity contracts, storage coordinator, tests and the package version manifest.
- No schema asset change; no frozen 1.0 surface edit; one new error code in `custody-errors.ts`; new contract bundle `1.2.0` descriptor file `composition-descriptors.ts` created by this lot.
- Make-only workflow, Docker-first; the single Docker lock `.tmp/packets/DOCKER-LOCK.md` is taken PER COMMAND via `flock`; `ENV=test-a4-G4` always LAST; `make down ENV=test-a4-G4` after every test stack.
- Branch development in isolated worktree `tmp/worktrees/a4-gap-G4` on branch `feat/cm-a4-gaps-g4-workspace-deletion` from `origin/main` (A2.0b merged, PR #882 at 812d1f053).
- Tests on `ENV=test-a4-G4` only, never `ENV=dev`; no `[skip ci]`; no secrets in code or logs.
- All new text in English. Commits via `make commit MSG="..."` only, ≤150 lines each, `make scope-check` before every commit.
- Design pins: a4-cm-gaps-r2.md §3.1–§3.5, §8 (P5), §10.0, §10.5. Owner answers 2026-10-30: Q-WS1 = conversations deleted with the workspace (app-side G6 disposition; CM step 8 deletes `cm_identity_conversation_sessions` rows of the workspace as designed). Q-K/Q-IDP1 do not touch G4.
- Version: bump `packages/cluster-mesh/package.json` once, 0.26.0-dev.6 → 0.26.0-dev.7, after confirming it is greater than the npm-published version (Post-Rebase Gate, rules/workflow.md), with root lockfile + packaging-fixture sync.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/identity-contracts/workspace-deletion.ts`
  - `packages/cluster-mesh/src/identity-contracts/composition-descriptors.ts`
  - `packages/cluster-mesh/src/identity-contracts/custody-errors.ts`
  - `packages/cluster-mesh/src/identity-contracts/index.ts`
  - `packages/cluster-mesh/src/storage/identity/workspace-deletion.ts`
  - `packages/cluster-mesh/src/storage/identity/index.ts`
  - `packages/cluster-mesh/tests/identity/workspace-deletion.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (packaging fixture pin sync for the version bump, enforced by `tests/packaging/prepare-artifacts.spec.ts`)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (same fixture sync)
  - `packages/cluster-mesh/package.json`
  - `package-lock.json` (root lockfile version parity for the `packages/cluster-mesh/package.json` bump; refreshed via `make lock-root`, enforced by the CI `changes` job)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `packages/cluster-mesh/src/identity-contracts/custody.ts`
  - `packages/cluster-mesh/src/identity-contracts/custody-operations.ts`
  - `packages/cluster-mesh/src/identity-contracts/custody-descriptors.ts`
  - `packages/cluster-mesh/src/identity-contracts/descriptors.ts`
  - `packages/cluster-mesh/src/identity-contracts/ports.ts`
  - `packages/cluster-mesh/src/storage/identity/custody-transaction-ports.ts`
  - `packages/cluster-mesh/src/storage/identity/atomic-deletion.ts`
  - `packages/cluster-mesh/src/storage/identity/deletion-planes.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR-G4-EX1 (scope addition, not a conditional-path exception): root `package-lock.json` added to Allowed Paths. Reason: the CI `changes` job requires `packages/cluster-mesh/package.json` and the root lockfile to carry the same version ("refresh the root lockfile through Make"); the 0.26.0-dev.7 bump is incomplete without it. Impact: one-line lockfile diff (`packages/cluster-mesh` version field only), refreshed via `flock .tmp/packets/DOCKER-LOCK.md make lock-root ENV=test-a4-G4`. Rollback: revert the lockfile line together with the package.json bump.
- BR-G4-EX2 (scope addition): `packages/cluster-mesh/tests/packaging/fixtures/selected/package.{json,lock.json}` added to Allowed Paths. Reason: the version bump to 0.26.0-dev.7 makes the fixture pin stale; `tests/packaging/prepare-artifacts.spec.ts` (run by the `validate-cluster-mesh` CI lanes) requires the selected fixture to pin the exact candidate tarball. Impact: three-line fixture diff (dev.6 → dev.7). Rollback: revert the fixture lines together with the package.json bump. Also retained the BRLOCK-EX1 `review_by` line in this BRANCH.md (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single CM lot on its own branch; one PR; one CI run per final head)
- Rationale: G4 is one bounded CM lot branching from origin/main; no sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, design r2 §3/§8/§10, owner answers.
  - [x] Create worktree `tmp/worktrees/a4-gap-G4` on `feat/cm-a4-gaps-g4-workspace-deletion` from `origin/main` (88078a995, A2.0b merged).
  - [x] Write `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm command style: `flock .tmp/packets/DOCKER-LOCK.md make ... ENV=test-a4-G4` (ENV last), `make down ENV=test-a4-G4` after.
  - [x] Validate scope boundaries above.
- [ ] **Lot 1 — Tests first: `tests/identity/workspace-deletion.spec.ts` (§8.4, both profiles + foreign-host fixture)**
  - [ ] Happy path: members of every role, conversation sessions, pending/consumed/revoked workspace-bound invitations, connector rows of two users in the workspace plus rows elsewhere; receipt fields exact; deterministic delivery ids; custody asserted.
  - [ ] Rollback: injected failure in business delete, plane capture, orphan gate — zero mutation, zero outbox rows.
  - [ ] Authorization: non-admin member, non-member, retired actor, absent workspace, absent actor, `assertAllowed` refusal — exact error, zero mutation.
  - [ ] Composition refusals at factory time and absent-plane-with-rows at call time.
  - [ ] Concurrency: member-add race, double-delete race.
  - [ ] Foreign-host test: UOW whose `hostTransaction` is an opaque sentinel (no journal/stores/raw/schema) — operation succeeds on both profiles (§3.5).
  - [ ] Scoped run: `flock .tmp/packets/DOCKER-LOCK.md make test-cluster-mesh SCOPE=tests/identity/workspace-deletion.spec.ts ENV=test-a4-G4` (sqlite), then `cluster-mesh-pg-test` lane (postgres), then `make down ENV=test-a4-G4`.
- [ ] **Lot 2 — Contract: `identity-contracts/workspace-deletion.ts` + `composition-descriptors.ts` + error code + barrel exports**
  - [ ] Types per §8.1; descriptor row domain `atomic_workspace_deletion` version `1.2.0`; `identity_workspace_admin_required` code + fixed message.
  - [ ] Lot gate: `make typecheck-cluster-mesh ENV=test-a4-G4`, `make lint-cluster-mesh ENV=test-a4-G4`.
- [ ] **Lot 3 — Coordinator: `storage/identity/workspace-deletion.ts` + storage barrel export**
  - [ ] Host-generic per §3.5 (`identityTransactionHost(tx)`, never `tx.hostTransaction.journal`); lock order operation → subjects → workspace; steps 1–10 of §8.1.
  - [ ] Lot gate: full scoped spec green on sqlite + postgres; frozen suites unmodified green (`tests/identity/atomic-person-deletion.spec.ts`, `deletion-planes.spec.ts`, `custody-uow.spec.ts`).
- [ ] **Lot 4 — Package gate, version bump, PR**
  - [ ] `make build-cluster-mesh ENV=test-a4-G4`; packaging spec `tests/packaging/identity-auth-types.spec.ts` green.
  - [ ] Bump `packages/cluster-mesh/package.json` to 0.26.0-dev.7 (> npm published version).
  - [ ] Push branch, open READY PR (BRANCH.md as body), run one CI; report security-container libexpat CVE if red (do not fix).
  - [ ] `make down ENV=test-a4-G4` after every test stack; report written to `.tmp/rv/a4-gap-G4.md`. Do not merge.
