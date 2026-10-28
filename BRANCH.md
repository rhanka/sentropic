# Feature: P1-0 chat-runtime package only

## Objective
- [ ] Publishable precursor containing only the runtime package and its validation/publication wiring; preserve every existing consumer until the conductor bootstraps the package.

## Scope / Guardrails
- [x] Branch `feat/chat-runtime-package` starts from `origin/main` at `5e986a0b6`; worktree `tmp/chat-runtime-package`.
- [x] Package source baseline: #819 at `55d903bb7b79ad51ab7a68d51a75a038369d68c3`.
- [x] Serialize Docker with `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; API_PORT=8796 UI_PORT=5196 MAILDEV_UI_PORT=1096 ENV=test-chat-p1 last; run make down after checks.
- [x] Make-only development, Docker-only dependencies; no Python, rebase, force push, publication or main merge; commits at most 150 changed lines, no AI trailers.
- [x] The conductor merges and dispatches bootstrap only after this draft has completed/success CI on its exact head.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/chat-runtime/**`
  - `package-lock.json`
  - `scripts/ci/**`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/chat-ui/**`
  - `packages/cowork-desktop/**`
  - `packages/cowork-bridge/**`
  - `ui/**`
  - `api/**`
  - `.track/**`
  - `.cursor/rules/**`
  - `docker-compose*.yml`
  - `spec/CHAT_MIGRATION_P0*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] Record rationale, impact and rollback before changing a conditional path.

## Feedback Loop
- [x] BR10-EX1: allow runtime-only Makefile validation/pack/bootstrap targets and CI registration; impact is one additive package lane, rollback removes only that lane; consumers and gates remain unchanged.
- [x] BR10-contracts: reproduced TS2307 against unchanged main; #819 now owns its data-only conversation ports in runtime and accepts the existing UI type peer, preserving port shapes and consumer isolation.

## AI Flaky tests

## Orchestration Mode (AI-selected)
- [x] Multi-branch: independent precursor and #819 repair, merge only; conductor owns integration and publication.

## UAT Management (in orchestration context)
- [x] No consumer change or product UAT in this precursor; retain full package and CI gates.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read repository/harness rules, frozen P0 boundary and P1 review; mechanical branch check passes.
- [ ] **Lot 1 — Runtime package**
  - [ ] Runtime source import progress: 6020 lines from #819 snapshot `70db7a8dc`.
  - [ ] Import #819 runtime sources, tests, scripts, manifest and license without consumer changes.
  - [ ] Verify typecheck/tests against unchanged main and retain the package ownership/export tests.
- [x] **Lot 2 — Publication wiring**
  - [x] Register runtime-only validation, pack and guarded OIDC/token bootstrap targets; retain manifest/CI gates; 201 manifest fixtures and 23 CI fixtures pass.
  - [x] Verify bootstrap `CI` (`.github/workflows/ci.yml`), ref `main`, input `bootstrap_publish_target=chat-runtime`, all other inputs default.
- [ ] **Lot 3 — Draft handoff**
  - [ ] Run runtime typecheck, full unit tests, guarded pack and relevant manifest/CI tests.
  - [ ] Open draft PR to main using this file as body; record exact head and completed/success CI.
  - [ ] Run make down; stop without main merge or bootstrap dispatch.
