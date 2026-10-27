# Feature: feat(artifacts): ship UP-T conformance vectors (0.2.4)

## Objective
- [ ] Deliver UP-T-2: publish importable activation conformance vectors for W1.c and Radar host executors.

## Scope / Guardrails
- [x] Additive testing surface only; activation implementation and SQL bytes stay unchanged.
- [x] Base `origin/main`; branch `feat/artifacts-up-t2`; worktree `tmp/worktrees/artifacts-up-t2`; merge only.
- [x] Make-only Docker tests under the shared lock; `ENV=test-artifacts-upt2` last; no Python.
- [x] No publication or merge; push and open a draft PR to main.
- [x] Ports: API 8799, UI 5185, Maildev 1092; qualification PostgreSQL has no host port.
- [x] Atomic commits below 150 changed lines, selective staging, `make commit`, no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/package.json`
  - `packages/artifacts/README.md`
  - `packages/artifacts/src/adapters/postgres-activation-vectors.ts`
  - `packages/cluster-mesh/packaging.mk`
  - `packages/cluster-mesh/tests/packaging/activation-vectors.spec.ts`
  - `packages/cluster-mesh/tests/packaging/prepare.sh`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `packages/artifacts/sql/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] BR861-EX3 authorized by the owner: package writer ships shared vectors and pack-only 0.2.4; scope includes isolated packed-consumer qualification and CI wiring. Impact: additive export/testing only. Rollback: revert these commits; keep 0.2.3 consumers unchanged.

## Feedback Loop
- [x] UP-T-2 / P1-1 in `pr794_opus_r1.md`: existing 0.2.3 vectors are repository tests absent from the published package; this branch supplies an executable package export.

## AI Flaky tests
- [x] No AI tests or flaky acceptance in this package-only scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; single package writer; independent review before handoff.

## UAT Management (in orchestration context)
- [x] Package consumer qualification replaces browser UAT; host session/ACL and deployment qualification remain consumer obligations.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read Docker lock, rules, template, package adapter/tests and Opus P1-1 evidence.
  - [x] Create isolated branch from fetched `origin/main`; mechanical harness branch check passes.
  - [x] Capture existing package targets and lazy-package consumer harness.
- [x] **Lot 1 — Test first**
  - [x] Add `packages/cluster-mesh/tests/packaging/activation-vectors.spec.ts`: native consumer import, complete execution on PostgreSQL, negative executor witness, counts.
  - [x] Reuse lazy-package preparation with an activation-only consumer and disposable Compose PostgreSQL.
  - [x] RED: installed 0.2.3 fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` for `./adapters/postgres-activation/vectors` (`/tmp/artifacts-upt2-red.log`).
- [ ] **Lot 2 — Package vectors**
  - [ ] Export framework-independent executable vectors; run against the supplied host stores and DB-time wait.
  - [ ] Cover exact bindings, denial/outage, replay/race, namespace isolation, immutable records, expiry, cleanup, invalidation and recovery.
  - [ ] Verify registry version before additive 0.2.4 pack-only bump; document exact import and host fixture contract.
- [ ] **Lot 3 — Docs consolidation & validation**
  - [ ] Run packed clean-consumer qualification, package unit tests, typecheck/build and lint.
  - [ ] Wire packed-vector qualification into artifacts CI under BR861-EX3.
  - [ ] Run scope check before each commit and reconcile independent review.
  - [ ] Push and create draft PR with this file as body; post 3-step plan.
  - [ ] Verify CI on the exact head; report PR, head, vector import path.
  - [ ] Tear down `test-artifacts-upt2`; retain BRANCH.md and draft status; do not merge.
