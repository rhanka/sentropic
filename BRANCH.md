# Chore: Architecture target tracker (SPEC_EVOL_ARCHITECTURE)

## Objective
Commit the cross-cutting app/workspace/PaaS architecture tracking register (`spec/SPEC_EVOL_ARCHITECTURE.md` v3), hardened by three adversarial review rounds (round 1 Maxwell/Feynman; round 2 + round 3 double reviews Codex 5.5 xhigh + Opus 4.8), with owner decisions D1-D11 taken 2026-06-07.

## Scope / Guardrails
- Scope limited to documentation: one new spec file, no code, no migration.
- Make-only workflow, no direct Docker commands.
- No services, tests, or UAT environments required (docs-only branch).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_ARCHITECTURE.md`
  - `BRANCH.md` (this file)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - Any `api/**`, `ui/**`, `packages/**`, `apps/**` path
- **Conditional Paths**: none.
- **Exception process**: not applicable (docs-only).

## Feedback Loop
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single docs commit, no sub-workstreams)
- [ ] **Multi-branch**
- Rationale: single documentation artifact; no orthogonal tasks.

## Lot 1 — Commit the tracker
- [x] `spec/SPEC_EVOL_ARCHITECTURE.md` v3 added (baseline corrected against `origin/main`; concepts hardened; studies ARCH-01..17; waves 0-3; risks 1-20)
- [x] Owner decisions D1-D11 recorded as DECIDED 2026-06-07 in section 6.3 (D10 deferred into ARCH-10)
- [x] Round-3 audit fixes applied (IdP live status PR #254, cowork split status, catalog dynamic-source nuance, claim merge-policy, ARCH-12/15 scheduling, untracked sibling-document references annotated in section 2.2)
- [x] CI green (run 27107761992, success; docs-only — no package bump required, no `packages/**/src` touched)
- [ ] PR review, then delete `BRANCH.md` before merge

## Notes
- Referenced sibling documents (`SPEC_EVOL_AUTH_IDP_STANDALONE.md`, `SPEC_EVOL_CHATUI_MODULARIZATION.md`, `SPEC_EVOL_CHATUI_FIDELITY.md`, `b2b2b-sentropic-eval.md`) are intentionally NOT co-committed: they belong to their own programs; the tracker annotates them as working-tree drafts (section 2.2).
- Single commit exceeds the 150-line soft guidance because the spec is one indivisible document (no meaningful split point).
