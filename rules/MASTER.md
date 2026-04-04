---
description: "Consolidated AI development rules - loaded in every conversation"
alwaysApply: true
paths: ["**/*"]
globs: ["**/*"]
tags: [master]
---

# MASTER RULES

## Make-Only (MANDATORY)
- ALL commands go through `make` targets — no direct npm/python/docker
- Install libs: `make install-<ui/api> ${NPM_LIB}` (add `-dev` for devDependencies)
- Build/quality: `make build`, `make typecheck`, `make lint`, `make format`
- Testing: `make test`, `make test-e2e`, `make test-smoke`
- DB: `make db-init`, `make db-migrate`, `make db-backup`, `make db-restore`, `make db-seed`

## Docker-First (MANDATORY)
- NO native npm/python on host — Docker containers only
- Same commands locally and in CI — no drift
- No `node_modules`, no `.venv`, no global packages on host

## Compose Isolation (MANDATORY)
- Use `ENV=<branch-slug>` as short alias; always pass as LAST argument to `make`
- Never use shell-prefix: `ENV=... make ...` is FORBIDDEN
- Before starting services, verify ports are free or owned by same project
- Override ports: `API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`; keep `VITE_API_BASE_URL` aligned
- Example: `make dev API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1081 ENV=feat-xxx`

## Branch Scope Control (MANDATORY)
- Every branch declares `Allowed Paths`, `Forbidden Paths`, `Conditional Paths` in `BRANCH.md`
- Default forbidden: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- Scope exceptions require `BRxx-EXn` with rationale + impact + rollback
- Use `plan/BRANCH_TEMPLATE.md` for `BRANCH.md` creation
- For complex branches, use `spec/BRANCH_SPEC_EVOL.md` (consolidate before tests, then delete)

## Orchestration Modes (choose one)
- **Mono-branch + cherry-pick**: sub-agents in isolated branches; cherry-pick into main; one test cycle
- **Multi-branch**: CI per branch; merge/cherry-pick; multiple test cycles
- Multi-need TODO items MUST use multi-branch with `PLAN.md`

## Commit Discipline (MANDATORY)
- Atomic: one logical change per commit, max 10-15 files
- Selective staging: `git add <specific-files>` — NEVER `git add .` or `git add -A`
- Commit command: `make commit MSG="type: concise description"` (single line only)
- Never use `git commit` directly (avoids co-authoring trailer)
- Update `BRANCH.md` checkboxes WITHIN each commit (`git add BRANCH.md` alongside work files)

## WARNING — Top 5 Most-Violated Rules
- VERIFY BRANCH before any work: `git -C <worktree> branch --show-current` — BR-04B lost 10+ commits on wrong branch
- Commits MUST stay under 150 lines — BR-04 Lot 6: 743 lines/15 files uncommitted = disaster
- BRANCH.md MUST follow `plan/BRANCH_TEMPLATE.md` strictly — no `###`, no prose, checkbox only
- SPLIT git add and git commit into separate calls — never combine
- ALWAYS pass ALL ports (API_PORT, UI_PORT, MAILDEV_UI_PORT) to subagents — missing ONE kills dev environment
- NEVER run `make clean-all` — destroyed all Docker volumes including dev DB
- NEVER test on ENV=dev — afterEach hooks purge real data (2026-03-14: chat messages destroyed)
- NEVER increase E2E timeouts — masks bugs; UI waits should be <2s except AI generation
- CI was green on main — any branch failure IS a branch problem, never claim "pre-existing"
- No legacy fallback — delete old code when replacing with new system

## Language Policy
- All code, comments, commits, PR titles, API schemas, errors: **English**
- All Markdown/MDC files: **English**
- Discuss with user in **French** (or English if requested)

## Other Rules Files
- `rules/workflow.md` — branching, commits, PR, orchestration (loads on `plan/**`, `BRANCH.md`)
- `rules/conductor.md` — conductor orchestration, steering, launch packets (loads on `plan/**`)
- `rules/subagents.md` — sub-agent contract, execution, reporting (loads on `plan/**`)
- `rules/testing.md` — test pyramid, CI, environment isolation (loads on `**/tests/**`, `e2e/**`)
- `rules/security.md` — SAST, SCA, container scanning, vulnerability register (loads on `.security/**`)

## Debug & Inspection Make Targets
- State: `make ps`, `make ps-all`
- Logs: `make logs`, `make logs-<service>` (e.g., `make logs-ui`, `make logs-api`)
- Database: `make db-query QUERY="SELECT ..."`, `make db-status`
- Shell/Exec: `make sh-ui`, `make sh-api`, `make exec-ui CMD="..."`, `make exec-api CMD="..."`
- Dev: `make dev`, `make down`, `make openapi-json`, `make openapi-html`
