---
description: "Development workflow, branching, commits, PR, orchestration"
alwaysApply: false
paths: ["plan/**", "**/BRANCH.md", "PLAN.md"]
globs: ["plan/**", "**/BRANCH.md", "PLAN.md"]
tags: [workflow]
---

# WORKFLOW

## Read Order
1. `rules/MASTER.md` (consolidated rules)
2. `README.md` (project overview)
3. `TODO.md` (current priorities)
4. `PLAN.md` (branch dependencies, waves, statuses — when present)
5. `BRANCH.md` (current branch plan — when present)
6. Relevant `spec/*.md` files for current scope

## FEATURE Flow (lean)
1. Read target `TODO.md` item (Next or Now)
2. Create `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` — first iteration must be detailed:
   - Lot-by-lot actionable tasks (no placeholders)
   - API/UI/E2E test plans at file granularity (existing + updated + new)
   - Detailed UAT checklists by surface (web app / chrome plugin / vscode plugin)
   - Blockers/decisions in `## Feedback Loop`
3. Follow lot-based flow (UAT lots -> docs consolidation -> final tests)
4. Constraints:
   - One migration file max in `api/drizzle/*.sql`
   - Tests listed exhaustively by scope and file
   - Branch scope boundaries mandatory (`Allowed`/`Forbidden`/`Conditional` paths)
   - Exception process with `BRxx-EXn`
5. Post 3-6 step plan as first PR comment
6. Keep `spec/*.md` in sync with behavior changes

## PR Creation (MANDATORY)
- Timing: just before CI trigger (first or final push)
- Source: exact text of `BRANCH.md` for PR title/body
- Format: English, include test plan from `BRANCH.md`
- Merge-prep sequence:
  1. Create/update PR with `BRANCH.md` as body
  2. Complete UAT + CI gates
  3. When both OK: commit deletion of `BRANCH.md`, push, merge

## Orchestration
- Main agent = orchestrator; sub-agents = orthogonal tasks only
- Each sub-agent: isolated branch or repo copy, distinct `ENV` + ports
- Orchestrator collects decision brief from each sub-agent
- Orchestrator is the only one integrating changes into main branch
- Mode recorded in `BRANCH.md`: mono-branch or multi-branch

## Multi-Branch Orchestration (MANDATORY for multi-need)
- Split multi-need TODO items into one branch per need
- Create `PLAN.md` at repo root before implementation:
  - Branch list with dependency graph
  - Waves: max 4 branches per wave, all orthogonal
  - Link to each `tmp/<branch-slug>/BRANCH.md`
  - Port allocation convention
- Phase 1 (Lot 0): read-only scoping, consolidate blockers
- Phase 2: implementation sub-agents (one per branch, parallel within wave)
- Phase 3: integrate, run final gates, create PRs

## Tmp Workspace Setup (MANDATORY for multi-branch)
- Each branch: own `tmp/<branch-slug>/` worktree
- Atomic setup sequence:
  ```bash
  git worktree remove tmp/<slug> 2>/dev/null || true
  git worktree add -b <branch> tmp/<slug> main
  cd tmp/<slug>
  cp ../../.env .env  # then override ENV, ports in .env
  ```
- Write `BRANCH.md` AFTER worktree creation (never before)
- Port isolation: distinct `ENV`, `API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT` per worktree

## Sub-Agent Implementation Prompt (MANDATORY)
Include in every implementation sub-agent prompt:
1. **Mandatory reading**: `rules/MASTER.md` + `rules/workflow.md` + scope-relevant rules
2. **Commit rule**: `make commit MSG="type: description"` only; never `git commit`
3. **Staging**: `git add <file1> <file2>` then `make commit`; never `git add .`
4. **Env cleanup**: `make down ENV=<branch-env>` at end of each lot
5. **Planning depth**: detailed lots, file-level test lists, UAT checklist
6. **Branch refs**: read `PLAN.md`, `spec/*.md`, align with `plan/BRANCH_TEMPLATE.md`

## Commit Guidelines
- Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- Atomic: one logical change per commit
- Max 10-15 files per commit
- Commit every 2-3 logical changes; commit before major work
- `make commit MSG="type: concise description"` (single line, mandatory)
- Consolidate CI debug commits: `git reset --soft HEAD~N` + single `make commit`

## Development Conventions
- Branches: `feat/<slug>`, `fix/<slug>`, `boot/<slug>` — one at a time
- PR: one capability per PR; checklist; clear description
- Never proceed more than one `TODO.md` item
- Be minimalist in changes (avoid broad refactors)
- English for commits, PR descriptions, code, comments

## Quality Gates
- Before UAT lot: `make typecheck-<ui/api>` + `make lint-<ui/api>`
- Before final tests: `make build-api build-ui-image`
- Final tests: `make test-api`, `make test-ui`, `make clean test-e2e`
- AI flaky allowlist (non-blocking, must document failure signature + user sign-off)

## Feature Completion
- Follow final lots in `BRANCH.md`
- Close/defer all `Feedback Loop` items with owner/date
- Ensure no unauthorized scope drift
- Final: PR -> UAT + CI green -> remove `BRANCH.md` -> push -> merge

## CI Monitoring (MANDATORY)
- After push: verify GitHub Actions via curl or `gh` CLI
- Push command: `git push origin <branch-name>` (never `--set-upstream`)
- Consolidate debug commits with `git reset --soft HEAD~N` + `make commit`

## Guardrails
- Never destructive DB/system actions without "approval"
- Before UAT lot: `make typecheck` + `make lint` for impacted components
- Before handoff: `make logs-<service>` to verify no runtime errors
- Update UAT checklist in `BRANCH.md` before handoff

## UI/UX Feedback Loop (MANDATORY)
- Track anomalies in `BRANCH.md` via `## Feedback Loop`
- Fields: ID, Branch, Owner, Severity, Status, Repro steps, Expected, Actual, Evidence
- Processing: reproduce -> focused checks -> fix -> rerun -> update item
- Escalate only for product/UX decisions, missing credentials, contradictory specs
- Batch questions once per lot

> WARNING: Subagents must commit every ~150 lines. BR-04 Lot 6: 743 lines/15 files uncommitted = disaster.

> WARNING: NEVER `make clean-all` on root — destroyed all Docker volumes including dev DB. Use `make clean ENV=<branch-env>` or `make down ENV=<branch-env>` only.

> WARNING: BRANCH.md must follow `plan/BRANCH_TEMPLATE.md` strictly — no `###`, no prose, checkbox only. Bugs go in `## Feedback Loop`, defers in `## Deferred to BR-XX`.

> WARNING: CI was green on main. Any branch failure IS a branch problem. Never claim "pre-existing". Investigate: evolution (adapt test) or regression (fix code).

> WARNING: After commit on root during multi-agent: `git -C tmp/<slug> reset --hard HEAD` to keep worktree aligned.

> WARNING: No "probably/maybe" in analysis — verify with grep/diff/DB query. No backward-compat patches unless explicitly asked.

> WARNING: When user says "aligned with X", copy X's exact pattern line by line. Don't reinvent or "improve" the reference.

> WARNING: No legacy fallback — delete old code when replacing with new system. Zero dual paths.
