# Feature: BR-40c Folder XLSX Multi-Tab Export

## Objective
Add a multi-tab xlsx export of a folder: one tab for the use cases, one tab for the evaluation
matrix (scoring grid), and one tab for the prioritization quadrant. Mirror the existing async
document-generation pattern (DOCX/PPTX queue jobs) rather than inventing a new delivery mechanism.

## Scope / Guardrails
- Scope limited to: a new xlsx generation service + route, queue wiring, and a folder UI export entry
  point. No changes to use-case/matrix data models.
- Make-only workflow; root `ENV=dev` stays stable; work in `tmp/feat-folder-xlsx-export`.
- Tests on `ENV=test-feat-folder-xlsx-export` / `ENV=e2e-feat-folder-xlsx-export`; `ENV` last.
- One migration max in `api/drizzle/*.sql` — not expected; declare exception if needed.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/40c-BRANCH_feat-folder-xlsx-export.md`
  - `api/package.json` (+ `package-lock.json`) — add xlsx writer (`exceljs` recommended).
  - `api/src/routes/api/xlsx.ts` (new)
  - `api/src/routes/api/index.ts` (route registration)
  - `api/src/services/xlsx-generation.ts` (new)
  - `api/src/services/queue-manager.ts` (job type `xlsx_generate`)
  - `api/src/utils/scoring.ts` (reuse only; read-only if possible)
  - `api/tests/api/xlsx.test.ts` (new) + related test fixtures
  - `ui/src/routes/folders/[id]/+page.svelte`
  - `ui/src/lib/stores/folders.ts`
  - `ui/src/lib/components/ImportExportDialog.svelte` (only if export entry reused there)
  - `ui/src/locales/en.json`, `ui/src/locales/fr.json`
  - `ui/tests/**` (export store specs)
  - `e2e/tests/07-import-export.spec.ts`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` except this branch file
  - `api/src/db/schema.ts`
- **Conditional Paths (explicit `BR40c-EXn` exception required)**:
  - `api/drizzle/*.sql` (max 1 file) — only if a new job type needs a schema/enum change.
  - `.github/workflows/**` — only if a new dependency needs CI wiring.
- **Exception process**: declare `BR40c-EXn` in `## Feedback Loop` with reason, impact, rollback.

## Feedback Loop (framing questions — RESOLVED 2026-05-25)
- **BR40c-Q1** `acknowledge`: delivery = **async job mirroring DOCX** (`POST /xlsx/generate` → poll →
  `GET /xlsx/jobs/:id/download`, S3-stored). Quadrant tab = **data + a NATIVE editable chart generated
  inside the xlsx** (NOT a static image). Verified constraint: `exceljs` can read but cannot WRITE
  charts (long-standing limitation, exceljs issues #141/#1569). Conductor-decided approach (user gave
  autonomy on this point): use `exceljs` for all data/tabs, then **inject the chart OOXML part**
  (`xl/charts/chart1.xml` + drawing relationships) for a native XY scatter / bubble chart referencing
  the quadrant sheet's value/complexity cell ranges. Lot 0 does a short **ExcelForge spike** (a TS lib
  that claims native scatter/bubble + multi-sheet data); adopt it only if it cleanly handles both our
  data tabs and a native chart, else fall back to `exceljs` + OOXML injection. No PNG image fallback.
- **BR40c-Q2** `acknowledge`: use-cases tab columns confirmed — name, domain, status, description,
  problem, solution, total value score, total complexity score, quadrant.
- **BR40c-Lot0** `acknowledge`: spike conclusion — `excelforge` does NOT exist on npm (404);
  `@node-projects/excelforge` exists but makes no documented chart claim. exceljs (4.4.0, MIT) +
  OOXML chart injection proven in a throwaway spike: native `<c:scatterChart>` referencing the
  quadrant sheet ranges, content-types registered, exceljs re-reads all 3 sheets intact. Adopted
  `exceljs` + OOXML injection as decided. No PNG fallback.
- **BR40c-EX1** `acknowledge`: edit `api/src/services/flow/postgres-job-queue.ts` (not in Allowed
  Paths) — one-line addition `WHEN 'xlsx_generate' THEN 'publishing'` to the queue-class CASE
  expression. Reason: this in-repo adapter is the single source of truth that routes a job type to
  the publishing queue class; there is no extension hook. Impact: one SQL CASE branch, mirrors the
  existing `docx_generate` line, no behavior change for other types. Rollback: remove the line.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism; one success on
  same commit + command; never add timeouts; record signature + user sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**.
- [ ] Multi-branch
- Rationale: one export capability (service + route + UI button); single final test cycle.

## UAT Management (in orchestration context)
- Development worktree: `tmp/feat-folder-xlsx-export`.
- Branch ports (slot 2): `API_PORT=9202`, `UI_PORT=5402`, `MAILDEV_UI_PORT=1302`.
- Test envs: `ENV=test-feat-folder-xlsx-export`, `ENV=e2e-feat-folder-xlsx-export`.
- Root UAT env: `ENV=dev`, commit-identical to branch HEAD.

## Plan / Todo (lot-based) — framing RESOLVED (async + native chart), ready to execute
- [x] **Lot 0 — Baseline, async pattern & chart-lib spike**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `TODO.md`, `PLAN.md`, this branch file.
  - [x] Study the DOCX/PPTX async pattern (`api/src/routes/api/docx.ts`, `services/docx-generation.ts`,
        `services/queue-manager.ts`) to mirror it exactly.
  - [x] Confirm slot-2 ports + `ENV=...` last.
  - [x] **ExcelForge spike**: disproved (`excelforge` is 404 on npm). Adopted `exceljs` + OOXML
        chart-part injection; proven by throwaway spike (see BR40c-Lot0). No PNG fallback.

- [x] **Lot 1 — XLSX generation service (3 tabs + native quadrant chart)**
  - [x] Add the chosen writer via `make install-api exceljs`; `--external:exceljs` in api build.
  - [x] `services/xlsx-generation.ts`: fetch folder + initiatives + matrix; build workbook with 3 tabs
        (use cases / evaluation matrix / prioritization quadrant). Use-cases columns per BR40c-Q2.
  - [x] Quadrant tab: data rows (value/complexity + computed quadrant label, sorted by priority) PLUS a
        NATIVE XY scatter chart referencing those cell ranges via OOXML injection (`services/xlsx-chart.ts`).
  - [x] Lot gate: `make typecheck-api` (pass); `make lint-api` + unit test in Lot 2 gate.

- [x] **Lot 2 — Route + queue wiring**
  - [x] `routes/api/xlsx.ts` mirroring DOCX endpoints; registered in `routes/api/index.ts`.
  - [x] Queue job type `xlsx_generate` in `queue-manager.ts` (S3 result); publishing class via EX1.
  - [x] Lot gate: `make typecheck-api` (pass) + `make lint-api` (0 errors); `api/tests/api/xlsx.test.ts` (9 pass).

- [ ] **Lot 3 — UI export entry point**
  - [x] Add the xlsx export action in `folders/[id]/+page.svelte` + `stores/folders.ts`; i18n labels.
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`; UI store spec.

- [ ] **Lot 4 — E2E**
  - [ ] Create folder with scored use cases → export xlsx → download → verify 3 tabs.
  - [ ] Lot gate: scoped `make test-e2e` on `07-import-export.spec.ts` with slot-2 ports.

- [ ] **Lot N-2 — UAT** (export a folder, open xlsx, verify the 3 tabs; non-reg: existing ZIP/DOCX/PPTX export).
- [ ] **Lot N-1 — Docs consolidation** (update export spec).
- [ ] **Lot N — Final validation** (typecheck/lint, API/UI/E2E retests, package bumps if any, PR → CI →
      remove `BRANCH.md` → merge via merge commit).
