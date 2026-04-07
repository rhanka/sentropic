# Chore: BR-25 — Rules & Skills Audit

## Objective
Absorb learnings from BR-04B audit (2 agents, 13 sessions, 400+ incidents) into rules and skills. Mechanical enforcement over text rules.

## Scope / Guardrails
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/chore-rules-skills-audit` (even for one active branch).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `rules/**`
  - `.claude/**`
  - `plan/25-BRANCH_chore-rules-skills-audit.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR25-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

## AI Flaky tests
- N/A (no code changes)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: docs-only, no CI dependency.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on integrated branch only.
- N/A — no user-facing changes.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`
  - [ ] Read audit reports from BR-04B session `185d0021` agents `a22a2d6f6e30c303e` (reproaches) and `a6d7c6fa856e30657` (improvements)
  - [ ] Categorize findings: existing rule violated vs missing rule vs needs mechanical enforcement

- [ ] **Lot 1 — Rule updates**
  - [ ] For each existing rule file: diff against audit findings, identify rules that exist but are repeatedly violated, understand WHY (visibility? precision? no mechanical enforcement?), and fix the root cause (reword, move, add hook)
  - [ ] For each audit finding with no existing rule: add the rule in the right file
  - [ ] Lot gate:
    - [ ] Review all changed rule files for consistency and no contradictions

- [ ] **Lot 2 — Mechanical enforcement**
  - [ ] For recurring patterns (print debug loops, wrong branch, hallucinated checkboxes): create skills or hooks that mechanically prevent the mistake instead of relying on text rules
  - [ ] Add hook for branch number allocation (check existing branches before assigning)
  - [ ] Validate hooks work with a dry-run
  - [ ] Lot gate:
    - [ ] Each hook tested manually

- [ ] **Lot N — Final validation**
  - [ ] Review all changed rule files for consistency
  - [ ] Create/update PR using `BRANCH.md` text as PR body
  - [ ] Run/verify branch CI on PR
  - [ ] Once CI OK, commit removal of `BRANCH.md`, push, merge
