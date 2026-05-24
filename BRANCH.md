# Feature: Register BR-38 Vision/Image Plans

## Objective
- [x] Register the BR-38 vision/image branch pair in `PLAN.md`.
- [x] Add detailed branch plans for BR-38a multimodal image input and BR-38b image generation.
- [x] Keep this PR documentation-only so it can merge quickly before implementation starts.

## Scope / Guardrails
- [x] Scope limited to roadmap and branch-plan documentation.
- [x] No runtime code, package, schema, workflow, Docker, or Makefile changes.
- [x] Make-only workflow remains authoritative; no direct Docker or npm commands are required for this documentation-only branch.
- [x] Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and remains on `main`.
- [x] Branch development happens in isolated worktree `tmp/chore-plan-vision`.
- [x] Automated runtime test campaigns are not applicable for this doc-only registration branch.
- [x] All new text is in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `plan/38a-BRANCH_feat-multimodal-image-input.md`
  - `plan/38b-BRANCH_feat-image-generation-tool.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `spec/**`
  - `plan/NN-BRANCH_*.md` except the two BR-38 branch files listed above
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `rules/**`
  - `README.md`
  - `TODO.md`
- **Exception process**:
  - No exception is declared for this branch.

## Feedback Loop
- [x] No blocker.
- [x] No product decision remains open for this registration PR.

## AI Flaky tests
- [x] Not applicable. No AI/provider/runtime tests are run by this documentation-only branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- [x] Rationale: one documentation branch registers two future implementation branches without touching runtime code.

## UAT Management (in orchestration context)
- [x] No UAT required for this registration PR.
- [x] BR-38a and BR-38b UAT checklists are captured inside their branch-plan files.

## Plan / Todo (lot-based)
- [x] **Lot 0 - Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `README.md`, `TODO.md`, `PLAN.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm root workspace is `main` and fast-forwarded to `origin/main` before creating the worktree.
  - [x] Create isolated worktree `tmp/chore-plan-vision` from `main`.
  - [x] Confirm command style: every `make` command passes the concrete `ENV=...` value last.
  - [x] Confirm branch scope boundaries.

- [x] **Lot 1 - Register BR-38a and BR-38b**
  - [x] Add BR-38a and BR-38b to `PLAN.md` status, pending branches, catalog, dependency graph, scheduling, port registry, and source specifications.
  - [x] Allocate BR-38a slot 0: `API_PORT=9190`, `UI_PORT=5390`, `MAILDEV_UI_PORT=1290`.
  - [x] Allocate BR-38b slot 1: `API_PORT=9191`, `UI_PORT=5391`, `MAILDEV_UI_PORT=1291`.
  - [x] Add `plan/38a-BRANCH_feat-multimodal-image-input.md` from the branch template.
  - [x] Add `plan/38b-BRANCH_feat-image-generation-tool.md` from the branch template.
  - [x] Keep BR-38a focused on image input/upload/vision routing.
  - [x] Keep BR-38b focused on image generation after BR-38a.

- [ ] **Lot N - Final validation**
  - [x] Run documentation diff validation: `git diff --check`.
  - [x] Run unresolved-token scan for the new plan files.
  - [ ] Create PR using `BRANCH.md` text as PR body.
  - [ ] Verify branch CI on the PR.
  - [ ] Commit removal of `BRANCH.md`, push, and merge with a merge commit.
