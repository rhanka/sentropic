---
name: plan
description: Use when you have a spec/decisions and need an executable plan — writes a lot-based BRANCH.md from the template and completes with track for realization state.
---

# harness/plan

Native sentropic planning. Turns an EVOL spec's decisions into an executable, scoped `BRANCH.md`. Open it
with `harness plan "<spec>" [--lots <n>]` (records a WorkEvent; harness writes BRANCH.md, then
`track branch import` indexes it).

## Write BRANCH.md from the template

Use `plan/BRANCH_TEMPLATE.md` strictly — checkboxes only, no prose, no `###`. First iteration must be
detailed:

- **Objective** + **Scope / Guardrails**.
- **Branch Scope Boundaries**: `Allowed` / `Forbidden` / `Conditional` paths (default forbidden: `Makefile`,
  `docker-compose*.yml`, `.cursor/rules/**`). Exceptions via `BRxx-EXn` (reason + impact + rollback).
- **Lot-based plan**: each lot is one logical change with a file-level test list and a lot gate.
- **Feedback Loop** for blockers/decisions.

## Lots & commit discipline

- One logical change per lot/commit; max ~10–15 files and **under 150 lines** per commit.
- Selective staging (`git add <files>` — never `git add .`); commit via `make commit MSG="type: …"`.
- Update `BRANCH.md` checkboxes WITHIN each commit.
- Multi-need work → multi-branch with a root `PLAN.md` (waves ≤4 orthogonal branches).

## Completes with track

harness OWNS the BRANCH.md (the master plan artifact) and EMITS `WorkEvent`s; **track** ingests them and
owns the realization state — Items, links, Decisions, acceptance, and the AWAITED / DROPPED / DONE / TO-DO
projections. Don't duplicate status in BRANCH.md prose — let track project it. Execute lots in order
autonomously; only interrupt for a real fork or blocker.
