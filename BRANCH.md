# Feature: BR-40c Folder XLSX Multi-Tab Export

## Objective
Add a multi-tab xlsx export of a folder (use cases / evaluation matrix / prioritization quadrant),
mirroring the existing async DOCX/PPTX queue-job delivery, with a NATIVE editable scatter chart and
LIVE cross-sheet Excel formulas for the score and quadrant cells (matrix-driven, recompute on edit).

## Scope / Guardrails
- Scope limited to a new xlsx generation service + route, queue wiring, and a folder UI export entry.
- One migration max in `api/drizzle/*.sql` (none expected; declare exception if needed).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/feat-folder-xlsx-export`.
- Test campaigns run on `ENV=test-feat-folder-xlsx-export` / `ENV=e2e-feat-folder-xlsx-export`.
- UAT worktree must be commit-identical (same HEAD SHA) to the branch under qualification.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/40c-BRANCH_feat-folder-xlsx-export.md`
  - `api/package.json` (+ `package-lock.json`)
  - `api/src/routes/api/xlsx.ts`
  - `api/src/routes/api/index.ts`
  - `api/src/services/xlsx-generation.ts`
  - `api/src/services/xlsx-chart.ts`
  - `api/src/services/queue-manager.ts`
  - `api/src/utils/scoring.ts` (reuse only)
  - `api/tests/api/xlsx.test.ts`
  - `ui/src/routes/folders/[id]/+page.svelte`
  - `ui/src/lib/stores/folders.ts`
  - `ui/src/lib/components/ImportExportDialog.svelte` (only if export entry reused there)
  - `ui/src/locales/en.json`, `ui/src/locales/fr.json`
  - `ui/tests/**`
  - `e2e/tests/07-import-export.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/src/db/schema.ts`
- **Conditional Paths (allowed only with explicit `BR40c-EXn` exception)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `api/src/services/flow/postgres-job-queue.ts` (queue-class CASE) — see BR40c-EX1
  - `spec/COLLAB.md` (export spec sync) — see BR40c-EX2
- **Exception process**: declare `BR40c-EXn` in `## Feedback Loop` with reason, impact, rollback.

## Feedback Loop
- **BR40c-Q1** `acknowledge`: delivery = async job mirroring DOCX (`POST /xlsx/generate` → poll →
  `GET /xlsx/jobs/:id/download`, S3-stored). Quadrant tab keeps a NATIVE editable XY scatter chart
  injected via raw OOXML (`xl/charts/chart1.xml` + drawing rels), not a static image. RESOLVED: keep
  async + native chart (`api/src/services/xlsx-chart.ts`); do not simplify to data-only.
- **BR40c-Q2** `acknowledge`: use-cases columns confirmed — name, domain, status, description,
  problem, solution, total value score, total complexity score, quadrant.
- **BR40c-REQ1a** `acknowledge`: score and quadrant cells are LIVE Excel formulas with cross-sheet
  references to the matrix tab, replacing the static JS-computed values. Implemented via exceljs
  `cell.value = { formula, result }`: value/complexity scores are ROUND weighted-mean formulas that
  reference `'Evaluation matrix'!$B$<row>` weight cells; use-cases quadrant cells are IF/MEDIAN
  formulas over the score columns; quadrant tab value/complexity cells are cross-sheet refs to the
  use-cases score cells, and its quadrant label is an IF/MEDIAN formula. Cached results keep values
  (and the chart) correct before any recalc.
- **BR40c-REBASE** `acknowledge`: WIP (6 commits) rebased onto `origin/main` (`067f8ced`, PR #181) —
  186 commits behind merge-base `1f7f1e11`. Conflicts resolved mechanically: `api/package.json`
  build script took main's line (drops removed `nodemailer` external) + added `--external:exceljs`;
  `package-lock.json` reset to main's base then regenerated via `make lock-root` (exceljs + uuid +
  saxes + readable-stream resolved). Other predicted conflict files (queue-manager, index.ts,
  locales) auto-merged cleanly. Post-rebase: `make typecheck-api` + `make lint-api` green.
- **BR40c-EX1** `acknowledge`: edit `api/src/services/flow/postgres-job-queue.ts` (one-line
  `WHEN 'xlsx_generate' THEN 'publishing'` in the queue-class CASE). Reason: single source of truth
  routing job type → publishing queue class; no extension hook. Impact: one CASE branch mirroring
  `docx_generate`. Rollback: remove the line.
- **BR40c-EX2** `acknowledge`: edit `spec/COLLAB.md` — add a "Folder XLSX Export (BR-40c)" subsection
  under Import/Export. Reason: workflow rule requires keeping `spec/*.md` in sync. Impact:
  documentation only, additive. Rollback: remove the subsection.
- **BR40c-Sec1** `acknowledge`: `exceljs@4.4.0` pulls transitive MODERATE advisories (`uuid`
  GHSA-w5hq-g745-h8pq, `ws` GHSA-58qx-3vcg-4xpx). The SCA/container compliance parser gates only
  `high`/`critical`; no `vulnerability-register.yaml` entry required. Fixing needs `exceljs@3.4.0`
  (breaking downgrade), not adopted.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as
  `flaky accepted`; at least one success on the same commit + command; never add timeouts; record
  command + failing file + signature in `BRANCH.md`; capture user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: one export capability (service + route + UI button).

## UAT Management (in orchestration context)
- Development worktree: `tmp/feat-folder-xlsx-export`.
- Branch ports (slot 2): `API_PORT=9202`, `UI_PORT=5402`, `MAILDEV_UI_PORT=1302`.
- Test envs: `ENV=test-feat-folder-xlsx-export`, `ENV=e2e-feat-folder-xlsx-export`.
- Root UAT env: `ENV=dev`, commit-identical to branch HEAD.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline, async pattern & chart-lib spike**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`,
        `README.md`, `PLAN.md`, this branch file, `plan/BRANCH_TEMPLATE.md`.
  - [x] Study the DOCX/PPTX async pattern (`docx.ts`, `docx-generation.ts`, `queue-manager.ts`).
  - [x] Confirm slot-2 ports + `ENV=...` last.
  - [x] Adopt `exceljs` (4.4.0, MIT) + OOXML chart-part injection. No PNG fallback.

- [x] **Lot R — Rebase onto origin/main**
  - [x] `git fetch origin main`; rebase 6 WIP commits onto `067f8ced` (186 behind merge-base).
  - [x] Resolve `api/package.json` (build script) + `package-lock.json` (via `make lock-root`).
  - [x] Inspect/keep stale `spec/COLLAB.md` (genuine BR-40c export spec); `BRANCH.md` regenerated.
  - [x] Validate: `make typecheck-api` (pass), `make lint-api` (0 errors), baseline xlsx test (pass).

- [x] **Lot 1 — XLSX generation service (3 tabs + native quadrant chart)**
  - [x] `exceljs` dep + `--external:exceljs` in api build.
  - [x] `xlsx-generation.ts`: fetch folder + initiatives + matrix; 3 tabs per BR40c-Q1/Q2.
  - [x] Native XY scatter chart via OOXML injection (`xlsx-chart.ts`).

- [x] **Lot 2 — Route + queue wiring**
  - [x] `routes/api/xlsx.ts` mirroring DOCX; registered in `routes/api/index.ts`.
  - [x] Queue job type `xlsx_generate` in `queue-manager.ts` (S3 result); publishing class via EX1.

- [x] **Lot 3 — UI export entry point**
  - [x] xlsx export action in `folders/[id]/+page.svelte` + `stores/folders.ts`; i18n labels.

- [x] **Lot 4 — Live cross-sheet formulas (BR40c-REQ1a)**
  - [x] `xlsx-generation.ts`: matrix sheet emits axis weight cell anchors; use-cases score cells =
        ROUND weighted-mean cross-sheet formulas; use-cases + quadrant tab quadrant cells = IF/MEDIAN
        formulas; quadrant value/complexity = cross-sheet refs to use-cases score cells; chart still
        live via cached results.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-feat-folder-xlsx-export` (pass)
    - [x] `make lint-api ENV=test-feat-folder-xlsx-export` (0 errors)
    - [x] **API tests** — `api/tests/api/xlsx.test.ts`:
      - [x] Existing: job enqueue/reuse/locale, 409/400/422 download, S3 bytes, 3-tab + native chart.
      - [x] New read-back tests (reopen workbook with exceljs):
        - [x] `writes live cross-sheet score formulas referencing the matrix tab`
        - [x] `writes live quadrant formulas (IF/MEDIAN) on both score-bearing tabs`
        - [x] `produces no formula-error tokens anywhere in the workbook` (#REF!/#DIV-0!/#VALUE!/…)
      - [x] Sub-lot gate: `make test-api-endpoints SCOPE=tests/api/xlsx.test.ts ENV=test-feat-folder-xlsx-export` (12 passed)

- [ ] **Lot 5 — E2E**
  - [ ] `e2e/tests/07-import-export.spec.ts`: create folder with scored use cases → export xlsx →
        download → verify 3 tabs + score/quadrant cells carry `=` formulas.
  - [ ] Lot gate:
    - [ ] Build: `make build-api build-ui-image API_PORT=9202 UI_PORT=5402 MAILDEV_UI_PORT=1302 ENV=e2e-feat-folder-xlsx-export`
    - [ ] Scoped: `make test-e2e E2E_SPEC=tests/07-import-export.spec.ts API_PORT=9202 UI_PORT=5402 MAILDEV_UI_PORT=1302 ENV=e2e-feat-folder-xlsx-export`
    - [ ] `make clean ... ENV=e2e-feat-folder-xlsx-export` before/after the pass.

- [ ] **Lot N-2 — UAT (web app)**
  - [ ] Open the folder page; trigger the xlsx export; poll job; download the workbook.
  - [ ] Evolution: open xlsx → 3 tabs present (use cases / evaluation matrix / prioritization
        quadrant); score and quadrant cells contain `=` formulas that recompute when a matrix weight
        is edited; native scatter chart renders and is editable.
  - [ ] Non-reg: existing ZIP, DOCX, PPTX folder exports still work unchanged.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] `spec/COLLAB.md` "Folder XLSX Export (BR-40c)" subsection in sync with behavior (BR40c-EX2),
        including the live-formula behavior.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (api + ui).
  - [ ] Retest API: `make test-api ENV=test-feat-folder-xlsx-export`.
  - [ ] Retest UI: `make test-ui ENV=test`.
  - [ ] Retest E2E: `make clean test-e2e ... ENV=e2e-feat-folder-xlsx-export`.
  - [ ] Package bumps if any `packages/<pkg>/src/**` changed (none expected).
  - [ ] Final gate (conductor): PR using `BRANCH.md` body → CI green + UAT → remove `BRANCH.md` →
        merge via merge commit.
