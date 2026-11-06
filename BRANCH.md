# Feature: SG1 git binding, registry and release index

## Objective
- [ ] Deliver G0 FROZEN v3 section 2 records and SG1 acceptance for the artifacts 0.2.18 train.

## Scope / Guardrails
- [x] Contract SHA-256: `4c405c8f49e9d242d65eebe35a14a45e4826afc0007e9f94a7fe21d7404e21ba`.
- [x] Branch `feat/git-artifact-sg1`; worktree `tmp/worktrees/sg1`; base `origin/main`.
- [x] Docker slot wrapper; make only; no Python; no secret values in outputs.
- [x] Use `API_PORT=8801 UI_PORT=5201 MAILDEV_UI_PORT=1101 ENV=test-sg1`, ENV last.
- [x] Train integration owns versions, locks, pins and L5; this wagon changes none.
- [x] Keep one ready PR and observe CI; merge freeze applies; never merge this wagon.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/migrations/0010_git_bindings.sql`
  - `packages/artifacts/docs/git-bindings.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `**/package*.json`
  - `tools/memory-mcp-l5/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [ ] BRSG1-CI1: required `enforce-package-bump` rejects unchanged versions for src changes; wagon instructions forbid bumps. Integration/CI conductor must resolve this gate; no bypass or manifest change in SG1.
- [x] SG1-sqlite: named follow-up for SQLite binding parity; acceptance and resource scope in `packages/artifacts/docs/git-bindings.md`; conductor imports this source into Track as designated writer.
- [x] SG2 owns forge adapter/probe-qualified GitPort; SG3 owns git tools and attach orchestration; SG4 owns release transaction writes.

## AI Flaky tests
- [x] No AI-dependent acceptance; no flaky exception requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one build lane; consolidated train review.

## UAT Management (in orchestration context)
- [x] Verify fake tenant and Postgres lifecycle, conflicts, namespace, CAS and scope isolation.
- [x] Verify MCP artifacts_get omits git entirely without current repository code right.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, contract and baseline; create isolated worktree; mechanical branch check.
- [x] Lot 1: tests first in `tests/git-bindings.test.ts`, `tests/fixtures/git-binding-conformance.ts`, `tests/git-bindings.integration.test.ts`, `tests/git-binding-projection.test.ts`.
  - [x] Author shared lifecycle, uniqueness, isolation, replay, CAS and concurrency acceptance before implementation.
  - [x] Initial red: missing git binding module; add Postgres durability and registry refusal tests.
- [x] Lot 2: frozen record types, scope-bound host registry, binding store port, memory double and lifecycle CAS.
  - [x] Define exact binding/live/index records and trusted storage/code-right ports.
  - [x] Add scope-bound registry with closed defaults and namespace validation.
  - [x] Add atomic memory store, principal-scoped replay receipts and transition/CAS invariants.
  - [x] Extend both backend suites with ref refusal, branch reclamation and missing-branch pause fencing.
  - [x] Red test exposed inbound resume bypass; restrict inbound transitions to the contract state machine.
  - [x] Add same-target configuration and retained pause-condition acceptance; check page-only MCP readers.
  - [x] Resolve both red cases: same-target updates retain generation; repeated pause cannot clear a missing/diverged condition.
- [x] Lot 3: additive migration 0010, append-only audit/index and Postgres adapter; shared conformance suite.
  - [x] Add 0010 records, release column, scoped foreign keys and partial active uniqueness indexes.
  - [x] Add Postgres binding/receipt/event transaction and cross-process replay locking.
  - [x] Author `tests/git-release-index.integration.test.ts` for rebuild cardinality, isolation and immutability.
  - [x] Fix fixture SQL parameter types after first Postgres run; migrations applied successfully.
  - [x] Implement scope-filtered release-index readers through the existing Postgres package export.
- [x] Lot 4: artifacts_get code-right projection and unchanged set_access read-only grant snapshot.
  - [x] Author MCP transition projection and frozen access-definition tests before wiring.
  - [x] Wire code-right-only artifacts_get projection; unavailable rights omit git entirely.
- [x] Lot 5: written SQLite decision and adapter/host integration documentation.
- [ ] Lot 6: scoped local tests, typecheck/lint, scope check, one ready PR and green CI.
  - [x] `make test-artifacts SCOPE=tests/git-bindings.test.ts`: 10 passed; `SCOPE=tests/git-binding-`: 4 passed.
  - [x] `make test-artifacts-integration SCOPE=tests/git-bindings.integration.test.ts`: 12 passed.
  - [x] `make test-artifacts-integration SCOPE=tests/git-release-index.integration.test.ts`: 1 passed.
  - [x] `make test-artifacts SCOPE=tests/tools-list-snapshot.test.ts`: 1 passed; catalogue unchanged.
  - [x] `make lint-artifacts` and `make typecheck-artifacts`: passed; all commands use the recorded ports and `ENV=test-sg1` last, through docker-slot.sh.
  - [ ] Open the single ready PR; watch CI and report the version-gate disposition.
  - [ ] Run `make down-volumes API_PORT=8801 UI_PORT=5201 MAILDEV_UI_PORT=1101 ENV=test-sg1`.

## Deferred to SG1-sqlite
- [ ] Add SQLite migration/adapter and run the same binding conformance suite on both SQL backends by 2026-11-10; no Immo dependency.
