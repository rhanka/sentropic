# Feature: PLAN.md roadmap refresh (chore)

## Objective
Refresh root `PLAN.md` to mirror the current orchestration state (BR-14c, BR-14g, BR-24, fix-mistral merged; BR-23 study complete with PR open; BR-14b in progress; BR-25 in study), surface forthcoming branches (BR-flow, BR-marketplace, BR-graphify, BR-persistence-git, BR-triggers), and record the 2026-05-13 repo merge policy (merge-commit only).

## Scope / Guardrails
- Scope limited to documentation: `PLAN.md` update + this `BRANCH.md` creation.
- One migration max in `api/drizzle/*.sql` (not applicable — doc-only).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/entropiq` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/chore-plan-roadmap-refresh` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). Not applicable — doc-only.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `PLAN.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `rules/**`
  - `spec/**`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `packages/**`
  - any other path
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- none.

## AI Flaky tests
- Not applicable — doc-only branch with no tests.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: doc-only refresh, no CI need, single PLAN.md target.

## UAT Management (in orchestration context)
- Not applicable — doc-only branch, no UI/API surface change.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & inventory**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/conductor.md`.
  - [x] Read current `PLAN.md` (state to refresh) and `plan/BRANCH_TEMPLATE.md`.
  - [x] Read `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §1 + §11, `SPEC_STUDY_AGENT_AUTONOMY_INCREMENTS.md` §6, `SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md`.
  - [x] Create worktree `tmp/chore-plan-roadmap-refresh` on branch `chore/plan-roadmap-refresh` from `origin/main`.
  - [x] Confirm scope (BRANCH.md + PLAN.md only) and guardrails.
  - [x] Environment mapping: `ENV=test-chore-plan-roadmap-refresh`; no services required (doc-only).

- [x] **Lot 1 — PLAN.md refresh**
  - [x] Section A — replace stale status header with current state:
    - BR-14c MERGED (PR #141, 2026-05-11)
    - BR-14g MERGED (PR #146)
    - BR-24 MERGED (PR #147)
    - fix-mistral MERGED (PR #145)
    - BR-23 SCOPING COMPLETED 2026-05-13, PR open, awaiting SPEC_VOL validation
    - BR-14b IN PROGRESS — Lot 1 contracts (`16163ffc`), Lot 2 events (`9cc76b61`), Lot 3 chat-core shell pending
    - BR-14a Lot 0 scoping complete (commit `c5cc6da1`)
    - BR-25 chore/rules-skills-audit in study mode (17/46 checkboxes)
  - [x] Section C — add repo policy note (2026-05-13): squash merge DISABLED, rebase merge DISABLED, merge commit ONLY, `delete_branch_on_merge` DISABLED.
  - [x] Section B — append new branches to §3 catalog: BR-flow, BR-marketplace, BR-graphify, BR-persistence-git, BR-triggers.
  - [x] Update existing rows: BR-14b status, BR-14a status + target rename `@sentropic/chat` → `@sentropic/chat-ui`, BR-23 status, BR-25 status.
  - [x] Lot gate (doc-only):
    - [x] No typecheck/lint/test required.
    - [x] Verify `PLAN.md` is well-formed Markdown (visual review).

- [x] **Lot 2 — Commit**
  - [x] `git add BRANCH.md PLAN.md`
  - [x] `make commit MSG="docs: refresh PLAN.md status and add 5 new branches plus repo policy note"`
  - [x] No push, no PR (let user review).
