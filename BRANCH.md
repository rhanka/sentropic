# Fix: Canvas live host Yjs 13.6.33 parity with the design-system peer range

## Objective
- [x] Align the canvas-live host Yjs dependency with `@sentropic/design-system-rich-text` peers (`yjs ^13.6.33`, `y-protocols ^1.0.7`; DS CL-3a built and tested on `yjs` 13.6.33): pin `yjs` exactly `13.6.33` in `api/package.json` devDependencies and both lockfiles, and update `H3_DEPENDENCY_CLOSURE()` plus `docs/canvas-live/h3-validation.md`.

## Scope / Guardrails
- [x] Branch `fix/canvas-live-yjs-13633` from `origin/main` (`cacc47154`); worktree `tmp/worktrees/canvas-yjs`.
- [x] Pin through make install targets only (`make install-api-dev`, `make lock-api`, `make lock-root`); no direct npm/docker.
- [x] Keep `y-protocols` `1.0.7` and `@hocuspocus/server`/`@hocuspocus/provider` `4.7.1` unless their peer ranges require otherwise (both accept `yjs ^13.6.8`, `y-protocols ^1.0.6`; no move needed).
- [x] CI lockfile-lane policy acknowledged (review_by=2026-11-30T00:00:00Z); installs resolve committed tool profiles or frozen consumer closures.
- [x] Make-only, Docker-first, no Python, no user-visible behavior change.
- [x] `ENV=test-canvas-yjs` last; `API_PORT=8802 UI_PORT=5202 MAILDEV_UI_PORT=1102`.
- [x] Docker operations hold `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; finish with `make down ENV=test-canvas-yjs`.
- [x] Atomic commits at most 150 changed lines through `make commit`; selective staging; rebase with `git rebase origin/main` and push only this branch with `--force-with-lease` per COMMON-RULES.
- [x] Draft PR to main; retain `BRANCH.md`; no merge requested.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json`
  - `api/src/services/canvas-live/harness.ts`
  - `docs/canvas-live/h3-validation.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - [ ] Declare exception ID `BRYJS-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - [ ] Include reason, impact, and rollback strategy.
  - [ ] Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [x] `attention`: host pin predates the DS CL-3a peer declaration — `yjs` `13.6.27` does not satisfy the published peer `^13.6.33`; alignment recorded in `docs/canvas-live/h3-validation.md` before claiming conformance.
- [x] `attention`: `make install-api-dev` runs npm in workspace-root mode, so it pins `api/package.json` and mirrors into the root `package-lock.json` but never touches `api/package-lock.json`. The api lockfile was regenerated in api-root mode with `make exec-api CMD="npm install --save-dev --save-exact --package-lock-only --ignore-scripts --workspaces=false --no-audit --no-fund yjs@13.6.33"` — the same container npm invocation the H2 lane used to pin `yjs` 13.6.27 originally; no direct docker/npm on the host. That run also refreshed the stale `../packages/cluster-mesh` entry (`0.24.0` -> `0.25.0` plus its `@sentropic/engram` peer lines) to match `packages/cluster-mesh/package.json` on the base; the root lockfile already recorded `0.25.0`, so the api lock was stale on `origin/main` and is now truthful. `make lock-root` re-run after it: idempotent, root-lock diff unchanged.

## AI Flaky tests
- [x] No AI calls in this change; no flaky exceptions requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch (single code author; single test cycle; rebase onto `origin/main` for PR updates per COMMON-RULES).
- [x] Rationale: one dependency pin across two lockfiles plus its two recorded closures.

## UAT Management (in orchestration context)
- [x] Mono-branch: no UI flow change; acceptance uses the H3 offline harness and the scoped canvas-live api suites.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`, `COMMON-RULES.md`.
  - [x] Confirm worktree `tmp/worktrees/canvas-yjs` on `fix/canvas-live-yjs-13633` from `origin/main` (`cacc47154`).
  - [x] Confirm DS peers: `@sentropic/design-system-rich-text` peerDependencies `yjs ^13.6.33`, `y-protocols ^1.0.7`; DS CL-3a devDeps exact `yjs` 13.6.33, `y-protocols` 1.0.7.
  - [x] Confirm `@hocuspocus/server`/`provider` 4.7.1 peers (`yjs ^13.6.8`, `y-protocols ^1.0.6`) accept the new pin; no collateral moves.
  - [x] Define environment mapping (`ENV=test-canvas-yjs`, `API_PORT=8802`, `UI_PORT=5202`, `MAILDEV_UI_PORT=1102`) and Docker lock path.
  - [x] Confirm command style `make ... ENV=test-canvas-yjs` with `ENV` last.
  - [x] Validate scope boundaries and declare `BRYJS-EXn` before any conditional change.
- [x] **Lot 1 — Exact yjs 13.6.33 pin through make install targets**
  - [x] Start the api test stack (`make up-api-test ENV=test-canvas-yjs`).
  - [x] `make install-api-dev NPM_LIB="yjs@13.6.33 --save-exact" ENV=test-canvas-yjs` — exact `13.6.33` in `api/package.json` devDependencies; npm workspace-root mode mirrors it into the root `package-lock.json`.
  - [x] `make exec-api CMD="npm install --save-dev --save-exact --package-lock-only --ignore-scripts --workspaces=false --no-audit --no-fund yjs@13.6.33" ENV=test-canvas-yjs` — regenerate `api/package-lock.json` in api-root mode (recorded in `## Feedback Loop`).
  - [x] `make lock-root` — idempotent re-run; root `package-lock.json` diff unchanged (exactly the yjs pin).
  - [x] Refresh the workspace install from the updated lock (`make up-api-test ENV=test-canvas-yjs`).
  - [x] Keep `y-protocols` `1.0.7`, `@hocuspocus/server` `4.7.1`, `@hocuspocus/provider` `4.7.1` unchanged; no peer-range-driven move (their peers accept `yjs ^13.6.8`).
  - [x] Lot gate:
    - [x] `grep` the three manifests: exactly one `13.6.33` yjs pin each, zero `13.6.27` remnants.
- [x] **Lot 2 — Recorded closures**
  - [x] `api/src/services/canvas-live/harness.ts` `H3_DEPENDENCY_CLOSURE()`: `yjs: '13.6.33'`.
  - [x] `docs/canvas-live/h3-validation.md`: installed-version row for `yjs` `13.6.33`.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-canvas-yjs` — exit 0.
- [x] **Lot 3 — Targeted local validation**
  - [x] `make test-canvas-live-harness ENV=test-canvas-yjs` — 4 passed (dependency-closure verification against the workspace install, DS witness 8 both providers, kill/restart).
  - [x] `make test-api-endpoints SCOPE=tests/api/canvas-live-hocuspocus.test.ts ENV=test-canvas-yjs` — 7 passed.
  - [x] `make test-api-endpoints SCOPE=tests/api/canvas-live-security.test.ts ENV=test-canvas-yjs` — 9 passed.
  - [x] `make test-api-endpoints SCOPE=tests/api/canvas-live-composition.test.ts ENV=test-canvas-yjs` — 4 passed.
  - [x] `make test-api-endpoints SCOPE=tests/api/canvas-live-quarantine-wiring.test.ts ENV=test-canvas-yjs` — 3 passed.
  - [x] `make scope-check ENV=test-canvas-yjs` before every commit — PASS C2.
  - [x] `make down ENV=test-canvas-yjs` and `make ps` confirm no canvas-yjs services.
- [ ] **Lot 4 — PR and CI**
  - [ ] Final gate step 1: create draft PR to main using this `BRANCH.md` as body.
  - [ ] Final gate step 2: one CI run on the final head; record run id and conclusion; no merge.
