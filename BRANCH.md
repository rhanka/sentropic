# Feature: BR-39m — Standalone IdP `auth.sent-tech.ca` (Phase A0)

## Objective
Stand up a thin standalone Identity Provider service (Phase A0) that composes the EXISTING `@sentropic/auth-hono` router factories + existing Postgres adapters + JWKS, serving `/oauth/*` + `/.well-known/*` + the auth-ui login/register/consent screens against the SHARED physical DB, with `design-system` as the only client (free auth). Zero new auth code beyond the service shell, the `design-system` client seed, and a documented RP session-glue recipe. All Phase A0 work is REVERSIBLE; irreversible items (physical `users` extraction, main-app OIDC cutover) are deferred to Phase D.

## Scope / Guardrails
- Scope limited to the standalone IdP service shell (placeholder `apps/auth-idp/`), one `design-system` client seed entry, and the RP session-glue recipe.
- NO DB migration: reuse the shared app DB connection/env; do NOT create a new DB; do NOT move/alter `users`/`user_sessions`.
- NO new auth code: compose the existing `authRouter`, `wellKnownRouter`, and Postgres adapters; do NOT fork or duplicate auth logic.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-auth-idp-standalone`.
- Automated test campaigns run on dedicated environments (`ENV=test-feat-auth-idp` / `ENV=e2e-feat-auth-idp`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Ports (BR-39 slot 4): `API_PORT=9199 UI_PORT=5399 MAILDEV_UI_PORT=1299`, `ENV=test-feat-auth-idp`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/auth-idp/**` (PLACEHOLDER location for the standalone IdP service — see F5)
  - `api/src/services/auth/oauth-client-seed.ts` (add `design-system` client row only)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` (unless `BR39m-EX1` approved)
  - `docker-compose*.yml` (unless `BR39m-EX1` approved)
  - `.cursor/rules/**`
  - `api/drizzle/*.sql` (NO migration this branch — HARD STOP)
  - `api/src/db/schema.ts` (NO schema change — HARD STOP)
  - `api/src/routes/auth/**`, `packages/auth-hono/**`, `packages/auth-ui/**` (reuse only; no fork)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**` (CI wiring for the new service) — requires `BR39m-EX2`
  - `Makefile`, `docker-compose*.yml`, `api/Dockerfile` (service run/compose/CI wiring) — requires `BR39m-EX1`
- **Exception process**:
  - Declare exception ID `BR39m-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
Status legend: `blocked` / `deferred` / `cancelled` / `attention` (agent) ; `clarification` / `acknowledge` / `refuse` (conductor/human).

### Fork defaults recorded as decisions (Phase A0)
- **F1+F3 (COUPLED) — data model + main-app cutover** — DECISION (Phase A0): IdP runs on the SHARED physical DB (IdP = logical owner). The physical `users`/`user_sessions` extraction AND the main-app OIDC-client cutover are DEFERRED together to **Phase D** (one branch, no dual-write bridge). `acknowledge` — recommended default per spec §5.2; IRREVERSIBLE, NOT in this branch.
- **F2 — identity model** — DECISION: global identity + `tenant_memberships`. Phase A0 has NO membership yet (design-system is free-auth, sub+email is enough). `acknowledge`.
- **F4 — openerp sub-tenancy** — DECISION: federated / app-managed default. Out of Phase A0 scope. `acknowledge`.
- **F5 — standalone IdP service name + topology** — DECISION (user-confirmed at launch, validated-at-merge): dir `apps/auth-idp/`, service alias `auth-idp`, domain `auth.sent-tech.ca`, centralized topology. BR39m-Q1 RESOLVED → EX1/EX2 authorized for Lot 4 wiring. `acknowledge`.
- **F6 — token claim set** — DECISION: deferred to Phase A1 (BR-39n / first tenant-scoped client `diag`). Phase A0 emits only the existing `sub`/`name`/`email`. `deferred`.
- **F7 — logout scope** — DECISION: RP-initiated logout + `end_session_endpoint` first; back-channel SLO later. `acknowledge`.
- **F8 — RP session lifetime** — DECISION: silent renew via `prompt=none` as default; no OAuth refresh tokens (offline_access stays rejected). `acknowledge`.
- **F9 — GDPR per-tenant data residency / scoped deletion** — DECISION: deferred (named, not implemented). `deferred`.

### Exceptions
- **BR39m-EX1** (`acknowledge`, APPLIED Lot 4) — touch `Makefile`, `docker-compose*.yml` (new additive overlay `docker-compose.idp.yml`) to wire the standalone IdP run target/service.
  - Reason: a standalone service needs a run/compose entry; default-forbidden paths.
  - Impact: ADDITIVE ONLY — new `docker-compose.idp.yml` overlay with an `auth-idp` service reusing the EXISTING `api` image + dev volume mount + shared `postgres`; new `make dev-idp`/`down-idp`/`logs-idp`/`typecheck-idp` targets; one new path-filter (`apps/auth-idp/**`) added to the `api` filter. No change to existing service definitions; `api/Dockerfile` NOT modified (apps/ source reached via dev volume mount).
  - Rollback: delete `docker-compose.idp.yml`, the added make targets, the path-filter line; no migration, no data, fully reversible.
  - Constraint: mirror existing `api`/compose patterns line-by-line; no new image build pipeline.
- **BR39m-EX2** (`acknowledge`, APPLIED Lot 4) — add a CI typecheck step for `apps/auth-idp` in `.github/workflows/ci.yml`.
  - Reason: the new service source must be typechecked in CI; `.github/workflows/**` is a conditional path.
  - Impact: ADDITIVE ONLY — one `Typecheck IdP` step in the existing `typecheck-lint-api` job (runs `make typecheck-idp`) plus `apps/auth-idp/**` added to the `api` paths-filter so the job triggers on IdP changes.
  - Rollback: remove the step + filter entry; reversible.

### Open blockers / escalations
- **BR39m-Q1** (`acknowledge`, RESOLVED 2026-06-03) — Apply EX1/EX2 for the standalone IdP.
  - Resolution: user confirmed F5 at launch (dir `apps/auth-idp/`, alias `auth-idp`, domain `auth.sent-tech.ca`, centralized; validated-at-merge). EX1/EX2 authorized; Option (A) taken with final names.
  - Outcome: Lot 4 wiring applied (compose overlay + make targets + CI typecheck step), live boot + SSO smoke executed.

## AI Flaky tests
- Standard acceptance rule applies (non-systematic provider/network/model nondeterminism only). No AI tests expected in Phase A0.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default; single workstream, single final test cycle)
- [ ] **Multi-branch**
- Rationale: Phase A0 is one orthogonal capability (service shell + one client + recipe); no independent sub-workstreams needing separate CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch after the service-shell lot, when a live login flow exists.
- UAT checkpoints listed as checkboxes inside the relevant lot.
- Execution flow: develop/test in `tmp/feat-auth-idp-standalone`; push before UAT; run UAT from root workspace (`ENV=dev`); switch back.

## Plan / Todo (lot-based) — Phase A0 only

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/architecture.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`, `spec/SPEC_EVOL_AUTH_IDP_STANDALONE.md`.
  - [x] Confirm isolated worktree `tmp/feat-auth-idp-standalone` on branch `feat/auth-idp-standalone`.
  - [x] Capture how the IdP is mounted today (`api/src/app.ts`, `api/src/routes/auth/index.ts`, `api/src/routes/well-known.ts`, `api/src/routes/auth/oauth.ts`, adapters, JWKS).
  - [x] Define env/ports: `API_PORT=9199 UI_PORT=5399 MAILDEV_UI_PORT=1299 ENV=test-feat-auth-idp` (BR-39 slot 4); `make ps-all` = no conflict.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Validate scope boundaries; declare `BR39m-EX1` / `BR39m-EX2` for conditional paths.
  - [x] Record fork defaults (F1..F9) as decisions in `## Feedback Loop`.

- [x] **Lot 1 — Standalone IdP service shell (reversible composition)**
  - [x] Add `apps/auth-idp/` (PLACEHOLDER for F5): a thin Hono composition module (`idp-app.ts`) that reuses the EXISTING `authRouter` + `wellKnownRouter` (which already compose `@sentropic/auth-hono` + shared-DB adapters + JWKS), mounted at the IdP-shaped paths against the SHARED DB. No new auth code, no new DB. Server entry `index.ts` + local `tsconfig.json`.
  - [x] Add `apps/auth-idp/README.md` documenting: composition, shared-DB reuse, PLACEHOLDER status, env reuse (`OAUTH_ISSUER_URL`, `OAUTH_SIGNING_KEK`, DB env).
  - [x] Lot gate: import paths/exports statically verified against source; containerized typecheck of `apps/` deferred to Lot 4 (needs EX1 build wiring — api tsconfig includes only `src`).

- [x] **Lot 2 — `design-system` client seed (free auth)**
  - [x] Extend `api/src/services/auth/oauth-client-seed.ts` with a `design-system` `oauth_clients` row (scopes `openid profile email`, PKCE, code grant, PLACEHOLDER design-system redirect URIs).
  - [x] Lot gate: `make typecheck-api ENV=test-feat-auth-idp` PASS + `make lint-api ENV=test-feat-auth-idp` 0 errors (no issues in seed file).

- [x] **Lot 3 — RP session-glue recipe**
  - [x] Add `apps/auth-idp/RP_SESSION_GLUE.md`: documented callback→verify(id_token via JWKS)→set-RP-cookie recipe (since `oauth-client.ts` stops at `exchangeCode` and `@sentropic/auth-client` is S2S-only). References `createOAuthClient` + discovery + userinfo; claims verified against `token-handler.ts` (sub/name/email/nonce/aud=client_id/iss).
  - [x] No new package code in Phase A0 (recipe only; a `@sentropic/auth-client` browser helper is a later phase per spec R3).

- [ ] **Lot 4 — Service run / compose / CI wiring (BR39m-EX1/EX2 APPLIED; F5 confirmed)**
  - [x] Add ADDITIVE compose overlay `docker-compose.idp.yml` (`auth-idp` service reusing the existing `api` image + dev volume mount + shared `postgres`) + make `dev-idp`/`down-idp`/`logs-idp`/`ps-idp`/`seed-idp-clients`/`typecheck-idp` targets running the IdP composition entrypoint.
  - [x] Add CI typecheck step (`make typecheck-idp`) in the existing `typecheck-lint-api` job + `apps/auth-idp/**` in the `api` paths-filter (EX2).
  - [x] Lot gate (static): `make typecheck-idp` PASS (verified: catches injected error, clean source green); `make typecheck-api` PASS; `make lint-api` 0 errors.
  - [x] Boot live on `ENV=test-feat-auth-idp` (slot-4 ports): `make dev-idp` → `auth-idp` container Healthy; curl `/.well-known/openid-configuration` (HTTP 200), `/.well-known/jwks.json` (HTTP 200, active EdDSA key), `/` (HTTP 200), `/api/v1/auth/oauth/authorize` (HTTP 400 param-validating); `design-system` client + signing key seeded on the SHARED DB.
  - [x] SSO smoke (`make smoke-idp`, `apps/auth-idp/sso-smoke.ts`): deterministic authorization_code round-trip for `design-system` PASS — discovery → /authorize (session cookie) → consent redirect → /consent/decision approve → code → /token (id_token+access_token, iss/aud/nonce/sub verified) → /userinfo (sub/email verified).
  - Runtime wiring discovered + fixed (all reversible, in-overlay): (a) `apps/auth-idp/package.json` `"type":"module"` (apps/ had no package.json → `.ts` treated as CJS → ESM-only `@sentropic/auth-hono` failed to require); (b) shared env schema requires `SCW_TEM_SECRET_KEY` → mock mirrored from api service; (c) dev defaults for `OAUTH_SIGNING_KEK`/`JWT_SECRET` (unset host var interpolates to empty string, defeating env.ts dev fallback + tripping the prod-secrets guard); (d) `dev-idp` runs `oauth:init-keys` with the IdP KEK so a JWKS signing key exists; smoke + key-init share the IdP's `JWT_SECRET`/`OAUTH_SIGNING_KEK`. NOTE: login/consent SCREENS are SvelteKit UI routes (`ui/src/routes/auth/**`, served by the `ui` build at the UI origin), NOT the IdP API service — the smoke drives the consent-decision API headlessly (correct Phase A0 protocol proof).

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Fold the A0 outcome (defaults confirmed, placeholder status) back into `spec/SPEC_EVOL_AUTH_IDP_STANDALONE.md` §4/§6 if needed.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (api).
  - [ ] Bump any `packages/<pkg>/package.json` whose `src/**` changed (none expected in A0).
  - [ ] PR using `BRANCH.md` as body; CI green; UAT sign-off (incl. F5 name validation) BEFORE merge.

## Deferred to later phases
- Phase A1 (BR-39n): token claim set (F6) + `diag` client + session-lifetime/logout.
- Phase B (BR-39e/39g): `tenant_memberships` + authorize-time gate + per-tenant acceptance backoffice.
- Phase C: openerp federation (F4) + branding (39f).
- Phase D (BR-39p): coupled physical `users` extraction + main-app OIDC-client cutover (F1+F3) — IRREVERSIBLE.
- F9: GDPR per-tenant scoped deletion.
