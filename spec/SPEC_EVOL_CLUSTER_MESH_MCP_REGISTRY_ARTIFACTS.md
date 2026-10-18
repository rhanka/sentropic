# SPEC EVOL — Cluster-Mesh MCP Provider Registry and `sentropic.artifacts` Provider

## Status and authority

**Status:** consolidated record of merged behavior. This spec describes what PR #679 (`feat: immo-861-mcp-registry (Sentropic consolidation 1a + 2-IdP + 2a)`) merged on `main` at `1472d961e098908e64ef60b83835af357888d031` (merged 2026-10-17). It introduces no new design: every statement is traceable to code at that commit or to a verbatim owner decision quoted in §9. Items not merged at that commit are marked as follow-ups in §10 and are not specified as current behavior.

**Authority:** the owner model quoted verbatim in §9.1. Sentropic owns the generic registry, provider contracts and package releases; each host owns its selection, parameterization and customizations. Immo is the first host. This spec is the repo record for the merged registry/artifacts surface; the scratch planning documents that preceded the merge are sources, not deliverables, and are listed in the source ledger (§13).

Related context:
- `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` — generic application MCP provider platform (manifest/adapter contract, elicitation, session/secret records). This spec records the registry and artifacts provider that landed under that platform framing.
- `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md` — cluster-mesh control plane, namespace contracts and D3 responsibility split.
- `spec/SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md` — cluster-mesh as the single lazy integration surface (optional peers, static leaves, loaders). PR #679 delivers a subset of its E5 MCP contract: the registry facade, provider leaves/loaders and the `/mcp` namespace composition over bridge + platform Hono with host-supplied auth (§3, §4). The remaining E5 OAuth composition (`createMcpAuth`, `mcpAuthRoutes`, `createMcpPlatformHono` wiring inside cluster-mesh) is not merged; it is follow-up #689 (§10).
- `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md` — `@sentropic/mcp-platform` activation and publication state.

## Reading convention

- File references are given at merge commit `1472d961e` (for example `packages/cluster-mesh/src/mcp/registry.ts`). Line numbers, when present, refer to that tree.
- "Merged" means present in the tree at `1472d961e`. "Follow-up" means tracked by an open PR or issue after that commit; follow-ups are named with their PR number and never described as shipped behavior.
- Owner decisions are quoted verbatim in French in §9, each with its source. A quote is a decision record, not a paraphrase.

## Objective

Record, in the repo, the merged contract by which:

- a host embeds the MCP provider registry through `@sentropic/cluster-mesh`, selects providers, configures them with host-owned values, compiles one registry, and keeps its own customizations;
- the `sentropic.artifacts` provider (package `@sentropic/artifacts`, leaf `./mcp/artifacts`) delivers artifact storage, ACL, releases and content activation through 15 exact `artifacts_*` tools;
- workload calls cross hosts through an RFC 8693 token exchange with a bounded cache and explicit invalidation, with no bearer passthrough.

## Non-goals

- No new provider, tool, route or release is designed here. Design deltas belong to their own branches and specs.
- Radar/Immo application behavior (its own MCP tools, receiver, deployment) is host-side work, referenced only where the merged Sentropic contract binds it.
- This spec does not retire or rewrite the platform spec (`SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md`); it records the merged subset and cross-references the rest.

## 1. Purpose

Provide the durable repo reference for the registry + artifacts delivery of PR #679, so that a second host, a reviewer, or a later branch can rely on merged contracts without reading the pre-merge scratch specifications. The spec covers the host model (§2), the component model (§3), the registry contract (§4), the artifacts provider (§5), the token exchange (§6), host obligations (§7), published versions (§8), owner decisions (§9), follow-ups (§10), and the second-host statement (§11).

## 2. Host model: generic core vs host responsibilities

The merged model is the owner model quoted in §9.1: the registry and its parameterizable providers ship through cluster-mesh; the host imports cluster-mesh, exposes the registry, registers its own MCP providers, and activates shipped providers with host parameterization. Customizations live host-side.

### 2.1 Sentropic core owns

- The registry facade: provider registration, `select`, `configure`, atomic `compile`, and the compiled registry (`packages/cluster-mesh/src/mcp/registry.ts`).
- Two provider-acquisition paths with different timing (see §4.2): separate loaders acquire provider modules on demand through `modules.load(...)` at compile time, while static leaves evaluate the selected peer's module graph at import. Only the loader path and registry-definition construction are deferred; importing a static leaf is itself the selection act (`packages/cluster-mesh/src/loaders/mcp/artifacts.ts`; `packages/cluster-mesh/src/integrations/mcp/artifacts.ts:6,34-37`; `spec/SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md`, E2).
- The generic provider-definition contract: exact `publicName → (providerId, capabilityName)` mapping, duplicate and cross-provider collision rejection without sanitizing, suffixing or silent keep (`packages/artifacts/src/provider-definition.ts:36-84`).
- The platform kernel in two distinct parts: the compiler, which returns a compiled registry plan (provider/tool maps and tool resolutions; `packages/mcp-platform/src/registry.ts:162-165,611-614`), and runtime helpers that build frozen registry entries and canonical requests only when explicitly called (`packages/mcp-platform/src/registry-entry.ts:50-112`). Compilation alone creates no `RegistryEntry` and no canonical request digest (§4.3).
- The `sentropic.artifacts` provider package and its 15 tools (§5).
- The RFC 8693 exchange client policy: grant type, Bearer-only, scope intersection, TTL ceilings, caching and invalidation (§6).

### 2.2 Host owns

- Which providers are selected and the values each selected provider is configured with; configuring an unselected provider is refused (`packages/cluster-mesh/src/mcp/registry.ts:95-113`).
- Its own domain MCP providers, registered alongside shipped providers in the same composed registry (Immo registers its own MCP functions; §9.1).
- All provider parameterization and customizations (for Immo: the web-pages parameterization; the pre-merge host plan implements the §9.1 owner model as versioned Immo configuration shipped with the Immo image — a host-side arrangement, with no Immo image or configuration delivery receipt in the merged Sentropic tree; §12).
- Host-supplied runtime resources listed in §7 (identity, storage, content domain, TLS termination, activation secrets and stores).
- Local configuration-review metadata (`approvalRef`, `revision`, `reviewedBy`): integrity metadata only, never an authorization authority (`packages/artifacts/src/mcp.ts:363-368,391-396`).

### 2.3 Non-goals / hard constraints

- No provider code carries host-specific defaults: the artifacts package states "No Immo defaults, URLs or bindings in generic source" (`packages/artifacts/README.md`).
- Public tool names are exact: collisions across activated providers abort compilation instead of being renamed (`packages/artifacts/src/provider-definition.ts:70-84`).
- On the loader path, an absent or incompatible selected peer refuses compilation atomically; no stub fallback is installed (`packages/cluster-mesh/src/integrations/mcp/artifacts.ts:17-24`). On the static-leaf path, a missing peer fails ESM linking at import time instead (§4.2).

## 3. Component model

| Component | Merged surface at `1472d961e` | Role |
|---|---|---|
| Registry facade | `packages/cluster-mesh/src/mcp/registry.ts` (`select`, `configure`, `compile`, `compiled`) | Host-facing selection/configuration/compilation of providers |
| Module loaders | `packages/cluster-mesh/src/loaders/mcp/{registry,entry,bridge,hono,stdio,artifacts}.ts` | On-demand acquisition of provider modules, invoked at compile time |
| Artifacts builtin leaf | `packages/cluster-mesh/src/integrations/mcp/artifacts.ts` (`createArtifactsBuiltin`) | Static leaf: importing it evaluates the `@sentropic/artifacts/mcp` peer module; only its `load()` callback defers registry-definition construction |
| Mesh composition | `packages/cluster-mesh/src/compose/mcp.ts`, `packages/cluster-mesh/src/mesh.ts` | Namespace composition over the compiled registry |
| Platform kernel | `packages/mcp-platform/src/{registry,registry-entry,registry-canonical,registry-parameters,tool-configuration}.ts` | Compiler producing the compiled plan; separate runtime entry/canonicalization helpers; bounded schemas |
| Artifacts provider | `packages/artifacts/src/{contracts,parameters,provider-definition,mcp}.ts` | Provider definition, parameter schema, manifest, 15 tool specs |
| Artifacts server | `packages/artifacts/src/server/{ports,service,authorization,access,bindings,publication,lifecycle,uploads,gc,runtime}.ts` | Storage ports, ACL, bindings, releases, lifecycle |
| Artifacts content | `packages/artifacts/src/content/{grants,routing,headers,handler,api-profile}.ts` | Content grants, activation tickets, content origins, serving |
| Exchange client | `packages/cluster-mesh/src/token-exchange.ts`, `packages/cluster-mesh/src/trust/token-exchange-http.ts` | RFC 8693 exchange, cache, invalidation (§6) |
| Issuer side | `packages/auth-hono/src/oauth/token-exchange-handler.ts`; `api/src/routes/auth/oauth.ts`; `api/drizzle/0043_immo_token_exchange.sql` | Sentropic issuer support for the exchange |

Transports (stdio, streamable HTTP, bridge, Hono) are provided by `packages/mcp-platform/src/transport/*` and the cluster-mesh loaders; one compiled registry serves every transport, and the artifacts service is shared by its HTTP and MCP surfaces (`packages/artifacts/README.md`, L-5b–5e notes).

## 4. Provider registry contract

### 4.1 Selection and configuration

The host-facing facade is `packages/cluster-mesh/src/mcp/registry.ts`:

- `select(providerIds)` fixes the selected provider set. Selecting an unknown provider throws `unknown provider selection: <id>`; selecting the same provider twice throws `duplicate provider selection: <id>` (`packages/cluster-mesh/src/mcp/registry.ts:95-103`).
- `configure(providerId, values)` attaches host-owned parameter values to a selected provider. Configuring an unselected provider throws `unselected provider configuration: <id>`; values must be a record (`packages/cluster-mesh/src/mcp/registry.ts:106-113`).
- Availability is reported per builtin as `not-selected`, `not-configured` or `available` from the current compiled state (`packages/cluster-mesh/src/mcp/registry.ts:125-144`).
- `compile(...)` acquires the platform kernel fresh, loads each selected builtin through its `load()` callback, registers, selects, configures and compiles; on success it replaces the facade's current registry, and a refusal inside `compile` publishes nothing (`packages/cluster-mesh/src/mcp/registry.ts:150-204`). This atomicity is scoped to the `compile` call: the facade's `register`, `select` and `configure` each clear the current compiled registry through `mutate()` (`packages/cluster-mesh/src/mcp/registry.ts:77-79,93,104,115`). After a successful compile, reconfiguring (even with values a later compile refuses) leaves `compiled()` undefined until the next successful compile; a previously returned compiled object itself is never mutated.

### 4.2 Names and leaves

- Provider ID: `sentropic.artifacts` (`ARTIFACTS_PROVIDER_ID`, `packages/artifacts/src/mcp.ts:22`). Application ID: `sentropic-artifacts` (`packages/artifacts/src/mcp.ts:23`). Provider version at merge: `0.1.0` (`packages/artifacts/src/mcp.ts:24`).
- Cluster-mesh leaf: `@sentropic/cluster-mesh/mcp/artifacts` (export `./mcp/artifacts`, `packages/cluster-mesh/package.json:107-109`), backed by `createArtifactsBuiltin` (`packages/cluster-mesh/src/integrations/mcp/artifacts.ts:25-39`).
- Two entry paths, two failure timings. The separate loader `loadArtifactsMcp(modules)` resolves the peer through `modules.load('mcp/artifacts')` at compile time (`packages/cluster-mesh/src/loaders/mcp/artifacts.ts:11-12`); there, an absent or incompatible optional peer (`@sentropic/artifacts >=0.1.0 <0.2.0`, `peerDependenciesMeta.optional = true`; `packages/cluster-mesh/package.json:150,160`) refuses compilation and no stub is substituted. The static leaf instead statically imports values from `@sentropic/artifacts/mcp` (`packages/cluster-mesh/src/integrations/mcp/artifacts.ts:6-12`): importing `createArtifactsBuiltin` evaluates that peer module before any `select`/`compile`, so a missing peer can fail ESM linking at import rather than produce a compile refusal. Only the leaf's `load()` callback and the `createArtifactsRegistryDefinition` construction behind it are deferred (`packages/cluster-mesh/src/integrations/mcp/artifacts.ts:34-37`).
- The provider's own MCP subpath is `@sentropic/artifacts/mcp` (export `./mcp`, `packages/artifacts/package.json`), which builds the kernel registry definition (`createArtifactsRegistryDefinition`, `packages/artifacts/src/mcp.ts:372-399`).

### 4.3 Compiled plan, runtime helpers, and dispatch validation

Three distinct layers must not be conflated:

- **Compiled plan (compiler output).** Compilation returns a `CompiledMcpRegistry` carrying provider/tool maps and `CompiledToolEntry` resolutions, including `resolveTool(publicName)` (`packages/mcp-platform/src/registry.ts:142,162-165,591-614`). It creates no per-call entry and no canonical request digest.
- **Runtime entry helpers (explicit calls only).** `buildRegistryEntry` freezes a `RegistryEntry` (tool name, capability ref, handler ID, bounded schema, canonical request), and `resolveRegistryEntry` builds one from runtime `input.args`, rejecting an unknown tool before inspecting arguments (`packages/mcp-platform/src/registry-entry.ts:58-112`). These helpers run only where a caller invokes them; the compiled plan does not invoke them by itself.
- **Actual dispatch validation.** The shared MCP bridge validates call arguments against `BridgeTool.schema` with `validateBoundedValue`, then invokes its supplied runner (`packages/mcp-platform/src/transport/bridge.ts`, CallTool handler). It does not call `resolveRegistryEntry`. The composed `/mcp` namespace path runs the host runner through its context/policy/guard chain (`createGuardedRunner`, `packages/cluster-mesh/src/compose/mcp.ts:125-140,173-199`), after checking each bridge tool against the compiled plan (`resolveTool`). Hosts therefore get schema validation at dispatch, not an automatic canonicalization or single-validation-path guarantee from compilation alone.

## 5. The `sentropic.artifacts` provider

### 5.1 Tool surface (15 exact tools)

The provider exposes exactly 15 tools, with closed input schemas (`packages/artifacts/src/mcp.ts:27-31,71-85`):

| Tool | Mutability (as declared) | Contract summary |
|---|---|---|
| `artifacts_get_template` | read-only | Approved template kit (sources + build recipe) |
| `artifacts_get_api_guide` | read-only | Versioned artifacts API guide |
| `artifacts_ensure` | state-transition, idempotent | Resolve or create the private artifact view for a binding |
| `artifacts_publish` | append, idempotent | Publish inline files as a new release |
| `artifacts_create_upload` | state-transition | Open a bounded upload session for large bytes |
| `artifacts_commit_upload` | append, idempotent | Verify staged bytes and publish them as a release |
| `artifacts_list` | read-only | List artifacts visible to the caller (ACL before pagination) |
| `artifacts_get` | read-only | Artifact metadata (grants visible to the owner only) |
| `artifacts_get_source` | read-only | Export the attached source reference (separate right) |
| `artifacts_fork` | state-transition | Fork privately under a fresh identity (no ACL copied) |
| `artifacts_set_access` | patch, confirm | Grant or revoke read/source access, or toggle public mode |
| `artifacts_promote` | patch | Select a release explicitly (expected-current CAS) |
| `artifacts_renew` | patch | Renew the artifact retention timestamp |
| `artifacts_delete` | delete, confirm | Withdraw into pending deletion (undo via `artifacts_restore`) |
| `artifacts_restore` | state-transition | Cancel a pending deletion or withdrawal before purge |

Parameter values are validated against the provider parameter schema: defaults apply, unknown keys, wrong types and missing required values are rejected, and secret-looking keys are refused (`packages/artifacts/README.md`, L-5a notes; `packages/artifacts/src/parameters.ts`).

### 5.2 Storage

Two composition levels exist; do not merge them. The small binding/ensure service (`createArtifactService`) depends only on `ServerPorts` — `KvPort` (get / put-if-absent) and `UuidPort` — which back its bindings and idempotency store (`packages/artifacts/src/server/ports.ts:10-23`; `packages/artifacts/src/server/service.ts:35-40`). The full fifteen-tool application composes the separate services and stores listed in `HttpAppDeps`: the ensure service, publication, lifecycle, forks, ACL store, source store and blob store, with `uploads` + `staging` additionally required to enable the upload routes and `templates` required for template/guide routes (`packages/artifacts/src/http.ts:47-61,144-149`). The shipped Postgres adapter implements the combined `PostgresArtifactStore` (publication state, intents, idempotency, ACL, sources, lifecycle, refcounts), not `KvPort` (`packages/artifacts/src/adapters/postgres.ts:35-44`); the shipped S3 adapter implements `PublicationBlobStore` (`packages/artifacts/src/adapters/s3.ts:43`). Domain schema ships as package migrations `packages/artifacts/migrations/0001_artifacts.sql` and `0002_lifecycle.sql`. Blobs are refcounted; garbage collection is explicit and reported (`packages/artifacts/src/server/gc.ts`).

### 5.3 ACL and authorization

Authorization runs first in the shared service (`packages/artifacts/src/server/service.ts`; `packages/artifacts/README.md`, L-5a notes). The baseline rule is owner-only, deny by default (`packages/artifacts/src/server/authorization.ts`); sharing grants, approved-public evaluation and the ACL store arrive in the same merged package (`packages/artifacts/src/server/access.ts`). Listing applies the ACL before pagination (`artifacts_list`, §5.1), forks copy no ACL (`packages/artifacts/src/server/fork.ts`), and content reads recheck the live ACL on every request (§5.5).

### 5.4 Releases and lifecycle

Publication creates releases over one current pointer; promotion selects a release explicitly with an expected-current compare-and-swap (`artifacts_promote`, §5.1; `packages/artifacts/src/server/publication.ts`, `packages/artifacts/src/server/lifecycle.ts`). Lifecycle covers withdraw, restore, delete, purge and retention renewal (`packages/artifacts/src/server/lifecycle.ts`). Uploads are staged through bounded sessions and committed only after digest/size verification (`artifacts_create_upload`, `artifacts_commit_upload`; `packages/artifacts/src/server/uploads.ts`). Idempotency is per-operation, not a blanket mutation contract: only the tools whose schemas declare it accept an idempotency key (`artifacts_ensure`, `artifacts_publish`, `artifacts_commit_upload`; `packages/artifacts/src/mcp.ts:73-76`), and publication replay applies only when both a request key and an injected idempotency store are present — otherwise publication calls `commitOnce` directly (`packages/artifacts/src/server/publication.ts:194-202`). Fork, access changes, promote, renew, delete and restore declare no idempotency-key field (`packages/artifacts/src/mcp.ts:80-85`); a fork allocates a fresh identity on every successful invocation (`packages/artifacts/src/server/fork.ts:90-96`). The §5.1 "idempotent" labels are the declared per-tool values only.

### 5.5 Content grants and activation tickets (merged state)

Content is served on a separate content domain (§7). Two short-lived mechanisms authorize it (`packages/artifacts/src/content/grants.ts:1-13`):

- **Content grants.** HMAC-SHA256 signed with a host-injected secret; bound to subject + artifact, with an optional pinned release; 55-second TTL inside a 60-second total cutoff budget (grant + skew/propagation). Verification is fail-closed (signature, shape, lifetime cap, expiry, future-issued beyond the skew budget). A grant never replaces the per-request ACL recheck in the content handler (`packages/artifacts/src/content/handler.ts`).
- **Activation tickets.** Single-use tickets whose stored record is `TicketRecord { ticketId, subjectId, artifactId, releaseId?, expiresAt }` (`packages/artifacts/src/content/grants.ts:112-118`), 120-second TTL (`CONTENT_TICKET_TTL_SECONDS`, `packages/artifacts/src/content/grants.ts:18`). Ticket IDs come from an injected port and must be unguessable (default: crypto UUIDs). **Stored is not enforced:** merged redemption accepts only `{subjectId, artifactId}` and compares only those two fields (`TicketService.redeem`, `packages/artifacts/src/content/grants.ts:143-148,174-188`); the stored `releaseId` is not compared at redemption. The content handler ignores the returned ticket record and mints the post-activation grant for the release currently resolved from the request origin (`packages/artifacts/src/content/handler.ts:99-122`). A ticket issued while release r1 was current can therefore activate release r2 after a stable-origin republish, even when its stored `releaseId` says r1. What remains enforced per release is the later grant-cookie check: an already-issued release-specific grant receives 401 once the stable origin resolves to another release (`packages/artifacts/src/content/handler.ts:140-142`); pinned origins keep serving their immutable release.

Mandatory release binding at redemption, and the channel-bound ticket form (`{subject, artifact, release, channel}`), are **not** in the merged tree; they are follow-up #688 (§10). A host must not treat release- or channel-bound activation as a shipped guarantee.

## 6. Token exchange (RFC 8693)

### 6.1 Contract

Workload calls obtain delegated tokens through RFC 8693 token exchange. The cluster-mesh client owns policy (grant type, Bearer-only, scope intersection, TTL ceiling, caching, never-passthrough); the issuer binding owns cryptographic trust (subject verification, token minting) (`packages/cluster-mesh/src/token-exchange.ts:97-106`). Grant and token-type constants are `RFC8693_GRANT_TYPE` / `ACCESS_TOKEN_TYPE` (`packages/cluster-mesh/src/trust.ts`, consumed at `packages/cluster-mesh/src/token-exchange.ts:2`). The production binding is the authenticated RFC 8693 HTTP adapter (`packages/cluster-mesh/src/trust/token-exchange-http.ts`); the Sentropic issuer side merged in the same PR (`packages/auth-hono/src/oauth/token-exchange-handler.ts`; issuer schema `api/drizzle/0043_immo_token_exchange.sql`).

Minted material never carries refresh material (`packages/cluster-mesh/src/token-exchange.ts:72`). Refusals are typed and fail-closed (unsupported grant/subject/requested token types, missing or disallowed audience, unverified or expired subject, invalid actor, empty scope intersection, `exchange_invalidated`; `packages/cluster-mesh/src/token-exchange.ts:108-135`). Raw bearer passthrough is excluded by construction and by test (`packages/cluster-mesh/tests/token-exchange-no-passthrough.spec.ts`).

### 6.2 Cache

- Hard residency cap: 60 seconds (`TOKEN_EXCHANGE_CACHE_TTL_MS`, `packages/cluster-mesh/src/token-exchange.ts:9-10`).
- Hard minted-token lifetime ceiling: 300 seconds; no configuration may raise it (`TOKEN_EXCHANGE_MAX_TTL_SEC`, `packages/cluster-mesh/src/token-exchange.ts:12-16`).
- Bounded cache: 1000 entries by default with insertion-order eviction, and a 5-second early-use safety margin subtracted from every cache deadline (`packages/cluster-mesh/src/token-exchange.ts:18-22`).

### 6.3 Invalidation

`invalidateTokenExchangeCache(filter | 'all')` evicts matching cached entries and detaches matching in-flight exchanges (`packages/cluster-mesh/src/token-exchange.ts:205-214,519-560`). Its return value is not a uniform total: it counts evicted cached entries, and counts detached flights only for global invalidation (`'all'` or the omitted argument) and for the bounded-history collapse into a global invalidation. A subject- or tenant-scoped invalidation can therefore cancel a pending mint and return `0`; zero is not evidence that no pending work was invalidated (`packages/cluster-mesh/src/token-exchange.ts:521-555`; asserted by `packages/cluster-mesh/tests/token-exchange-cache.spec.ts:290,320,350`).

The mid-flight guarantee is scoped to the supported cases. For `'all'`, the omitted argument, a subject filter, or a tenant filter, an invalidation landed during subject verification or during the mint makes the pending exchange refuse with `exchange_invalidated` and admit nothing into the cache (`packages/cluster-mesh/src/token-exchange.ts:317-324,397-401,441-486`). **Baseline limitation:** an empty filter object `{}` matches every cached entry for eviction and detaches in-flight registrations, but advances neither the global nor any scoped invalidation floor (`packages/cluster-mesh/src/token-exchange.ts:338-346,527-537`), so an outstanding mint still succeeds and repopulates the cache. A caller requiring global in-flight invalidation uses `'all'` or omits the argument; an empty object does not provide that guarantee.

## 7. What a host must supply

The merged packages define ports and transport-free surfaces; the host supplies the concrete resources:

| Obligation | Host supply (merged contract) |
|---|---|
| Identity | Verified caller identity mapped into the provider context: the artifacts adapter resolves `principalSub`/`tenantRef`/`connectorInstanceId` into tenant/principal refs (`packages/artifacts/src/mcp.ts:320-325`) and the executor acts as `req.ctx.principal.sub` (`packages/artifacts/src/mcp.ts:333-337`). For exchange, the host/issuer binding supplies subject verification and minting (`TokenExchangeIssuer.verify/mint`, `packages/cluster-mesh/src/token-exchange.ts:103-106`) plus the workload client provisioning (`api/src/scripts/oauth-provision-exchange-client.ts`, `api/src/services/auth/oauth-client-seed.ts`). |
| Storage | For the ensure service only: `ServerPorts` (`KvPort`, `UuidPort`; `packages/artifacts/src/server/ports.ts:20-23`). For the full application: the composed services/stores of `HttpAppDeps` (publication, lifecycle, forks, ACL, sources, blobs; uploads/staging for upload routes; `packages/artifacts/src/http.ts:47-61`), backed by the shipped combined `PostgresArtifactStore` (`packages/artifacts/src/adapters/postgres.ts:35-44`) and the S3 `PublicationBlobStore` (`packages/artifacts/src/adapters/s3.ts:43`) — neither adapter implements `KvPort`. Apply the package migrations (`packages/artifacts/migrations/0001_artifacts.sql`, `0002_lifecycle.sql`). No eager connections or DDL run on import (`packages/artifacts/src/server/ports.ts:1-9`). |
| Content domain | A content base domain routed to the transport-free content handler: stable origin `<artifactId>.<base>` follows the current release, pinned origin `<releaseId>.pinned.<base>` serves one immutable release (`packages/artifacts/src/content/routing.ts:4-6,20-22`); the handler is constructed with `baseDomain` injected (`packages/artifacts/src/content/handler.ts:43-44`). |
| TLS | TLS termination and origin routing are host-side: the package ships transport-free HTTP/content surfaces only (`packages/artifacts/src/http.ts`; `packages/artifacts/src/content/handler.ts`) and emits a host-only `__Host-artifacts_grant` cookie plus no-store/nosniff/frame-denial/CSP headers (`packages/artifacts/src/content/headers.ts`), which require the host's secure origin. |
| Activation | The HMAC grant secret, the ticket store and the ticket ID source are injected ports (`createHmacGrantSigner`, `TicketStore`, `createTicketService`; `packages/artifacts/src/content/grants.ts:50-54,120-125,152-157`); template kits and the API guide are host-approved local assets behind a catalog port (`packages/artifacts/src/server/templates.ts`). |
| Provider values | Selection + configuration values per provider (§4.1), and local review metadata (`approvalRef`, `revision`, `reviewedBy`) as integrity metadata only (`packages/artifacts/src/mcp.ts:363-368`). |

## 8. Published versions

Versions declared in the merged tree at `1472d961e`, with npm registry state checked while writing this branch:

| Package | Version at `1472d961e` (source) | npm state at check |
|---|---|---|
| `@sentropic/cluster-mesh` | `0.18.0` (`packages/cluster-mesh/package.json`) | published: `0.18.0` |
| `@sentropic/mcp-platform` | `0.3.0` (`packages/mcp-platform/package.json`) | published: `0.3.0` |
| `@sentropic/auth-hono` | `0.16.0` (`packages/auth-hono/package.json`) | published: `0.16.0` |
| `@sentropic/artifacts` | `0.1.0` (`packages/artifacts/package.json`; `ARTIFACTS_PROVIDER_VERSION`, `packages/artifacts/src/mcp.ts:24`) | not present on npm at check; first publish is an owner-run bootstrap (`bootstrap_publish_target=artifacts`), never automated (`packages/artifacts/README.md`, "First publish (bootstrap)") |
| `@sentropic/llm-gateway` | `0.20.1` (`packages/llm-gateway/package.json`) | not re-checked for this spec |

The accepted peer range binding the artifacts provider into cluster-mesh is `>=0.1.0 <0.2.0` (§4.2). A registry absence is not a source defect: local sibling archives do not establish publication, and consumers must record actual registry receipts before adoption.

## 9. Owner decisions (verbatim)

### 9.1 Host model (binding)

Source: pre-merge consolidated specification, §1 "Binding owner model and evidence", recording the launch packet's owner instructions verbatim. Preserved here as the decision record for §2:

> immo embarque le registre mcp via cluster-mesh et le configure: ajoute son propre mcp pour les fonction immo, et parametre ceux qui doivent l'être (pages de vibe coding). donc les custo vivent côté immo, et cluster-mesh et son registry et ses mcp embarquent des fonction de selection/ paramétrage

> sentropic dispose d'une fonction registre avec un certain nombre de mcp (comme l'affichage de pages web) paramétrables, livrées via cluster-mesh. Immo importe cluster-mesh et expose le registre mcp, y enregistre son propre mcp des fonctions immos, et active avec un paramétrage immo la fonction des pages web.

Merge sequencing decision (same source, §1 and lot plan): owner decision **2026-10-16 Q-A1 = A**:

> « Tout attend la fusion »

### 9.2 Gap decisions T1–T8

Source: owner decisions relayed verbatim by the Immo conductor, 2026-10-16:

> « T4: en fait on s'en fou un peu, c'est quotidien, s'il y a eu une annulation sur preprod et pas prod, ca n'a pas vraiment de sens, en tout cas c pas urgent » ; « T6: bah oui sinon comment on restero preprod sur prod ? » ; « T7: donc ?? pas tres clair » ; « T3 oui faut fixer ca » ; « T5 a corriger » ; « T8 je comprends pas on a tout fait pour qu'un utilisateur de prod puisse juste se loguer en prod pour éviter une complexité inutile, peux tu arrêter d'inventer n'importe quoi ? » ; « vas y mais n'hystérise pas tout. MCP = le plus critique ».

Recorded consequences in the same source: T4 and T6 accepted by design (preprod mirrors prod); T8 withdrawn; T7 only measure = no manual re-sync during the restore window; T1, T3, T5 fixed host-side; T2 (MCP session bound to owner, current-request identity/scopes/token, idle expiry) prioritized host-side. T4/T6/T7/T8 are not re-raised as requirements by this spec.

### 9.3 OAuth restore rehearsal

Source: owner decision 2026-10-16 on OAUTH-RESTORE-T3, relayed verbatim by the Immo conductor:

> « Test hors ligne seul (Recommandé) »

Recorded consequence in the same source: the offline proof only; no failure-injection input is added to the host restore workflow for now; real injection is not a prerequisite.

### 9.4 OAuth cutover into cluster-mesh

Source: binding owner addendum 2026-10-16 (OAuth move into cluster-mesh, #861):

> « ok donc je veux qu'on fasse bien la bascule. mais attention au processus de sauvegarde / backup restoration côté immo »

This decision drives follow-up O1 (#689, §10); it is not merged behavior at `1472d961e`.

### 9.5 « Tout en artifacts » (source gap)

The launch packet for this branch requires the owner decisions quoted verbatim, including:

> « Tout en artifacts »

Source status: this exact phrase was not found in the scratch sources read for this spec (`spec-v8.md`, `registry-entry-contract-v9.md`, `owner-decisions-T1-T8.md`, owner addendums, O1 plan). It is quoted here from the launch packet itself. No context is added around it; closing this source gap requires the owner's original message reference.

## 10. Follow-ups — not merged at `1472d961e`

These items are open after the #679 merge. They are recorded here so no reader treats them as shipped behavior; their own PRs own their contracts.

| Follow-up | State at writing | Delta vs merged tree |
|---|---|---|
| Artifacts `0.1.1` — activation ticket binding (FL-ACT), PR #688 (`fix/artifacts-activation-binding`, "Fix artifact activation ticket binding (FL-ACT)") | OPEN, not merged | Makes release binding mandatory and enforces release plus channel at redemption, superseding the merged subject/artifact-only redemption (§5.5), and ships as `@sentropic/artifacts 0.1.1`. Until it merges, §5.5 is the binding contract. |
| O1 — cluster-mesh OAuth composition for Immo, PR #689 (`feat/cluster-mesh-oauth-o1`, "Cluster-mesh OAuth composition for Immo (O1)") | OPEN draft, not merged | Implements the §9.4 cutover decision host-side composition (`/mcp/auth`, `/compose/mcp-oauth` surfaces per its branch plan). Until it merges, no OAuth composition surface is delivered by cluster-mesh beyond what #679 shipped. |
| `@sentropic/artifacts` first npm publication (§8) | Not present on npm at check | Owner-run bootstrap only; required before any external host installs the provider from the registry. |

**Status update (2026-10-18, amendment §14.6):** PR #688 has merged on `main` (`441453966a4dfac12c220f154508d7ab1ee3c237`); the mandatory release+channel ticket binding ships with it and supersedes §5.5 as current behavior from that merge, while §5.5 remains the merged-at-`1472d961e` record. PR #689 remains open. The table above is preserved as the state at writing.

## 11. Second host: the Sentropic app

The same host model applies: the Sentropic app, as a host, embeds the registry through cluster-mesh, selects and configures providers, and keeps its customizations host-side (§2, §9.1). No new design is specified here for that host.

### Managed-app adoption matrix (amendment F692-3, 2026-10-18)

Target matrix, not an onboarding claim: one row per managed app, with the template/instance vocabulary of `spec/SPEC_EVOL_APP_CATALOG.md:29` (Q2) and its resolved slug discipline (`:77` §6) preserved — no new naming is introduced here. Evidence status stays `unverified` for every row until a host qualification receipt exists; a row records the intended binding, never that the binding runs. The KVM gateway and the IdP appear in this section as identity actors (see the note below the table), not as app rows.

| App | Owner | Repository | Template / instance identity | Tier / origin | Identity mode | Resource namespace | Selected capabilities | Annotation adapter | Data authority | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|
| Immo | Host owner (Immo) | Host-side, outside this repo (`missing source` in this tree, §12) | First host instance of the generic registry (§2, §9.1) | Host environment | Host-embedded registry; host-supplied identity (§7) | Host-declared per binding | Registry + `sentropic.artifacts` + own MCP providers | Host-supplied (§14.5) | Host (customizations host-side, §9.1) | `unverified` |
| Sentropic app | Sentropic | This repo (app surface) | Second host instance (§11) | Product tiers | Host-embedded registry; IdP-issued clients | App-instance namespace (§14.3) | Registry + selected providers per host config | Embedded annotation session surface (PR #694) | Host (this app) | `unverified` |
| OpenERP | OpenERP owner | OpenERP repo (external) | Standalone and brokered instances, distinct | Own tiers | **Client and provider**: MCP client + server, own identity authority; brokered lane via RFC 8693 (`spec/SPEC_OPENERP_REQUIREMENTS.md:18`, `:55`; `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md:18`, `:26`) | Organisation scope (its own scope unit, no workspaces) | MCP client+server, OTel, policy hooks, marketplace/sandbox (`spec/SPEC_OPENERP_REQUIREMENTS.md:31`, `:42`, `:67`) | Per managed-screen contract (PR #694) | **Its own database** and organisation scope; never a shared Sentropic DB | `unverified` |
| nc-fullstack | App owner | App repo (external) | Managed app instance | Own tiers | Managed-app identity mode (to qualify) | App-instance namespace | Catalogue-selected capabilities (to qualify) | Host adapter; **must not assume a Node/Hono backend** (SvelteKit UI + FastAPI backend) | App (own store) | `unverified` |
| CV | App owner | App repos (external) | Three distinct bindings, not equated: `spa-transpose-cv`, `scalian-transpose-cv`, Sentropic profiles feature | Own tiers | Per binding (to qualify) | Per binding namespace | Per binding (to qualify) | Per binding host adapter | Per binding authority | `unverified` |
| Diag | App owner | App repo (external; repository HEAD `unverified`) | Managed app instance | Own tiers | Managed-app identity mode (to qualify) | App-instance namespace | Catalogue-selected capabilities (to qualify) | Host adapter (to qualify) | App (own store) | `unverified` |
| Design-system surface | Sentropic | Design-system repo (external; repository HEAD `unverified`) | Managed surface, not a flagship workspace type (§14.3) | Public/default surface | Public/PKCE RP, personas non-authoritative | Surface namespace | Catalogue-visible surface capabilities | Host adapter (to qualify) | Surface owner | `unverified` |
| Geo and further declared consumers | Declaring owners | Declared repos (external) | Declared instances | Own tiers | To qualify per consumer | Per-instance namespace | Declared capabilities only | Host adapter (to qualify) | Consumer authority | `qualification required` |

Identity actors, not app rows: the **KVM gateway** is a distinct OAuth relying party and the first forced-MFA target (PR #695); the **IdP** is the issuer/tenant-spine authority. Neither is an app-template instance, and neither appears as a catalogue app entry. Platform consumers that are not managed web apps (h2a, llm-mesh/gateway, Engram/Graphify, k8s-ops) are likewise excluded from this matrix; their catalogue relationship, where any, is the projection of §14.1, not an app row.

## Acceptance

This spec is accepted as the repo record of the #679 delivery when:

- every normative statement above resolves to a file reference at `1472d961e` or to a §9 verbatim quote (spot-checkable from the source ledger, §13);
- the 15 tool names, the provider/leaf names, the cache/TTL constants and the ticket binding match the merged sources cited in §4–§6;
- follow-ups are listed only in §10 and nowhere described as merged behavior;
- `make scope-check` passes for the branch carrying this file (`spec/**` + `BRANCH.md` only).

No runtime gate applies: this branch changes no code, and the merged behavior keeps the test evidence of PR #679.

## 12. Source gaps for independent review

- §9.5: the verbatim phrase « Tout en artifacts » is sourced from this branch's launch packet only; the owner's original message was not located in the scratch sources read. Status: `source-gap`, flagged in place, no context invented.
- §8: npm state is a point-in-time registry check made while writing this branch; it is not a publication receipt. Consumers must re-check the registry before adoption.
- Radar/Immo deployment state (which host build runs which tuple) is outside this repo and outside this spec; §9 quotes record decisions, not deployment receipts.

## 13. Source ledger

| Source | What it establishes here |
|---|---|
| Merge commit `1472d961e098908e64ef60b83835af357888d031` (PR #679, merged 2026-10-17) | Baseline tree for every code reference |
| `packages/cluster-mesh/src/mcp/registry.ts`; `packages/cluster-mesh/src/loaders/mcp/*`; `packages/cluster-mesh/src/integrations/mcp/artifacts.ts`; `packages/cluster-mesh/package.json` | Registry facade, lazy loaders, builtin leaf, peer range (§3, §4) |
| `packages/mcp-platform/src/{registry-entry,registry-canonical,registry-parameters,tool-configuration}.ts` | Frozen entries, canonical requests, bounded validation (§4.3) |
| `packages/artifacts/src/{mcp,provider-definition,parameters,contracts}.ts`; `packages/artifacts/src/server/*`; `packages/artifacts/src/content/*`; `packages/artifacts/src/adapters/*`; `packages/artifacts/migrations/*`; `packages/artifacts/README.md` | Provider, 15 tools, storage ports, ACL, releases, grants/tickets, host obligations (§5, §7) |
| `packages/cluster-mesh/src/{token-exchange,trust,trust/token-exchange-http}.ts`; `packages/cluster-mesh/tests/token-exchange-*.spec.ts`; `packages/auth-hono/src/oauth/token-exchange-handler.ts`; `api/drizzle/0043_immo_token_exchange.sql` | RFC 8693 exchange, cache, invalidation, issuer side (§6) |
| `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md`; `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md`; `spec/SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md`; `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md` | Section-structure conventions and cross-referenced platform context |
| Pre-merge scratch specifications and decision records (read-only sources, not deliverables): consolidated Immo MCP spec v8 (§1 owner model, Q-A1), registry entry contract v9, owner decisions T1–T8 (2026-10-16), OAuth owner addendum (2026-10-16), O1 branch plan (2026-10-17) | Verbatim owner decisions (§9) and follow-up framing (§10) |
| GitHub PR state at writing: #679 MERGED; #688 OPEN; #689 OPEN draft | Merge/follow-up status (§8, §10) |
| npm registry reads at writing (`@sentropic/cluster-mesh 0.18.0`, `@sentropic/mcp-platform 0.3.0`, `@sentropic/auth-hono 0.16.0` present; `@sentropic/artifacts` absent) | Published-version state (§8) |

## 14. Catalogue-integration amendment (2026-10-18)

This section is an amendment layer dated 2026-10-18. It is explicitly separated from the merged #679 record above (§1–§13, baseline `1472d961e`): nothing here rewrites that record, and nothing here is merged behavior. It states the specified target by which the host registry and the `sentropic.artifacts` provider project into the one logical catalogue already decided in `spec/SPEC_EVOL_CATALOG.md` and `spec/SPEC_EVOL_APP_CATALOG.md`. Status of every target statement below: `unverified` until a qualification receipt exists. Cross-references to the parallel amendments: PR #694 (annotations), PR #695 (per-app MFA), PR #596 (seat-credential custody).

### 14.1 Projection into the unified catalogue (amendment F692-1)

- The host registry/compiler (§4) projects into the one logical catalogue (typed discovery from sources) without becoming it. The catalogue preserves the five existing `CatalogEntry` kinds — `skill`, `tool`, `agent`, `workflow`, `canvas` — and the sixth application-template projection `kind:'app'` / `CatalogSourceKind:'app'` already specified by `SPEC_EVOL_APP_CATALOG.md` Q4. It is fed by pluggable `CatalogSource`s with a synchronous `snapshot()` and an optional asynchronous `refresh()` (`spec/SPEC_EVOL_CATALOG.md:99` §3.1, `:150` §3.2, `:177` §3.5, `:181` §3.6). The host registry is one source among others; it owns provider effects for its own tools, not catalogue composition.
- MCP tools map to `tool` entries. Tools owned by a skill stay owned by their `skill` entry and are not duplicated as `tool` entries. The `agent`, `workflow` and `canvas` kinds are preserved as decided. Published `control.app_templates` rows feed `AppCatalogSource.refresh()` out of band; its synchronous, I/O-free `snapshot()` exposes `kind:'app'` entries to `search_catalog` only under explicit allow and tenant filtering (APP_CATALOG Q2/Q4). Postgres outbox/NOTIFY invalidates that snapshot; the control-plane tables remain the source of truth and app instances are not catalogue entries. There is no seventh `mcp-server` kind: a server identity stays source/provider metadata on the entry, never a kind.
- Every projected entry carries the transverse columns: **auth** (authz-projected discovery with deny-as-missing semantics — an unauthorized entry is absent, not shown as denied; `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:714` §7.1), **NHI** (workload identity stays distinct from human identity; verified invocation context carries references and decisions, never raw credentials; `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md:136`), **access rights** (per-entry `contextFilter`/`authzRequirements`, explicit allow, tenant-filtered; `spec/SPEC_EVOL_APP_CATALOG.md:46` Q4, `:50`), **distribution** (synchronous snapshot on the resolve path, asynchronous refresh/outbox invalidation out-of-band; `spec/SPEC_EVOL_CATALOG.md:150` §3.2), and **observability** (durable `auditId`/`correlationId` references threaded alongside the invocation record; `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:761`).
- Registry visibility is advisory/discovery only; it is never authorization by itself. Per-request authorization is repeated at invocation time with the current principal, session, scopes, tenant/workspace context, consent/freshness state and adapter policy (`spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:745` §8). The generic core vs adapter split of that platform spec applies unchanged (`spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:91` §2): Sentropic owns the generic registry, provider contracts and package releases; each host owns its selection, parameterization and customizations (§2, §9.1).

### 14.2 Owner-facing catalogue view (amendment F692-2)

- The catalogue is visible at its assigned boundary: one owner-facing, permission-filtered view over MCP sources/tools, skills, agents, and app templates (the `workflow` and `canvas` kinds retained), showing for each entry: source, provider/app binding, version, availability/maturity, enrolment/consent state, allowed capabilities, distribution state, and diagnostics. Unauthorised entries are absent from the view (deny-as-missing, §14.1); the view never renders an entry as "denied".
- The surface is owned by the D13 application factories: row 28 `/catalog` (application catalog factory over the composite registry; search/discovery only, effect authorization fail-closed) and row 27 `/apps` (application apps factory over the existing control-plane service) (`spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md:250`). The `catalog` facade owns registry composition and source metadata; it owns neither provider effects, nor credentials, nor resource bytes (`spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md:227`). Cross-kind LLM discovery uses the additive `search_catalog` meta-tool; `search_skills` stays skill-only (`spec/SPEC_EVOL_CATALOG.md:177` §3.5).
- The BR-42b no-public-HTTP limit (`spec/SPEC_EVOL_CATALOG.md:203`, D-NO-HTTP: catalog kept server-side via the chat tool loop, no public catalog HTTP endpoint in v1) is historical v1 scope. It is cited as a superseded boundary, not as a current limit on the owner-facing view above.
- This view is a target description. It is not a claim that the view exists today, nor that any entry is public: app templates project only with an explicit allow state, tenant-filtered, and a missing or unknown policy does not project (`spec/SPEC_EVOL_APP_CATALOG.md:50`).

### 14.3 Shared glossary and "pages" repair (amendment F692-4)

The following meanings govern §11 and this section; they restate the app-catalog vocabulary (`spec/SPEC_EVOL_APP_CATALOG.md:5` §0, `:42` Q3) and the data-architecture plane boundaries (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:150`, `:185`, `:231`):

| Term | Meaning |
|---|---|
| Managed app | An application operated under the platform contracts (identity, catalogue projection, observability) through a host/adapter, e.g. the §11 rows |
| App template / app instance | Template: the versioned blueprint (`control.app_templates`, published rows immutable). Instance: a template bound to a tenant and environment (`control.app_instances`) (`spec/SPEC_EVOL_APP_CATALOG.md:29` Q2) |
| Artifact / release | Artifact: a stored content object owned by the `sentropic.artifacts` provider (§5). Release: one published version of an artifact, selected by the current pointer (§5.4) |
| Page / screen | An addressable screen inside a managed app instance, or artifact content rendered by a host page. Generated HTML inside an artifact is artifact content: it is not an app and not a page |
| Catalogue vs registry | Catalogue: the one logical, permission-filtered discovery union (§14.1). Registry: the host-embedded provider registry/compiler of §4. The registry projects into the catalogue; it is not the catalogue |
| Namespace | The resource namespace of an app instance or provider binding. It is distinct from a Hono route namespace, a Postgres schema, a Kubernetes namespace, and a tier; none of those supplies the resource namespace |
| Tenant / workspace / repo / client | Tenant: the organisation/account scope. Workspace: a product workspace bound to an instance. Repo: a source repository. Client: an OAuth client (RP) bound to a tenant. The flagship workspace types `ai-priorities`/`opportunity`/`code` are workspace types, not apps |

- "Pages" repair: generated artifact pages are read as **artifact content rendered by a host page**. Every screen reference names its app instance. The §9.1 verbatim owner quotes stay byte-identical; this glossary is the reading footnote for them.
- « Tout en artifacts » (§9.5) is recorded from the 2026-10-18 owner feedback as the current authority for the generated-content experience. It does not move host databases: shared business databases stay out of scope, and the `control` schema (`spec/SPEC_EVOL_APP_CATALOG.md:23` Q1) and OpenERP's own database (§11) remain as already decided.

### 14.4 Storage and serialization ownership (amendment F692-5)

- Delivered artifact adapters and migrations stay as implemented (§5.2): the shipped Postgres adapter implements the combined `PostgresArtifactStore` and the S3 adapter the `PublicationBlobStore`; neither implements `KvPort`. This amendment changes no delivered storage behavior.
- Host installation targets the generic module-storage contract: hosts inject parameterized execution and serializable transaction sessions, and the package imports neither the database driver nor application code (`spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md:46`, injected PostgreSQL installation). The artifacts store is not claimed to implement generic module registration: that claim requires its own adapter and qualification receipt, which does not exist yet (`unverified`).
- Scoped export and erasure follow the lifecycle contracts: the physical planes stay behind their ports (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:311`, Axis E), export is one signed archive produced from the single scope enumeration (DL-8) with per-family `payloadSchemaVersion` (DL-13), and completed deletions are re-applied at restore so a restore cannot resurrect erased data (DL-17) (`spec/SPEC_EVOL_DATA_LIFECYCLE.md:95`, `:127`).
- No shared-app database service is added by this amendment. Custody secrets stay outside this serialization path entirely (PR #596; no persisted custody access-token copy exists for an export or backup to carry).

### 14.5 Annotations and per-app MFA connection (amendment F692-6)

- The annotation overlay consumes existing app control-plane bindings (`SPEC_EVOL_APP_CATALOG.md` Q2) and trusted host registries, not compiler-owned mappings. The host adapter derives screen identity from its served build route manifest, trusted route binding and app/tier (PR #694 §4, pinned at `4bd0fa3fa9936a2d732b4760ee58811b01573c5a`, line 105); the server repository/recipient binding maps `{appId,tier,pageId,releaseId}` to `{repoId,workspaceId,conductorPrincipal,agentInstance?,bindingGeneration}` (same revision, §6, line 156). Unknown mapping saves privately as unrouted; rebinding invalidates the old delivery grant. No parallel mapping store is introduced. The MCP registry/compiler (§4) retains provider selection, configuration, capability compilation and tool resolution only. An artifact read never grants annotation write or agent delivery: private-by-default holds until an explicit send action grants that exact annotation/revision to an eligible principal, and agent delivery runs under a verified workload principal plus the owner's exact delivery grant, with per-annotation mediation (PR #694 spec at its head, §3: grant separation and per-annotation mediation).
- Human access follows the per-app MFA client policy and its migration (PR #695 spec at its head, §4.1 client policy and §10.1 migration): the client requires an assurance **level**, never a named method; the method rides in the signed evidence. NHI workload tokens keep their own authorisation and never inherit the human session assurance (verified invocation context and generation/capacity contracts, `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md:136`, `:170`).
- Catalogue selection, artifact content grant, and MFA assurance are three distinct facts, displayed distinctly in the catalogue view (§14.2). None implies another: selecting an entry does not grant its content, a content grant does not raise MFA assurance, and MFA assurance does not select or grant anything. The observability column (§14.1) carries invocation correlation references only; it is neither a durable security receipt nor a secret store, and the two audit record classes of PR #695 (best-effort operational logs vs transactionally committed security transitions) stay distinct.

#### Questions propriétaire ouvertes (non tranchées)

Les trois arbitrages suivants appartiennent au propriétaire. Ils sont conservés ici comme questions ouvertes, sans réponse apportée par le présent amendement ; leur source normative est la spécification de la PR #695.

- **D-P1 — Fenêtre de fraîcheur MFA pour `kvm-gateway`.** Quelle durée maximale entre la cérémonie MFA et l'émission d'un nouveau code OAuth pour `kvm-gateway` : (i) 300 secondes ; (ii) quelques heures, avec 8 heures comme valeur proposée par la spécification ; (iii) 24 heures ? Conséquences : (i) contient au plus court la réutilisation d'une session IdP dérobée, au prix de cérémonies WebAuthn répétées lors des réémissions ; (ii) équilibre friction et exposition, avec une fenêtre de réémission plus longue ; (iii) laisse une journée de réémission à une session dérobée. Ce choix ne fixe ni la durée du cookie de session côté `kvm-gateway`, ni la borne administrative distincte de 900 secondes pour les mutations de sécurité IdP. Source : [PR #695 §15, D-P1](https://github.com/rhanka/sentropic/blob/ef956c306be72b066f2a316d79fd6b0f8b1c4d68/spec/SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md#L844) (revision `ef956c306be72b066f2a316d79fd6b0f8b1c4d68`; section anchor `#15-décisions-propriétaire`).
- **D-P2 — Codes de récupération pour le compte propriétaire KVM.** Faut-il construire les codes de récupération, et sous quelle forme : (i) différer les codes — deux authentificateurs indépendamment récupérables en prérequis, plus la réinitialisation d'urgence par le Job opérateur (recommandation de la spécification) ; (ii) construire les codes avec liaison en attente — le code ouvre la demande et crée un authentificateur en attente, sans jamais activer seul un accès MFA ; (iii) activation autonome code plus délai, qui consigne une racine de récupération plus faible ? Conséquences : (i) garde la surface minimale, avec une récupération de perte totale dépendante du recours opérateur ; (ii) ajoute un confort et une surface (émission sous session MFA fraîche, hachages liés au sujet et à la génération, consommation unique atomique) sans chaîne directe du code vers le MFA ; (iii) rend le vol du code éventuellement suffisant après le délai et devrait être assumé comme un affaiblissement explicite de la propriété de récupération. Source : [PR #695 §15, D-P2](https://github.com/rhanka/sentropic/blob/ef956c306be72b066f2a316d79fd6b0f8b1c4d68/spec/SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md#L846) (revision `ef956c306be72b066f2a316d79fd6b0f8b1c4d68`; section anchor `#15-décisions-propriétaire`); recovery contract §6, R-REC-6.
- **D-P3 — Portée du durcissement des comptes.** À quels comptes la protection stockée s'applique-t-elle, celle qui ferme la récupération par le seul courriel : (i) protection activée explicitement aux transitions prévues (entrée en liste d'autorisation d'un client forcé, première émission vers un client MFA sans liste, ou activation opérateur), après les prérequis de confiance et de récupération (recommandation de la spécification) ; (ii) durcissement de tout compte dès son premier passkey, y compris pour les applications sans exigence MFA ? Conséquences : (i) préserve la récupération par courriel pour les usages non forcés et borne le changement aux comptes protégés ; (ii) ferme pour davantage de comptes la création de credentials, la session sans appareil et les mutations sensibles par email seul, y compris sans exigence MFA applicative ; cette protection élargit les préparatifs de récupération et le risque de perte d'accès. Elle exige une migration conservant les prérequis de confiance et de récupération. Pour un compte protégé avec appareils, le login email `bearer` vers un client non-MFA reste possible (§4.2) : la protection ne force pas chaque connexion. Source : [PR #695 §15, D-P3](https://github.com/rhanka/sentropic/blob/ef956c306be72b066f2a316d79fd6b0f8b1c4d68/spec/SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md#L857) (revision `ef956c306be72b066f2a316d79fd6b0f8b1c4d68`; section anchor `#15-décisions-propriétaire`).

### 14.6 Terminology repair and dated status layer (amendment F692-7)

- Terminology repair: the cross-reference added by this branch in `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md:7` called the compiler output "compiled registry entries". That wording contradicted §4.3 and is corrected in this amendment: compilation yields a **compiled registry plan** (provider/tool maps and tool resolutions); frozen `RegistryEntry` values exist only where a caller explicitly invokes the runtime entry helpers. No merged-behavior statement in §1–§13 is rewritten by this repair.
- Dated status layer (2026-10-18): PR #688 is merged on `main` at `441453966a4dfac12c220f154508d7ab1ee3c237` and PR #689 is open at this amendment date; §10 carries the dated update and keeps its at-writing table unchanged. Publication and deployment states stay `unverified` wherever no registry or deployment receipt is cited (§8, §12).
- Acceptance check for this amendment: a reader can trace a skill, an agent template, an MCP tool, and an app template from the catalogue (§14.1–§14.2) through its current authorisation (per-request recheck, §14.1) to the owning runtime (host registry, §4, or app instance, §11), and can distinguish **installed / selected / compiled / published / deployed** as separate states. Any presentation diagram of this spec must draw the catalogue itself as a component with its sources, not only the host registry.
