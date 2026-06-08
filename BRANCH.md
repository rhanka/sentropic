# Chore: Register architecture target program in PLAN.md (BR-44..BR-67)

## Objective
Integrate the architecture target program (ARCH-01..19, decided D1-D11 + DD1-DD11) into the canonical `PLAN.md` roadmap: status addendum, §5 wave pointer, new §8 (BR-44..BR-67 with waves H/1a/1b/2/3, gates, owner items, external lanes), §7 source-spec entries.

## Scope / Guardrails
- Documentation only: `PLAN.md` + this file; no code, no migration.
- Make-only workflow; no services/tests/UAT (docs-only).
- All new text in English.
- Branch slugs in §8 are PROPOSALS pending owner validation (durable-naming rule).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `PLAN.md`
  - `BRANCH.md` (this file)
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `plan/NN-BRANCH_*.md`, any `api/**`, `ui/**`, `packages/**`, `apps/**`, `spec/**` path
- **Conditional Paths**: none.
- **Exception process**: not applicable (docs-only).

## Feedback Loop
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single docs commit set)
- [ ] **Multi-branch**
- Rationale: documentation artifact only.

## Lot 1 — Register the program
- [x] Status addendum 2026-06-07 added (program registered, D1-D11 + DD1-DD11 summary, cadence)
- [x] §5 pointer added (architecture target program → §8)
- [x] §8 added: BR-44 hardening; BR-45..48 Wave-1a framing studies; BR-49..52 Wave-1b; BR-53..60 Wave-2 (gated); BR-61..65 Wave-3 proofs+storage; BR-66..67 last; owner items; external lanes
- [x] §7 source specifications: SPEC_EVOL_ARCHITECTURE + SPEC_EVOL_DATA_ARCHITECTURE added
- [ ] CI green (docs-only; no package bump required)
- [ ] PR review, then delete `BRANCH.md` before merge

## Notes
- Per repo merge policy §0: source branches preserved post-merge (the `chore/architecture-target` remote branch was restored accordingly).
- Waves H/1a/1b are dispatchable immediately after merge; Wave 2+ gates are listed per branch.
