# Feature: Fix package publish triggers

## Objective
Prevent package publish jobs from running on main when only CI workflow files changed.

## Scope / Guardrails
- Scope limited to GitHub Actions path filters and this branch plan.
- No application runtime, Docker Compose, database, Kubernetes, or package source changes.
- Make-only workflow, no direct Docker or npm commands.
- Branch development happens in isolated worktree `tmp/fix-publish-package-triggers`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/ci.yml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None
- **Exception process**:
  - Not required; workflow file is explicitly allowed for this CI-only fix.

## Feedback Loop
- `attention`: Main run `26333611298` deployed k8s successfully, but `publish-chat-ui` failed with npm `ENEEDAUTH` because `.github/workflows/ci.yml` made `chat_ui=true`; package publish jobs need package-source-only triggers.

## AI Flaky tests
- Not applicable.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: One CI workflow condition fix.

## UAT Management (in orchestration context)
- No UAT surface; CI validation only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/fix-publish-package-triggers`.
  - [x] Confirm scope and guardrails.
  - [x] Confirm root cause from GitHub Actions logs.

- [x] **Lot 1 — Separate validate and publish package filters**
  - [x] Add package-source-only outputs for LLM Mesh and Chat UI publish jobs.
  - [x] Keep workflow-file changes triggering validation jobs.
  - [x] Point `publish-llm-mesh` and `publish-chat-ui` to package-source-only outputs.
  - [x] Lot gate:
    - [x] Static workflow inspection confirms `.github/workflows/ci.yml` does not trigger package publish outputs.

- [ ] **Lot N — Final validation**
  - [x] Commit implementation fix with `make commit`.
  - [ ] Push latest branch and open PR with this `BRANCH.md` as body.
  - [ ] Verify PR CI or enough workflow checks to prove package publish jobs are no longer triggered by workflow-only changes.
  - [ ] Delete `BRANCH.md`, push, merge.
