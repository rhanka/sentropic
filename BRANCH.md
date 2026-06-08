# Chore: Resource Plane study (SPEC_EVOL_RESOURCE_FS, ARCH-21a/21b)

## Objective
Commit the Resource Plane study (`spec/SPEC_EVOL_RESOURCE_FS.md` — a uniform filesystem-presented resource plane over capabilities/data/context/knowledge; owner decisions RF1-RF11 taken 2026-06-08 after a brainstorm + double adversarial review + two double mini-studies) and register ARCH-21a/21b in the architecture tracker + PLAN.md.

## Scope / Guardrails
- Documentation only: one new spec + tracker + PLAN update; no code, no migration.
- Make-only workflow; no services/tests/UAT (docs-only). All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_RESOURCE_FS.md`
  - `spec/SPEC_EVOL_ARCHITECTURE.md` (ARCH-21a/21b rows + review-log entry only)
  - `PLAN.md` (Resource Plane §8 addition + BR-70/BR-71)
  - `BRANCH.md` (this file)
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `plan/NN-BRANCH_*.md`, any `api/**`, `ui/**`, `packages/**`, `apps/**` path
- **Conditional Paths**: none.

## Feedback Loop
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single docs commit set)
- [ ] **Multi-branch**
- Rationale: documentation artifacts only.

## Lot 1 — Commit the study + registration
- [x] `spec/SPEC_EVOL_RESOURCE_FS.md` v2 added (Resource Plane; verb floor ls/read/edit/grep; resolver-first id-canonical; async via existing chat resume; namespace-as-authz; brainstorm forks A-D + RF1-RF11 decided; bash RF10 three loci; viz RF11 trace+custom-renderer; review + 2 mini-studies, all GO-WITH-CHANGES; ARCH-21a/21b split)
- [x] Owner decisions RF1-RF11 recorded as DECIDED 2026-06-08
- [x] Tracker: ARCH-21a + ARCH-21b rows + review-log entry
- [x] PLAN.md: Resource Plane §8 section + BR-70 (21a) + BR-71 (21b)
- [ ] CI green (docs-only; no package bump required — no `packages/**/src` touched)
- [ ] PR review, then delete `BRANCH.md` before merge

## Notes
- The plane is a PROJECTION over already-decided subsystems (catalog ARCH-01, resolver ARCH-19, context/session, knowledge ARCH-06, async ARCH-07/chat-resume), NOT a new store; the filesystem is presentation, not contract. A stringly LLM terminal was rejected (would undercut the typed-tool grain RF2).
- BR-70 (ARCH-21a) is dispatchable after BR-44 queue hardening (for `/proc/jobs`); BR-71 (ARCH-21b) is gated on ARCH-14/19/06/05/16/17.
- Owner items still open: RF9 package name at extraction (ARCH-12/D11), RF11 custom-renderer registry/sandbox shape (chat-ui, default ships in BR-70).
- Single commit set exceeds the 150-line soft guidance: the spec is one indivisible document + two tracker/plan registrations.
