# Fix: #861 public contract gaps

## Objective
- [x] Close upstream classes a/b for the artifacts 0.2.0 candidate: public coordinator construction, packed typed example, preparation cleanup and purge testing seams.

## Scope / Guardrails
- [x] Branch fix/artifacts-861-contract-gaps; worktree tmp/worktrees/861-contract-gaps; base 082fe4c60 on origin/feat/immo-861-integration.
- [x] Make only; ENV=test-861-gaps last; shared Docker flock and matching teardown after every step; no Python or attribution trailers.
- [x] Every commit is below 150 changed lines and uses selective staging plus make commit.
- [x] l0-freeze, L3 port signatures and profile input are unchanged; Radar-owned class c remains outside scope.
- [x] Candidate version remains the integration owner's reserved 0.2.0; no publication or main merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/**`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/artifacts/l0-freeze/**`
  - `packages/artifacts/src/server/commit/types.ts`
  - `packages/artifacts/src/profile/**`
  - `packages/cluster-mesh/**`
  - `api/**`
  - `ui/**`
  - `.track/**`
  - `.github/**`
  - `docker-compose*.yml`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`
- **Exception process**:
  - [x] BR861-GAPS-EX1: Makefile only admits test-861-gaps to the existing isolated Compose runner/build/scope/down guards; rollback removes that environment from those guards.

## Feedback Loop
- [x] Opus r1 P2-3: portable Make-path regression failed first, then passed; offline tools/cache now use overridable variables without personal absolute paths.
- [x] Opus r1 P2-1 execution: no-download and legacy-metadata regressions failed first; per-intent validation now retains reported invalid debt without stopping valid cleanup.
- [x] Opus r1 P2-1 query: PostgreSQL regression failed before the fix; filter completed/future intents, limit reads, prioritize unsettled debt, retire settled rechecks after 60 seconds.
- [x] Opus r1 P2-2: orphan-first purge regression failed before the fix; uncorrelated DELETE now forwards without pausing (A4).
- [x] Tests preceded implementation: packed example missing; preparation/purge exports missing; delayed PUT recovery reproduced and corrected.
- [x] Preparation metadata uses existing intent JSON; cleanup cannot complete an expired preparation, delete shared bytes, or erase attempt history.
- [x] npm TLS resets blocked normal installation; isolated cached qualification passed with recorded tool versions, without sibling package sources or relaxed assertions.
- [x] Receipt: packages/artifacts/probe/CONTRACT-GAPS-RECEIPT.md contains exact commands, toolchain differences, SHA-256 and integrity.
- [ ] Delivery blocked by external access: GitHub HTTPS TLS handshake fails, the GitHub connector transport is unavailable, and existing SSH authentication is refused; push/draft PR/CI inspection remain pending.

## AI Flaky tests
- [x] No flaky acceptance, timeout increase or skipped required case.

## Orchestration Mode (AI-selected)
- [x] One code author on one isolated branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Package/API changes only; real PostgreSQL/MinIO and installed-consumer qualification replace UI UAT.

## Plan / Todo (lot-based)
- [x] Lot 1: export PostgreSQL executor and coordinator types; ship public-import Radar example with compiled profile, PG participant, fence and scheduler.
- [x] Lot 2: preparation inventory/deadlines and bounded cleanup; preparation-cleanup.test.ts covers shared/active protection, failure retry, batches and delayed PUT.
- [x] Lot 3: purge pause/claim inspection; purge-testing.test.ts and publication-authorization.integration.test.ts cover correlated pause, both PG race orders and expired finalization.
- [x] Build/freeze: platform/artifacts build and frozen contract fixture compilation passed; byte comparison with base passed.
- [x] Unit: all 437 tests / 35 files passed, including the two new unit files.
- [x] Integration/E2E: all 171 tests / 12 files passed, including radar-commit-setup.integration.test.ts and the extended PostgreSQL authorization tests.
- [x] Packed example: packed-example.test.mjs installed the exact archive into an isolated consumer and compiled the shipped example/public API fixture.
- [x] Lint: recommended TypeScript ESLint rules passed; cached version differences documented in receipt.
- [ ] Push and open a draft PR against feat/immo-861-integration; inspect its CI status.
