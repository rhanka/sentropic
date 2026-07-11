# Feature: Foundation design specs — mcp-platform activation (BR-42l) + ARCH-11 tenant reconciliation

## Objective
Land two architect foundation design specs, each produced by 2-peer Opus 4.8xhigh review (author + adversary) + owner decisions (2026-07-11). Both carry a **Codex 5.5xhigh 2nd-engine gate OWED before any implementation/publish/cutover**. Doc-only, fast-merge.

## Scope / Guardrails
- Scope limited to `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md` + `spec/SPEC_EVOL_ARCH11_TENANT_RECONCILIATION.md` (documentation only).
- No code, no migration, no runtime change.
- These specs are DESIGN only: nothing is implemented / published / cut over from them until the Codex gate + owner-final.
- Make-only workflow, all new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md`
  - `spec/SPEC_EVOL_ARCH11_TENANT_RECONCILIATION.md`
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
- `attention`: Codex 5.5xhigh adversarial 2nd-engine pass OWED on both specs (rate-limited at authoring; run at usage reset). Blocking for implementation/publish/cutover, NOT for landing the design doc.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (doc-only)
- [ ] **Multi-branch**
- Rationale: two documentation files, no build/test surface.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Foundation specs (2-peer Opus + owner decisions)**
  - [x] BR-42l `SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md`: author Opus + adversarial Opus reconciled; owner=publish-now-narrow-freeze.
  - [x] ARCH-11 `SPEC_EVOL_ARCH11_TENANT_RECONCILIATION.md`: author Opus + adversarial Opus reconciled; owner=model-multi-org-now + coupled-G1.
- [ ] **Lot N — Final validation**
  - [ ] Codex 5.5xhigh 2nd-engine gate at usage reset (amend if material).
  - [ ] Register BR-42l / BR-42m / coupled-G1 via the track lane.
  - [ ] Remove BRANCH.md, push, merge.
