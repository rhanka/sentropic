# Chore: BR-40 Prioritization & Sheets Trio (documentation umbrella)

## Objective
Register and document three orthogonal feature branches as a coordinated wave under the
"prioritization & sheets" theme. This branch is **documentation-only**: it adds the BR-40a/b/c
branch plans, registers them in `PLAN.md` (catalog, dependency graph, port slots, wave), and
captures the open framing questions to resolve before implementation. No code changes.

## Trio scope
- **BR-40a `feat/prioritization-matrix-scale`** — raise the per-folder use-case cap to 50 and make
  the prioritization-matrix chart legible at scale: label only the top-10 (by value/complexity
  priority), add a "hide bubbles" toggle, and add a business-domain-filterable legend with
  hover-driven domain emphasis.
- **BR-40b `feat/xlsx-multitab-query`** — correctly handle multi-tab (multi-sheet) xlsx sources for
  both indexing and the documentary query tool, building on the in-flight `feat/xlsx-gsheet-indexing`
  branch (already does multi-sheet text extraction + Google Sheets → xlsx export, UAT-ready, unmerged).
- **BR-40c `feat/folder-xlsx-export`** — add a multi-tab xlsx export of a folder: one tab for use
  cases, one tab for the evaluation matrix, one tab for the prioritization quadrant.

## Orchestration Mode
- [x] **Multi-branch** (mandatory per `rules/MASTER.md` — multi-need item; each sub-branch has its own
  CI cycle and worktree).
- [ ] Mono-branch + cherry-pick
- Rationale: three orthogonal capabilities across distinct file areas (UI scatter plot + executive
  summary backend for 40a; document-text/query tooling for 40b; new xlsx export route/service +
  export button for 40c). Run as one wave of three parallel sub-agents.

## Wave & Port Allocation (branch nn = 40)
- Slot ports: API `9000 + (40*5) + slot` = `9200..9204`; UI `5200 + (40*5) + slot` = `5400..5404`;
  Maildev UI `1100 + (40*5) + slot` = `1300..1304`.
- BR-40a slot 0: `API_PORT=9200`, `UI_PORT=5400`, `MAILDEV_UI_PORT=1300`, worktree `tmp/feat-prioritization-matrix-scale`.
- BR-40b slot 1: `API_PORT=9201`, `UI_PORT=5401`, `MAILDEV_UI_PORT=1301`, worktree `tmp/feat-xlsx-multitab-query`.
- BR-40c slot 2: `API_PORT=9202`, `UI_PORT=5402`, `MAILDEV_UI_PORT=1302`, worktree `tmp/feat-folder-xlsx-export`.
- Root dev/UAT stays on API `8787`, UI `5173`, Maildev `1080` (reserved for user).

## Dependency graph
- BR-40a — independent.
- BR-40b — depends on the disposition of `feat/xlsx-gsheet-indexing` (see BR40b-Q1).
- BR-40c — independent (may consume xlsx libraries; uses its own writer path, orthogonal to 40b's reader path).

## Branch Scope Boundaries (this chore branch)
- **Allowed Paths**:
  - `plan/40-BRANCH_chore-priorization-sheets.md`
  - `plan/40a-BRANCH_feat-prioritization-matrix-scale.md`
  - `plan/40b-BRANCH_feat-xlsx-multitab-query.md`
  - `plan/40c-BRANCH_feat-folder-xlsx-export.md`
  - `PLAN.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, any `api/**`, `ui/**`,
  `packages/**`, `e2e/**`, other `plan/NN-BRANCH_*.md`.
- No code, no migration, no test changes in this branch.

## Feedback Loop (open framing questions — to resolve before implementation)
- **BR40a-Q1** `attention`: ranking metric for the "top-10" labels (highest value? lowest complexity?
  combined priority score?). See BR-40a plan.
- **BR40a-Q2** `attention`: bubble color semantics — keep current status-based colors and add a separate
  domain legend, or recolor bubbles by business domain. See BR-40a plan.
- **BR40b-Q1** `attention`: disposition of `feat/xlsx-gsheet-indexing` (merge-first / absorb / rename).
  See BR-40b plan.
- **BR40c-Q1** `attention`: export delivery pattern (async job mirroring DOCX vs synchronous download)
  and prioritization-quadrant tab content (data-only vs embedded chart image). See BR-40c plan.

## Closure
- [x] Four plan files added.
- [x] `PLAN.md` updated (catalog, status addendum, dependency graph, port slots, branch pointers).
- [ ] PR created with this file as body; merged via merge commit (squash/rebase disabled per §0).
- [ ] After merge: spawn BR-40a/b/c worktrees; resolve framing questions; begin Lot 0.
