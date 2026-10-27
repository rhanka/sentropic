# Feature: feat(artifacts): ship UP-T conformance vectors (0.2.4)

## Objective
- [x] Deliver UP-T-2: ship importable activation conformance vectors for W1.c and Radar host executors in the 0.2.4 candidate tarball.

## Scope / Guardrails
- [x] Additive testing surface only; activation implementation and SQL bytes stay unchanged.
- [x] Base `origin/main`; branch `feat/artifacts-up-t2`; worktree `tmp/worktrees/artifacts-up-t2`; merge only.
- [x] Make-only Docker tests under the shared lock; `ENV=test-artifacts-upt2` last; no Python.
- [x] No publication or merge; push and open a draft PR to main.
- [x] Publication boundary: merging to main publishes 0.2.4 through CI; W1.c (#794) must then move its exact pin from 0.2.3 to 0.2.4; SQL hash/receipts stay unchanged.
- [x] Ports: API 8799, UI 5185, Maildev 1092; qualification PostgreSQL has no host port.
- [x] Atomic commits below 150 changed lines, selective staging, `make commit`, no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/package.json`
  - `packages/artifacts/README.md`
  - `packages/artifacts/src/adapters/postgres-activation-vectors.ts`
  - `packages/artifacts/src/mcp-core.ts`
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
  - [x] BR861-EX4: exact-head green CI request covers the evidenced blocking provider-version mismatch. Impact: mcp-core.ts version metadata only, aligned to 0.2.4. Rollback: revert this metadata fix with the 0.2.4 package bump.

## Feedback Loop
- [x] UP-T-2 / P1-1 in `pr794_opus_r1.md`: existing 0.2.3 vectors are repository tests absent from the published package; this branch supplies an executable package export.
- [x] TYPE-1: strict installed-consumer compilation requires `@types/pg` in the consumer tree, alongside `pg`; fixture corrected without changing package production code.
- [ ] REV-1: owner review on draft PR #797; harness consensus selection unavailable because live peer discovery does not provide exact model IDs (`.h2a/reviews/upt2-author.md`); no consensus claimed.
- [x] REV-P1-1: reproduce missing db-time-skew/commit-unknown IDs on both pool sizes; add both mandatory vectors with additive host hooks (16 total).
- [x] REV-P2: dedicated target requires packed-consumer/DB wiring and explicit disposable opt-in; refuse non-test database names before schema changes or vector stores.
- [x] CI-1: run 40492154926 passes installed vectors but packed-consumer probe rejects provider 0.2.3 against package 0.2.4; align only the provider version metadata in mcp-core.ts to unblock the requested exact-head CI gate.

## AI Flaky tests
- [x] No AI tests or flaky acceptance in this package-only scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; single package writer; external review on the draft PR.

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
- [x] **Lot 2 — Package vectors**
  - [x] Export framework-independent executable vectors; run against the supplied host stores and DB-time wait.
  - [x] GREEN: all 14 vectors pass on clean-installed 0.2.4 with real PostgreSQL; broken-executor witness rejects (`/tmp/artifacts-upt2-green.log`).
  - [x] Registry `npm view` returned 0.2.3 before bumping to 0.2.4; document exact import and host fixture contract.
- [ ] **Lot 3 — Docs consolidation & validation**
  - [x] Packed consumer after Opus r1: 9/9 tests pass, zero skipped; 16 vectors on each of pool max 1 and 4, broken-executor/disposable-host refusal, missing-wiring failures, NodeNext/Bundler types with skipLibCheck false/true.
  - [x] Document mandatory additive hooks, isolated-process clock skew and disposable database guard; package build and JSON execution receipt gate pass on review rerun.
  - [x] Package unit tests: 451/451 (37 files); lint passes; strict package build passed during packed-consumer qualification (`/tmp/artifacts-upt2-unit-lint.log`).
  - [x] Wire packed-vector qualification into artifacts CI under BR861-EX3.
  - [x] Run scope check before each commit; author diff inspection complete; external review tracked as REV-1.
  - [x] Push and create draft PR #797 to main with this file as body; 3-step plan posted.
  - [ ] Verify CI on the exact head; report PR, head, vector import path.
  - [x] Tear down `test-artifacts-upt2` after each test step; retain BRANCH.md and draft status; do not merge.
