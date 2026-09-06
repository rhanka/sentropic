# Standalone IdP — `apps/auth-idp/` (PLACEHOLDER, BR-39m Phase A0)

> **PLACEHOLDER — fork F5 not validated.** The service name, this directory
> (`apps/auth-idp/`), the compose/service alias (`auth-idp`), and the domain
> (`auth.sent-tech.ca`) are **provisional** and MUST be confirmed by the user
> before merge (`feedback_no_unvalidated_naming`). Do not treat any of these as
> final.

## What this is

A **thin standalone Identity Provider service shell** that proves the Sentropic
auth surface can run as its own service (`auth.sent-tech.ca`) **separated from
the product app**, with **zero new auth code** and on the **shared physical
database**.

It is Phase A0 of `spec/SPEC_EVOL_AUTH_IDP_STANDALONE.md`:
- single client only: `design-system` (free auth — `sub` + `email` is enough);
- no token claim set (F6 → Phase A1), no membership (F2 → Phase B), no main-app
  cutover and no physical `users` extraction (F1+F3 → Phase D).

## How it composes (zero new auth code)

`idp-app.ts` builds a fresh Hono app and **reuses the Cluster Mesh namespace modules**:

| Mounted path | Reused from | Already composes |
|---|---|---|
| `/.well-known/openid-configuration`, `/.well-known/jwks.json` | Cluster Mesh `/oauth` well-known projection | `createWellKnownRouter` (`@sentropic/auth-hono`) + JWKS adapter |
| `/api/v1/auth/oauth/*` | Cluster Mesh `/oauth` module | `createOAuthRouter` (`@sentropic/auth-hono`) + Postgres state-store + JWKS adapters |
| `/api/v1/auth/{register,login,credentials,magic-link,email,federation}/*` | Cluster Mesh `/auth` module | `createAuthRouter` (`@sentropic/auth-hono`) + identity adapters |
| `/api/v1/auth/{session,device}/*` | Cluster Mesh `/session` module | session/device handlers + session/cookie adapters |

The login / register / magic-link / consent **screens** (Phase A0-bis) are a
**minimal SvelteKit static front** under `apps/auth-idp/web/` that mounts the
published `@sentropic/auth-ui` components, wired **same-origin** to the IdP API
(`/api/v1/auth`) via `createDefaultFetchTransport` (EN+FR labels). The
`auth-idp` Hono service serves the built bundle (`web/build`, SPA fallback
`404.html`) alongside `/api/v1/auth/*` + `/.well-known/*`, so `auth.sent-tech.ca`
shows a real login page whose session cookie is first-party at the IdP origin.

The front is a self-contained sub-project (own `package.json` + lock, NOT a
root workspace member — same isolation pattern as `e2e/`); it consumes
`@sentropic/auth-ui` via a relative `file:` dependency. The integration is a
line-by-line copy of the product `ui/` `/auth/*` route pattern, with the
transport baseUrl pointed at the same-origin `/api/v1/auth` mount. For the
authorize flow to land on these screens, the IdP runs with `UI_BASE_URL` /
`AUTH_CALLBACK_BASE_URL` set to its OWN origin (see `docker-compose.idp.yml`).

Build + serve locally: `make build-idp-web` then `make dev-idp` (slot 4 ports).

## Shared physical DB (fork F1+F3 default)

This service imports the **same** `api/src/db/client` (transitively, via the
reused routers/adapters) and the **same** env. It:

- does **NOT** create a new database;
- does **NOT** run a new migration (`api/src/index.ts` owns migrations in A0);
- does **NOT** move or alter `users` / `user_sessions`.

The IdP is the **logical** owner of identity while **physically** sharing the
product DB. Physical `users` extraction + main-app OIDC cutover are deferred,
**coupled**, to Phase D (one branch, no dual-write bridge).

## Environment reuse

No new env vars are introduced in Phase A0. The shell reuses:

- `IDP_PORT` (optional; falls back to `API_PORT` / `PORT`) — listener port;
- `OAUTH_ISSUER_URL` — the IdP issuer (e.g. `https://auth.sent-tech.ca`); if
  unset, the issuer is derived per-request (see `resolveOAuthIssuer`);
- `OAUTH_SIGNING_KEK` — Ed25519 signing-key encryption (already required in prod);
- `JWT_SECRET` — session/state signing (dev fallback exists);
- `CORS_ALLOWED_ORIGINS` — must include the `design-system` origin;
- `UI_BASE_URL` / `AUTH_CALLBACK_BASE_URL` — login/consent screen origin;
- the standard DB connection env consumed by `api/src/db/client`.

## Running (Phase A0)

Phase A0 runs the shell from the **existing `api` image** with an IdP entrypoint
override — this avoids a parallel build pipeline and keeps everything reversible.
The make target + compose service that wire this are gated behind exception
`BR39m-EX1` (Makefile / docker-compose are default-forbidden paths) and are
**not yet applied**; see `BRANCH.md → Feedback Loop`.

## Reversibility

Deleting `apps/auth-idp/` removes the standalone shell with **no schema or data
side effects**. The product API independently composes the same `/auth`,
`/oauth`, and `/session` modules.
