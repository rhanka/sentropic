# Feature: A-LIVE W5 — GB1 descriptor/receipt validation (lot 2)

## Objective
- [ ] Implement A-LIVE §10 lot 2 (wagon W5 of the alive enablement plan r3.5; M3-GB1 scope unchanged since r3): full dependency integrity inventory with a sealed host integrity map, script-package qualification rows distinct from the empty execution allowlist, the pure mandatory builder-attested receipt schema and verifier, and the candidate output ceiling gate with boundary fixtures. Validation only; no execution, no deployment, no activation (merge/activation wait for GB4-P go).

## Scope / Guardrails
- [ ] Code-only wagon on `feat/alive-w5`, no PR; scoped local tests only, full suites in CI.
- [ ] ENV=test-alive-w5 (lower-case only); never ENV=dev; make-only; no version bump (train integration lane bumps once per train, OPTIM 2026-11-03).
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/build-contract.ts`
  - `packages/artifacts/src/server/build-dependencies.ts`
  - `packages/artifacts/src/server/build-receipt.ts`
  - `packages/artifacts/src/server/build-output.ts`
  - `packages/artifacts/src/server/build-integrity.ts`
  - `packages/artifacts/src/server/failures.ts` (additive `dist_over_limits` registration only)
  - `packages/artifacts/tests/build-contract.test.ts`
  - `packages/artifacts/tests/build-integrity.test.ts`
  - `packages/artifacts/tests/build-receipt.test.ts`
  - `packages/artifacts/tests/build-output.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `apps/**`, `api/**`, `deploy/**`, `packages/artifacts/src/mcp-core.ts`, `packages/artifacts/src/profile/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file) — unused.

## Feedback Loop
- [ ] Named port for W3 (supervisor) and W7 (builder service): the existing subpath `@sentropic/artifacts/server/build-contract` re-exports the integrity, output and receipt validators; no new package export. A-LIVE §8.4 defines the receipt join; no invented cross-lane contract.

## AI Flaky tests
- [ ] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: lane W5 of the parallel alive plan; one wagon among W1-W11, merged by the train integration lane.

## UAT Management (in orchestration context)
- [ ] Wagon: branch pushed, scoped tests green locally; no PR, no CI polling (relay to the conductor).

## Plan / Todo (lot-based)
- [ ] Lot 1: failing tests for integrity coverage, script qualification, receipt verifier, output boundaries.
- [x] Lot 2: host integrity map coverage + typed `dependency_integrity_missing`/`dependency_integrity_mismatch` refusals + script qualification rows (A-LIVE §7.2-7.3, §3.4).
- [x] Lot 3: pure mandatory receipt schema + verifier with anti-replay and falsified-digest refusals (A-LIVE §8.4; G0 §4.3).
- [ ] Lot 4: candidate output ceiling gate, boundary fixtures 255/256 files, 16 MiB±1, 64 MiB±1 (A-LIVE §8.3, §10 lot 2).
- [ ] Lot 5: scoped green (test-artifacts, typecheck-artifacts, lint-artifacts), scope-check per commit, wagon push, French report.
