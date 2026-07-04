# Feat: Focus DS-native flat HTML presentation rework (F1–F5)

## Objective
The delivered `@sentropic/focus` HTML surface (0.4.0, PR #376) was owner-rejected: raw markdown (`##`), invented rounded/bordered boxes (DS violation), English-only chrome, and a model too thin to read as a motivated decision-dossier. This branch reworks the HTML render fundamentals so a focus dossier renders markdown natively, FR-first, 100% on flat DS tokens (no boxes), with an enriched detailed/motivated model and read-only DS-button affordances. Design: `spec/SPEC_EVOL_FOCUS_DS_PRESENTATION.md` (owner GO 2026-07-03, all précos OUI 2026-07-04). Extends the 0.4.0 branch (its `theme.ts` is rewritten); supersedes the rejected box styling so no rejected design reaches main. Replaces the mis-pasted lockfile-fix BRANCH.md previously committed on this branch.

## Scope / Guardrails
- HTML render surface only; terminal/MD chrome i18n = follow-up. No live `--serve` driver, no new track events, no cerclage, no diagram adapter, no publish (deferred per spec §6).
- New runtime dep `marked` (the default markdown engine; the host `renderMarkdown` hook stays an override). Requires a root lockfile regen via `make lock-root`.
- Additive; version 0.4.0 → 0.5.0.
- The interim `FOCUS_COMPONENT_CSS` is a temporary de-mutualization; the obligation de relivraison onto the DS static presentation kit is tracked (spec §4, gated on DS-ASK P1).

## Allowed Paths
- `packages/focus/**`
- `BRANCH.md`
- `package-lock.json`

## Forbidden Paths
- `Makefile`
- `docker-compose*.yml`

## Conditional Paths
- (none)

## Scope Exceptions
- `FOCUS-EX1` — touch root `package-lock.json` (default-sensitive). Rationale: the new `marked` runtime dep must be reflected in the root lock. Impact: lock-only regen via `make lock-root`; no foreign version churn. Rollback: revert the lock commit.

## Lots
- [x] F1 — built-in default markdown renderer (`marked`); host `renderMarkdown` becomes an override
- [x] F2 — i18n: `locale`/`language` model fields + FR-first chrome catalog + `<html lang>` from content language
- [x] F3 — enriched model (option rationale/consequence/impact/recommended; outcome verdict/motivation; question context/stakes) + dense render
- [x] F4 — `FOCUS_COMPONENT_CSS` rewritten flat, 100% DS tokens (boxes removed; accents by left filet; prose typography; overflow-wrap)
- [x] F5 — affordances as disabled DS buttons + copyable `stp focus …` command (no `<del>`)
- [ ] Landing — root lockfile regen (`make lock-root`, adds `marked`), push, green CI, PR #376 re-scoped
