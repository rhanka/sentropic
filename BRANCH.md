# Feature: BR-39d — Service-to-Service Auth (client_credentials + @sentropic/auth-client)

## Objective
Add OAuth2 `client_credentials` grant to the Sentropic IdP so backend services (paas, immo-api, diag-api) mint scoped, audience-bound access tokens without a human, expose a `@sentropic/auth-client` Node helper for consumers, and ship a `createRequireServiceAuth` Hono middleware for resource servers — DPoP opt-in, RFC 8707 resource indicators, single migration.

## Scope / Guardrails
- Scope limited to S2S auth: `packages/auth-hono`, new `packages/auth-client`, `api` host wiring (schema + adapter + one protected route + scripts), tests, CI/Make parity.
- One migration max in `api/drizzle/*.sql` → `0029_service_clients.sql` (0028 already taken by chat attachments on main).
- Make-only workflow, no direct Docker commands. `ENV=<env>` last argument always.
- Root workspace `~/src/sentropic` reserved for user dev/UAT (`ENV=dev`) — must stay stable; never test on `ENV=dev`.
- Branch development happens in isolated worktree `tmp/feat-auth-s2s` only.
- Automated test campaigns run on `ENV=test-feat-auth-s2s` / `ENV=e2e-feat-auth-s2s`, never on root `dev`.
- No breaking changes to `@sentropic/auth-hono` public surface — extend `OauthStateStorePort` and exports additively only.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-hono/src/**`
  - `packages/auth-hono/tests/**`
  - `packages/auth-hono/README.md`
  - `packages/auth-hono/package.json`
  - `packages/auth-client/**` (new package)
  - `api/src/db/schema.ts`
  - `api/src/services/auth/**`
  - `api/src/routes/auth/**`
  - `api/src/scripts/**`
  - `api/tests/api/auth/**`
  - `api/tests/unit/auth/**`
  - `e2e/tests/02-auth-s2s-*.spec.ts`
  - `docs/secrets.md` (S2S env vars + rotation runbook)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - any `ui/**` (S2S is server-side only, no UI surface in 39d)
- **Conditional Paths (allowed only with declared `BR39d-EXn` exception)**:
  - `api/drizzle/0029_service_clients.sql` (max 1 migration file) → `BR39d-EX3`
  - `.github/workflows/ci.yml` (validate/publish-auth-client lanes, filters, bootstrap enum) → `BR39d-EX2`
  - `Makefile` (auth-client targets + `oauth-rotate-service-client`) → `BR39d-EX1`
  - root `package.json` / `package-lock.json` (workspace registration of new package) → `BR39d-EX4`
- **Exception process**:
  - Declare exception ID `BR39d-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
Actions with the following status should be included around tasks only if really required.

- `BR39d-EX1` (Makefile) — `acknowledge`: new npm package requires make wiring per make-only rule. Targets added: `typecheck-auth-client`, `test-auth-client`, `build-auth-client`, `pack-auth-client`, `publish-auth-client`, `publish-auth-client-token`, `oauth-rotate-service-client`. Impact: additive targets only, mirrors `*-auth-hono` exactly. Rollback: delete the added targets.
- `BR39d-EX2` (.github/workflows/ci.yml) — `acknowledge`: new package needs CI parity. Adds `auth_client` + `auth_client_publish` path filters, `validate-auth-client` job (mirror of `validate-auth-hono`), `publish-auth-client` job (mirror of `publish-auth-hono`), `auth-client` to `bootstrap_publish_target` enum + bootstrap step. Impact: additive jobs, no change to existing lanes. Rollback: revert the additions.
- `BR39d-EX3` (api/drizzle/0029_service_clients.sql) — `acknowledge`: single migration creating `service_clients`. Within template's one-migration-max. Rollback: drop migration + table.
- `BR39d-EX4` (root package.json/package-lock.json) — `acknowledge`: register `@sentropic/auth-client` in npm workspace so `api` consumes it. Impact: workspace member add + lockfile. Rollback: remove member.

### Decisions (frozen for 39d, dual-review gated)
- `BR39d-D1` — **DPoP for service clients = opt-in** via `service_clients.dpop_bound_access_tokens boolean default false`. Consistent with `BR39c-D2` (DPoP opt-in for clients; mandatory only for `type ∈ {agent,nhi,mcp_connector}` arriving in 39h). README documents a strong recommendation to enable for production S2S. Reversible: a later branch can flip default or mandate per identity type.
- `BR39d-D2` — **Secret rotation = make target** `make oauth-rotate-service-client CLIENT_ID=<id> ENV=<env>`: generates a new secret, prints it once, replaces `client_secret_hash`, stamps `secret_rotated_at`. Single-secret immediate cutover (operator coordinates consumer redeploy). Zero-downtime dual-secret grace window + admin UI deferred to BR-39g/39h. Reversible.
- `BR39d-D3` — **`@sentropic/auth-client` = Node-only** (server-side consumers). Uses `jose` + Node WebCrypto. Browser variant deferred until a real SPA-mints-S2S need surfaces (`39d-bis`). Reversible.
- `BR39d-D4` — **`aud` = RFC 8707 strict resource indicators**. `service_clients.resource_indicators text[]` lists allowed audiences. Token request carries `resource=<uri>`; issued access-token `aud` = that resource and MUST be in the client's `resource_indicators` (else `invalid_target`). If `resource` omitted and the client has exactly one indicator, default to it; if it has multiple, `resource` is required. `createRequireServiceAuth({requiredScopes, resource})` validates `aud === its own resource`. Prevents cross-service token confusion. Reversible toward looser auto-derive if ever needed.

## AI Flaky tests
- Acceptance rule per `rules/testing.md`: accept only non-systematic provider/network nondeterminism as `flaky accepted` (≥1 success same commit+command). Never add timeouts. S2S suites are deterministic (no AI) → no flaky tolerance expected.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single worktree `tmp/feat-auth-s2s`, one final test cycle)
- [ ] **Multi-branch**
- Rationale: One cohesive vertical slice (schema → grant → middleware → package → host wiring). Lots are sequential with shared contract, not orthogonal — multi-branch would fragment the `OauthStateStorePort` extension. Implementation delegated to one Codex sub-agent (39c pattern), conductor integrates.

## UAT Management (in orchestration context)
- Mono-branch: UAT after lots complete. S2S has **no UI surface** → UAT is a scripted API round-trip (mint token via `client_credentials`, call a protected route through `createRequireServiceAuth`, observe 200; then negative cases) run by the user from root `ENV=dev`, plus npm dry-run inspection of `@sentropic/auth-client` pack.
- Push branch before UAT; run UAT from root workspace; switch back to `tmp/feat-auth-s2s` after.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`, `rules/architecture.md`.
  - [ ] Read `packages/auth-hono/README.md`, `packages/auth-hono/src/oauth/*`, `packages/auth-hono/src/ports.ts`, `api/src/services/auth/oauth-state-adapter.ts`, `api/src/db/schema.ts` (oauth_clients), `api/drizzle/0027_oauth_clients.sql`.
  - [ ] Confirm worktree `tmp/feat-auth-s2s` on branch `feat/auth-s2s` (verify `git branch --show-current`).
  - [ ] Env/port mapping (BR-39 slot 3): `API_PORT=9198`, `UI_PORT=5398`, `MAILDEV_UI_PORT=1298`; `ENV=test-feat-auth-s2s` (API/unit/integration) and `ENV=e2e-feat-auth-s2s` (E2E). `make ps-all` to confirm no conflict.
  - [ ] Confirm command style `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Validate scope boundaries + declare `BR39d-EX1..EX4` (above).
  - [ ] Confirm decisions `BR39d-D1..D4` (above) — pending dual adversarial review gate.

- [ ] **Lot 1 — Schema & port contract (`service_clients`)**
  - [ ] `api/drizzle/0029_service_clients.sql`: `service_clients` table — `id text PK`, `client_id text UNIQUE NOT NULL`, `client_secret_hash text NOT NULL`, `display_name text`, `allowed_scopes text[] NOT NULL`, `resource_indicators text[] NOT NULL DEFAULT '{}'`, `dpop_bound_access_tokens boolean NOT NULL DEFAULT false`, `tenant_id text NULL` (multi-tenant hook `BR39c-D18`), `secret_rotated_at timestamp`, `created_at timestamp NOT NULL DEFAULT now()`, `revoked_at timestamp NULL`.
  - [ ] `api/src/db/schema.ts`: drizzle `serviceClients` table mapping mirroring the migration.
  - [ ] `packages/auth-hono/src/oauth/state-store-types.ts`: add `ServiceClientRecord` interface + `OauthStateStorePort.findServiceClient(clientId): Promise<ServiceClientRecord | null>` (additive, non-breaking).
  - [ ] `api/src/services/auth/oauth-state-adapter.ts`: implement `findServiceClient` (filter `revoked_at IS NULL`).
  - [ ] Memory state-store fixture (`packages/auth-hono/tests/**` helper) extended with service clients for handler tests.
  - [ ] Lot gate:
    - [ ] `make typecheck-auth-hono` + `make typecheck-api` + `make lint-auth-hono`
    - [ ] **API tests**: `api/tests/unit/auth/oauth-state-adapter.test.ts` — add `findServiceClient` cases (found / revoked / missing). Run `make test-api SCOPE=tests/unit/auth/oauth-state-adapter.test.ts ENV=test-feat-auth-s2s`.
    - [ ] Sub-lot gate: `make test-auth-hono` + `make test-api ENV=test-feat-auth-s2s`

- [ ] **Lot 2 — `client_credentials` grant on token endpoint**
  - [ ] `packages/auth-hono/src/oauth/token-handler.ts`: branch on `grant_type=client_credentials` → authenticate via `client_secret_basic`/`client_secret_post` against `findServiceClient`; intersect requested `scope` with `allowed_scopes` (reject `invalid_scope` if any requested scope not allowed); resolve `resource` per `BR39d-D4` (`invalid_target` on mismatch); DPoP `cnf={jkt}` per `BR39d-D1`; issue `access_token` only (no `id_token`, no `refresh_token` per `BR39c-D13`); `aud` = resolved resource; persist `TokenMeta` (userId null) for introspection/revoke.
  - [ ] Extend `TokenMeta`/`saveTokenMeta` usage to allow `userId: null` for service tokens (additive).
  - [ ] `packages/auth-hono/src/oauth/wellknown-handler.ts`: `grant_types_supported: ['authorization_code', 'client_credentials']`.
  - [ ] Lot gate:
    - [ ] `make typecheck-auth-hono` + `make lint-auth-hono`
    - [ ] **auth-hono tests**: `packages/auth-hono/tests/oauth-client-credentials.test.ts` — happy path (Basic + POST), DPoP-bound happy path (`cnf.jkt` present, `token_type=DPoP`), errors: wrong secret (`invalid_client`), scope not allowed (`invalid_scope`), revoked client, unknown `resource` (`invalid_target`), missing `resource` with multiple indicators. Update `oauth-wellknown` test for new `grant_types_supported`.
    - [ ] Sub-lot gate: `make test-auth-hono`

- [ ] **Lot 3 — `createRequireServiceAuth` middleware (resource server)**
  - [ ] `packages/auth-hono/src/middleware.ts` (or new `src/oauth/service-auth-middleware.ts`): `createRequireServiceAuth({issuer, requiredScopes, resource, ports})` → parse `Authorization: Bearer|DPoP <jwt>`; JWKS verify via `JwksPort` (kid lookup + cache); validate `iss`, `aud === resource`, `exp`, `scope ⊇ requiredScopes`; if DPoP-bound (`cnf.jkt`) require + verify `DPoP` proof (RFC 9449: `htm`/`htu`/`ath`/`jti` anti-replay via `recordDpopJti`); set `c.set('serviceClient', {...})`; 401/403 with WWW-Authenticate on failure.
  - [ ] Export from `packages/auth-hono/src/index.ts`.
  - [ ] Lot gate:
    - [ ] `make typecheck-auth-hono` + `make lint-auth-hono`
    - [ ] **auth-hono tests**: `packages/auth-hono/tests/service-auth-middleware.test.ts` — pass (Bearer + DPoP), reject: missing token, bad signature, wrong `aud`, expired, missing required scope, DPoP proof missing/replayed/`ath` mismatch.
    - [ ] Sub-lot gate: `make test-auth-hono`

- [ ] **Lot 4 — New package `@sentropic/auth-client` (Node consumer helper)**
  - [ ] `packages/auth-client/` scaffold: `package.json` (name `@sentropic/auth-client`, version `0.1.0`, ESM, `jose` dep, mirror auth-hono tsconfig/build/test config), `README.md`, `src/index.ts`, `tsconfig.json`, `vitest.config.ts`.
  - [ ] `createAuthClient({issuer, clientId, clientSecret, dpop?, resource?, scope?})` → `getToken({scope?, resource?}) → Promise<{access_token, token_type, expires_at}>` with in-memory cache + auto-refresh on expiry (refresh skew ~30s); DPoP keypair generation (Ed25519 via `jose`) + per-request proof builder when `dpop:true`.
  - [ ] Lot gate:
    - [ ] `make typecheck-auth-client` (`BR39d-EX1`) + `make lint` for package
    - [ ] **auth-client tests**: `packages/auth-client/tests/auth-client.test.ts` — token fetch + cache reuse, refresh on expiry, scope/resource forwarding, DPoP proof shape; integration against an in-process mock IdP (reuse auth-hono router with memory state store) for a real round-trip.
    - [ ] Sub-lot gate: `make test-auth-client`

- [ ] **Lot 5 — Host wiring in Sentropic API (real consumer co-design)**
  - [ ] Per `feedback_contract_consumer_codesign`: exercise BOTH contracts against a real host flow, not just package mocks.
  - [ ] `api/src/routes/auth/*` (or internal route module): mount one protected internal route guarded by `createRequireServiceAuth({requiredScopes:['service:ping'], resource:<api resource uri>})` returning a minimal JSON — proves the middleware in the real app (session/cookie/error-shape concerns).
  - [ ] `api/src/services/auth/oauth-client-seed.ts` (+ `api/src/scripts/oauth-seed-clients.ts`): seed a sample `service_clients` row for dev/test/e2e.
  - [ ] Wire `grant_types` allow-list so `oauth_clients` vs `service_clients` paths stay separate (per `BR39c-D1`).
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **API tests**: `api/tests/api/auth/service-auth-middleware.test.ts` — full host round-trip: mint token via `client_credentials` against mounted IdP, call protected route → 200; negative: no token → 401, wrong scope → 403, wrong `aud`/`resource` → 401. Extend `api/tests/unit/auth/oauth-state-adapter.test.ts` if needed.
    - [ ] Sub-lot gate: `make test-api ENV=test-feat-auth-s2s`
    - [ ] **E2E (optional, API-level)**: `e2e/tests/02-auth-s2s-client-credentials.spec.ts` — against running stack: token endpoint round-trip + protected route. Prepare: `make build-api build-ui-image API_PORT=9198 UI_PORT=5398 MAILDEV_UI_PORT=1298 ENV=e2e-feat-auth-s2s`. Run scoped then group gate per `.github/workflows/ci.yml` split.

- [ ] **Lot 6 — CI / Make / ops parity**
  - [ ] `Makefile` (`BR39d-EX1`): add `typecheck-auth-client`, `test-auth-client`, `build-auth-client`, `pack-auth-client`, `publish-auth-client`, `publish-auth-client-token`, `oauth-rotate-service-client CLIENT_ID=... ENV=...` (mirror `*-auth-hono`).
  - [ ] `.github/workflows/ci.yml` (`BR39d-EX2`): add `auth_client` + `auth_client_publish` filters (`packages/auth-client/**`), `validate-auth-client` job (mirror `validate-auth-hono`), `publish-auth-client` job (mirror `publish-auth-hono`, gated on main), `auth-client` in `bootstrap_publish_target` enum + bootstrap step.
  - [ ] root `package.json`/`package-lock.json` (`BR39d-EX4`): register workspace member.
  - [ ] `docs/secrets.md`: document S2S env (resource URIs, sample service client provisioning), `oauth-rotate-service-client` runbook, DPoP recommendation.
  - [ ] Lot gate: `make typecheck` + `make lint` clean; CI dry concerns reviewed.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] `packages/auth-hono/README.md`: document `client_credentials` grant, `findServiceClient` port method, `createRequireServiceAuth`, RFC 8707 resource indicators, DPoP S2S recommendation.
  - [ ] `packages/auth-client/README.md`: consumer quickstart (Node), `createAuthClient`/`getToken`, DPoP opt-in.
  - [ ] If `spec/BRANCH_SPEC_EVOL.md` was created, integrate into specs then delete it.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck` + `make lint` (auth-hono, auth-client, api)
  - [ ] Retest auth-hono: `make test-auth-hono`
  - [ ] Retest auth-client: `make test-auth-client`
  - [ ] Retest API: `make test-api ENV=test-feat-auth-s2s`
  - [ ] Retest E2E (if added): group gates per `.github/workflows/ci.yml` split, `ENV=e2e-feat-auth-s2s`
  - [ ] Version bumps (enforced by CI `enforce-package-bump`): `packages/auth-hono` `0.3.0 → 0.4.0` (minor: new grant + middleware); new `packages/auth-client` `0.1.0`. `auth-ui` unchanged.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` as PR body.
  - [ ] Final gate step 2: run/verify branch CI on PR; resolve blockers (incl. `enforce-package-bump`, `validate-auth-client`).
  - [ ] Final gate step 3: once UAT + CI green → commit removal of `BRANCH.md`, push, merge. First publish of `@sentropic/auth-client` via `bootstrap_publish_target=auth-client` then attach OIDC trusted publisher (Playwright, `feedback_npm_trusted_publisher_via_playwright`). Note: `auth-hono` 0.4.0 publish may need the bootstrap fallback (trusted publisher still broken — handover §3).
