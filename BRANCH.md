# Feature: Comments C2b — dedicated artifact-comments HTTP router

## Objective
Add a dedicated artifact-comments Hono router over `CommentStore` in `@sentropic/comments` (`./artifact-hono` subpath) with `threadId`-keyed thread verbs, injected per-artifact authorization, HTTP `provenance.toolCallId` enforcement, and the 2048-character `section_key` cap with a stable 400 error code.

## Scope / Guardrails
- Scope limited to `packages/comments` (`artifact-hono.ts`, `artifact-hono.spec.ts`, `package.json`, `CHANGELOG.md`), C0 package-manifest migration receipt (`docs/comments-annotations/contract/package-zod4-migration.json`, `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`), and regenerated lockfiles / cluster-mesh selected packaging fixture.
- Legacy `packages/comments/src/hono.ts`, `packages/comments/src/index.ts`, M2/M3 `packages/cluster-mesh/src/compose/comments.ts`, `packages/cluster-mesh/src/hono/comments-router.ts`, and `api/src/**` remain untouched.
- Make-only workflow, no direct npm/node/docker on the host.
- Isolated worktree `tmp/comments-c2b`, `ENV=test-c2b`, `API_PORT=9196`, `UI_PORT=5396`, `MAILDEV_UI_PORT=1296`.
- In every `make` command, `ENV=test-c2b` is passed as the last argument.
- All code, tests, commits, and PR text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/comments/src/artifact-hono.ts`
  - `packages/comments/src/artifact-hono-ports.ts`
  - `packages/comments/tests/artifact-hono.spec.ts`
  - `packages/comments/package.json`
  - `packages/comments/CHANGELOG.md`
  - `docs/comments-annotations/contract/package-zod4-migration.json`
  - `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
  - `api/package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/comments/src/hono.ts`
  - `packages/comments/src/index.ts`
  - `packages/cluster-mesh/src/**`
  - `api/src/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRC2B-EX1` in `## Feedback Loop` for the C0 package-manifest migration receipt (`docs/comments-annotations/contract/package-zod4-migration.json`, `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`) and consumer lockfiles/fixture alignment required by `enforce-package-bump` and `validate-cluster-mesh`.

## Feedback Loop
- `BRC2B-EX1` (`acknowledge`): Updating `packages/comments/package.json` (`0.3.2` -> `0.3.3` + additive `./artifact-hono` export) requires updating the pinned manifest migration receipt (`docs/comments-annotations/contract/package-zod4-migration.json`, `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`), workspace lockfiles (`package-lock.json`, `api/package-lock.json`), and `packages/cluster-mesh/tests/packaging/fixtures/selected/package{,-lock}.json` so `enforce-package-bump`, C0 boundary checks, and `validate-cluster-mesh` stay green. Impact: additive subpath export only; all 29 frozen M1 source/conformance pins and `.` / `./hono` exports remain unchanged. Rollback: revert the bump/receipt/fixture commit and remove `packages/comments/src/artifact-hono.ts`.

## AI Flaky tests
- None expected for this package-scoped branch; known unrelated CI `data-plane-relay` flake may be documented if encountered.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single focused package lot)
- [ ] **Multi-branch**
- Rationale: Single atomic lot C2b + S4-route over `@sentropic/comments`.

## UAT Management (in orchestration context)
- No UI changes; automated package and boundary gates only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules (`MASTER.md`, `workflow.md`, `testing.md`, `COMMON-RULES.md`), `SPEC-r6.md`, `ds-review-kit-r6-carbon.md`.
  - [x] Create isolated worktree `tmp/comments-c2b` on `feat/comments-c2b-artifact-router` from `origin/main` (`d6093d568`).
  - [x] Verify ports `9196`, `5396`, `1296` are free and `ENV=test-c2b` is passed last.
  - [x] Declare `Allowed Paths`, `Forbidden Paths`, and `BRC2B-EX1`.

- [x] **Lot 1 — Red-first tests and dedicated artifact-comments Hono router**
  - [x] Write `packages/comments/tests/artifact-hono.spec.ts` and verify RED via `make test-comments ENV=test-c2b`.
  - [x] Implement `packages/comments/src/artifact-hono.ts` (~145 LOC) over `CommentStore` with injected authz/tenant/event ports.
  - [x] Verify GREEN via `make build-comments ENV=test-c2b`, `make typecheck-comments ENV=test-c2b`, `make test-comments ENV=test-c2b`.

- [x] **Lot 2 — Subpath export, version bump (`0.3.3`), CHANGELOG, C0 receipt & consumer fixtures**
  - [x] Export `./artifact-hono` and bump `@sentropic/comments` to `0.3.3` in `packages/comments/package.json`; add `packages/comments/CHANGELOG.md`.
  - [x] Update `docs/comments-annotations/contract/package-zod4-migration.json` and `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts` under `BRC2B-EX1`.
  - [x] Regenerate lockfiles (`package-lock.json`, `api/package-lock.json`) and `packages/cluster-mesh/tests/packaging/fixtures/selected/package{,-lock}.json`.
  - [x] Verify `make pack-comments ENV=test-c2b`, `make test-cluster-mesh SCOPE=tests/comments-contract-boundaries.spec.ts ENV=test-c2b`, and `test-lazy-package`.

- [ ] **Lot 3 — Final validation & PR**
  - [ ] Run `make build-comments`, `make typecheck-comments`, `make test-comments`, `make scope-check` (all `ENV=test-c2b`).
  - [ ] Tear down stack with `make down-volumes ENV=test-c2b` and `make clean ENV=test-c2b`.
  - [ ] Drop `BRANCH.md` before final push, open PR, wait for green CI on exact head (do not merge).
