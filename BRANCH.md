# Feature: h2a roles ↔ workpackages alignment (governance)

## Objective
Sediment the owner-ratified role↔WP↔scope taxonomy into track: per-role workpackages, reparent items,
and a mapping spec. Conductor-authored governance change (no code).

## Scope / Guardrails
- Track data (`.track/**`) + one spec doc only. No code, no build, no migration.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.track/**`
  - `spec/SPEC_EVOL_H2A_ROLES_SCOPES.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**: n/a

## Lots
- [x] Lot 1 — create 13 role-aligned WPs + reparent items + cancel superseded WPs (live `.track`)
- [x] Lot 2 — governance spec `SPEC_EVOL_H2A_ROLES_SCOPES.md`
