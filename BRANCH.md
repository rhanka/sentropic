# Feature: Freeze the Universal Connector & Account Broker STUDY

## Objective
Mark `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md` as FROZEN/CONSOLIDATED — the locked reference that now spawns dedicated EVOLs (first: the bank connector, merged #396). Doc-only, fast-merge.

## Scope / Guardrails
- Scope limited to `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md` (status banner only).
- No code, no migration, no runtime change.
- Make-only workflow, all new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`
- **Conditional Paths**:
  - `.github/workflows/**`
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (doc-only)
- [ ] **Multi-branch**
- Rationale: single documentation status banner; no build/test surface.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Freeze banner**
  - [x] Add FROZEN/CONSOLIDATED status + derived-EVOL pointer + remaining-foundations note.
- [ ] **Lot N — Final validation**
  - [ ] PR + CI green (doc-only) + remove BRANCH.md + merge.
