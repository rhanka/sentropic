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
- **F5 — standalone IdP service name + topology** — `attention`: the service name/location/domain is a **PLACEHOLDER pending user validation at merge** (`feedback_no_unvalidated_naming`). Current placeholder: dir `apps/auth-idp/`, service alias `auth-idp`, domain `auth.sent-tech.ca`. Do NOT treat as final. **HARD STOP before freezing.**
- **F6 — token claim set** — DECISION: deferred to Phase A1 (BR-39n / first tenant-scoped client `diag`). Phase A0 emits only the existing `sub`/`name`/`email`. `deferred`.
- **F7 — logout scope** — DECISION: RP-initiated logout + `end_session_endpoint` first; back-channel SLO later. `acknowledge`.
- **F8 — RP session lifetime** — DECISION: silent renew via `prompt=none` as default; no OAuth refresh tokens (offline_access stays rejected). `acknowledge`.
- **F9 — GDPR per-tenant data residency / scoped deletion** — DECISION: deferred (named, not implemented). `deferred`.

### Exceptions
- **BR39m-EX1** (`attention`, declared, NOT yet applied) — touch `Makefile`, `docker-compose*.yml`, `api/Dockerfile` to wire the standalone IdP run target/service.
  - Reason: a standalone service needs a run/compose entry; default-forbidden paths.
  - Impact: ADDITIVE ONLY — new compose service + new make target reusing the EXISTING `api` image/entrypoint with an IdP composition module; no change to existing services.
  - Rollback: delete the added compose service block + make target; no migration, no data, fully reversible.
  - Constraint: mirror existing `api`/compose patterns line-by-line; no new image build pipeline unless necessary.

### Open blockers / escalations
- (none new beyond F5 attention + EX1/EX2 declarations) — see Stopped-at in report.

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

- [ ] **Lot 1 — Standalone IdP service shell (reversible composition)**
  - [ ] Add `apps/auth-idp/` (PLACEHOLDER for F5): a thin Hono composition module that reuses the EXISTING `authRouter` + `wellKnownRouter` (which already compose `@sentropic/auth-hono` + shared-DB adapters + JWKS), mounted at the IdP-shaped paths against the SHARED DB. No new auth code, no new DB.
  - [ ] Add `apps/auth-idp/README.md` documenting: composition, shared-DB reuse, PLACEHOLDER status, env reuse (`OAUTH_ISSUER_URL`, `OAUTH_SIGNING_KEK`, DB env).
  - [ ] Lot gate: `make typecheck-api ENV=test-feat-auth-idp` (composition module compiles).

- [ ] **Lot 2 — `design-system` client seed (free auth)**
  - [ ] Extend `api/src/services/auth/oauth-client-seed.ts` with a `design-system` `oauth_clients` row (scopes `openid profile email`, PKCE, code grant, design-system redirect URIs).
  - [ ] Lot gate: `make typecheck-api ENV=test-feat-auth-idp`; verify seed row via `make db-query`.

- [ ] **Lot 3 — RP session-glue recipe**
  - [ ] Add `apps/auth-idp/RP_SESSION_GLUE.md`: documented callback→verify(id_token via JWKS)→set-RP-cookie recipe (since `oauth-client.ts` stops at `exchangeCode`). Reference `createOAuthClient` + discovery + userinfo.
  - [ ] No new package code in Phase A0 (recipe only; a `@sentropic/auth-client` helper is a later phase per spec R3).

- [ ] **Lot 4 — Service run / compose / CI wiring (requires BR39m-EX1/EX2)**
  - [ ] After EX approval: add ADDITIVE compose service + make `dev-idp`/`run-idp` target reusing the existing `api` image with the IdP composition entrypoint.
  - [ ] After EX2 approval: add CI lane for the new service (mirror existing api lane).
  - [ ] Lot gate: `make typecheck-api lint-api ENV=test-feat-auth-idp`; service boots and serves `/.well-known/openid-configuration` + `/oauth/authorize`.
  - [ ] UAT: live login at the IdP origin → design-system receives a token → RP session via the glue recipe.

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
