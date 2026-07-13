# Feature: cited-source-viewer — graphify-iso realignment (behavioral parity, no 3rd UAT)

## Objective
Realign the MERGED `@sentropic/cited-source-viewer` (PR #385) so it is behavior/API ISO the graphify-qualified S.6 viewer, preventing a third full UAT. Restore graphify's API + behavior; preserve the architect's neutral refactors. Qualification model = 3.5 total (immo/radar UAT done + graphify UAT done + 0.5 graphify technical non-regression pivot + 1 future immo full UAT). Closure gated on double consensus (architect + graphify + owner).

## Scope / Guardrails
- Scope limited to `packages/cited-source-viewer/**`.
- No migration.
- Make-only workflow; package gates are the pre-existing docker make targets (`make test-cited-source-viewer[-dom]`, `make typecheck-cited-source-viewer`).
- Automated tests run on a dedicated env (`ENV=test-csv-iso`), never on `dev`.
- In every `make` command, `ENV=<env>` is passed last.
- All new text in English.
- Merge is BLOCKED until double consensus (architect + graphify) + owner GO — this branch is review-ready, not merge-ready.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cited-source-viewer/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention`: closure requires DOUBLE CONSENSUS — architect (consents to restoring graphify behavioral API + keeping neutral refactors, PDF-loading gap fixed) and graphify lane (confirms its qualified API is the frozen target + will run the 0.5 non-regression pivot). Consensus requests deposited to `claude:architect` + `claude:graphify` (dormant). Owner ratifies the 3.5-not-5 qualification model.
- `acknowledge`: owner directive (rhanka) = package must be the graphify-qualified viewer packaged, NOT a 3rd UX; no new Sentropic full UAT.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single package, one behavioral realignment, gated on external consensus.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Delta ledger vs graphify qualified viewer (Codex 5.5xhigh, file-grounded): 13 deltas classified BEHAVIORAL / ARCHITECT-INTENTIONAL / NEUTRAL.
  - [x] Isolated worktree off `origin/main`; ENV mapping `test-csv-iso`.
  - [x] Scope boundaries confirmed (package-scoped; Makefile untouched).

- [x] **Lot 1 — Behavioral realignment to graphify API**
  - [x] `scope="entity"` default; `activeGroupIndex` + group-relative `activeIndex`; `(gIndex,rIndex)` focus model; scoped doc/citation nav; scope-eligibility filters groups-with-refs only; selection-only entity navigator with visible label; active-group header title.
  - [x] Keyboard `n/N` (citation, active scope) + `e/E` (entity, selection scope only) + Esc + ←/→ pages.
  - [x] `onScopeChange`; primary `onFocusChange(groupId, refIndex)` from in-viewer nav only; enriched snapshot demoted to optional `onFocusDetail`.
  - [x] Keep body-registry; fix the PDF transient-loading gap (frame stays loading until body status arrives).
  - [x] Preserve neutral extensions: closed `SourcePayload` union, generic body props, `labels`/`class`, markdown scope. Type-only `region`/`figure_id` added; no rendering (v2/v3 deferred).
  - [x] `types.ts`, `README.md` updated; `package.json` bumped to `0.2.0`.
  - [x] Lot gate:
    - [x] `make typecheck-cited-source-viewer ENV=test-csv-iso` — GREEN.
    - [x] `make test-cited-source-viewer ENV=test-csv-iso` — GREEN (4 files / 22 tests).
    - [x] `make test-cited-source-viewer-dom ENV=test-csv-iso` — GREEN (1 file / 21 tests), independently re-run by the coordinator.

- [x] **Lot 2 — Test parity (prove behavioral iso)**
  - [x] Ported graphify viewer parity cases into `tests/viewer-frame.dom.spec.ts`: entity default; toggle hidden <2 groups-with-refs; entity-scope boundary; Sélection fires `onScopeChange` + global counter + entity indicator; selection crosses boundary + `onFocusChange(groupId,refIndex)`; keyboard n/N + e/E; e/E inert in Entité; flat-refs n/N; grouped `activeGroupIndex`+relative `activeIndex`; `sourceHref` null hide. Purity gates intact.

- [ ] **Lot 3 — Consensus + graphify 0.5 pivot (BLOCKING, external)**
  - [ ] `attention`: architect consensus (restore graphify API + neutral refactors kept).
  - [ ] `attention`: graphify consensus (qualified API is the frozen target).
  - [ ] graphify 0.5 non-regression pivot: `studio/src/App.svelte` imports `@sentropic/cited-source-viewer/CitedSourceViewer.svelte`; delete local `studio/src/components/CitedSourceViewer.svelte` + `studio/src/lib/cited-source/{quoteMatch,markdownSource,pdfEngine}.js`; keep `studio/src/lib/citedSources.js`; run `citedSourceViewer/citedSourceQuoteMatch/citedSourcePdfEngine/citedSourcesThread` tests GREEN.
  - [ ] Owner GO on the 3.5-not-5 qualification model → merge.
