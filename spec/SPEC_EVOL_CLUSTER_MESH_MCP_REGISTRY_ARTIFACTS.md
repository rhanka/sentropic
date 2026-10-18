# SPEC EVOL — Cluster-Mesh MCP Provider Registry and `sentropic.artifacts` Provider

## Status and authority

**Status:** consolidated record of merged behavior. This spec describes what PR #679 (`feat: immo-861-mcp-registry (Sentropic consolidation 1a + 2-IdP + 2a)`) merged on `main` at `1472d961e098908e64ef60b83835af357888d031` (merged 2026-10-17). It introduces no new design: every statement is traceable to code at that commit or to a verbatim owner decision quoted in §9. Items not merged at that commit are marked as follow-ups in §10 and are not specified as current behavior.

**Authority:** the owner model quoted verbatim in §9.1. Sentropic owns the generic registry, provider contracts and package releases; each host owns its selection, parameterization and customizations. Immo is the first host. This spec is the repo record for the merged registry/artifacts surface; the scratch planning documents that preceded the merge are sources, not deliverables, and are listed in the source ledger (§14).

Related context:
- `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` — generic application MCP provider platform (manifest/adapter contract, elicitation, session/secret records). This spec records the registry and artifacts provider that landed under that platform framing.
- `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md` — cluster-mesh control plane, namespace contracts and D3 responsibility split.
- `spec/SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md` — cluster-mesh as the single lazy integration surface (optional peers, static leaves, loaders); the MCP composition delivered by #679 follows its E5 contract.
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
- Lazy provider acquisition through the cluster-mesh module registry: a selected provider's code materializes only at compile time, through `modules.load(...)`, never by eager import (`packages/cluster-mesh/src/mcp/registry.ts`; `packages/cluster-mesh/src/loaders/mcp/artifacts.ts`).
- The generic provider-definition contract: exact `publicName → (providerId, capabilityName)` mapping, duplicate and cross-provider collision rejection without sanitizing, suffixing or silent keep (`packages/artifacts/src/provider-definition.ts:36-84`).
- The compiled-tool kernel: frozen registry entries, canonical requests, bounded argument validation and unknown-tool rejection before argument inspection (`packages/mcp-platform/src/registry-entry.ts:50-112`).
- The `sentropic.artifacts` provider package and its 15 tools (§5).
- The RFC 8693 exchange client policy: grant type, Bearer-only, scope intersection, TTL ceilings, caching and invalidation (§6).

### 2.2 Host owns

- Which providers are selected and the values each selected provider is configured with; configuring an unselected provider is refused (`packages/cluster-mesh/src/mcp/registry.ts:95-113`).
- Its own domain MCP providers, registered alongside shipped providers in the same composed registry (Immo registers its own MCP functions; §9.1).
- All provider parameterization and customizations (for Immo: the web-pages parameterization, shipped as versioned Immo configuration with the Immo image; §9.1).
- Host-supplied runtime resources listed in §7 (identity, storage, content domain, TLS termination, activation secrets and stores).
- Local configuration-review metadata (`approvalRef`, `revision`, `reviewedBy`): integrity metadata only, never an authorization authority (`packages/artifacts/src/mcp.ts:363-368,391-396`).

### 2.3 Non-goals / hard constraints

- No provider code carries host-specific defaults: the artifacts package states "No Immo defaults, URLs or bindings in generic source" (`packages/artifacts/README.md`).
- Public tool names are exact: collisions across activated providers abort compilation instead of being renamed (`packages/artifacts/src/provider-definition.ts:70-84`).
- An absent or incompatible selected peer refuses compilation atomically; no stub fallback is installed (`packages/cluster-mesh/src/integrations/mcp/artifacts.ts:17-24`).

## 3. Component model

| Component | Merged surface at `1472d961e` | Role |
|---|---|---|
| Registry facade | `packages/cluster-mesh/src/mcp/registry.ts` (`select`, `configure`, `compile`, `compiled`) | Host-facing selection/configuration/compilation of providers |
| Module loaders | `packages/cluster-mesh/src/loaders/mcp/{registry,entry,bridge,hono,stdio,artifacts}.ts` | Lazy acquisition of provider modules at compile time |
| Artifacts builtin leaf | `packages/cluster-mesh/src/integrations/mcp/artifacts.ts` (`createArtifactsBuiltin`) | Static catalog metadata + qualified loader for `sentropic.artifacts` |
| Mesh composition | `packages/cluster-mesh/src/compose/mcp.ts`, `packages/cluster-mesh/src/mesh.ts` | Namespace composition over the compiled registry |
| Platform kernel | `packages/mcp-platform/src/{registry,registry-entry,registry-canonical,registry-parameters,tool-configuration}.ts` | Frozen entries, canonical requests, bounded schemas, compiled configuration |
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
- `compile(...)` materializes the selected providers and publishes the compiled registry atomically: a refusal publishes nothing and keeps the previous compiled registry intact (`packages/cluster-mesh/src/mcp/registry.ts:150-165`). Selected builtins materialize only at compile time, through the module registry.

### 4.2 Names and leaves

- Provider ID: `sentropic.artifacts` (`ARTIFACTS_PROVIDER_ID`, `packages/artifacts/src/mcp.ts:22`). Application ID: `sentropic-artifacts` (`packages/artifacts/src/mcp.ts:23`). Provider version at merge: `0.1.0` (`packages/artifacts/src/mcp.ts:24`).
- Cluster-mesh leaf: `@sentropic/cluster-mesh/mcp/artifacts` (export `./mcp/artifacts`, `packages/cluster-mesh/package.json:107-109`), backed by `createArtifactsBuiltin` (`packages/cluster-mesh/src/integrations/mcp/artifacts.ts:25-39`).
- Lazy loader: `loadArtifactsMcp(modules)` resolves the peer through `modules.load('mcp/artifacts')` (`packages/cluster-mesh/src/loaders/mcp/artifacts.ts:11-12`). The peer is optional: `@sentropic/artifacts >=0.1.0 <0.2.0` with `peerDependenciesMeta.optional = true` (`packages/cluster-mesh/package.json:150,160`). An absent or incompatible peer refuses compilation; no stub is substituted.
- The provider's own MCP subpath is `@sentropic/artifacts/mcp` (export `./mcp`, `packages/artifacts/package.json`), which builds the kernel registry definition (`createArtifactsRegistryDefinition`, `packages/artifacts/src/mcp.ts:372-399`).

### 4.3 Compiled entries

Compilation produces frozen entries bound to canonical requests: `buildRegistryEntry` freezes each `RegistryEntry` (tool name, capability ref, handler ID, bounded schema, canonical request digest), and `resolveRegistryEntry` rejects an unknown tool before inspecting arguments (`packages/mcp-platform/src/registry-entry.ts:58-112`). Runtime arguments enter module code through one validated chokepoint; unknown slots are rejected by `additionalProperties: false`, missing slots by `required` (`packages/mcp-platform/src/registry-entry.ts:79-84`).

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

The service depends only on injected ports — `KvPort` (get / put-if-absent) and `UuidPort` behind `ServerPorts` — never on a driver, ORM row or network client (`packages/artifacts/src/server/ports.ts:10-23`). Hosts supply Postgres/S3-backed implementations (`packages/artifacts/src/adapters/postgres.ts`, `packages/artifacts/src/adapters/s3.ts`); domain schema ships as package migrations `packages/artifacts/migrations/0001_artifacts.sql` and `0002_lifecycle.sql`. Blobs are refcounted; garbage collection is explicit and reported (`packages/artifacts/src/server/gc.ts`).

### 5.3 ACL and authorization

Authorization runs first in the shared service (`packages/artifacts/src/server/service.ts`; `packages/artifacts/README.md`, L-5a notes). The baseline rule is owner-only, deny by default (`packages/artifacts/src/server/authorization.ts`); sharing grants, approved-public evaluation and the ACL store arrive in the same merged package (`packages/artifacts/src/server/access.ts`). Listing applies the ACL before pagination (`artifacts_list`, §5.1), forks copy no ACL (`packages/artifacts/src/server/fork.ts`), and content reads recheck the live ACL on every request (§5.5).

### 5.4 Releases and lifecycle

Publication creates releases over one current pointer; promotion selects a release explicitly with an expected-current compare-and-swap (`artifacts_promote`, §5.1; `packages/artifacts/src/server/publication.ts`, `packages/artifacts/src/server/lifecycle.ts`). Lifecycle covers withdraw, restore, delete, purge and retention renewal (`packages/artifacts/src/server/lifecycle.ts`). Uploads are staged through bounded sessions and committed only after digest/size verification (`artifacts_create_upload`, `artifacts_commit_upload`; `packages/artifacts/src/server/uploads.ts`). Mutating calls carry idempotency keys with explicit conflicts (`packages/artifacts/src/server/idempotency.ts`).

### 5.5 Content grants and activation tickets (merged state)

Content is served on a separate content domain (§7). Two short-lived mechanisms authorize it (`packages/artifacts/src/content/grants.ts:1-13`):

- **Content grants.** HMAC-SHA256 signed with a host-injected secret; bound to subject + artifact, with an optional pinned release; 55-second TTL inside a 60-second total cutoff budget (grant + skew/propagation). Verification is fail-closed (signature, shape, lifetime cap, expiry, future-issued beyond the skew budget). A grant never replaces the per-request ACL recheck in the content handler (`packages/artifacts/src/content/handler.ts`).
- **Activation tickets.** Single-use tickets bound the same way (`TicketRecord { ticketId, subjectId, artifactId, releaseId?, expiresAt }`, `packages/artifacts/src/content/grants.ts:112-118`), 120-second TTL (`CONTENT_TICKET_TTL_SECONDS`, `packages/artifacts/src/content/grants.ts:18`). Ticket IDs come from an injected port and must be unguessable (default: crypto UUIDs). Redemption checks subject/artifact binding before atomic single-use consumption; mismatched attempts do not consume the ticket (`packages/artifacts/src/content/grants.ts:143-188`). Per-version activation redeems one ticket, then demands fresh consent on the stable origin (401); pinned origins keep serving their immutable release (`packages/artifacts/src/content/handler.ts:4-9`).

The channel-bound ticket form (`{subject, artifact, release, channel}`) is **not** in the merged tree; it is follow-up #688 (§10).

## 6. Token exchange (RFC 8693)

### 6.1 Contract

Workload calls obtain delegated tokens through RFC 8693 token exchange. The cluster-mesh client owns policy (grant type, Bearer-only, scope intersection, TTL ceiling, caching, never-passthrough); the issuer binding owns cryptographic trust (subject verification, token minting) (`packages/cluster-mesh/src/token-exchange.ts:97-106`). Grant and token-type constants are `RFC8693_GRANT_TYPE` / `ACCESS_TOKEN_TYPE` (`packages/cluster-mesh/src/trust.ts`, consumed at `packages/cluster-mesh/src/token-exchange.ts:2`). The production binding is the authenticated RFC 8693 HTTP adapter (`packages/cluster-mesh/src/trust/token-exchange-http.ts`); the Sentropic issuer side merged in the same PR (`packages/auth-hono/src/oauth/token-exchange-handler.ts`; issuer schema `api/drizzle/0043_immo_token_exchange.sql`).

Minted material never carries refresh material (`packages/cluster-mesh/src/token-exchange.ts:72`). Refusals are typed and fail-closed (unsupported grant/subject/requested token types, missing or disallowed audience, unverified or expired subject, invalid actor, empty scope intersection, `exchange_invalidated`; `packages/cluster-mesh/src/token-exchange.ts:108-135`). Raw bearer passthrough is excluded by construction and by test (`packages/cluster-mesh/tests/token-exchange-no-passthrough.spec.ts`).

### 6.2 Cache

- Hard residency cap: 60 seconds (`TOKEN_EXCHANGE_CACHE_TTL_MS`, `packages/cluster-mesh/src/token-exchange.ts:9-10`).
- Hard minted-token lifetime ceiling: 300 seconds; no configuration may raise it (`TOKEN_EXCHANGE_MAX_TTL_SEC`, `packages/cluster-mesh/src/token-exchange.ts:12-16`).
- Bounded cache: 1000 entries by default with insertion-order eviction, and a 5-second early-use safety margin subtracted from every cache deadline (`packages/cluster-mesh/src/token-exchange.ts:18-22`).

### 6.3 Invalidation

`invalidateTokenExchangeCache(filter | 'all')` evicts matching entries and in-flight exchanges and returns the evicted count (`packages/cluster-mesh/src/token-exchange.ts:205-214,519-538`). Every invalidation bumps a global generation: work invalidated mid-flight can neither insert into the cache nor return success, including invalidation landed during subject verification (`exchange_invalidated`; `packages/cluster-mesh/src/token-exchange.ts:317-320,439-486`).

## 7. What a host must supply

The merged packages define ports and transport-free surfaces; the host supplies the concrete resources:

| Obligation | Host supply (merged contract) |
|---|---|
| Identity | Verified caller identity mapped into the provider context: the artifacts adapter resolves `principalSub`/`tenantRef`/`connectorInstanceId` into tenant/principal refs (`packages/artifacts/src/mcp.ts:320-325`) and the executor acts as `req.ctx.principal.sub` (`packages/artifacts/src/mcp.ts:333-337`). For exchange, the host/issuer binding supplies subject verification and minting (`TokenExchangeIssuer.verify/mint`, `packages/cluster-mesh/src/token-exchange.ts:103-106`) plus the workload client provisioning (`api/src/scripts/oauth-provision-exchange-client.ts`, `api/src/services/auth/oauth-client-seed.ts`). |
| Storage | `ServerPorts` implementations (`KvPort`, `UuidPort`; `packages/artifacts/src/server/ports.ts:20-23`), backed by the shipped Postgres/S3 adapters (`packages/artifacts/src/adapters/postgres.ts`, `packages/artifacts/src/adapters/s3.ts`), with the package migrations applied (`packages/artifacts/migrations/0001_artifacts.sql`, `0002_lifecycle.sql`). No eager connections or DDL run on import (`packages/artifacts/src/server/ports.ts:1-9`). |
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


