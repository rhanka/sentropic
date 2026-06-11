# BRANCH — chore/arch-01-app-control-plane-study

- Branch: `chore/arch-01-app-control-plane-study`
- Mode: mono-branch
- Baseline: origin/main @ 850f9dde3
- Kind: study (doc-only — produces the ARCH-01 output `spec/SPEC_EVOL_APP_CATALOG.md`)

## Allowed Paths
- [x] `spec/SPEC_EVOL_APP_CATALOG.md`
- [x] `BRANCH.md`

## Forbidden Paths
- [x] all code (`api/**`, `ui/**`, `packages/**`), `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `api/drizzle/**`

## Conditional Paths
- [x] none

## Lots
- [x] **Lot 1 — Author ARCH-01 study**
  - [x] Draft `SPEC_EVOL_APP_CATALOG.md` (control-plane model + catalog projection + D7 cost)
  - [x] Double consensus (Codex 5.5-xhigh + Fable 5) — both GO-WITH-CHANGES
  - [x] Reconcile all convergent must-fixes (namespace no-FK, schema relational+CHECK, hostnames table, projection refresh+outbox, build-cli net-new vocabulary, D7 cutover risk)
  - [x] Fold D7 migration-cost estimate (ai-priorities M / opportunity M→L / code S; ~6-8d authoring + cutover risk)
  - [x] Surface 2 owner-irreversible decisions (OD-1 public app_slug names, OD-2 vocabulary package home) with recommendations
- [x] **Lot N — Final**
  - [x] PR (doc-only)

## Feedback Loop
- OD-1 / OD-2 (§6 of the study) = owner ratification required BEFORE the ARCH-01 implementation branch (not blocking this study or the next ARCH studies).

## Deferred
- ARCH-01 implementation branch plan (separate, after owner ratifies OD-1/OD-2).
