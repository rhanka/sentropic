# Feature: BR-39d — Service-to-Service Auth (client_credentials + @sentropic/auth-client)

## Objective
Add OAuth2 `client_credentials` grant to the Sentropic IdP so backend services (paas, immo-api, diag-api) mint scoped, audience-bound, stateless access tokens without a human, expose a `@sentropic/auth-client` Node helper for consumers, and ship a `createRequireServiceAuth` Hono middleware for resource servers — DPoP opt-in, RFC 8707 resource indicators, single migration, no change to the shipped `oauth_tokens` table.

## Scope / Guardrails
- Scope limited to S2S auth: `packages/auth-hono`, new `packages/auth-client`, `api` host wiring (schema + adapter + one protected route + one outbound consumer + scripts), tests, CI/Make parity.
- One migration max in `api/drizzle/*.sql` → `0029_service_clients.sql` (0028 already taken by chat attachments; `0029` confirmed as next free number).
- Service tokens are **stateless** (`BR39d-D5`): no row in `oauth_tokens`, no change to its `user_id`/FK constraints. Revocation/introspection of service tokens deferred to BR-39h.
- Make-only workflow, no direct Docker commands. `ENV=<env>` last argument always.
- Root workspace `~/src/sentropic` reserved for user dev/UAT (`ENV=dev`) — must stay stable; never test on `ENV=dev`.
- Branch development happens in isolated worktree `tmp/feat-auth-s2s` only.
- Automated test campaigns run on `ENV=test-feat-auth-s2s` / `ENV=e2e-feat-auth-s2s`, never on root `dev`.
- No breaking changes to `@sentropic/auth-hono` public surface — extend `OauthStateStorePort` and exports additively/optionally only.
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
  - `api/Dockerfile` (COPY + build wiring so `api` imports `@sentropic/auth-client`) → `BR39d-EX5`
- **Exception process**:
  - Declare exception ID `BR39d-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
Actions with the following status should be included around tasks only if really required.

- `BR39d-Q3` (auth-hono 0.4.0 bump breaks auth-ui peer, OPEN, BLOCKING the lockfile/bump gate) — Bumping `@sentropic/auth-hono` 0.3.0 → 0.4.0 (per Lot N + required by the touched `src/**`) breaks the workspace lockfile: `@sentropic/auth-ui@0.3.0` declares `peerDependencies: { "@sentropic/auth-hono": "^0.3.0" }`, and `^0.3.0` excludes `0.4.0`. `make lock-root` fails with ERESOLVE. `packages/auth-ui/**` is a Forbidden Path and BRANCH.md says "auth-ui unchanged", so I did NOT edit it. Options: **(A, recommended)** widen auth-ui peer to `"^0.3.0 || ^0.4.0"` + patch-bump auth-ui 0.3.0→0.3.1 (additive, reversible; needs a Forbidden-path exception `BR39d-EX6`), then `make lock-root`; **(B)** keep auth-hono at a 0.3.x bump (e.g. 0.3.1) — but a new grant + new middleware is a feature and warrants a minor, so this is wrong semver; **(C)** `--legacy-peer-deps` — rejected, masks a real ERESOLVE that npm consumers of auth-ui@0.3.0 + auth-hono@0.4.0 would also hit. The auth-hono `package.json` is left at `0.4.0` (correct per spec). Conductor must pick A (preferred) and run `make lock-root` to finalize the lockfile, OR direct option B. Until resolved, the lockfile is NOT regenerated for the 0.4.0 bump.
- `BR39d-Q2` (e2e seed wiring, OPEN, needs micro-EX) — The optional E2E spec `e2e/tests/02-auth-s2s-client-credentials.spec.ts` needs the e2e DB to contain the `example-service-rp` service client. Seeding happens in `api/tests/utils/seed-test-data.ts` (calls `seedOAuthClients()`), which is OUTSIDE this branch's Allowed Paths. To run the E2E lane, add one line `await seedServiceClients();` next to the existing `seedOAuthClients()` call (import from `../../src/services/auth/oauth-client-seed`). Recommendation: conductor approves a 1-line micro-exception (or folds it into `api/tests/utils` allowance) since the seed helper is already implemented and exported. Non-blocking for unit/integration gates; only gates the optional E2E lane.
- `BR39d-Q1` (infra blocker, OPEN) — Host Docker IPv4 network pool exhausted: every compose-network target (`make typecheck-api`, `make test-api`, dev/e2e stacks) fails with `could not find an available, non-overlapping IPv4 address pool`. Remedy is `docker network prune` but raw `docker` is blocked by the agent sandbox and no `make` target prunes networks. Package-only gates (`make typecheck-auth-hono`, `make test-auth-hono`, `make build-auth-hono`, `make pack-auth-hono`, `make typecheck-auth-client`, `make test-auth-client`) use `docker run` (no network) and PASS. Conductor must `docker network prune -f` on the host (non-destructive, preserves volumes), then re-run the api/e2e gates. All source for api/CI/Make/docs lots is written and committed; only the api-runtime test/typecheck execution is pending.
- `BR39d-EX1` (Makefile) — `acknowledge`: new npm package requires make wiring per make-only rule. Targets added: `typecheck-auth-client`, `test-auth-client`, `build-auth-client`, `pack-auth-client`, `publish-auth-client`, `publish-auth-client-token`, `oauth-rotate-service-client`. Impact: additive targets only, mirrors `*-auth-hono` exactly. Rollback: delete the added targets.
- `BR39d-EX2` (.github/workflows/ci.yml) — `acknowledge`: new package needs CI parity. Adds `auth_client` + `auth_client_publish` path filters, `validate-auth-client` job (mirror of `validate-auth-hono`), `publish-auth-client` job (mirror of `publish-auth-hono`), `auth-client` to `bootstrap_publish_target` enum + bootstrap step. Impact: additive jobs, no change to existing lanes. Rollback: revert the additions.
- `BR39d-EX3` (api/drizzle/0029_service_clients.sql) — `acknowledge`: single migration creating `service_clients` only (no `oauth_tokens` ALTER, per `BR39d-D5`). Within template's one-migration-max. Rollback: drop migration + table.
- `BR39d-EX4` (root package.json/package-lock.json) — `acknowledge`: register `@sentropic/auth-client` in npm workspace so `api` consumes it. Impact: workspace member add + lockfile. Rollback: remove member.
- `BR39d-EX5` (api/Dockerfile) — `acknowledge`: `api` imports `@sentropic/auth-client` (dogfood S2S consumer, `BR39d-D10`) → Dockerfile must COPY `packages/auth-client/package.json` + build it in the workspace step, mirroring the existing auth-hono lines. Impact: additive COPY/build lines only. Rollback: remove them.

**Decisions (frozen for 39d, dual-review gated — Opus 4.8 + Codex 5.5-high, 2026-06-01):**
- `BR39d-D1` — **DPoP for service clients = opt-in** via `service_clients.dpop_bound_access_tokens boolean default false`. Consistent with `BR39c-D2` (mandatory only for `type ∈ {agent,nhi,mcp_connector}` arriving in 39h). README documents a strong recommendation to enable for production S2S. Reversible.
- `BR39d-D2` — **Secret rotation = make target** `make oauth-rotate-service-client CLIENT_ID=<id> ENV=<env>`: generates a new secret, prints it once, replaces `client_secret_hash`, stamps `secret_rotated_at`. Single-secret immediate cutover (operator coordinates consumer redeploy). Zero-downtime dual-secret grace window + admin UI deferred to BR-39g/39h. Reversible.
- `BR39d-D3` — **`@sentropic/auth-client` = Node-only** (server-side consumers). Uses `jose` + Node WebCrypto. Browser variant deferred (`39d-bis`). Reversible.
- `BR39d-D4` — **`aud` = RFC 8707 strict resource indicators**. `service_clients.resource_indicators text[]` lists allowed audiences. Token request carries `resource=<uri>`; issued access-token `aud` = that resource and MUST be in the client's `resource_indicators`. Resolution rule: 1 indicator + no `resource` ⇒ use it; >1 indicator + no `resource` ⇒ `invalid_target`; 0 indicators ⇒ `resource` required else `invalid_target`; requested `resource` not in list ⇒ `invalid_target`. `createRequireServiceAuth({requiredScopes, resource})` validates `aud === its own resource`. Reversible.
- `BR39d-D5` — **Service tokens are STATELESS** (user decision, 2026-06-01). `client_credentials` issues a signed Ed25519 JWT and does NOT call `saveTokenMeta` → no `oauth_tokens` row, no schema/FK change to the shipped table. Security control = short TTL (`OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC`, default `900`) + DPoP recommendation. Revocation + introspection of service tokens are **deferred to BR-39h** (which reworks token tables under the unified identities model). Resource servers verify statelessly via JWKS, so no DB dependency. Consequence: no immediate kill-switch before expiry — mitigated by short TTL + secret rotation (stops new tokens). `TokenMeta.userId` is NOT widened (no service rows persisted). Reversible.
- `BR39d-D6` — **Narrow port for `createRequireServiceAuth`** (Opus M5, co-design lesson `feedback_contract_consumer_codesign`): accept `ServiceAuthPorts = Pick<AuthHonoPorts, 'jwks' | 'clock'> & { dpopReplay?: Pick<OauthStateStorePort, 'recordDpopJti'> }` — NOT the full 15-port `AuthHonoPorts`. RS consumers must not construct users/credentials/sessions/email ports just to verify a bearer token. Reversible.
- `BR39d-D7` — **DPoP at the resource server enforces `ath`** (B2): the middleware passes the bound access token into `verifyOAuthDpopProof` (RFC 9449 §4.3 `ath` binding) and records `jti` anti-replay via `dpopReplay.recordDpopJti` with a symmetric acceptance window (`iatSkew`, default 60s). Without `ath`, a stolen DPoP proof + token would replay. Reversible.
- `BR39d-D8` — **`findServiceClient` is OPTIONAL on `OauthStateStorePort`** (Codex MAJOR): declared `findServiceClient?(clientId): Promise<ServiceClientRecord | null>` so existing implementors of the published `0.3.0` contract keep compiling. The handler treats absence as "service grant unsupported" (`unsupported_grant_type`). Additive, non-breaking. Reversible.
- `BR39d-D9` — **Discovery + error semantics**: `.well-known/openid-configuration` advertises `grant_types_supported: ['authorization_code','client_credentials']` and `token_endpoint_auth_methods_supported: ['client_secret_basic','client_secret_post','none']`. Error codes pinned: missing/invalid client auth ⇒ `invalid_client` (401); requested scope ⊄ allowed ⇒ `invalid_scope`; `resource` unknown/ambiguous/zero ⇒ `invalid_target`. Empty/absent `scope` ⇒ grant the client's full `allowed_scopes` (RFC 6749 §4.4.2). Reversible.
- `BR39d-D10` — **`auth-client` activation via `api` dogfooding** (Opus M1 + `rules/architecture.md` activation rule): `api` imports `@sentropic/auth-client` and uses it for a real outbound mint→call loop against its own `createRequireServiceAuth`-protected route (self-S2S health/ping). Satisfies "≥1 app root imports through workspace wiring", exercises the full client contract on a real host, and provides the UAT artifact. Requires `BR39d-EX5` (api/Dockerfile). Reversible.

**Deferred to BR-39h:**
- Service-token revocation + introspection (stateless in 39d per `BR39d-D5`).
- Zero-downtime dual-secret rotation grace window + admin UI (per `BR39d-D2`, also BR-39g).
- Fusion of `oauth_clients` + `service_clients` into unified `identities` table.

**Post-merge external action (NOT a pre-UAT blocker):** register `validate-auth-client` as a required status check in GitHub branch protection (repo-admin UI) once the job exists.

## AI Flaky tests
- Acceptance rule per `rules/testing.md`: accept only non-systematic provider/network nondeterminism as `flaky accepted` (≥1 success same commit+command). Never add timeouts. S2S suites are deterministic (no AI) → no flaky tolerance expected.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single worktree `tmp/feat-auth-s2s`, one final test cycle)
- [ ] **Multi-branch**
- Rationale: One cohesive vertical slice (schema → grant → middleware → package → host wiring). Lots are sequential with a shared contract (`OauthStateStorePort` extension), not orthogonal — multi-branch would fragment it. Implementation delegated to one Codex sub-agent (39c pattern); conductor integrates.

## UAT Management (in orchestration context)
- Mono-branch: UAT after lots complete. S2S has **no UI surface** → UAT is a scripted API round-trip run by the user from root `ENV=dev`: (1) mint a token via `client_credentials` (Basic + POST), (2) call the `createRequireServiceAuth`-protected route → 200, (3) negative cases (no token → 401, wrong scope → 403, wrong `resource`/`aud` → 401, wrong secret → 401), (4) DPoP-bound happy path, (5) `npm pack` dry-run inspection of `@sentropic/auth-client`, (6) the `api` self-S2S dogfood loop succeeds.
- Push branch before UAT; run UAT from root workspace; switch back to `tmp/feat-auth-s2s` after.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`, `rules/architecture.md`.
  - [x] Read `packages/auth-hono/README.md`, `packages/auth-hono/src/oauth/*`, `packages/auth-hono/src/ports.ts`, `api/src/services/auth/oauth-state-adapter.ts`, `api/src/db/schema.ts` (oauth_clients + token tables), `api/drizzle/0027_oauth_clients.sql`.
  - [x] Confirm worktree `tmp/feat-auth-s2s` on branch `feat/auth-s2s` (`git branch --show-current`).
  - [x] Env/port mapping (BR-39 slot 3): `API_PORT=9198`, `UI_PORT=5398`, `MAILDEV_UI_PORT=1298`; `ENV=test-feat-auth-s2s` and `ENV=e2e-feat-auth-s2s`. `make ps-all` to confirm no conflict.
  - [x] Confirm command style `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Validate scope boundaries + decisions `BR39d-D1..D10` + exceptions `BR39d-EX1..EX5` (above).

- [x] **Lot 1 — Schema & port contract (`service_clients`)**
  - [x] `api/drizzle/0029_service_clients.sql`: `service_clients` table ONLY — `id text PK`, `client_id text UNIQUE NOT NULL`, `client_secret_hash text NOT NULL`, `display_name text`, `allowed_scopes text[] NOT NULL`, `resource_indicators text[] NOT NULL DEFAULT '{}'`, `dpop_bound_access_tokens boolean NOT NULL DEFAULT false`, `tenant_id text NULL` (hook `BR39c-D18`), `secret_rotated_at timestamp`, `created_at timestamp NOT NULL DEFAULT now()`, `revoked_at timestamp NULL`. No `oauth_tokens` ALTER (`BR39d-D5`). (+ `_journal.json` idx 29 entry so drizzle migrator applies it.)
  - [x] `api/src/db/schema.ts`: drizzle `serviceClients` table mirroring the migration.
  - [x] `packages/auth-hono/src/oauth/state-store-types.ts`: add `ServiceClientRecord` interface + **optional** `findServiceClient?(clientId): Promise<ServiceClientRecord | null>` on `OauthStateStorePort` (`BR39d-D8`). Export `ServiceClientRecord` from `ports.ts`/`index.ts`.
  - [x] `api/src/services/auth/oauth-state-adapter.ts`: implement `findServiceClient` (filter `revoked_at IS NULL`).
  - [x] Memory state-store fixture extended with service clients for handler tests.
  - [ ] Lot gate:
    - [x] `make typecheck-auth-hono` PASS. `make typecheck-api` BLOCKED (`BR39d-Q1` docker net pool). `make lint-auth-hono` n/a (no such target; CI validates auth-hono via typecheck+test+build+pack).
    - [x] **API tests**: `api/tests/unit/auth/oauth-state-adapter.test.ts` — `findServiceClient` cases (found / revoked / missing) WRITTEN. Execution BLOCKED (`BR39d-Q1`).
    - [x] Sub-lot gate: `make test-auth-hono` PASS (80 tests). `make test-api ENV=test-feat-auth-s2s` BLOCKED (`BR39d-Q1`).

- [x] **Lot 2 — `client_credentials` grant on token endpoint (stateless)**
  - [x] `packages/auth-hono/src/oauth/token-handler.ts`: branch on `grant_type=client_credentials` (keep `authorization_code` path untouched) → authenticate `client_secret_basic`/`client_secret_post` against `findServiceClient` (via `ports.tokens.hashSecret` — host impl is sha256, not Argon2id; the contract is the port); empty/absent `scope` ⇒ full `allowed_scopes`, else subset check (`invalid_scope` on superset); resolve `resource` per `BR39d-D4` (`invalid_target`); DPoP `cnf={jkt}` per `BR39d-D1`; issue a signed **access_token only** (no `id_token`, no `refresh_token`, `aud` = resolved resource, TTL `serviceAccessTokenTtlSeconds` default 900); **do NOT call `saveTokenMeta`** (`BR39d-D5`). Uses resolved resource as `aud`, not the userinfo constant.
  - [x] `packages/auth-hono/src/oauth/wellknown-handler.ts`: `grant_types_supported` + `token_endpoint_auth_methods_supported` per `BR39d-D9`.
  - [x] If `findServiceClient` is undefined on the port, `client_credentials` ⇒ `unsupported_grant_type` (`BR39d-D8`).
  - [x] Lot gate:
    - [x] `make typecheck-auth-hono` PASS. `make lint-auth-hono` n/a (no such target).
    - [x] **auth-hono tests**: `packages/auth-hono/tests/oauth-client-credentials.test.ts` (11 tests) — happy (Basic + POST), DPoP-bound happy (`cnf.jkt`, `token_type=DPoP`), no-`scope` ⇒ all allowed, errors: wrong secret (`invalid_client`), scope superset (`invalid_scope`), revoked client, unknown `resource` (`invalid_target`), missing `resource` with >1 indicator (`invalid_target`), 0 indicators + no resource (`invalid_target`), unsupported when port lacks findServiceClient. Updated `oauth-wellknown` test for new metadata. Asserts NO token-meta row written (`store.tokens.size === 0`).
    - [x] Sub-lot gate: `make test-auth-hono` PASS (91 tests).

- [x] **Lot 3 — `createRequireServiceAuth` middleware (resource server)**
  - [x] `packages/auth-hono/src/oauth/service-auth-middleware.ts`: `createRequireServiceAuth({issuer, requiredScopes, resource, ports})` where `ports: ServiceAuthPorts` (narrow, `BR39d-D6`) → parse `Authorization: Bearer|DPoP <jwt>`; JWKS verify via `JwksPort` (kid lookup); validate `iss`, `aud === resource`, `exp`, `scope ⊇ requiredScopes`; if `cnf.jkt` present require + verify `DPoP` proof passing the access token for `ath` (`BR39d-D7`) + `recordDpopJti` replay via `dpopReplay`; `c.set('serviceClient', {...})`; 401/403 with `WWW-Authenticate`.
  - [x] Export `createRequireServiceAuth` + `ServiceAuthPorts` (+ `ServiceAuthContext`) from `packages/auth-hono/src/index.ts` (root export).
  - [x] Lot gate:
    - [x] `make typecheck-auth-hono` PASS. `make lint-auth-hono` n/a.
    - [x] **auth-hono tests**: `packages/auth-hono/tests/service-auth-middleware.test.ts` (10 tests) — pass (Bearer + DPoP), reject: missing token, bad signature, wrong `aud`, expired, missing required scope (403 insufficient_scope), DPoP proof missing / replayed / `ath` mismatch.
    - [x] Sub-lot gate: `make test-auth-hono` PASS (101 tests).

- [x] **Lot 4 — New package `@sentropic/auth-client` (Node consumer helper)**
  - [x] `packages/auth-client/` scaffold: `package.json` (`@sentropic/auth-client`, `0.1.0`, ESM, `jose` peer dep, mirrors auth-hono build/test config), `README.md`, `src/index.ts`, `tsconfig.json`, `LICENSE`. (No `vitest.config.ts` — auth-hono pattern runs `vitest run tests` directly.)
  - [x] `createAuthClient({issuer, clientId, clientSecret, dpop?, resource?, scope?, tokenEndpoint?, refreshSkewSeconds?, fetch?, now?})` → `getToken({scope?, resource?, forceRefresh?}) → Promise<{access_token, token_type, expires_at, scope}>` with in-memory cache (keyed scope+resource) + auto-refresh (skew default 30s); lazy Ed25519 DPoP keypair + `buildDpopProof({htm, htu, accessToken?})` when `dpop:true`; `AuthClientError` carries OAuth code + status.
  - [x] Workspace registration (`BR39d-EX4`): `packages/*` glob already covers it; `package-lock.json` synced via `make lock-root`; `api/package.json` declares `@sentropic/auth-client`. Dockerfile wiring (`BR39d-EX5`): COPY + `npm --workspace @sentropic/auth-client run build`.
  - [x] Lot gate:
    - [x] `make typecheck-auth-client` (`BR39d-EX1`) PASS. (No auth-client lint target; CI parity = typecheck+test+build+pack.)
    - [x] **auth-client tests**: `packages/auth-client/tests/auth-client.test.ts` (7 tests) — token fetch + cache reuse, refresh on expiry, scope/resource forwarding, DPoP proof shape, **real round-trip** mint→protected-route (Bearer + DPoP w/ ath) against an in-process `@sentropic/auth-hono` IdP, error mapping. Not mocks-only.
    - [x] Sub-lot gate: `make test-auth-client` PASS (7 tests). `make pack-auth-client` PASS (dist+src+README+LICENSE).

- [x] **Lot 5 — Host wiring in Sentropic API (real consumer co-design + dogfood)**
  - [x] Per `feedback_contract_consumer_codesign`: exercise BOTH contracts on the real host.
  - [x] `api`: mount `createRequireServiceAuth({requiredScopes:['service:ping'], resource:<api resource uri>})`-protected internal route `GET /api/v1/auth/s2s/ping` returning minimal JSON (resource-server side). New file `api/src/routes/auth/service-s2s.ts`; mounted in `api/src/routes/auth/index.ts` under `/s2s`.
  - [x] `api` imports `@sentropic/auth-client` (`BR39d-D10`, `EX4`+`EX5`): `GET /api/v1/auth/s2s/self-check` mints via `createAuthClient` → calls the protected `/ping` route — the activation + UAT artifact (gated behind `OAUTH_SELF_SERVICE_CLIENT_ID/_SECRET`).
  - [x] `api/src/services/auth/oauth-client-seed.ts` (+ `api/src/scripts/oauth-seed-clients.ts`): `seedServiceClients()` seeds `example-service-rp` + the self-S2S dogfood client for dev/test/e2e. Env: `OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC`, `OAUTH_SERVICE_RESOURCE_URI`, `OAUTH_SELF_SERVICE_CLIENT_ID/_SECRET`.
  - [ ] Lot gate:
    - [x] `make typecheck-api` BLOCKED (`BR39d-Q1` docker net pool). `make lint-api` BLOCKED (same).
    - [x] **API tests**: `api/tests/api/auth/service-auth-middleware.test.ts` WRITTEN — full host round-trip (mint via `client_credentials` → protected route 200) + negatives (no token 401, wrong scope 403, wrong `aud`/`resource` 401). Execution BLOCKED (`BR39d-Q1`).
    - [x] Sub-lot gate: `make test-api ENV=test-feat-auth-s2s` BLOCKED (`BR39d-Q1`).
    - [x] **E2E (optional, API-level)**: `e2e/tests/02-auth-s2s-client-credentials.spec.ts` WRITTEN. Running it requires `seedServiceClients()` to be wired into `api/tests/utils/seed-test-data.ts` (out of Allowed Paths) — see `BR39d-Q2`. Execution BLOCKED (`BR39d-Q1` + e2e build).

- [x] **Lot 6 — CI / Make / ops parity**
  - [x] `Makefile` (`BR39d-EX1`): added `typecheck-auth-client`, `test-auth-client`, `build-auth-client`, `pack-auth-client`, `publish-auth-client`, `publish-auth-client-token`, `oauth-rotate-service-client CLIENT_ID=... ENV=...` (mirror `*-auth-hono`; `oauth:rotate-service-client` npm script + `api/src/scripts/oauth-rotate-service-client.ts`).
  - [x] `.github/workflows/ci.yml` (`BR39d-EX2`): added `auth_client` + `auth_client_publish` filters (`packages/auth-client/**`), `validate-auth-client` job (typecheck+test+build+pack), `publish-auth-client` job (main-gated, OIDC id-token), `auth-client` in `bootstrap_publish_target` enum + bootstrap step. YAML validated.
  - [x] root `package.json`/`package-lock.json` (`BR39d-EX4`) + `api/Dockerfile` (`BR39d-EX5`): workspace member (glob) + lockfile + COPY/build wiring for auth-client (done in Lot 4).
  - [x] `docs/secrets.md`: S2S inventory rows (`OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC`, `OAUTH_SERVICE_RESOURCE_URI`, `OAUTH_SELF_SERVICE_CLIENT_ID/_SECRET`), provisioning + mint/use + DPoP + `oauth-rotate-service-client` runbook + stateless/no-revoke note (defer 39h).
  - [x] Lot gate: `make typecheck`/`make lint` are `typecheck-ui+typecheck-api` / `lint-ui+lint-api` — BLOCKED by `BR39d-Q1` (compose network). Package gates (typecheck/test/build/pack auth-hono + auth-client) all PASS.

- [x] **Lot N-1 — Docs consolidation**
  - [x] `packages/auth-hono/README.md`: `client_credentials` grant, optional `findServiceClient`, `createRequireServiceAuth` + `ServiceAuthPorts`, RFC 8707 resource indicators, DPoP S2S recommendation, stateless service-token note, `0.4.0` version entry + env vars.
  - [x] `packages/auth-client/README.md`: Node consumer quickstart, `createAuthClient`/`getToken`, DPoP opt-in, config + errors (written in Lot 4).
  - [x] No `spec/BRANCH_SPEC_EVOL.md` was created for this branch.

- [ ] **Lot N — Final validation**
  - [x] `make typecheck`/`make lint` for auth-hono + auth-client PASS (typecheck). `make typecheck-api`/`make lint-api` BLOCKED (`BR39d-Q1`).
  - [x] `make test-auth-hono` (101) + `make test-auth-client` (7) PASS. `make test-api ENV=test-feat-auth-s2s` BLOCKED (`BR39d-Q1`).
  - [ ] Retest E2E (if added): BLOCKED (`BR39d-Q1` + `BR39d-Q2`).
  - [x] Version bumps: `packages/auth-hono` `0.3.0 → 0.4.0` (minor) DONE; new `packages/auth-client` `0.1.0` DONE. `auth-ui` unchanged — but the 0.4.0 bump breaks auth-ui's `^0.3.0` peer, see `BR39d-Q3` (lockfile NOT regenerated for the 0.4.0 bump pending conductor decision).
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` as PR body.
  - [ ] Final gate step 2: run/verify branch CI on PR; resolve blockers (`enforce-package-bump`, `validate-auth-client`).
  - [ ] Final gate step 3: once UAT + CI green → commit removal of `BRANCH.md`, push, merge. First publish of `@sentropic/auth-client` via `bootstrap_publish_target=auth-client` then attach OIDC trusted publisher (Playwright, `feedback_npm_trusted_publisher_via_playwright`). `auth-hono` 0.4.0 publish may need the bootstrap fallback (trusted publisher still broken — handover §3). Register `validate-auth-client` as required check (admin).
