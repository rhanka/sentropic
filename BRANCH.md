# Feature: BR-39l Lot 6 — MCP AuthZ fast-unblock (claude.ai static-client go-live)

## Objective
Make the Sentropic IdP + MCP resource-server kit interoperable with claude.ai's "Custom
credentials for non-DCR servers" flow, using a PRE-REGISTERED STATIC client (no DCR). Add the
RFC 8414 AS-metadata alias, RFC 9207 `iss` authorization-response parameter, RFC 9728 §3.1
correct Protected-Resource-Metadata URL construction (+ a one-minor redirect shim), and an
env-driven `resource_indicators` allowlist on the prod-safe OAuth client registration script.

Note on the `auth-hono` bump: kept to PATCH (0.10.0 → 0.10.1) to stay within
`@sentropic/auth-ui@0.6.0`'s peer-compat ceiling (`^0.10.0`) — a MINOR (0.11.0) would break the
workspace `npm install` (ERESOLVE) and require an out-of-scope `packages/auth-ui/package.json`
peer-range extension. The changes are additive (new endpoints/params); the architect may re-cut
as a minor + extend auth-ui's peer range at merge if preferred.

## Scope / Guardrails
- Make-only workflow, no direct Docker commands.
- Library + register-script + tests only. No prod, no kubectl, no DCR, no `registration_endpoint`.
- Audience-binding (variable-`aud` on the authorization_code flow) is ALREADY SHIPPED in BR-39l
  Lot 2 (`validateResource` in `packages/auth-hono/src/oauth/authorize-handler.ts`) — NOT rebuilt here.
- refresh / `offline_access` (P3) stays DEFERRED — the `offline_access` rejection in
  `authorize-handler.ts validateScope` is NOT relaxed in this branch.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-hono/src/**`
  - `packages/auth-hono/tests/**`
  - `packages/auth-hono/package.json` (version bump — enforce-package-bump)
  - `packages/mcp-auth/src/**`
  - `packages/mcp-auth/tests/**`
  - `packages/mcp-auth/package.json` (version bump — enforce-package-bump)
  - `api/src/scripts/oauth-register-client.ts`
  - `api/tests/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/src/routes/**` (prod/app wiring — architect-owned)
  - prod manifests / kubectl / deploy
  - any DCR / `registration_endpoint` surface
  - the `offline_access` rejection (no relaxation)
- **Conditional Paths (allowed only with explicit exception)**:
  - none used
- **Exception process**:
  - Declare exception ID `BR39L-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `attention` (BR39L-N1, architect handoff — prod wiring, NOT in this branch): the RFC 8414 alias
  and RFC 9207 `iss` are implemented in the `@sentropic/auth-hono` library
  (`createWellKnownRouter`, single source of truth). The api forwarder
  `api/src/routes/well-known.ts` currently forwards only `/openid-configuration` + `/jwks.json`;
  the architect must add a forward for `/oauth-authorization-server` at prod-promote to make the
  8414 alias reachable at `https://auth.sent-tech.ca/.well-known/oauth-authorization-server`.
- `attention` (BR39L-N2, architect/immo handoff — RFC 9728 root serving): the library now advertises
  and serves the RFC 9728 §3.1 correct PRM URL (`/.well-known/oauth-protected-resource/<path>`) via
  `mcpAuthRoutes` (root-mount) and the fetch-style `core.handle()`. The immo MCP server (separate
  repo) consumes `@sentropic/mcp-auth@0.2.0` and mounts `mcpAuthRoutes` at the ROOT (or wires
  `mcp.handle()`); the appended-suffix 308 shim keeps existing MCP clients working for one minor.
  The api SAMPLE router `api/src/routes/api/mcp.ts` (gated OFF by default, NOT the go-live target)
  keeps its current prefix-mount behavior and is out of scope.
- `attention` (BR39L-N3, architect — prod registration, NOT executed here): register the
  immo/claude.ai STATIC client against the prod DB with:
  ```
  OAUTH_CLIENT_ID=immo-mcp \
  OAUTH_CLIENT_NAME="Immo MCP (claude.ai)" \
  OAUTH_CLIENT_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback \
  OAUTH_CLIENT_RESOURCE_INDICATORS=https://immo.sent-tech.ca/mcp \
  OAUTH_CLIENT_SCOPES=openid,immo:read,immo:search,immo:documents:read \
  OAUTH_CLIENT_SECRET=<strong-generated-secret> \
  npm run oauth:register-client
  ```
  (requirePkce=true, tokenEndpointAuthMethod=client_secret_basic are the script defaults; hosted
  redirect_uri = claude.ai's fixed non-DCR callback.)

## AI Flaky tests
- None expected: all added tests are pure unit tests (no provider/network/model nondeterminism).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal lot set; one final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal AuthZ-interop lot; no independent CI needed.

## UAT Management (in orchestration context)
- No UI surface. CI gates (unit tests) are the acceptance; architect owns prod-promote UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Read `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md`, auth-hono + mcp-auth src, `oauth-register-client.ts`.
  - [x] Confirm isolated worktree `tmp/br39l-lot6`.
  - [x] Confirm scope boundaries.

- [x] **Lot 1 — mcp-auth RFC 9728 §3.1 PRM URL + redirect shim**
  - [x] `prm.ts`: `protectedResourceMetadataUrl` inserts the well-known segment BEFORE the resource
        path (RFC 9728 §3.1); add `protectedResourceMetadataPath`, `legacyProtectedResourceMetadataUrl`,
        `legacyProtectedResourceMetadataPath`.
  - [x] `core.ts` `handle()`: serve the PRM at the RFC path (200) + 308 redirect shim at the old
        appended suffix.
  - [x] `hono.ts` `mcpAuthRoutes()`: serve the RFC path + back-compat mount-relative path + 308 shim.
  - [x] Bump `packages/mcp-auth/package.json` 0.1.0 → 0.2.0.
  - [x] Tests: `packages/mcp-auth/tests/prm.test.ts`, `core.test.ts`, `hono.test.ts`.
  - [ ] Lot gate: `make test-api` (CI-gated; Docker) — run in CI on the PR.

- [x] **Lot 2 — auth-hono RFC 8414 alias + RFC 9207 iss**
  - [x] `wellknown-handler.ts`: extract a single AS-metadata builder; serve it at both
        `/openid-configuration` and `/oauth-authorization-server` (8414 alias); advertise
        `authorization_response_iss_parameter_supported: true`; NO `registration_endpoint`.
  - [x] `http-utils.ts`: `redirectWithOAuthError` appends `iss` (RFC 9207) on error redirects.
  - [x] `issue-authorized-code.ts`: append `iss` on the success authorization-response redirect.
  - [x] `authorize-handler.ts` + `consent-decision-handler.ts`: thread `issuer` into every RP
        redirect (success, error, access_denied).
  - [x] Bump `packages/auth-hono/package.json` (src changed).
  - [x] Tests: `packages/auth-hono/tests/oauth-wellknown.test.ts` (8414 alias + iss flag + no
        registration_endpoint), `oauth-authorize.test.ts` (iss on success + error).
  - [ ] Lot gate: `make test-api` (CI-gated; Docker).

- [x] **Lot 3 — oauth-register-client resource_indicators**
  - [x] `oauth-register-client.ts`: `OAUTH_CLIENT_RESOURCE_INDICATORS` (comma-separated https URIs)
        → `resource_indicators` column; keep prod-safe guards; import-safe (guarded direct-run).
  - [x] Test: `api/tests/unit/oauth-register-client.test.ts` (resource_indicators parsed + set).
  - [ ] Lot gate: `make test-api` (CI-gated; Docker).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (CI-gated).
  - [ ] `make test-api` (CI-gated).
  - [x] Bumped affected `packages/<pkg>/package.json` versions (auth-hono + mcp-auth src changed).
  - [ ] PR created with `BRANCH.md` body; CI green; architect merges + prod-promotes (NOT here).
