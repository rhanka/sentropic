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
- **Exception process**: declare `BR40a-EXn` in `## Feedback Loop` with reason, impact, rollback.

## Feedback Loop (open framing questions)
- **BR40a-Q1** `attention`: "top-10" ranking metric. The chart must label only the 10 highest-priority
  use cases. Source spec said "top au sens valeur/complexité". Candidate metrics: (a) priority score
  = `value − complexity` (quick-wins bias); (b) `value / complexity` ratio; (c) highest `value` only;
  (d) distance from origin / quadrant rank. Stakes: drives which labels show; wrong choice mislabels
  the matrix. Needs user decision before Lot 1.
- **BR40a-Q2** `attention`: bubble color semantics. Today bubbles are colored by initiative **status**
  (`InitiativeScatterPlot.svelte:145` `STATUS_COLORS`). The new legend is "filterable by business
  domain" (`initiative.data.domain`, currently stored but unused in the chart). Options: (a) keep
  status colors + add a separate domain legend/filter overlay; (b) recolor bubbles by business domain
  (status moves to tooltip/shape). Stakes: conflicts with the current status legend; affects DOCX
  export parity. Needs user decision before Lot 1.
- **BR40a-Q3** `clarification`: cap = 50 — confirm hard limit (block creation/generation beyond 50)
  vs soft target (generate up to 50). Default assumption pending answer: soft cap of 50 in the
  generation/query path; UI handles ≤50 gracefully.

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

## Plan / Todo (lot-based) — DRAFT pending BR40a-Q1/Q2/Q3
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `TODO.md`, `PLAN.md`, this branch file.
  - [ ] Create isolated worktree `tmp/feat-prioritization-matrix-scale` from `main`.
  - [ ] Confirm command style with slot-0 ports and `ENV=...` last.
  - [ ] Resolve BR40a-Q1/Q2/Q3 before Lot 1.

- [ ] **Lot 1 — Use-case cap to 50**
  - [ ] Raise the per-folder cap to 50 in the generation/query path (`executive-summary.ts` query and any UI guard).
  - [ ] Confirm no schema/migration needed (else declare `BR40a-EX1`).
  - [ ] Lot gate: `make typecheck-api` + `make lint-api`; API tests for executive-summary cap.

- [ ] **Lot 2 — Chart legibility at scale (labels + hide-bubbles)**
  - [ ] Label only the top-10 use cases by the metric chosen in BR40a-Q1.
  - [ ] Add a "hide bubbles" toggle: when on, hide point markers but keep hover hit-areas + tooltip.
  - [ ] When bubbles shown and ≤10 cases, all bubbles + labels render normally.
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`; UI specs for top-10 selection + toggle.

- [ ] **Lot 3 — Business-domain legend, filter & hover emphasis**
  - [ ] Add a legend grouped by `initiative.data.domain`, filterable (toggle domains on/off).
  - [ ] On hover (point or legend entry), enlarge points sharing the hovered point's business domain
        — in both bubbles-shown and bubbles-hidden modes.
  - [ ] Apply BR40a-Q2 color decision.
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`; UI specs for legend filter + hover emphasis.

- [ ] **Lot 4 — Executive-synthesis (DOCX) chart parity**
  - [ ] Ensure the DOCX bitmap snapshot reflects the new label/legend rules (or document deferral).
  - [ ] Lot gate: API tests for synthesis context.

- [ ] **Lot N-2 — UAT** (web app: cap to 50, top-10 labels, hide-bubbles, domain filter, hover emphasis;
      non-reg: existing folder chart, DOCX export).
- [ ] **Lot N-1 — Docs consolidation** (update relevant spec; remove `spec/BRANCH_SPEC_EVOL.md` if added).
- [ ] **Lot N — Final validation** (typecheck/lint, UI/API/E2E retests, package bumps if any, PR → CI →
      remove `BRANCH.md` → merge via merge commit).
