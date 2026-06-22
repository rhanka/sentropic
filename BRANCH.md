# Feature: ARCH-17 dev-tier reframe — ground the owner-ratified 2-tier model into the decision spec

## Objective
Record the owner reframe (rhanka, 2026-06-22) of the deployment-plane into `SPEC_DECISION_DEPLOYMENT_PLANE.md`: the 3-tier model (preprod+validation+prod) is superseded by a 2-tier model — a single `dev` tier (main-aligned, real prod-data copy, standalone `dev.auth` with parent RP ID, distinct dev crypto) + prod. Doc-only; no code.

## Scope / Guardrails
- Scope limited to the architect decision record (`spec/`); doc-only change, no code/tests/infra.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree (`../sentropic-arch17`), off `origin/main`.
- All new text in English.
- This is a REVISION of an owner-ratified decision → merge gated on a double review (Codex 5.5xhigh + Opus 4.8max) confirming the recording is faithful + internally consistent.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_DECISION_DEPLOYMENT_PLANE.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`, `deploy/**`, `.github/workflows/**`
  - any other `spec/**` or `plan/**` file
- **Conditional Paths (allowed only with explicit `BRxx-EXn` exception)**:
  - none
- **Exception process**: none needed (doc-only, within Allowed Paths).

## Feedback Loop
- `attention` (architect → owner/conductor): this supersedes ratified D11R (federation dropped), D4 (naming), D12, and the OQ2R/D13–D14 data policy where they conflict. Owner ratified the model (Q1=parent-RP-ID, Q3=real-PII-copy, Q2=distinct-dev-crypto default); this PR records it. Old sections kept for provenance with `⊘ SUPERSEDED` markers.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (doc-only, single change)
- [ ] **Multi-branch**
- Rationale: a single decision-record edit; no sub-workstreams, no CI matrix.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Isolated worktree off `origin/main` (`../sentropic-arch17`).
  - [x] Confirm scope boundaries (doc-only; Allowed = the spec + this file).
- [x] **Lot 1 — Ground the reframe**
  - [x] Add the `§ REVISION 2026-06-22` section (2-tier model + DV1–DV6).
  - [x] Mark the 3-tier table, D11R, D4, D12 + the implementation order with `⊘ SUPERSEDED` provenance markers.
- [ ] **Lot N — Final validation**
  - [ ] Double review (Codex 5.5xhigh + Opus 4.8max): recording faithful to the owner's Q1/Q2/Q3 + internally consistent (esp. DV4 webauthn_credentials import vs DV5 crypto scrub).
  - [ ] Open PR using this `BRANCH.md` as body.
  - [ ] On review GO: commit removal of `BRANCH.md`, merge.
