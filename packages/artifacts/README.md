# @sentropic/artifacts — generic artifact contracts (L-5a)

## Shared PostgreSQL activation (UP-T, 0.2.3)

W1.c/W3.a and Radar S1/A6 use the same imports:

```ts
import {
  createPostgresActivationStore, ACTIVATION_MAX_TTL_SECONDS, ACTIVATION_SQL_ASSET,
  ACTIVATION_SQL_ASSET_SHA256,
} from '@sentropic/artifacts/adapters/postgres-activation';
import { createTicketService } from '@sentropic/artifacts/content/grants';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL(import.meta.resolve(ACTIVATION_SQL_ASSET)), 'utf8');
// Apply these exact bytes once through the host's journaled migration executor.
const activation = createPostgresActivationStore({ pool, namespace: trustedHostNamespace });
const tickets = createTicketService({ store: activation.tickets, ttlSeconds: ACTIVATION_MAX_TTL_SECONDS });
```

The SQL asset is `@sentropic/artifacts/sql/0001_activation.sql`; it creates the
independent `artifact_host` schema. The adapter never applies DDL or opens a
connection on construction. Journal the asset hash and verify it against
`ACTIVATION_SQL_ASSET_SHA256` before serving. A unit test pins the exact file bytes;
future schema changes require a new numbered SQL asset.
This store is independent of the publication coordinator.

Persist a flow through `activation.flows.put`: `flowId`, `ticketId`, `subjectId`,
`artifactId`, `releaseId`, `channel`, `nonceDigest`, `sessionId`, `profileDigest`,
`policyRevision`, `targetOrigin`, `expiresAt`. Nonce/profile digests are lowercase
SHA-256 hex; the origin is an exact HTTPS origin. One flow is associated with one
ticket. Both IDs must be fresh cryptographically random values, never reused on
retry or after cleanup. Duplicate IDs reject; records cannot be updated. The
trusted namespace comes from host configuration, never browser input.

`createTicketService` uses the adapter's optional `tickets.issue(record, ttlMs)`
port: PostgreSQL samples its clock after lock waits and adds the requested TTL
in SQL. The returned deadline is authoritative; issuance and redemption tolerate
application clock skew. Use that returned deadline for the browser flow, whose
expiry must be live and no later than its ticket. Low-level `tickets.put` imports
an absolute PostgreSQL-time deadline and enforces the same 60-second cap. The historical
120-second default of `createTicketService` is unchanged; hosts explicitly select
`ttlSeconds <= ACTIVATION_MAX_TTL_SECONDS` for this adapter.

For browser activation call `activation.consume({flowId,ticketId,expected},
authorize)`. `expected` contains every flow binding above except IDs and expiry.
Obtain these values from verified session/browser evidence and compiled policy.
The adapter locks namespace, flow, then ticket on one leased READ COMMITTED client,
checks exact bindings and database-time expiry after lock waits, invokes current
authority, and checks expiry again after authority waits at the atomic deletion.
Missing/expired/wrong bindings and explicit denial return `undefined`; authority
outage and transaction failures reject. Neither path permits a grant.

The host's `authorize({client,namespace,ticket,flow})` must recheck current session,
ACL, policy/profile, exact origin and stable-release fence on that client, holding
the relevant policy locks until COMMIT. Return `true` only with this protection.
Do not sign, set cookies, or perform externally visible effects in this callback.
Sign and emit a host-only cookie only after `consume` resolves with a record.
`ActivationCommitUnknownError` means issue no grant; obtain a fresh ticket/flow
after a new authority check. A crash after commit similarly requires a fresh
flow. Do not automatically replay a consumed ticket. Standalone `tickets.take`
implements the existing port; browser activation uses the combined operation.

Schedule `cleanup(limit)` at least once per minute and collect counts/errors
without token values. It deletes at most `limit` total rows (default 100, maximum
1000), skips locked candidates and respects namespace boundaries. Expiry denial
works even when cleanup stops. Ordinary application-process restart preserves
live state and single use.

During restore keep both replicas/issuers closed, restore the activation tables
and migration journal alongside business/ACL state, call `invalidate()` for each
trusted namespace, and rotate the host signing credential before admitting
either replica. Invalidation advances a durable namespace generation in O(1);
all restored tickets/flows deny immediately and bounded cleanup removes them.
Reconcile current authority independently of the restored ACL snapshot. Fresh
authorized sessions create fresh flows; revoked readers stay denied. Rollback
disables activation while retaining the additive schema and accepted artifacts.

### Importable host conformance (UP-T-2, 0.2.4)

The packed package exports the framework-independent host suite and its stable
vector IDs. Install the SQL asset through your test migration executor first:

```ts
import assert from 'node:assert/strict';
import {
  POSTGRES_ACTIVATION_VECTOR_IDS, runPostgresActivationConformance,
} from '@sentropic/artifacts/adapters/postgres-activation/vectors';

assert.equal(process.env.ACTIVATION_DISPOSABLE, '1');
const { rows: [{ databaseName }] } = await pool.query('SELECT current_database() AS "databaseName"');
assert.match(databaseName, /^test[_-][a-z0-9_-]+$/i); // Check before any schema setup/reset.
const passed = await runPostgresActivationConformance({
  disposable: { confirmed: true, databaseName },
  createStore: namespace => createPostgresActivationStore({ pool, namespace }),
  inspectTicket, // Host query returning persisted issuedAt/expiresAt and current DB now, in milliseconds.
  createStoreWithCommitAckLoss, // Host composition with acknowledgement loss AFTER real consume COMMIT.
  wait: async (ms, client) => { await (client ?? pool).query('SELECT pg_sleep($1)', [ms / 1000]); },
  onPass: id => console.log('activation vector passed:', id),
});
assert.deepEqual(passed, POSTGRES_ACTIVATION_VECTOR_IDS); // 16 vectors
```

Supply your host's store composition in `createStore`, using the supplied namespace
and the same disposable PostgreSQL database/executor for every instance. Replica
instances must share durable state. `wait` uses database time and the supplied
leased client during authority checks, including when the pool has one connection.
`inspectTicket(namespace, ticketId)` reads `issued_ms`, `expires_ms` and
`floor(extract(epoch FROM clock_timestamp()) * 1000)` through that same executor.
`createStoreWithCommitAckLoss(namespace)` wraps the host's leased client: execute
COMMIT, then throw before returning its acknowledgement. Seed with the normal
store; inject only into the store returned by this hook. Both hooks are optional
in the interface for additive compatibility; their vectors always run and fail
if either hook is absent. A complete host fixture is in
`packages/cluster-mesh/tests/packaging/activation-vectors.spec.ts`.
Run in an isolated process: the clock-skew vector temporarily replaces `Date.now`
by +/-120 seconds and restores it even on failure. TypeScript hosts install
`@types/pg` alongside `pg` in their consumer project.
The runner throws with the failing vector ID and original cause; it returns all
16 IDs only after every assertion passes. It uses fresh namespaces and invalidates
and cleans its records after each vector. Namespace rows remain in the disposable
database. The runner refuses without explicit disposable confirmation and an
actual database name starting `test_` or `test-`. Check `current_database()` on the
host executor before installing/resetting the schema. Never use a serving database.

The vectors cover namespace isolation, immutable records, all nine exact binding
comparisons, wrong IDs, denial/outage preservation, single use, concurrent replicas,
expiry without cleanup and after authority waits, bounded cleanup, invalidation
and fresh recovery, the 60-second TTL cap, flow/ticket association, DB-time-only
issuance/expiry under app clock skew, and `ActivationCommitUnknownError` without
a grant followed by replay denial. This adds
only a testing export in 0.2.4; adapter behavior and SQL bytes are unchanged.

`make -f packages/cluster-mesh/packaging.mk test-lazy-package-activation ENV=test-artifacts-upt2`
packs and installs the candidate in a clean consumer, verifies the SQL hash, and
runs all 16 vectors on that consumer's PostgreSQL executor (pool max 1 and 4).
It requires explicit disposable configuration and checks the JSON result for
nine passing tests and zero skipped tests; missing CI wiring fails. Follow with
`make down ENV=test-artifacts-upt2` (use the shared Docker lock for both commands).

Additional fault/process conformance lives in `tests/postgres-activation.test.ts` and
`tests/postgres-activation.integration.test.ts`, with the independent process
witness `tests/fixtures/activation-process.mjs`. Run through
`make test-artifacts` and `make test-artifacts-integration` on an isolated test
environment. The vectors cover namespace/binding isolation, immutable IDs,
one connection, no pre-commit result, uncertain commit, DB expiry after lock and
authority waits, bounded cleanup, two OS processes, restart, race, crashes before
and after commit, restored snapshot invalidation and fresh authority recovery.
Host migration/journal, actual session/ACL fences, signing-key rotation and real
browser/deployment receipts remain W1.c/W3.a/A6 obligations.

Version 0.2.1 fixes host commit authorization being masked by the built-in
publication guard and wires the optional trusted `mapHostError` dependency.
Publication retains its lifecycle, ACL and policy revision checks; the host
`authorizeCommit` binding decides account approval and its sanitized refusal code.
Custom services using `createGuardedPublicationService` may pass the request-bound
`authorizeCommit` in `publishFinalized(input)`. It runs after
lifecycle, ACL and policy revision checks. When omitted, publication keeps the
default `participant.checkApproval` check and denies unapproved or expired commits.

Bind the same mapper on `createHttpArtifactApp`, `createArtifactsToolExecutor`
(or `createArtifactsAdapter`) and `createArtifactCommitCoordinator` so host wrapper
errors are classified at their originating layer. For example:

```ts
import { ArtifactOperationError, type ArtifactHostFailureMapper }
  from '@sentropic/artifacts/server/outcome-contract';

const mapHostError: ArtifactHostFailureMapper = cause => {
  const code = (cause as { code?: string } | null)?.code;
  return code === 'artifact_s3_timeout' || code === 'artifact_connection_lost'
    ? new ArtifactOperationError('provider_unavailable', { cause }) : undefined;
};
```

Pass `{ ...existingOptions, mapHostError }` to each construction. The packed
`examples/radar-commit-setup.ts` also accepts this option. Unrecognized failures
keep their existing classification; private causes never enter HTTP/MCP results.
Frozen contracts, command identity and selected tools remain unchanged.


Generic, host-independent artifact domain state for the Sentropic artifacts
provider (`sentropic.artifacts`, spec-v8 §9), covering L-5a–5e. Version
`0.1.2` adds UTF-8 text publication, exposes storage adapters and ships SQL migrations.
Version `0.1.1` fixed activation ticket release and channel binding (FL-ACT).
Version `0.1.4` hardens host authority, replay isolation, publication and content
responses, and adds the platform-free `@sentropic/artifacts/mcp-core` entry.

## 0.2.0 contract line (L0 frozen)

The `0.2.0` line freezes the immo #861 declaration shapes only:
explicit capability selection and the effective publication profile
(`l0-freeze/profile-contract.ts`), the effective command identity
(`l0-freeze/command-identity-contract.ts`), the commit finalization unit
(`l0-freeze/commit-contract.ts`) and the typed failure outcome
(`l0-freeze/failure-contract.ts`). The section 3.2 host API names are frozen
against spec r2. Trusted scope/subject domain qualification and
actor-mapping acceptance remain gated on i-cond Q0; the structural freeze
is not a completed Q0-dependent qualification. L1+ promotes the shapes
into `src/`; version reservations are pack-only dev versions owned by the
integration owner, never registry candidates. The common-contract reuse map lives in
`docs/common-contract-map.md`; the migration inventory lives in
`docs/migration-inventory-l0.md`. L0 changes no behavior, no `src/` file
and no package version.

## Migrating to 0.1.4

HTTP hosts must supply a trusted `HttpRequest.storageScopeId` for `/ensure`.
MCP hosts configure `defaultStorageScopeId` or supply the trusted invocation's
`ArtifactsInvokeInput.storageScopeId`; tool arguments cannot choose storage.
Legacy body/tool `storageScopeId` and client `paramsHash` fields remain accepted
but are ignored. Missing host scope now returns 400. Ensure hashes cover the
validated parameters, binding, owner and scope; publication hashes cover release
metadata, server-derived file digests and validated source provenance (including
its absence and recipe step order). Source writes occur within the idempotent
publication operation, so unchanged replays do not write provenance again.
Direct service callers publishing a `source` pass their host `SourceStore` as
the second argument to `publish`; the HTTP/MCP app supplies its configured store.
Keys are isolated by operation and
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
Upload sessions cap client `maxSize` by the host `maxUploadBytes` and publication
file/total limits. Every append checks remaining cumulative capacity before
decoding bytes or writing staging. Upload publication metadata is validated
before the session is consumed; a rejected path or MIME type can be corrected
and committed using the same staged bytes. Finalization validates, hashes and
publishes one copied snapshot. Overlapping append/commit operations return 409;
failed verification or metadata validation leaves the session retryable.

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

## Source and management capabilities

Version 0.3.0 introduces D1, D2 and D4; see [CHANGELOG.md](./CHANGELOG.md).

Hosts may explicitly select `artifacts_get_source`, `artifacts_set_access`, and
`artifacts_delete` in their compiled profile. Configure `get_source` with empty
limits/defaults, and `set_access`/`delete` with `idempotencyKeyMaxUnits: 256` and
empty defaults. Existing profile selections remain explicit.

`POST /get_source` accepts `artifactId`, optional `releaseId`, and optional unique
`paths` (1–32 entries). Bind `publication.getRelease` and `sources.getSource` on
the HTTP app. It returns the canonical manifest, verified author file bytes,
and separate nullable `sourceRef`; readers need the distinct source permission.
The snapshot is limited to 32 files and 262144 decoded bytes. Hosts must qualify
a 2 MiB serialized MCP result budget before selecting this capability.

`POST /set_access` grants or revokes a named principal's read access, requires a
caller `idempotencyKey`, and keeps the artifact private. Bind
`isApprovedAccount` to the host's principal policy. `POST /delete` also requires
`expectedCurrentReleaseId` (nullable) and a trusted `management.confirmation`
port. Its `request` method issues a challenge for the host management UI;
`consume` verifies the human-approved proof, expiration and full command context
on the supplied transaction. A caller boolean is never confirmation. Repeated
successful deletes return the stored receipt without consuming proof again.

Apply `migrations/0004_terminal_controls.sql` after `0001_artifacts.sql`,
`0002_lifecycle.sql` and `0003_coordinator.sql` before activation.
The default management writer uses the coordinator's PostgreSQL
transaction; alternative stores implement `management.createUnit` with the same
parent/ACL/current lock order and transactional effects. Terminal markers and
SQL guards prevent restoration and later publication. Deletion reports
`purgeState: "pending"`; physical purge belongs to host retention policy.

Get/list include binding, creation/modification dates, current release, digest,
host URLs and available metadata. Historical modification dates stay nullable.
The PostgreSQL projection reads the optional metadata column added by the
publication parity lane without requiring that column for older stores.
