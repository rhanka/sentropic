# Feature: common rule L01b2 kit publication and activation
## Objective
- [x] Follow approved amendment SHA-256 `3302ba9e3ee91a52850b89cb9646e2747d0412b5a9fcf3e17f3cdd72a6573fba`, sections 3/5/L01b2; depends on L01b1.
- [ ] Implement test-only CT-04-06/14 fixtures and independently kill M04-M06/M14/parity/delta/namespace.
## Scope / Guardrails
- [x] Isolated `tmp/worktrees/cm-s3-l01b2`, branch `feat/cm-s3-common-rule-l01b2`, from #722 head `07c069942dbf3c4531c8529e96ce208d71ca98ae`; mechanical branch check passed.
- [x] Test-only kit; no backend, admission claim, dependency or production codec changes.
- [x] Make-only checks, `ENV=test-common-rule` last; no Python; one Docker build at a time.
- [x] No service ports required by the disposable workspace lane; no dev environment.
- [x] Specific-file staging; `make commit MSG="..."`; each commit below 150 changed lines.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/tests/storage/common-rule/publication-reference.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/publication-assertions.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/publication-mutants.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/publication-kit.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/cluster-mesh/src/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Exceptions require ID, reason, impact and rollback in Feedback Loop before edits.
## Feedback Loop
- [x] Require independent review and retain its findings before draft handoff; no production qualification is claimed.
- [x] Provider denial checks remain in L18; this lot supplies only a reference legacy-policy double and no provider qualification.
## AI Flaky tests
- [x] No provider/model nondeterminism or accepted skips in this kit.
## Orchestration Mode (AI-selected)
- [x] Mono-branch implementation; independent read-only review before handoff.
## UAT Management (in orchestration context)
- [x] No web, Chrome or VSCode behavior changes; UAT is executable CT assertions.
## Plan / Todo (lot-based)
- [ ] **Lot 1 - Fixture contract and publication reference**
  - [ ] Add `publication-reference.ts`: scoped roots/receipts, ordinary/staged/projection races, preparation and commit crash points, reopen and revocation controls.
- [ ] **Lot 2 - Activation reference**
  - [ ] Extend `publication-reference.ts`: two-scope one-way activation, consumer parity, resumable validation/checkpoints, captured changes, bounded final delta and legacy-policy double.
- [ ] **Lot 3 - Reusable assertions**
  - [ ] Add `publication-assertions.ts`: CT-04 visibility/fences, CT-05 crash matrix, CT-06 concurrent/restarted retries, CT-14 activation/parity/inventory/namespace cases.
- [ ] **Lot 4 - Mutants and final validation**
  - [ ] Add `publication-mutants.ts` and `publication-kit.spec.ts`; require a positive pass before each independently designated mutant kill.
  - [ ] Scoped common-rule 36/36 and L01b2 17/17, zero skips/todo; full cluster-mesh 1024 passed (129 separate-lane skips); TypeScript and lint pass.
  - [ ] Run scope checks before each commit; review the five-path diff and keep the lot below 500 changed lines.
  - [ ] Prepare the draft PR body and require CI green on its exact head, stacked on #722; keep both PRs open.
