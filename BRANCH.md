# Chore: Coherence reconciliation + track registry (scope/deps per element)

## Objective
Reconcile plan/track/branch coherence after a double audit (Codex 5.5 xhigh + Opus 4.8) and produce `track/TRACK.md` — the authoritative registry associating a scope (packages/app-trees) and dependencies (internal BRs + external lanes) to every in-progress and upcoming branch. Apply the audit's gate fixes + status corrections to `PLAN.md`.

## Scope / Guardrails
- Documentation only: `track/TRACK.md` (new) + `PLAN.md` (addendum + 2 gate fixes) + `BRANCH.md`; no code, no migration.
- Make-only workflow; no services/tests/UAT (docs-only). All text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `track/TRACK.md`, `PLAN.md`, `BRANCH.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `plan/NN-BRANCH_*.md`, any `api/**`, `ui/**`, `packages/**`, `apps/**`, `spec/**`
- **Conditional Paths**: none.

## Feedback Loop
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single docs commit set)
- [ ] **Multi-branch**
- Rationale: documentation artifacts only.

## Lot 1 — Reconcile + register
- [x] `track/TRACK.md` added (scope+deps per element, reconciled from the double coherence audit; coherence findings; scope-collision hot spots; external lanes; open items)
- [x] PLAN.md addendum 2026-06-09 (coherence reconciliation, dispatch verdict Wave H+1a, status corrections, open owner decisions) + pointer to track/TRACK.md
- [x] PLAN.md gate fixes: BR-57 += BR-49 + BR-34 Lot 0; BR-65 += BR-60
- [ ] CI green (docs-only; no package bump required)
- [ ] PR review, then delete `BRANCH.md` before merge

## Notes
- The live `track` MCP sidecar is EMPTY (harness BRANCH.md ingestion not yet run); `track/TRACK.md` + PLAN are the interim source of truth. Follow-up: ingest per-branch BRANCH.md into the harness track once the harness CLI is buildable.
- BR-70/71 (Resource Plane) PLAN §8 registration rides with PR #276 (merge it first); this PR keeps them in `track/TRACK.md` §4 only to avoid a §8 conflict.
- Open owner decisions are listed in `track/TRACK.md` §5/§7 (chat-ui serialization, BR-70/71 split, parallel-lane count) — surfaced to the owner separately, not decided in this docs PR.
