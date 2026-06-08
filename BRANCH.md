# Chore: Data architecture study (SPEC_EVOL_DATA_ARCHITECTURE, ARCH-18/19)

## Objective
Commit the "data in the agentic era" deep study (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md` v3, owner decisions DD1-DD11 taken 2026-06-07 after two double adversarial review rounds) and register ARCH-18/ARCH-19 in the architecture tracker.

## Scope / Guardrails
- Documentation only: one new spec file + tracker update, no code, no migration.
- Make-only workflow, no direct Docker commands; no services/tests/UAT (docs-only).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_DATA_ARCHITECTURE.md`
  - `spec/SPEC_EVOL_ARCHITECTURE.md` (ARCH-18/19 rows + review-log entry only)
  - `BRANCH.md` (this file)
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `plan/NN-BRANCH_*.md`, any `api/**`, `ui/**`, `packages/**`, `apps/**` path
- **Conditional Paths**: none.
- **Exception process**: not applicable (docs-only).

## Feedback Loop
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single docs commit set)
- [ ] **Multi-branch**
- Rationale: documentation artifacts only; no orthogonal tasks.

## Lot 1 — Commit the study + tracker registration
- [x] `spec/SPEC_EVOL_DATA_ARCHITECTURE.md` v3 added (5 axes; evidence-grounded baseline: 57 tables, 47 jsonb, queue without lease/reaper, dead `task_io_contracts`, unbounded `chat_stream_events`; round-1 concept review + round-2 decision-packet audit, 4× GO-WITH-CHANGES)
- [x] Owner decisions DD1-DD11 recorded as DECIDED 2026-06-07 (incl. DD5 rider: knowledge base is LLM-wiki/graph-first via graphify, vector = subordinate addition; DD6: separate unpublished package; DD10: envelope v0 with binding-defined scope map)
- [x] Tracker updated: ARCH-18 + ARCH-19 rows, review-log entry, ARCH-20 dissolution recorded
- [ ] CI green (docs-only; no package bump required — no `packages/**/src` touched)
- [ ] PR review, then delete `BRANCH.md` before merge

## Notes
- Next dispatchable work per the study: hardening prerequisite branch (queue stranded-`processing` reaper, `chat_stream_events` retention sweep + `created_at` index, flow comment fix, `task_io_contracts` drop migration) — lands BEFORE any outbox dispatcher or UBO storage work; then ARCH-19 paper lots (Lot 0 shape-mining + OpenERP mapping incl. one order→lines→invoice chain).
- Single commit exceeds the 150-line soft guidance: the spec is one indivisible document.
