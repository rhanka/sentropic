# Feature: Bank/Financial Connector socle spec (SPEC_EVOL_BANK_CONNECTOR)

## Objective
Land the architect-owned socle spec for the bank/financial connector (instance of the Universal Connector & Account Broker pattern), fully double-consensus reviewed (Opus 4.8xhigh + Codex 5.5xhigh) and owner-ratified (B1-b/B4/B5-b/B6-a). Doc-only branch, fast-merge.

## Scope / Guardrails
- Scope limited to `spec/SPEC_EVOL_BANK_CONNECTOR.md` (documentation only).
- No code, no migration, no runtime change — nothing to build/test.
- Make-only workflow, no direct Docker commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_BANK_CONNECTOR.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (doc-only, single trivial cycle)
- [ ] **Multi-branch**
- Rationale: single documentation file, double-consensus already complete; no build/test surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Author spec grounded on STUDY + MCP-platform socle + openerp consumer.
  - [x] Confirm scope and guardrails (doc-only).
- [x] **Lot 1 — Spec + double-consensus**
  - [x] Draft `spec/SPEC_EVOL_BANK_CONNECTOR.md`.
  - [x] Opus 4.8xhigh adversarial pass reconciled (v2).
  - [x] Codex 5.5xhigh adversarial pass reconciled (v3).
  - [x] Owner decisions integrated (B1-b/B4/B5-b/B6-a).
- [ ] **Lot N — Final validation**
  - [ ] Final dual confirmation pass (Opus + Codex leg) — PASS.
  - [ ] Final gate step 1: create PR using `BRANCH.md` as body.
  - [ ] Final gate step 2: verify CI green (doc-only paths-filter).
  - [ ] Final gate step 3: remove `BRANCH.md`, push, merge.
