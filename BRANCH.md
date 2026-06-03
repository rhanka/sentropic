# Feature: BR-39m A0-bis — Serve IdP login/register/consent screens at the IdP origin

## Objective
Give the standalone IdP (`apps/auth-idp`) its OWN human-facing login / register / magic-link / consent screens, served same-origin with its OIDC API, so `auth.sent-tech.ca` can show a real login page with clean (same-origin) cookies. Reuse the published `@sentropic/auth-ui` components; no new auth code, no parallel UI.

## Scope / Guardrails
- Scope limited to a NEW minimal static front under `apps/auth-idp/web/`, the IdP Hono service static-serving (`apps/auth-idp/idp-app.ts`), IdP docs, and the IdP wiring (Makefile/compose/CI under exception).
- No migration, no `users`/prod-data change, no main-app cutover.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` reserved for user dev/UAT (`ENV=dev`); must remain stable.
- Branch development in isolated worktree `tmp/feat-auth-idp-screens`.
- Automated runs on dedicated env `ENV=test-feat-auth-idp-screens`, never on root `dev`.
- In every `make` command, `ENV=<env>` passed as the last argument.
- All new text in English.
- Ports (BR-39 slot 4): `API_PORT=9199 UI_PORT=5399 MAILDEV_UI_PORT=1299`, `ENV=test-feat-auth-idp-screens`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/auth-idp/web/**`
  - `apps/auth-idp/idp-app.ts`
  - `apps/auth-idp/index.ts`
  - `apps/auth-idp/sso-smoke.ts`
  - `apps/auth-idp/screen-smoke.ts`
  - `apps/auth-idp/README.md`
  - `apps/auth-idp/RP_SESSION_GLUE.md`
  - `apps/auth-idp/tsconfig.json`
  - `apps/auth-idp/package.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/src/**` (product API source)
  - `packages/auth-*/**` (published package src)
  - `api/drizzle/*.sql`
  - `ui/**`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — `BR39m-EX2`
  - `docker-compose.idp.yml` — `BR39m-EX2`
  - `.github/workflows/ci.yml` — `BR39m-EX2`
  - root `package.json` (workspace member add) — `BR39m-EX3`
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path, with reason, impact, rollback.

## Feedback Loop
- `BR39m-D1` (decision, reversible default — flag for merge-time validation): **how to serve the screens.** Chosen approach = a minimal **SvelteKit static** front under `apps/auth-idp/web/` (exact `ui/` adapter-static pattern, `paths.relative=false`) that mounts the existing `@sentropic/auth-ui` components for login / register / magic-link / consent, wired **same-origin** to `/api/v1/auth` via `createDefaultFetchTransport`, EN+FR labels, reusing the `ui/` integration pattern line-by-line. The `auth-idp` Hono service static-serves the built `web/build` bundle (SPA fallback) alongside `/api/v1/auth/*` + `/.well-known/*`. Rationale: SvelteKit adapter-static produces exactly the path-based routes (`/auth/login`, `/auth/oauth/consent`) the `@sentropic/auth-hono` authorize handler redirects to (`loginUrl`/`consentUrl` + `continue`/`state`); a hand-rolled router would risk path mismatch. Reversible: deleting `apps/auth-idp/web/` + the static-serve block reverts to API-only IdP.
- `BR39m-EX2` (exception): touch `Makefile`, `docker-compose.idp.yml`, `.github/workflows/ci.yml` to build the static front + serve it + CI typecheck/build it. Impact: additive IdP-only targets/overlay/CI steps; no existing service/target modified. Rollback: revert the additive blocks.
- `BR39m-EX3` (exception): add `apps/auth-idp/web` as a root npm workspace member so its devDeps (vite/svelte/kit) install. Impact: one line in root `package.json` `workspaces`. Rollback: remove the line.
- `BR39m-D2` (decision): **screen-driven smoke.** New `apps/auth-idp/screen-smoke.ts` drives a real headless Chromium (reusing the e2e Playwright image) against the live `auth-idp` origin: navigate the IdP-served `/auth/login`, authenticate, follow authorize→consent on the served `/auth/oauth/consent` screen, reach the code, exchange the token. Deterministic (DB-seeded user, fixed PKCE). The original headless `sso-smoke.ts` stays as the bare-API parity smoke.
- F5 PLACEHOLDER (carried from main): service name `auth-idp`, dir `apps/auth-idp/`, domain `auth.sent-tech.ca` remain user-validation-pending (`feedback_no_unvalidated_naming`). This branch adds no NEW durable name beyond `apps/auth-idp/web/` (provisional, under the same F5 umbrella).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single workstream, one final test cycle)
- [ ] Multi-branch
- Rationale: one orthogonal capability (serve screens at IdP origin); no independent sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `apps/auth-idp/*`, `packages/auth-ui/**`, `ui/` auth routes + integration services, spec Phase A0/A0-bis, rules.
  - [x] Confirm worktree `tmp/feat-auth-idp-screens` on branch `feat/auth-idp-screens`.
  - [x] Confirm ports slot 4 + `ENV=test-feat-auth-idp-screens`.
  - [x] Confirm scope boundaries + declare exceptions (D1/EX2/EX3/D2).

- [ ] **Lot 1 — Minimal static front (`apps/auth-idp/web/`)**
  - [ ] Scaffold SvelteKit static app (package.json, svelte.config.js, vite.config.ts, tsconfig, app.html) mirroring `ui/`.
  - [ ] Same-origin transport service (`createDefaultFetchTransport({ baseUrl: '/api/v1/auth' })`) + EN/FR label resolver + OAuth consent transport (copy `ui/` pattern).
  - [ ] Routes `/auth/login`, `/auth/register`, `/auth/magic-link/verify`, `/auth/oauth/consent` mounting auth-ui components with the exact `continue`/`state`/returnUrl wiring.
  - [ ] Add `apps/auth-idp/web` to root workspaces (`BR39m-EX3`).
  - [ ] Lot gate: front typecheck + build green.

- [ ] **Lot 2 — IdP service static-serve + wiring**
  - [ ] `idp-app.ts`: serve `web/build` via `@hono/node-server/serve-static` with SPA fallback; keep `/api/v1/auth/*` + `/.well-known/*`.
  - [ ] Makefile: `build-idp-web` + serve wiring; compose: same-origin `UI_BASE_URL`/`AUTH_CALLBACK_BASE_URL` so authorize redirects to the IdP-served screens (`BR39m-EX2`).
  - [ ] CI: typecheck + build the front on `apps/auth-idp/**` changes (`BR39m-EX2`).
  - [ ] Update `apps/auth-idp/README.md` (screens now served at IdP origin).
  - [ ] Lot gate: `make typecheck-idp`, `make typecheck-api`, `make lint-api`, front typecheck/build.

- [ ] **Lot 3 — Screen-driven smoke**
  - [ ] `apps/auth-idp/screen-smoke.ts`: Playwright headless flow against the live IdP-served screens (`BR39m-D2`).
  - [ ] Make target `smoke-idp-screens`.
  - [ ] Lot gate: `make dev-idp` + `make smoke-idp-screens` green; `make down ENV=test-feat-auth-idp-screens`; `make ps-all` clean.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint (idp + api + front).
  - [ ] Screen-driven smoke + bare-API smoke green.
  - [ ] PR with `BRANCH.md` body; CI green; remove `BRANCH.md`; merge (NOT in this subagent run).
