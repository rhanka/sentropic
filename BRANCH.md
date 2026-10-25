# Feature: #861 fix L3 coordinator defects found by L8c

## Objective
- [x] Preserve typed retriable failures, classify without error text, and distinguish explicit COMMIT aborts from lost acknowledgements.

- [x] Make strict installation with Radar llm-mesh 0.19.2 and public declaration compilation pass from packed archives.

## Scope / Guardrails
- [x] Branch fix/artifacts-861-L3-l8c-defects; worktree tmp/worktrees/861-l3-l8cfix.
- [x] Base origin/feat/immo-861-integration 8d268de0d; merge L8c 083b4f2fe without rebase.
- [x] Make only; ENV=test-861-l3-l8cfix last; shared Docker lock and make down after each step.
- [x] Local .tmp/qualification.make substitutes the environment name in existing Compose targets; no committed runner changes or published ports.
- [x] Frozen L0 bytes and L3 port signatures remain unchanged; no publication.
- [x] Retain the integration owner's reserved artifacts 0.2.0 version (registry baseline 0.1.4); spec r2 assigns manifests and locks to the integrator.

- [x] Branch fix/artifacts-861-pack-l8d-defects; worktree tmp/worktrees/861-pack-l8dfix; base origin/feat/immo-861-integration.
- [x] Merge origin/feat/artifacts-861-L8d without rebasing; retain original qualification evidence.
- [x] Make-only; ENV=test-861-pack-l8dfix last; shared Docker lock and matching Compose down after each step.
- [x] Preserve all l0-freeze bytes and L3 port signatures; no publication.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/commit/coordinator.ts`
  - `packages/artifacts/tests/commit-failure-parity.integration.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/artifacts/l0-freeze/**`
  - `packages/artifacts/src/server/commit/types.ts`
  - `.track/**`
  - `Makefile`
  - `docker-compose*.yml`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/artifacts/package.json`
- **Exception process**:
  - [x] No exceptions; inherited L8c test content is preserved by a merge commit.

- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/package.json`
  - `packages/cluster-mesh/package.json`
  - `packages/artifacts/probe/l8d/**`
  - `packages/cluster-mesh/tests/**`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/src/modules/catalog.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**`
  - `packages/artifacts/l0-freeze/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`
  - `.github/workflows/**`
- **Exception process**:
  - [x] BR861-EX1 permits only matching mesh peer metadata in package-lock.json; no resolution changes; rollback with manifest range.
  - [x] BR861-EX2 permits only the catalog llm-mesh range change for the L8d qualification defect; impact: registry, gateway coherence and topology admit exactly 0.19.2 plus the existing range; rollback: restore the catalog range and remove its 0.19.2 admission tests together with the manifest widening.

## Feedback Loop
- [x] Reproduced all six expected failures as ordinary tests: 6 failed, 33 passed before the fix.
- [ ] Independent peer review before merge.

- [x] Post-merge integrity regression executed five Node processes inside one 5s test and timed out at 5.7s; split its five independent cases without changing assertions or timeouts. Full packaging source rerun: 52 passed, 45 fixture-dependent tests inactive.
- [x] Merged origin/feat/immo-861-integration at 0bda0f93d without rebasing; only BRANCH.md conflicted. Retained this fix plan and incoming INT-15 installed-receipt integrity tests; Track bytes are identical across parents.
- [x] L8d merge conflicts only in BRANCH.md; replace lane plan with this bounded fix plan.
- [x] Spec r2 R4 requires exactly 0.19.2 || >=0.22.0 <0.28.0; no 0.20/0.21 support implied.
- [x] L8D-2 is archive omission: retain frozen import and include src/contracts.ts in package files.
- [x] Retain planned artifacts 0.2.0 and cluster-mesh 0.22.0; verify the source-change package bump against main (0.21.2), without inventing a release version.

## AI Flaky tests
- [x] No flaky acceptance or skipped regression cases.

- [x] No flaky acceptance or silent skips.

## Orchestration Mode (AI-selected)
- [x] Single author; inherited L8c qualification merged before the fix.

- [x] Mono-branch; requested merge preserves L8d history without copying commits.

## UAT Management (in orchestration context)
- [x] Package-only change; HTTP/MCP behavior checked against real PostgreSQL in separate child processes.

- [x] No interactive surface changes; packed consumer tests provide the applicable acceptance evidence.

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock and spec r2; mechanically check branch; merge L8c.
- [x] Lot 1: reuse L2 typed classification, remove message inference, certify explicit SQL aborts after successful settlement.
- [x] Promote all known-failure cases in commit-failure-parity.integration.test.ts; add a typed provider-outage case.
- [x] Full PostgreSQL/MinIO integration campaign: 168 tests passed across 12 files, including L8c 40/40 and coordinator 42/42; build passed and stack removed.
- [x] Lot 2: 431 unit tests across 33 files; 168 integration/E2E tests across 12 files; lint, build, freeze-types and scope checks passed; no skips.
- [x] Frozen bytes verified, branch pushed, draft PR #747 opened against feat/immo-861-integration; peer review remains pending before merge.

- [x] Lot 0 — read Docker lock, rules and spec r2; create worktree; mechanical branch check; merge L8d tests.
- [x] Lot 1 — reproduced both known failures using the original packed tests; removed TODO markers (2 failures, no TODOs/skips).
- [x] Lot 2 — updated peer range and lock metadata; included required contract source in artifacts archive.
- [x] Lot 3 — strict full-Radar install and npm ci passed (764 packages); clean packed runtime and strict NodeNext declarations passed; 2 promoted regressions and 16 receipt regressions passed, zero TODOs/skips.
- [x] Lot 4 — verified frozen bytes/L3 signatures and package-bump applicability; reviewed minimal diff; prepared push/draft handoff targeting feat/immo-861-integration.
- [x] Evidence: packages/artifacts/probe/l8d/PACK-FIX-RECEIPT.md; archive tuple and disposable lock/smoke receipts in tmp/l8d; final matching Compose down passed.
- [x] Lot 5 — reproduced actual packed 0.19.2 entry refusal; aligned runtime range; 72 module tests and 47 packaging checks passed, including catalog parity and boundaries (45 packed-fixture tests not activated).
- [x] Lot 6 — rebuilt and probed actual packed 0.19.2 entries; smoke/declarations and 18 regressions passed; bounded receipt claims; merged current integration without rebase; scope checked and prepared push. Dedicated Compose cleanup passed after every step.

## Deferred to L8 qualification / L9
- [x] Full eight-suite and four-shard qualification, image qualification, published bytes and activation remain separate gates; original L8d receipt is historical evidence.
