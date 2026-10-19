# @sentropic/artifacts — generic artifact contracts (L-5a)

Generic, host-independent artifact domain state for the Sentropic artifacts
provider (`sentropic.artifacts`, spec-v8 §9), covering L-5a–5e. Version
`0.1.2` adds UTF-8 text publication, exposes storage adapters and ships SQL migrations.
Version `0.1.1` fixed activation ticket release and channel binding (FL-ACT).
Version `0.1.4` hardens host authority, replay isolation, publication and content
responses, and adds the platform-free `@sentropic/artifacts/mcp-core` entry.

## Migrating to 0.1.4

HTTP hosts must supply a trusted `HttpRequest.storageScopeId` for `/ensure`.
MCP hosts configure `defaultStorageScopeId` or supply the trusted invocation's
`ArtifactsInvokeInput.storageScopeId`; tool arguments cannot choose storage.
Legacy body/tool `storageScopeId` and client `paramsHash` fields remain accepted
but are ignored. Missing host scope now returns 400. Ensure hashes cover the
validated parameters, binding, owner and scope; publication hashes cover release
metadata and server-derived file digests. Keys are isolated by operation and
principal. A changed payload under the same key returns an explicit conflict.
Persisted unscoped replay keys are no longer consulted after upgrading.

Publication defaults to 128 files, 16 MiB per file and 64 MiB total. Hosts can
override these positive integer limits through `createPublicationService({
limits: { maxFiles, maxFileBytes, maxTotalBytes } })`; the HTTP decoder uses the
same byte budgets before allocating bytes. Paths must be unique canonical
relative paths, at most 1024 UTF-8 bytes: empty/dot segments, backslashes,
percent escapes, URL delimiters, colons and control characters are rejected.
Existing integrations using larger bundles or noncanonical paths must adjust
their limits or filenames. Invalid publications fail before object-store effects.

Content `HEAD` responses have the corresponding GET headers and no body,
including errors and activation. Errors and activation responses include the
same security and no-store headers as content responses, with a restrictive CSP.

Import `createArtifactsManifest`, `createArtifactsToolExecutor` or
`createArtifactsAdapter` from `@sentropic/artifacts/mcp-core` when the platform
is absent. This entry has no runtime platform import. Existing `/mcp` exports,
including `createArtifactsRegistryDefinition`, retain their platform integration.
The existing root barrel re-exports `/mcp` and also requires the platform.
Platform types remain referenced in TypeScript declarations for adapter typing.
`make probe-artifacts-packed-consumer ENV=test-artifacts-hardening` installs the
tarball alone in a separate consumer, proves the platform is absent and runs the
15-tool manifest and ensure/publish/get/list flow before the platform proof.

Release coordination: #707 reserves 0.1.3 for optional platform peer widening;
0.1.4 retains `>=0.3.0 <0.5.0` and fits cluster-mesh's current
`>=0.1.0 <0.2.0` and #707's `>=0.1.3 <0.2.0` artifacts ranges.

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

## Storage adapters and host migrations

Hosts import `createS3BlobStore` from `@sentropic/artifacts/adapters/s3`
and `createPostgresArtifactStore` from `@sentropic/artifacts/adapters/postgres`.
Install the optional peer `@aws-sdk/client-s3@^3.980.0` for S3 and
`pg@^8.12.0` for Postgres (`@types/pg` for TypeScript hosts). Pass a configured
`S3Client` and bucket to the S3 adapter and a `pg.Pool` to the Postgres adapter.
The core works without either driver; adapters do not create connections or
apply DDL at import or startup.

The installed package includes SQL resources exported under
`@sentropic/artifacts/migrations/*`. Read them through Node's resolver:

```js
import { readFile } from 'node:fs/promises';

const migrations = ['0001_artifacts.sql', '0002_lifecycle.sql'];
for (const name of migrations) {
  const sql = await readFile(new URL(import.meta.resolve(
    `@sentropic/artifacts/migrations/${name}`,
  )), 'utf8');
  // Hand each SQL resource to the host's existing journaled migration runner.
}
```

Apply `0001_artifacts.sql` first to create the domain schema, then
`0002_lifecycle.sql` to add lifecycle, sharing, sources and GC support, before
using the Postgres store. The host owns migration credentials, serialization,
transactions and the migration journal; execute each version through that
runner rather than running this read loop at application startup.

Before the first `/ensure` or `artifacts_ensure`, the host must provision an
`artifacts.storage_scopes` row for each storage scope it uses. Migration 0001
creates the table but does not seed it; the package neither provisions scopes
nor infers their organization. The artifact's `storage_scope_id` references
this row through a foreign key. For example, run a parameterized host query:

```js
await pool.query(
  'INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
  [storageScopeId, organizationId],
);
```

Keep the scope ID stable, validate that any existing row belongs to the intended
organization, and use that ID as `storageScopeId` (or MCP's configured
`defaultStorageScopeId`). The host owns provisioning permissions and tenant
authorization; changing a binding or organization identifier does not provision
a scope automatically.

## Inline publication: text or bytes

Each file in HTTP `POST /publish` and MCP `artifacts_publish` accepts exactly
one of `text` (a string, including the empty string) or `bytes` (integers 0–255).
The server encodes `text` as UTF-8 before calculating digests and byte sizes:

```json
{
  "artifactId": "<ensured artifact UUID>",
  "files": [{ "path": "index.html", "mimeType": "text/html", "text": "<h1>Été à Montréal 🏠</h1>" }]
}
```

`text` requires a canonical lowercase MIME type without parameters: `text/*`,
`application/javascript`, `application/ecmascript`, `application/json`,
`application/xml`, `application/*+json`, `application/*+xml`, or `image/svg+xml`.
Use `bytes` for binary formats such as PNG or PDF. Both fields together, neither
field, a non-string `text`, or a non-text MIME type with `text` are rejected.

Content responses include `Cross-Origin-Resource-Policy: same-origin`, preventing
cross-origin no-CORS resource embedding even between sibling subdomains sharing
a registrable domain. Assets within the same artifact origin remain loadable.

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
- `src/mcp-core.ts` — the platform-free `sentropic.artifacts` MCP provider: 15 exact
  `artifacts_*` tools with closed schemas, a host-bindable invocation
  scope, an executor over the same HTTP app and a platform adapter.
- `src/mcp.ts` — the compatible `@sentropic/mcp-platform` kernel registry
  definition wrapper (the optional peer is required here and by the root barrel).

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
