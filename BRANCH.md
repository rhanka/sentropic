# Feature: P1-0 chat-runtime package only

## Objective
- [ ] Publishable precursor containing only the runtime package and its validation/publication wiring; preserve every existing consumer until the conductor bootstraps the package.

## Scope / Guardrails
- [x] Branch `feat/chat-runtime-package` starts from `origin/main` at `5e986a0b6`; worktree `tmp/chat-runtime-package`.
- [x] Package copied byte-for-byte from corrected #819 at `7a5285c26cee7fd4265e469058b60427ab42c9ec`; runtime sources stabilized at `15881ba19`.
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
- [x] **Lot 1 — Runtime package**
  - [x] Import #819 runtime sources, tests, scripts, manifest and license without consumer changes, in commits below 150 lines.
  - [x] Typecheck and 440 runtime tests pass against unchanged main; retain the package ownership/export tests.
  - [x] Fresh runtime archive `a5bc85bc6f2e68fcefed00168f67b368e61d637dcc8a6a65ca63d67ef5c05c9f` installs alone; all public imports pass using registry UI 0.34.1 with no injected peers; matches #819's clean CI artifact.
- [x] **Lot 2 — Publication wiring**
  - [x] Register runtime-only validation, pack and guarded OIDC/token bootstrap targets; retain manifest/CI gates; 201 manifest fixtures and 23 CI fixtures pass.
  - [x] Verify bootstrap `CI` (`.github/workflows/ci.yml`), ref `main`, input `bootstrap_publish_target=chat-runtime`, all other inputs default.
- [ ] **Lot 3 — Draft handoff**
  - [x] Run runtime typecheck, 440 unit tests, guarded pack, standalone archive qualification, 201 manifest fixtures and 23 CI fixtures; all pass.
  - [ ] Open draft PR to main using this file as body; record exact head and completed/success CI.
  - [x] Run make down and make ps; no remaining services. Stop without main merge or bootstrap dispatch.
