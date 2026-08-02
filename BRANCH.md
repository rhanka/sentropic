# Feature: D6 slice (a) — Agents-Surface Cross-Host Fusion Contract

## Objective
Pose the design-only contract by which cowork agents and plugins become entries on the ONE agents surface (`AgentsFeedPort`), I1/I3/I4-clean, as a standalone D6 slice. No lane, no build (storm-gate 0.90.1; no build before owner signature).

## Scope / Guardrails
- Scope limited to `spec/**` (a single new design spec) — design-only, no code, no build.
- No migration, no Docker, Make-only workflow.
- Root workspace `~/src/sentropic` reserved for user dev/UAT (`ENV=dev`); must remain stable.
- Branch development happens in isolated worktree `tmp/d6a-fusion`.
- No automated test campaign (spec-only branch).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_AGENTS_SURFACE_FUSION.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path (reason, impact, rollback).

## Lots
- [x] Lot 1 — Author `spec/SPEC_EVOL_AGENTS_SURFACE_FUSION.md`: cross-host fusion contract; pins I1-I5 verbatim; I1/I3/I4 compliance; LIB/INTEGRATION split + acceptance-grid mapping; dependency/gate table.
- [ ] Lot 2 — h2a-architect evaluation against the 6' surface contract (external review; not a code lot).

## Feedback Loop
- `acknowledge` (2026-08-02): owner GO = slice (a) now — source `tmp/D6_SLICE_A_OWNER_GO_conductor.md`.
- `attention` (2026-08-02): orientations 1-4 not yet transmitted; provisional mapping volet (b) -> orientation 3 (remote); does not block this slice.

## AI Flaky tests
- N/A — spec-only branch, no test campaign.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single design artifact; no sub-workstreams)
- [ ] **Multi-branch**
- Rationale: one design spec, no CI, no parallel workstreams.

## UAT Management (in orchestration context)
- N/A — design-only, no UI change. Review gate = h2a-architect evaluation -> conductor consolidation -> owner signature (not UAT).
