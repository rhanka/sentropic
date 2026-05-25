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

## Feedback Loop (open framing questions)
- **BR40c-Q1** `attention`: delivery pattern + quadrant tab content. (1) Delivery: async job mirroring
  DOCX (`POST /xlsx/generate` → poll → `GET /xlsx/jobs/:id/download`, S3-stored) vs synchronous
  in-request download (simpler, no queue). (2) Quadrant tab: data-only (each use case with its
  value/complexity scores + computed quadrant label, sorted by priority) vs additionally embedding a
  rendered chart image. Stakes: async matches the existing pattern + handles large folders but is
  heavier; an embedded chart image needs a server-side render path. Recommendation: async job +
  data-only quadrant tab (chart image deferred). Needs user decision before Lot 1.
- **BR40c-Q2** `clarification`: use-cases tab columns — propose name, domain, status, description,
  problem, solution, total value score, total complexity score, quadrant. Confirm or adjust.

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

## Plan / Todo (lot-based) — DRAFT pending BR40c-Q1/Q2
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `TODO.md`, `PLAN.md`, this branch file.
  - [ ] Study the DOCX/PPTX async pattern (`api/src/routes/api/docx.ts`, `services/docx-generation.ts`,
        `services/queue-manager.ts`) to mirror it exactly.
  - [ ] Create worktree `tmp/feat-folder-xlsx-export` from `main`; confirm slot-2 ports + `ENV=...` last.
  - [ ] Resolve BR40c-Q1/Q2 before Lot 1.

- [ ] **Lot 1 — XLSX generation service**
  - [ ] Add `exceljs` via `make install-api exceljs`; bump nothing else.
  - [ ] `services/xlsx-generation.ts`: fetch folder + initiatives + matrix; build workbook with 3 tabs
        (use cases / evaluation matrix / prioritization quadrant) per BR40c-Q1/Q2.
  - [ ] Lot gate: `make typecheck-api` + `make lint-api`; unit test on workbook structure.

- [ ] **Lot 2 — Route + queue wiring**
  - [ ] `routes/api/xlsx.ts` mirroring DOCX endpoints; register in `routes/api/index.ts`.
  - [ ] Queue job type `xlsx_generate` in `queue-manager.ts` (S3 result if async chosen).
  - [ ] Lot gate: `make typecheck-api` + `make lint-api`; `api/tests/api/xlsx.test.ts`.

- [ ] **Lot 3 — UI export entry point**
  - [ ] Add the xlsx export action in `folders/[id]/+page.svelte` + `stores/folders.ts`; i18n labels.
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`; UI store spec.

- [ ] **Lot 4 — E2E**
  - [ ] Create folder with scored use cases → export xlsx → download → verify 3 tabs.
  - [ ] Lot gate: scoped `make test-e2e` on `07-import-export.spec.ts` with slot-2 ports.

- [ ] **Lot N-2 — UAT** (export a folder, open xlsx, verify the 3 tabs; non-reg: existing ZIP/DOCX/PPTX export).
- [ ] **Lot N-1 — Docs consolidation** (update export spec).
- [ ] **Lot N — Final validation** (typecheck/lint, API/UI/E2E retests, package bumps if any, PR → CI →
      remove `BRANCH.md` → merge via merge commit).
