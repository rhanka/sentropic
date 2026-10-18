# @sentropic/artifacts — generic artifact contracts (L-5a)

Generic, host-independent artifact domain state for the Sentropic artifacts
provider (`sentropic.artifacts`, spec-v8 §9), covering L-5a–5e. Version
`0.1.1` fixes activation ticket release and channel binding (FL-ACT).

## What's here (L-5a)

- `src/contracts.ts` — schema versions, server-allocated UUID identities,
  `CanonicalManifest`, JSON types. No server, driver or ORM imports.
- `src/codecs.ts` — canonical manifest bytes (recursive key sort, arrays as
  unordered sets, no `undefined`) + SHA-256 digest; `parseManifest`
  fail-closed (sealed documents verify, working documents carry no digest).
- `src/parameters.ts` — provider parameter schemas: defaults, unknown-key /
  wrong-type / missing-required rejection, secret-looking key refusal.
- `src/provider-definition.ts` — exact `publicName → (providerId, capability)`
  map; duplicate and cross-provider collisions rejected, never sanitized.
- `src/client.ts` — transport-free request builders / response parsers.
- `src/server/ports.ts` — injected `KvPort` / `UuidPort` / per-key mutex.
- `src/server/service.ts` — one service for HTTP and MCP: authorization
  first, then idempotent binding ensure. Explicit ports, no defaults.
- `src/server/authorization.ts` — owner-only, deny by default (no sharing
  grants in this lot; sharing arrives in L-5c).
- `src/server/bindings.ts` — owner-scoped stable bindings, scope fail-closed,
  concurrent ensures converge.
- `src/server/idempotency.ts` — one result per key, explicit conflicts.

## Gates

```sh
make typecheck-artifacts API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry
make test-artifacts API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry
make test-artifacts-integration API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry
```

## What's here (L-5b–5c)

- `src/server/access.ts` — owner/grants/approved-public evaluation + ACL store.
- `src/server/sources.ts` — explicit source refs + source store.
- `src/server/fork.ts` — private independent forks, no ACL copy, refcounted blobs.
- `src/server/lifecycle.ts` — withdraw/restore/delete/purge, explicit
  promote/rollback over the single publication current pointer, renew.
- `src/server/gc.ts` — refcounts, pins, reported collection.
- `src/http.ts` — transport-free HTTP app delegating to the same services
  (401/403/404/409/410/422/400 mapping; reads never oracle existence).
- `migrations/0001_artifacts.sql` — domain schema (manifest TEXT for
  byte-identity). Sharing/lifecycle/GC tables arrive with the 0002 migration.

No Immo defaults, URLs or bindings in generic source.

## What's here (L-5d–5e)

- `src/content/grants.ts` — 55s HMAC content grants (60s cutoff budget) and
  single-use activation tickets bound to subject, artifact, exact release
  and channel (`stable` or `pinned`); secrets and clocks are injected.
- `src/content/routing.ts` — stable (`<artifactId>.<base>`) and pinned
  (`<releaseId>.pinned.<base>`) single-UUID origins; safe path resolution.
- `src/content/headers.ts` — no-store/nosniff/frame-denial/CSP headers and
  the host-only `__Host-artifacts_grant` cookie.
- `src/content/handler.ts` — transport-free content serving: per-version
  activation, grant + live ACL recheck per request, raw bytes out.
- `src/content/api-profile.ts` — reader-delegation profile: exact
  method/route/binding checks plus Origin/CSRF evidence for writes.
- `src/server/templates.ts` — generic template kit + versioned API guide
  catalog port (hosts inject approved local assets).
- `src/mcp.ts` — the `sentropic.artifacts` MCP provider: 15 exact
  `artifacts_*` tools with closed schemas, a host-bindable invocation
  scope, an executor over the same HTTP app, a platform adapter, and the
  `@sentropic/mcp-platform` kernel registry definition (the platform is
  an optional peer, required only by the `./mcp` subpath).

Ticket issuance and redemption both require `subjectId`, `artifactId`,
`releaseId` and `channel`. The handler checks the release resolved from the
requested origin and its channel before minting a grant. A stable ticket
issued for r1 cannot activate r2 after republish, and a stable ticket cannot
activate a pinned origin (or vice versa). Mismatches return 401 without a
grant cookie and preserve the ticket for a matching request. Tickets expire
at `expiresAt` (120 seconds by default) and can be redeemed only once.

## First publish (bootstrap)

The steady-state OIDC job requires an npm trusted publisher. For the first
publication, use the current package version and this bootstrap sequence
(owner-run, never automated here):

1. Trigger the `bootstrap-publish` workflow manually with
   `bootstrap_publish_target=artifacts` (runs
   `make publish-artifacts-token` with the `NPM_TOKEN` secret; no OIDC
   provenance on the token publish). Locally equivalent:
   `make publish-artifacts-token NPM_TOKEN_FILE=/path/to/token`.
2. On npmjs.com, open `@sentropic/artifacts` → Settings → Trusted
   Publishers and attach the GitHub Actions publisher for
   `rhanka/sentropic` workflow `ci.yml`.
3. After that, merges to `main` touching the artifacts package publish
   through the `publish-artifacts` job (`make publish-artifacts`, OIDC +
   provenance), gated by `validate-artifacts`.
