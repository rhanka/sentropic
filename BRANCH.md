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
- [x] SG1-sqlite: named follow-up for SQLite binding parity; acceptance and resource scope in `packages/artifacts/docs/git-bindings.md`; conductor imports this source into Track as designated writer.
- [x] SG2 owns forge adapter/probe-qualified GitPort; SG3 owns git tools and attach orchestration; SG4 owns release transaction writes.

## AI Flaky tests
- [x] No AI-dependent acceptance; no flaky exception requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one build lane; consolidated train review.

## UAT Management (in orchestration context)
- [ ] Verify fake tenant and Postgres lifecycle, conflicts, namespace, CAS and scope isolation.
- [ ] Verify MCP artifacts_get omits git entirely without current repository code right.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, contract and baseline; create isolated worktree; mechanical branch check.
- [ ] Lot 1: tests first in `tests/git-bindings.test.ts`, `tests/fixtures/git-binding-conformance.ts`, `tests/git-bindings.integration.test.ts`, `tests/git-binding-projection.test.ts`.
  - [x] Author shared lifecycle, uniqueness, isolation, replay, CAS and concurrency acceptance before implementation.
  - [x] Initial red: missing git binding module; add Postgres durability and registry refusal tests.
- [ ] Lot 2: frozen record types, scope-bound host registry, binding store port, memory double and lifecycle CAS.
- [ ] Lot 3: additive migration 0010, append-only audit/index and Postgres adapter; shared conformance suite.
- [ ] Lot 4: artifacts_get code-right projection and unchanged set_access read-only grant snapshot.
- [ ] Lot 5: written SQLite decision and adapter/host integration documentation.
- [ ] Lot 6: scoped local tests, typecheck/lint, scope check, one ready PR and green CI.

## Deferred to SG1-sqlite
- [ ] Add SQLite migration/adapter and run the same binding conformance suite on both SQL backends by 2026-11-10; no Immo dependency.
