# Feature: Gmail MCP Invoke Surface

## Objective
Deliver the public MCP resource-server route for Gmail and Google Drive P1 read capabilities, backed only by the existing connector-host mount and its secret boundary.

## Scope / Guardrails
- Scope limited to the MCP route, existing connector-host helpers only when a thin dispatcher is required, API tests, and this plan.
- No new egress, token decryption, refresh, secret store, database schema, migration, package, Makefile, or Compose change.
- The route maps the verified OAuth `sub` directly to the app `userId`: `packages/auth-hono/src/oauth/token-handler.ts` issues user access-token `sub` from `codePayload.userId`, and `api/src/routes/auth/oauth.ts` maps that value to `users.id`.
- The route resolves the default workspace with `resolveDefaultWorkspaceId(userId)` only when the request provides no `workspaceRef`; the mount still enforces workspace access.
- `GMAIL_SMOKE_READONLY_TOKEN` enables the opt-in real Gmail readonly smoke test; it is skipped when unset and must never be committed or used with `ENV=dev`.
- All commands use Make targets, automated tests use `ENV=test-mcp-gmail-invoke-surface`, and all new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/api/mcp.ts`
  - `api/src/services/connector-host/**`
  - `api/tests/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/**`
  - `api/src/services/secret-crypto.ts`
  - `api/drizzle/**`
  - `drizzle/**`
  - `Makefile`
  - `docker-compose*.yml`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare `BR-MCP-GMAIL-EXn` with reason, impact, and rollback before touching a conditional or forbidden path.

## Feedback Loop
- [x] `BR-MCP-GMAIL-ACK1` — OAuth subject mapping is proven by the issuer and app user adapter; no subject lookup or new query is required.

## AI Flaky tests
- [ ] No AI test is in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one public route and one hermetic API integration lane share the same principal and secret boundary.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and principal mapping**
  - [x] Confirm `feat/mcp-gmail-invoke-surface` is based on current `origin/main` and passes `harness check branch`.
  - [x] Verify OAuth `sub === users.id` and locate `resolveDefaultWorkspaceId` for the fallback workspace.
  - [x] Confirm the target route’s disabled guard and RFC 9728 metadata route must remain byte-for-byte unchanged.

- [ ] **Lot 1 — Route through the connector-host mount**
  - [ ] Parse the shared invoke/resource-read body without exposing schema internals.
  - [ ] Resolve one `(userId, workspaceId)`, select only Gmail or Google Drive hosts, and pass `sessionPrincipalSub === userId`.
  - [ ] Preserve mount envelopes and map typed connector outcomes to stable HTTP statuses.
  - [ ] Add the resources-read guarded route without changing the existing invoke guard, disabled guard, or PRM route.
  - [ ] Lot gate: `make typecheck-api`, `make lint-api`, and scoped MCP resource-server tests.

- [ ] **Lot 2 — Hermetic route coverage**
  - [ ] Extend `api/tests/api/mcp-resource-server.test.ts` with real signed MCP tokens, connected Gmail account seeding, mocked JWKS and Google egress, no-token assertions, scope rejection, allowlist denial, principal binding, and both secret outcomes.
  - [ ] Add the opt-in `GMAIL_SMOKE_READONLY_TOKEN` smoke case, skipped unless explicitly supplied.
  - [ ] Lot gate: run the scoped API suite on `ENV=test-mcp-gmail-invoke-surface` and record exact outcomes.

- [ ] **Lot 3 — Final validation and PR**
  - [ ] Run `make typecheck-api`, `make lint-api`, `make scope-check`, and the focused API suite with `ENV=test-mcp-gmail-invoke-surface`.
  - [ ] Create and push a PR to `main` with this file as the body; do not merge.
