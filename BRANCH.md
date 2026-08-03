# Feature: h2a Into Sentropic Integration — Orientation 3 Remote

## Objective
- [x] Pose the design-only D6 architecture for orientation #3 of capitalize-sentropic: code-workspace enrollment, remote h2a sessions on the one agents feed, and owner signatures through Focus decisions.

## Scope / Guardrails
- [x] Implementation scope is limited to `spec/**`; `BRANCH.md` is branch-control metadata only.
- [x] No code, lane, build, test, migration, UAT, or package change.
- [x] The h2a 0.90.1 storm-gate and owner-signature gate remain closed; this spec is not a signature.
- [x] Make-only workflow; all new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_H2A_INTO_SENTROPIC.md`
  - `BRANCH.md` (branch-control metadata only)
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare `H2A-INTO-STP-EXn` in `## Feedback Loop` with reason, impact, and rollback before touching any conditional or forbidden path.

## Feedback Loop
- [x] `attention` — sentropic PR #502 is an open design draft; this spec depends on its one-port fusion contract without treating it as merged code beyond the locally measured `AgentsFeedPort`/`AgentsEntry` types.
- [x] `attention` — h2a PR #152 is the sole merged publisher of `docs/governance/surface-invariants.md`; this branch references it and does not republish the invariant set.
- [x] `attention` — the exact Part 1 enrollment shape remains co-specified with the workspace primitive owner.

## AI Flaky tests
- [x] N/A — design-only documentation branch; no test campaign.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single design artifact; no sub-workstreams)
- [ ] **Multi-branch**
- Rationale: one spec and no implementation lane.

## UAT Management (in orchestration context)
- [x] N/A — design-only; review flow is architect evaluation, conductor consolidation, then owner signature.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and placement measurement**
  - [x] Read the governing rules, branch template, #502 contract, h2a surface-invariants publisher, and cited local primitives.
  - [x] Verify the worktree mechanically with `harness check branch`.
- [x] **Lot 1 — Architecture specification**
  - [x] Author `spec/SPEC_EVOL_H2A_INTO_SENTROPIC.md` to the supplied orientation #3 direction.
  - [x] Make absence-of-debt, LIB/INTEGRATION ownership, gates, acceptance grid, non-goals, and open items explicit.
- [x] **Lot 2 — Documentation gate**
  - [x] Run `make scope-check` and inspect the final diff; no build or tests.
