# Chore: BR-25 — Rules & Skills Audit

## Objective
Absorb learnings from BR-04B audit (2 agents, 13 sessions, 400+ incidents) into rules and skills. Mechanical enforcement over text rules.

## Scope / Guardrails
- Make-only workflow.
- Root workspace reserved for user dev/UAT (`ENV=dev`).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `rules/**`
  - `.claude/**`
  - `plan/24-BRANCH_chore-rules-skills-audit.md`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `e2e/**`

## Feedback Loop

## AI Flaky tests
- N/A (no code changes)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: docs-only, no CI dependency.

## Plan / Todo (lot-based)

- [ ] **Lot 1 — Audit analysis**
  - [ ] Read audit reports from BR-04B session `185d0021` agents `a22a2d6f6e30c303e` (reproaches) and `a6d7c6fa856e30657` (improvements)
  - [ ] For each existing rule file: diff against audit findings, identify rules that exist but are repeatedly violated, understand WHY (visibility? precision? no mechanical enforcement?), and fix the root cause (reword, move, add hook)
  - [ ] For each audit finding with no existing rule: add the rule in the right file

- [ ] **Lot 2 — Mechanical enforcement**
  - [ ] For recurring patterns (print debug loops, wrong branch, hallucinated checkboxes): create skills or hooks that mechanically prevent the mistake instead of relying on text rules
  - [ ] Validate hooks work with a dry-run

- [ ] **Lot N — Final validation**
  - [ ] Review all changed rule files for consistency
  - [ ] Commit and push
