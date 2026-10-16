# @sentropic/artifacts — generic web-pages artifact contracts (L-5a)

Generic, host-independent artifact domain state for the Sentropic web-pages
provider (`sentropic.web-pages`, spec-v8 §9). Single unreleased `0.1.0`
candidate covering L-5a–5e; no publication before the final merge.

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

No Immo defaults, URLs or bindings in generic source. Content serving and
MCP tools arrive in L-5d–5e.
