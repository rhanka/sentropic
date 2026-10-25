# Fix: #861 L8d packed tuple defects

## Objective
- [x] Make strict installation with Radar llm-mesh 0.19.2 and public declaration compilation pass from packed archives.

## Scope / Guardrails
- [x] Branch fix/artifacts-861-pack-l8d-defects; worktree tmp/worktrees/861-pack-l8dfix; base origin/feat/immo-861-integration.
- [x] Merge origin/feat/artifacts-861-L8d without rebasing; retain original qualification evidence.
- [x] Make-only; ENV=test-861-pack-l8dfix last; shared Docker lock and matching Compose down after each step.
- [x] Preserve all l0-freeze bytes and L3 port signatures; no source changes or publication.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/package.json`
  - `packages/cluster-mesh/package.json`
  - `packages/artifacts/probe/l8d/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**`
  - `packages/artifacts/l0-freeze/**`
  - `packages/cluster-mesh/src/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`
  - `.github/workflows/**`
- **Exception process**:
  - [x] BR861-EX1 permits only matching mesh peer metadata in package-lock.json; no resolution changes; rollback with manifest range.

## Feedback Loop
- [x] L8d merge conflicts only in BRANCH.md; replace lane plan with this bounded fix plan.
- [x] Spec r2 R4 requires exactly 0.19.2 || >=0.22.0 <0.28.0; no 0.20/0.21 support implied.
- [x] L8D-2 is archive omission: retain frozen import and include src/contracts.ts in package files.
- [x] enforce-package-bump remains unchanged: this PR changes no src files; reserved artifacts 0.2.0 and mesh 0.22.0 remain the candidate tuple.

## AI Flaky tests
- [x] No flaky acceptance or silent skips.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; requested merge preserves L8d history without copying commits.

## UAT Management (in orchestration context)
- [x] No interactive surface changes; packed consumer tests provide the applicable acceptance evidence.

## Plan / Todo (lot-based)
- [x] Lot 0 — read Docker lock, rules and spec r2; create worktree; mechanical branch check; merge L8d tests.
- [x] Lot 1 — reproduced both known failures using the original packed tests; removed TODO markers (2 failures, no TODOs/skips).
- [x] Lot 2 — updated peer range and lock metadata; included required contract source in artifacts archive.
- [x] Lot 3 — strict full-Radar install and npm ci passed (764 packages); clean packed runtime and strict NodeNext declarations passed; 2 promoted regressions and 16 receipt regressions passed, zero TODOs/skips.
- [x] Lot 4 — verified frozen bytes/L3 signatures and package-bump applicability; reviewed minimal diff; prepared push/draft handoff targeting feat/immo-861-integration.
- [x] Evidence: packages/artifacts/probe/l8d/PACK-FIX-RECEIPT.md; archive tuple and disposable lock/smoke receipts in tmp/l8d; final matching Compose down passed.

## Deferred to L8 qualification / L9
- [x] Full eight-suite and four-shard qualification, image qualification, published bytes and activation remain separate gates; original L8d receipt is historical evidence.
