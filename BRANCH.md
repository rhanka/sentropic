# fix(artifacts): 0.2.1 host guard and host failure mapper

## Objective
- [ ] Fix the two Radar acceptance defects for immo #861 without changing frozen contracts.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/artifacts-021`, branch `fix/artifacts-0.2.1-acceptance`, base `origin/main`.
- [x] Make-only; shared Docker lock; cleanup after each step; no merge.
- [x] Environment: `test-artifacts-021`; Compose qualification has no published ports.
- [x] Existing qualification Compose lane extended to `test-artifacts-021` (BR861-EX1).
- [x] Preserve `packages/artifacts/l0-freeze/**` byte for byte and existing wire shapes.
- [x] Commits below 150 lines, selective staging, `make commit` only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/http.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/server/commit/coordinator.ts`
  - `packages/artifacts/src/server/commit/types.ts`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/probe/**`
  - `packages/artifacts/examples/radar-commit-setup.ts`
  - `packages/artifacts/README.md`
  - `packages/artifacts/package.json`
  - `packages/cluster-mesh/tests/integrations/artifacts-surface.spec.ts`
  - `package-lock.json`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/l0-freeze/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare rationale, impact and rollback in Feedback Loop before any exception.

## Feedback Loop
- [x] BR861-EX1: extend existing Compose qualification ENV allowlist to the requested `test-artifacts-021`; required by Docker lock and make-only constraints. Impact: only that isolated ENV selects qualification services, scope checks and cleanup. Rollback: remove its four allowlist entries.
- [x] BR861-EX2: route existing package-pack/consumer recipes through the same Compose lane and add a packed-example check; required to verify installed mapper declarations under the Docker lock. Default commands are unchanged. Rollback: remove the pack-run indirection and example target.
- [x] CI catalog adaptation: mesh's artifacts catalog test pinned version 0.2.0; compare against the exported artifacts version so the 0.2.1 patch retains the catalog contract. No mesh runtime code changed.
- [x] Independent review selection unavailable: no reachable live model catalog or installed catalog CLI; recorded `.tmp/immo-861-artifacts/review-021.md`, no consensus claimed. Author reviewed the exact bounded diff; PR remains unmerged.

## AI Flaky tests
- [x] No AI-dependent tests in scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one author, independent review before handoff.

## UAT Management (in orchestration context)
- [x] Library-only change; application regression tests and packed consumer serve as UAT.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read Docker lock, Radar analysis and spec r2; create worktree; mechanical branch check.
- [x] Lot 1 — Reproduce account suspension after barrier in HTTP publication; host callback and refusal code; retain lifecycle/ACL/revision checks.
  - [x] Baseline regression run: four failures; host callback called zero times; HTTP/MCP S3 timeout and coordinator acquisition returned non-retriable `provider_error`.
  - [x] Tests: `tests/host-acceptance.test.ts`, `tests/fixtures/transport-world.ts`; four baseline failures, four passes after fixes.
- [x] Lot 2 — Wire optional `mapHostError` through HTTP, MCP and coordinator classification.
  - [x] Additive dependencies wired; HTTP/MCP S3 and coordinator acquisition regressions pass.
  - [x] Tests: `tests/host-acceptance.test.ts`, `tests/commit-failure-parity.integration.test.ts`; typed timeout red then green, private causes and retry parity.
  - [x] Existing direct-publication integration fixture now explicitly composes host approval after provider checks; its 15 expiry-denial failures exposed reliance on the removed provider approval check. Assertions retained unchanged.
- [ ] Lot 3 — Bump artifacts to 0.2.1; update packed host composition and documentation.
  - [x] Registry latest verified as 0.2.0; package, workspace lock and provider manifest version bumped to 0.2.1.
  - [ ] Tests: `probe/packed-example.test.mjs`; verify registry version, freeze bytes and package bump.
- [ ] Lot 4 — Final validation and PR.
  - [x] 445 unit tests passed; typecheck, lint, frozen declarations and maintained ABI fixture passed.
  - [x] CI `validate-artifacts` passed all unit/integration/build/lint/pack/consumer gates on `123a581cc`; final-head rerun follows catalog test adaptation and packed declaration gate wiring.
  - [ ] Run artifacts typecheck, lint, unit, integration, frozen declaration and packed-consumer checks under lock; clean each stack.
  - [ ] Review the exact diff and reconcile findings.
  - [ ] Push; PR to main with this plan as body; CI green on exact head; do not merge.
