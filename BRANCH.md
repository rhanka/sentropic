# Fix: #861 L8d packed tuple defects

## Objective
- [ ] Make strict installation with Radar llm-mesh 0.19.2 and public declaration compilation pass from packed archives.

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
- [ ] Lot 1 — reproduce both known failures using the original packed tests; remove TODO markers.
- [ ] Lot 2 — update peer range and lock metadata; include required contract source in artifacts archive.
- [ ] Lot 3 — run receipt regressions, strict Radar install, packed runtime/declaration smoke and both promoted regressions.
- [ ] Lot 4 — verify frozen bytes/L3 signatures, scope, package-bump applicability; review diff; push and draft PR targeting feat/immo-861-integration.

## Deferred to L8 qualification / L9
- [x] Full eight-suite and four-shard qualification, image qualification, published bytes and activation remain separate gates; original L8d receipt is historical evidence.
