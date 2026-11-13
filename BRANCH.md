# Feature: Standard ecosystem diagram cards

## Objective
- [ ] Render the existing ecosystem with published DiagramSceneFigure and real repository/package ownership.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/ecosystem-ds; branch feat/governance-ecosystem-ds-cards.
- [x] Make-only, Docker-first; ENV=test-ecosystem-ds last; no merge or trailers.
- [x] No application stack or ports required; disposable kit containers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/governance/**`
  - `README.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [x] Binding DS specification supplied by owner; no new design decisions.
- [x] README scope limited to image references.
- [x] Track single-writer reservation: conductor records this request and deliverable.
- [x] npm confirms DS 0.40.0; standard renderer reproduces footer overflow with the required full npm names. Owner clarification pending; no truncation or gate relaxation.

## AI Flaky tests
- [x] No provider calls required.

## Orchestration Mode
- [x] Mono-branch; one implementation lane.

## UAT Management (in orchestration context)
- [ ] Inspect generated overview and repository frames in light/dark modes.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules and inventory; mechanically verify branch; verify npm DS 0.40.0.
- [ ] Lot 1: upgrade dependencies; use semantic documents, views and standard scene components.
- [ ] Lot 2: correct ownership, names and kinds; regenerate all SVGs through the kit.
- [ ] Lot 3: prepare/build/export-static/validate/deliver; inspect output; independent code review.
- [ ] Lot 4: push, open PR, verify exact-head CI; report in .tmp/rv/ecosystem-ds.md; conductor merges.
