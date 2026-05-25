# Feature: BR-40a Prioritization Matrix at Scale

## Objective
Raise the per-folder use-case cap to 50 and keep the prioritization-matrix chart legible at that
scale: label only the top-10 use cases (by value/complexity priority), add a "hide bubbles" toggle
that keeps the chart usable via hover alone, and add a business-domain-filterable legend with
hover-driven emphasis (hovering a point or a domain enlarges the points of that business domain).

## Scope / Guardrails
- Scope limited to: per-folder use-case cap, the scatter-plot chart UX (labels, bubbles toggle,
  domain legend/filter, hover emphasis), and the executive-synthesis chart rendering parity.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` reserved for user dev/UAT (`ENV=dev`); stays stable.
- Branch development in isolated worktree `tmp/feat-prioritization-matrix-scale`.
- Automated tests run on `ENV=test-feat-prioritization-matrix-scale` / `ENV=e2e-feat-prioritization-matrix-scale`.
- `ENV=<env>` passed last in every `make` command.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/40a-BRANCH_feat-prioritization-matrix-scale.md`
  - `ui/src/lib/components/InitiativeScatterPlot.svelte`
  - `ui/src/lib/utils/scoring.ts`
  - `ui/src/locales/en.json`
  - `ui/src/locales/fr.json`
  - `ui/tests/**` (scatter-plot / scoring specs)
  - `api/src/services/executive-summary.ts` (use-case cap + top-cases selection)
  - `api/src/services/docx-service.ts` (executive-synthesis chart context parity, if needed)
  - `api/tests/**` (executive-summary specs)
  - `e2e/tests/**` (folder / prioritization specs)
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` except this branch file
  - `api/src/db/schema.ts` (no schema change expected)
- **Conditional Paths (explicit `BR40a-EXn` exception required)**:
  - `api/drizzle/*.sql` (max 1 file) — only if the cap is enforced via a DB constraint rather than service validation.
  - `.github/workflows/**`
  - `api/src/routes/api/initiatives.ts` (generation `initiative_count` soft cap) — covered by **BR40a-EX1**.
  - `ui/src/routes/folder/new/+page.svelte` (generation count form clamp/attr) — covered by **BR40a-EX1**.
- **Exception process**: declare `BR40a-EXn` in `## Feedback Loop` with reason, impact, rollback.

## Feedback Loop (framing questions — RESOLVED 2026-05-25)
- **BR40a-Q1** `acknowledge`: top-10 ranking metric = **ratio `value / (complexity + ε)` with a cap**.
  Verified context: value and complexity are both normalized to the SAME 0-100 scale (weighted mean of
  Fibonacci-point ratings; API also exposes `ease = 100 − complexity`), and complexity CAN be 0. User
  chose the ratio (their usual "value per unit effort"); implementation MUST add an ε guard
  (e.g. `complexity + 1`) plus an upper cap so complexity≈0 cases do not explode/divide-by-zero.
  Document the exact ε and cap in code + tests.
- **BR40a-Q2** `acknowledge`: bubble color = **business domain** (`initiative.data.domain`). Status
  (currently `STATUS_COLORS` at `InitiativeScatterPlot.svelte:145`) moves to the tooltip and/or marker
  shape/border. The legend is the domain legend, filterable. Keep DOCX bitmap parity (Lot 4).
- **BR40a-Q3** `acknowledge`: cap = 50 is a **soft target** (generate/query up to 50; UI handles ≤50
  gracefully). No hard block, no DB constraint.
- **BR40a-EX1** `attention`: the per-folder generation cap is NOT in `executive-summary.ts` (verified:
  that service has no use-case cap, it processes all initiatives of a folder). The real soft cap lives
  in `api/src/routes/api/initiatives.ts:655` (`initiative_count` Zod `.max(25)`) and the UI generation
  form `ui/src/routes/folder/new/+page.svelte` (`max="25"`, clamp `25`). Both are outside the declared
  Allowed Paths. Reason: raising the soft cap to 50 (Lot 1, core objective) requires editing exactly
  these two files. Impact: minimal — single Zod bound + single UI clamp/attr; no schema/migration, no
  DB constraint (consistent with BR40a-Q3). Rollback: revert `.max(50)`→`.max(25)` and `max="50"`/
  clamp `50`→`25`. No other behavior touched.

## UAT Feedback
- **BR40a-UAT1** `fixed`: the "hide bubbles" toggle hid the data POINTS instead of the top-N TEXT
  label callouts. Fixed in `InitiativeScatterPlot.svelte`: points always render (subject to legend
  filter + hover emphasis); the toggle now suppresses only the label callouts (clean point cloud for
  hover-simple). DOCX snapshot forces labels on so the export keeps the top-N labels.
- **BR40a-UAT2** `attention` (separate brainstorm, conductor-owned): business `domain` is free-text
  from generation → ~45 distinct values, legend unusable. Needs a normalized business-domain taxonomy
  at generation time. Proposal handled outside this branch.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`;
  at least one success on the same commit + command; never add timeouts; record signature + user sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single frontend-centric capability + small backend cap change).
- [ ] Multi-branch
- Rationale: one chart/UX capability plus a bounded executive-summary cap change; one final test cycle.

## UAT Management (in orchestration context)
- Development worktree: `tmp/feat-prioritization-matrix-scale`.
- Branch ports (slot 0): `API_PORT=9200`, `UI_PORT=5400`, `MAILDEV_UI_PORT=1300`.
- Test envs: `ENV=test-feat-prioritization-matrix-scale`, `ENV=e2e-feat-prioritization-matrix-scale`.
- Root UAT env: `ENV=dev` on `/home/antoinefa/src/sentropic`, commit-identical to branch HEAD.

## Plan / Todo (lot-based) — framing RESOLVED, ready to execute
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `TODO.md`, `PLAN.md`, this branch file.
  - [ ] Create isolated worktree `tmp/feat-prioritization-matrix-scale` from `main`.
  - [ ] Confirm command style with slot-0 ports and `ENV=...` last.
  - [ ] Framing resolved (BR40a-Q1 ratio+ε, BR40a-Q2 color=domain, BR40a-Q3 soft cap) — see Feedback Loop.

- [x] **Lot 1 — Use-case cap to 50**
  - [x] Raise the per-folder cap to 50 in the generation path: `initiatives.ts` Zod `.max(50)` + `folder/new` form clamp/attr `50` (see BR40a-EX1; `executive-summary.ts` has no cap).
  - [x] Confirm no schema/migration needed; soft cap via Zod validation only (BR40a-Q3) — declared `BR40a-EX1` for the two out-of-Allowed-Paths files.
  - [x] Lot gate: `make typecheck-api` + `make lint-api` (0 errors); API test `initiatives-generate-matrix.test.ts` (12 passed, incl. accept-50 / reject-51).

- [x] **Lot 2 — Chart legibility at scale (labels + hide-bubbles)**
  - [x] Label only the top-10 use cases by ratio `value / (complexity + ε)` with cap (BR40a-Q1); ties broken by value. New pure helpers `computePriorityRatio` / `selectTopPriorityIndices` in `scoring.ts` (ε=1, cap=100); label plugin filters on `raw.isTopCase`.
  - [x] Add a "hide bubbles" toggle: when on, `pointRadius`/`pointHoverRadius`=0 but `pointHitRadius`=20 kept (hover + tooltip stay).
  - [x] When bubbles shown and ≤10 cases, all bubbles render; top-N labels cover all of them (N=10 ≥ count).
  - [x] Lot gate: `make typecheck-ui` (0 errors) + `make lint-ui` (clean); `scoring.test.ts` 23 passed (12 new for ratio/top-N).

- [x] **Lot 3 — Business-domain legend, filter & hover emphasis**
  - [x] Legend grouped by `initiative.data.domain` (+ "No domain"), filterable (toggle domains on/off via `hiddenDomains` set; filtered domain points get radius 0).
  - [x] On hover (point via `onHover`, legend entry via mouseenter/focus, or top-case label), enlarge points sharing the hovered domain (`pointRadii` × 1.8) — in both bubbles-shown and bubbles-hidden modes (hidden mode reveals only the emphasized domain).
  - [x] Color bubbles by business domain (categorical palette); status moved to tooltip (`statusLine`) + marker border (`borderColor` = status color, `pointBorderWidth`).
  - [x] Lot gate: `make typecheck-ui` (0 errors) + `make lint-ui` (clean). UI interactive behavior validated by E2E `e2e/tests/03-prioritization-matrix.spec.ts` (legend chips, hide-bubbles toggle, legend filter aria-pressed).

- [x] **Lot 4 — Executive-synthesis (DOCX) chart parity**
  - [x] DOCX embeds the live chart canvas as an opaque PNG (`dashboardImage` -> `docx-service.ts` image patch; the server never re-renders/re-ranks the chart), so the new top-N labels (Lot 2) + domain colors + status borders (Lot 3) are captured automatically. No server-side label/legend logic to change.
  - [x] Hardened `getDocxBitmapSnapshot()` so the transient view state (hide-bubbles / domain filter / hover emphasis) never leaks into the export: it temporarily forces the full chart (every point at base radius), redraws synchronously, captures, then restores the user's view.
  - [x] Server narrative `top_cases` (executive-summary.ts ROI-quadrant filter, value>=thr & complexity<=thr) is the AI-prompt/DOCX-text priority list — a separate, pre-existing concern from the chart's ratio-based top-N labels; out of BR-40a scope (chart legibility/scale only). Documented, not changed.
  - [x] Lot gate: `make typecheck-ui` (0 errors) + `make lint-ui` (clean). No API synthesis-context change needed (chart is a client bitmap).

- [ ] **Lot N-2 — UAT** (web app: cap to 50, top-10 labels, hide-bubbles, domain filter, hover emphasis;
      non-reg: existing folder chart, DOCX export). Awaiting user UAT on root `ENV=dev`.
- [ ] **Lot N-1 — Docs consolidation** (no `spec/BRANCH_SPEC_EVOL.md` was added; no spec file touched —
      chart UX behavior is self-documented in `InitiativeScatterPlot.svelte` + this BRANCH.md).
- [ ] **Lot N — Final validation** (PR → CI → user UAT sign-off → remove `BRANCH.md` → merge). PR pushed for CI + UAT; merge deferred to user.

## Verification (branch HEAD)
- [x] `make typecheck-ui` — svelte-check 0 errors (6 pre-existing warnings, none in changed files).
- [x] `make lint-ui` — eslint clean (exit 0).
- [x] `make test-ui SCOPE=tests/utils/scoring.test.ts` — 23/23 passed (ratio/top-N helpers).
- [x] `make test-api-endpoints SCOPE=tests/api/initiatives-generate-matrix.test.ts` — 12/12 passed (incl. accept-50 / reject-51 cap).
- [ ] E2E `e2e/tests/03-prioritization-matrix.spec.ts` — runs in CI / final `make clean test-e2e` (legend chips, hide-bubbles toggle, domain filter aria-pressed).
- Env note: the dev-target api container's startup (~36s: db:migrate → listening) exceeds the `up-api-test --wait` health window on this host, so `make test-api` reports the api "unhealthy" prematurely; the api is in fact healthy and tests pass when run via `test-api-endpoints` against the already-up stack. Re-running `make test-api` while the stack is live triggers `prepare-node-workspace`'s `npm ci` which unlinks node_modules under the running tsx watcher (tsx/preflight crash loop) — always `make down` before a fresh cold run. Infra timing, not a code regression.
