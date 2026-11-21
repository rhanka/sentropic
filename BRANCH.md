# Feature: Comments C2c — artifact-comments namespace in api

## Objective
Mount the `@sentropic/comments/artifact-hono` router as its own namespace in `api/`, wired to the C2a per-artifact authorization resolver, `PgCommentStore`, and `PgNotifyCommentEventSink`, with real PostgreSQL API endpoint tests.

## Scope / Guardrails
- Scope limited to `api/src/routes/namespaces/artifact-comments*.ts`, `api/src/app.ts` mount, `api/vitest.config.ts` alias, and `api/tests/api/artifact-comments.test.ts`.
- Do not touch `packages/comments/src/hono.ts`, the M2/M3 `/comments` router, or MCP tools (C2d).
- Make-only workflow, Docker-first, `ENV=test-c2c` last, ports `API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296`.
- Atomic commits under 150 lines via `make commit MSG="..."`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/routes/namespaces/artifact-comments.ts`
  - `api/src/routes/namespaces/artifact-comments-ports.ts`
  - `api/src/app.ts`
  - `api/vitest.config.ts`
  - `api/tests/api/artifact-comments.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/comments/src/hono.ts`
  - `packages/cluster-mesh/src/hono/comments-router.ts`
  - `packages/cluster-mesh/src/compose/comments.ts`
  - `api/src/routes/namespaces/comments.ts`
  - `api/src/routes/namespaces/comments-ports.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- None.

## AI Flaky tests
- None.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: Single isolated lot (~145 LOC) on `feat/comments-c2c-api-mount`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, `SPEC-r6.md`, and `ds-review-kit-r6-carbon.md`.
  - [x] Create isolated worktree `tmp/comments-c2c` on `feat/comments-c2c-api-mount` from `origin/main`.
  - [x] Define environment `ENV=test-c2c` and ports `API_PORT=9196 UI_PORT=5396 MAILDEV_UI_PORT=1296`.
- [x] **Lot 1 — Artifact-comments namespace & API tests (test-first)**
  - [x] Add `@sentropic/comments/artifact-hono` vitest alias in `api/vitest.config.ts`.
  - [x] Write `api/tests/api/artifact-comments.test.ts` covering every verb, refusal, reply inheritance, unassign, and `PgNotifyCommentEventSink` emission.
  - [x] Implement `api/src/routes/namespaces/artifact-comments-ports.ts` and `api/src/routes/namespaces/artifact-comments.ts`.
  - [x] Mount the artifact-comments namespace router in `api/src/app.ts`.
  - [x] Run `make typecheck-api`, `make test-api-endpoints SCOPE=tests/api/artifact-comments.test.ts`, `make lint-api`, `make scope-check` with `ENV=test-c2c`.
- [ ] **Lot 2 — Final validation & PR**
  - [ ] Tear down test stack (`make down-volumes` / `make down` + `make clean` for `ENV=test-c2c`).
  - [ ] Remove `BRANCH.md` before final push and open PR.
  - [ ] Verify CI green on exact head.
