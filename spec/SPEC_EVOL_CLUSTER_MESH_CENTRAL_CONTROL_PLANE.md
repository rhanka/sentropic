# Cluster Mesh Central Control Plane — Evolution Specification

## Status and authority

- Status: **r13 build specification**.
- Architecture authority: `/home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit/dossier.json`, revision `2026-08-29-r13`, status `owner-corrected-target`.
- Owner direction: proceed with the r13 model. D17 is an internal conductor gate set; C1–C5 and A1–A5 are not product decisions and are not owner-ratification checkpoints.
- Scope: evolve `@sentropic/cluster-mesh` into an optional Hono composition plugin with an integrated control runtime, then migrate the 29 r13 namespaces one by one.
- Provenance qualification: the r9/r10 wording in the dossier is conductor-normalized. The complete raw owner capture for those rounds is a source-gap; this specification does not describe that wording as verbatim.
- Transverse invariant: **D1=B everywhere**. Every provider remains independently integrable, testable and disableable, owns its domain runtime/data/secrets, and never imports `@sentropic/cluster-mesh` merely to operate.

## Reading convention

- **CURRENT** means behavior verified in this checkout at the cited path or symbol.
- **TARGET** means required r13 behavior that is not claimed as implemented.
- **PARTIAL** means a reusable seam exists but does not yet cover the namespace contract.
- **SOURCE-GAP** means the source or external proof was not available in the inspected checkout.
- A target router, mount, migration or test name is a plan locator, not evidence that the file exists.
- Code identifiers remain English. Terms such as `namespace`, `router`, `cutover`, `shadow`, `generation` and `VerifiedInvocationContext` have the exact meanings defined below.

## Objective

Deliver one optional Cluster Mesh composition for the Sentropic HTTP roots:

1. `@sentropic/cluster-mesh` exports a Hono plugin factory and integrates the neutral runtime that establishes verified invocation context, admission, capacity, generation, registration, session actuation, receipts and the logical MCP singleton.
2. The plugin composes, but does not absorb, autonomous Hono router factories supplied by provider packages or application-owned namespace modules.
3. The product API migrates from its current mount table to the 29 r13 namespace modules through D11 shadow comparison, single-author cutover, explicit rollback and immediate legacy-path deletion.
4. `apps/auth-idp` remains a second HTTP composition root and composes the same `/auth` and `/oauth` modules plus the root-specific `/session` projection under its established public root and `/.well-known`.
5. PTY is the preferred drive/wake actuator. Registration and possession are fail-closed; tmux is only a secondary adapter when explicitly available.
6. The MCP target is one logical server authority per active runtime generation, never one server per session.

The plugin is optional. A provider may be mounted directly by another Hono application, and h2a retains a degraded standalone per-session mode when the Cluster Mesh composition is disabled.

## Non-goals

- No federation, distributed consensus or general exactly-once guarantee.
- No provider implementation copied into `cluster-mesh`.
- No provider secret, OAuth token, private key, PTY handle or connector credential stored by the plugin.
- No second Graphify memory engine, Track log, MCP protocol implementation, LLM routing authority or chat runtime.
- No per-session MCP server in the TARGET.
- No permanent dual route, dual writer or compatibility fallback after a namespace cutover.
- No application mirror for `LOCAL_ONLY` state.
- No external h2a or Graphify source change on this branch.
- No remote-action activation based only on a live process, claimed presence or transport receipt.
- No migration generated after the single migration file has been accepted; later namespace lots must reuse existing domain tables or stop as a source-gap.

## CURRENT evidence baseline

| Area | Verified CURRENT evidence | r13 consequence |
|---|---|---|
| Route inventory | `api/src/routes/**` has 56 files: 43 `api/` routers plus its index, 10 `auth/` routers plus its index, and `well-known.ts`. | The mount table is the migration inventory; no current route disappears without a namespace replacement and test evidence. |
| Product composition root | `api/src/app.ts` mounts `/.well-known`, `/api/v1`, and `/api/v1/auth`; `api/src/routes/api/index.ts` directly mounts the application routers. | `api/src/app.ts` becomes the first consumer of `createClusterMeshPlugin`; the direct mount table is deleted namespace by namespace. |
| Cluster Mesh | `packages/cluster-mesh/src/mesh.ts` exports `createDegenerateClusterMesh`; there is no central Hono plugin or integrated control runtime. | The plugin/runtime is TARGET, not a rename of the current seam. |
| App adapter | `api/src/services/cluster-mesh-adapter.ts` exports the real symbol `createClusterMeshAppAdapter` and uses a process-local `Map` for attached workstations. | The adapter becomes the product composition adapter and obtains durable registration/generation ports before app cutover. |
| MCP | `api/src/routes/api/mcp.ts` creates `mcpRouter`, calls the real `createMcpAuth`, and dispatches directly to connector hosts; the public surface is feature-gated. | Reuse `mcp-auth` and `mcp-platform`; remove direct API dispatch when `/mcp` becomes single-author. |
| Reusable auth | `packages/auth-hono` exports `createAuthRouter`, `createOAuthRouter` and `createWellKnownRouter`. | `/auth` and `/oauth` wrap these real factories with product ports; they are not reimplemented in the plugin. |
| Reusable MCP auth | `packages/mcp-auth/src/core.ts` exports `createMcpAuth`; `packages/mcp-auth/src/hono.ts` exports `mcpAuthRoutes`. | MCP verification stays MCP-authored and receives neutral verified references. |
| Reusable gateway | `packages/llm-gateway/src/router/index.ts` exports `createGatewayRouter`. | `/gw` is a wrapping/mounting migration, not a TARGET extraction. |
| Reusable chat | `packages/chat-server/src/index.ts` exports `createChatServer`; `api/src/routes/api/chat.ts` already consumes it and adds application endpoints. | `/chat` completes the factory ports, then removes the app-local parallel route. |
| Partial reusable packages | `flow`, `comments`, `focus`, `llm-mesh`, `connector-host`, `mcp-platform`, `chat-core`, `auth-client`, `oauth-verify` and `harness` expose useful contracts/services but not all r13 Hono namespace factories. | Their namespace routers are TARGET extractions with injected ports and standalone tests. |
| IdP composition root | `apps/auth-idp/idp-app.ts:createIdpApp` mounts the same `authRouter` at `/api/v1/auth` and `wellKnownRouter` at `/.well-known`; it shares the physical DB and does not run migrations. | The IdP is an explicit second root that composes the shared `/auth` and `/oauth` modules plus the root-specific `/session` projection. It is not a thirtieth namespace and does not own a second auth implementation. |
| Runtime boot | `api/src/index.ts` runs public then control-schema migrations before importing `api/src/app.ts`. | The unique control-plane migration is available before any product-app namespace cutover. |
| Control persistence | `api/src/db/control-schema.ts` owns internal control tables; `api/src/db/run-migrations.ts` applies `api/drizzle/control/` after public migrations. The next free control migration id is `0007`; the next free public id is `0042`. | Put all new Cluster Mesh durable state in one `api/drizzle/control/0007_cluster_mesh_r13.sql`; do not add a public `0042` file on this branch. |
| h2a qualification | The r13 qualification records 0 central listener, 44 per-session `mcp-serve` processes, `missing-registration`, empty relaunch results and ghost presence. | These are CURRENT failure measurements to reproduce before build and replace with A1–A3 evidence; they are not target capacities. |
| PTY driver | No concrete PTY/tmux driver was found in the inspected Sentropic sources. | `/session` and `/cli` define injectable PTY ports. A1 requires a real h2a adapter/qualification; a fake driver cannot close A1. |
| Track | No `packages/track` source exists in this checkout; Focus consumes an external `@sentropic/track`. | `/track` is a TARGET adapter module and remains fail-closed until the external contract/source is pinned. |
| Graphify | Graphify implementation is absent from the inspected Sentropic sources. | `/memory` is a TARGET adapter over the existing h2a↔Graphify contract; it may ship only fail-closed fixtures until the public contract is pinned. |
| Bookmarklet | `api/src/app.ts` contains CORP middleware for two bookmarklet URLs; no corresponding mounted bookmarklet router was found. `api/src/upstream/injected-script.ts` still emits bookmarklet URLs. | `/clients` owns the inventory. The cutover must either mount the proven client handlers or delete stale middleware/script branches together; it may not preserve an unverified path. |

## Accepted r13 decisions

| Decision | Requirement |
|---|---|
| D1 | **B**: autonomous, disableable provider/router modules composed by the plugin; no provider-to-cluster-mesh dependency. |
| D2 | Establish a neutral, injectable `VerifiedInvocationContext` once at ingress; domain routers apply their own authorization rules. |
| D3 | Sentropic/Cluster Mesh owns integrated runtime, transport, admission/lifecycle, PTY actuation boundary and neutral enforcement; h2a owns collaboration semantics, tool authorization, consumer adapter and thin stdio bridge; Graphify owns memory. |
| D4 | Persistence, migration, backfill and rollback proof precede every application cutover; one canonical author exists per namespace/domain. |
| D5 | Immutable event envelope, idempotency key, generation, outbox and distinct transported/verified/acted receipts. |
| D6 | One composed MCP capability, authored by `mcp-platform` and `mcp-auth`, reusable without Cluster Mesh. |
| D7 | Signed/verified message plus registration, possession and domain authorization before preferred PTY actuation. |
| D8 | Reuse the h2a↔Graphify memory contract; Graphify owns canonical store, ranking, revalidation and projections. |
| D9 | Keep deterministic Focus rendering and architecture evidence separate from runtime ownership. |
| D10 | OAuth/MCP/NIST-NHI verification sediment applies to all actionable routes; no new wire profile is selected here. |
| D11 | Per namespace: shadow read/compare, single-author cutover, observation, rollback proof, then legacy path deletion in the replacement lot. |
| D12 | Accept by observable effects, stable refusal reasons, generation/capacity metrics, receipts and LOST reconciliation, never process presence alone. |
| D13 | Compose exactly the 29 namespace modules in the inventory below. |
| D14 | `cluster-mesh` is the Hono plugin and contains the integrated control runtime. |
| D15 | Exactly one logical MCP server authority per active generation; zero server per session. |
| D16 | PTY preferred, registration fail-closed, bounded pool K, configurable cap `clusterMesh.capacity.maxConcurrent` defaulting to 12. |
| D17 | C1–C5 and A1–A5 are internal conductor-enforced gates. They do not wait for an owner choice. |

## Target architecture

```mermaid
flowchart TB
  subgraph Roots[HTTP composition roots]
    API[Sentropic API]
    IDP[apps/auth-idp]
    STANDALONE[Standalone provider host]
  end
  subgraph CM[@sentropic/cluster-mesh]
    PLUGIN[createClusterMeshPlugin]
    CTX[VerifiedInvocationContext ingress]
    RUNTIME[Integrated runtime and generations]
    REG[Registration and PTY authority]
    CAP[Capacity pool K and maxConcurrent]
    MCP[Logical MCP server per generation]
  end
  subgraph Modules[Autonomous Hono namespace modules]
    AUTH[auth-hono]
    MCPA[mcp-auth and mcp-platform]
    GW[llm-gateway]
    CHAT[chat-server]
    LIBS[Provider and application modules]
  end
  API --> PLUGIN
  IDP --> PLUGIN
  PLUGIN --> CTX --> RUNTIME
  RUNTIME --> REG
  RUNTIME --> CAP
  RUNTIME --> MCP
  PLUGIN --> AUTH
  PLUGIN --> MCPA
  PLUGIN --> GW
  PLUGIN --> CHAT
  PLUGIN --> LIBS
  STANDALONE --> AUTH
  STANDALONE --> MCPA
  STANDALONE --> GW
  STANDALONE --> CHAT
  STANDALONE --> LIBS
```

The plugin is a Hono mounting/composition boundary, not a provider service locator. The product root constructs product adapters and passes namespace modules to the plugin. A provider module can be constructed without the plugin and mounted on another Hono app.

## Neutral invocation and namespace contracts

`VerifiedInvocationContext` is TARGET in `@sentropic/contracts`, not in `@sentropic/cluster-mesh`. It contains verified references and decisions, never raw credentials:

```ts
export interface VerifiedInvocationContext {
  readonly invocationId: string;
  readonly correlationId: string;
  readonly generationId: string;
  readonly principal: VerifiedPrincipalRef;
  readonly workspace: VerifiedWorkspaceBindingRef;
  readonly scopes: readonly string[];
  readonly policyRevision: string;
  readonly registration?: VerifiedRegistrationRef;
  readonly custody?: VerifiedCustodyRef;
  readonly issuedAt: string;
}
```

The plugin consumes neutral modules shaped like:

```ts
export interface ClusterMeshNamespaceModule {
  readonly namespace: ClusterMeshNamespace;
  readonly enabled: boolean;
  createRouter(input: {
    readonly context: VerifiedInvocationContextPort;
    readonly receipts: InvocationReceiptPort;
  }): Hono;
}
```

The exact exported factory is TARGET `createClusterMeshPlugin(options)`. `options` supplies the integrated runtime, namespace modules, mount policy and probes. Provider packages may depend on `@sentropic/contracts`; they must not depend on `@sentropic/cluster-mesh`. Application-only extractions live under `api/src/routes/namespaces/` as injectable router factories and receive product ports from `api/src/app.ts`.

## Integrated runtime, registration and capacity

- A **generation** is one fenced lifecycle epoch of the integrated Cluster Mesh runtime. Generation identity changes on authoritative replacement or recovery, not on every request.
- `clusterMesh.capacity.maxConcurrent` is the externally configurable hard cap, default `12`.
- `clusterMesh.capacity.poolSize` is the configured pool K and must satisfy `0 < poolSize <= maxConcurrent`; no default K is fixed by r13.
- Admission reserves capacity before any spawn or PTY action. With the default cap, the thirteenth concurrent reservation is refused before spawn with stable reason `capacity_exhausted`.
- A registration binds generation, subject/NHI, workspace, PTY actuator reference, custody epoch, expiry/lease and possession evidence. Missing, stale, revoked or generation-mismatched registration fails closed before actuation.
- PTY is the preferred actuator. A tmux adapter may be selected only as a declared fallback after the same registration and authorization gates; tmux is not the control-plane model.
- Live process or heartbeat state is advisory. A dead or parked target is reconciled to `LOST`, never `REATTACHED` solely from a PID.
- `drive`/`wake` success requires an acted receipt and an observable tick from the target session. `relaunch-inbox` reports the actual acted set.

## Logical MCP singleton boundary

The MCP singleton is **logical per generation**, not one global operating-system process:

- one active `mcpServerId` and one authoritative supervisor lease exist for a generation;
- zero session owns or starts an MCP server;
- a thin stdio bridge may exist per consumer only if it has no registry, heartbeat, policy, consent store or gateway authority;
- coordinated workers or rolling replacement may use more than one process, but only the active generation lease may accept authoritative MCP traffic;
- old and new generations may overlap during fenced handover, but a request is accepted by one generation and one author only;
- `mcp-platform` owns MCP session/consent/elicitation/cancellation semantics, `mcp-auth` owns OAuth resource verification, and connector hosts own provider execution/secrets.

The canonical Sentropic effect path is:

```text
MCP client
  -> Cluster Mesh Hono plugin
  -> VerifiedInvocationContext
  -> active generation and logical MCP server
  -> createMcpAuth / mcp-platform router
  -> connector-host provider
  -> acted receipt
```

## HTTP roots and frozen facade boundaries

### Product API and `apps/auth-idp`

The product API and the IdP are separate composition roots over shared modules:

| Root | TARGET mount contract |
|---|---|
| Product API | `api/src/app.ts` mounts the Cluster Mesh plugin beneath `/api/v1`, with `/auth`, `/oauth`, `/session` and the other 26 modules independently enabled. `/.well-known` is a root projection of the `/oauth` module. |
| Standalone IdP | `apps/auth-idp/idp-app.ts:createIdpApp` mounts the same `/auth` and `/oauth` modules and projects the shared `/session` module onto the root-specific session/device paths beneath its established `/api/v1/auth` public root; it mounts the same discovery factory at `/.well-known`. Static IdP screens remain root-owned. |

The IdP is not a second implementation or a thirtieth namespace. Cross-root duplication of a module is deliberate composition; within either root there is exactly one author and no legacy route after cutover.

### `/auth` ↔ `/oauth` ↔ `/session`

| Facade | Owns | Does not own |
|---|---|---|
| `/auth` | Identity enrollment and account lifecycle: WebAuthn register/login/credentials, magic link, email verification, federation and identity-facing `/me` operations. | OAuth authorization/token/introspection/revocation, runtime session registration, PTY custody or drive/wake. |
| `/oauth` | Authorization-server and protected-resource protocol: authorize, consent, token, userinfo, introspect, revoke, S2S/OBO, resource metadata and `/.well-known` projections. | User/account CRUD, application cookie-session lifecycle, PTY or Cluster Mesh generation state. |
| `/session` | Runtime/session lifecycle and authority: application session lifecycle adapter, device/consumer attachment, generation registration, possession/custody, drive/wake/relaunch, LOST reconciliation and acted receipts. | Identity proofing, OAuth token issuance, connector or MCP protocol semantics. |

Relative to dossier D13, the spec+plan freeze deliberately assigns both `api/src/routes/auth/session.ts` and `api/src/routes/auth/device.ts` to `/session`, not `/auth`; this is the authoritative boundary decision rather than an implementation drift. Those handlers therefore become ports consumed by `/session`, while the other auth handlers compose `/auth` or `/oauth`. The migration may preserve root-specific external URL projection only where the IdP contract requires it; it may not keep two active authors in one root.

### `catalog` ↔ `resources` ↔ MCP/connectors

| Facade | Responsibility contract |
|---|---|
| `/catalog` | Read/search discovery of skills, tools, agents, workflows and canvases plus source metadata. It owns registry composition, not provider effects, credentials or resource bytes. |
| `/resources` | Uniform `list/stat/read/grep/edit/invoke` projection and resource references. It delegates discovery to `/catalog`, provider work to MCP/connectors and domain authorization to the verified context. It is not a second registry or provider. |
| `/mcp` | MCP protocol ingress, session, consent, elicitation, cancellation and resource-server authorization. It delegates provider execution and does not administer connector accounts. |
| `/connectors` | Provider/account administration, bindings, availability and connector-host dispatch. Providers retain secrets/codecs; effectful invocation requires the verified context and an MCP/resource authorization when applicable. |

### `/streams` ↔ domains

`/streams` owns only transport: SSE framing, cursor/replay protocol, heartbeat, backpressure, connection lifecycle and generic envelope delivery. Each domain owns event production, payload schema, hydration/projection and domain authorization. The streams router receives domain stream ports; it must not import business router hydration functions or mutate locks/presence as a side effect of transport teardown. A domain can expose its stream port without importing the streams module.

## Corrected D3 responsibility split

| Owner | Owns | Explicitly excludes |
|---|---|---|
| Sentropic / `cluster-mesh` | Hono composition plugin, integrated runtime, generation/transport, admission/lifecycle, capacity, neutral registration enforcement, preferred PTY actuation boundary, namespace enablement and neutral receipts. | h2a collaboration semantics/tool authorization, provider secrets/codecs, Graphify memory semantics. |
| h2a | Collaboration semantics, drive tool authorization, registration producer/consumer adapter, PTY host adapter, thin stdio MCP bridge, h2a↔Graphify consumer contract. | Separate control authority, per-session control authority, canonical Graphify memory. |
| Graphify | Memory store, ranking, revalidation, graph/vector projections, retention and rebuild. | Session admission, PTY, MCP or Cluster Mesh policy syntax. |

The absent Sentropic PTY driver and absent Graphify/Track sources stay explicit source-gaps. Adapter contracts and fail-closed fixtures do not close A1, D8 or `/track` production activation by themselves.

## D13 namespace inventory and migration ownership

All 29 rows are mandatory plan scope. “Application module” means an injectable Hono factory under `api/src/routes/namespaces/`, not a permanent direct entry in `api/src/routes/api/index.ts`.

| # | Namespace | CURRENT source | TARGET router owner and absorbed surface |
|---:|---|---|---|
| 1 | `/mcp` | `api/src/routes/api/mcp.ts`; `mcp-auth`; `mcp-platform`; `connector-host` | Reusable `mcp-platform`/`mcp-auth` router mounted once; absorbs `/api/v1/mcp/*`; direct connector dispatch deleted. |
| 2 | `/gw` | `llm-gateway:createGatewayRouter`; no product mount | Existing reusable factory mounted at `/api/v1/gw/*`. |
| 3 | `/focus` | `api/src/routes/api/focus.ts`; `packages/focus` services | `packages/focus` Hono factory with injected owner-signature/Track/tenant ports; absorbs `/api/v1/focus/*`. |
| 4 | `/llm-mesh` | `llm-mesh` contracts; `models.ts`, provider-connections and AI settings routes/services | `llm-mesh` Hono enrollment/pool factory; absorbs model and provider-enrollment sub-surfaces without moving secrets. |
| 5 | `/track` | external `@sentropic/track` consumed by Focus; package source absent | Standalone neutral adapter factory, fail-closed until Track contract is pinned; no copied Track log. |
| 6 | `/memory` | Graphify contract/implementation absent from checkout | Standalone Graphify adapter factory over the pinned h2a↔Graphify port; fail-closed while source/release proof is absent. |
| 7 | `/session` | `createClusterMeshAppAdapter`; auth `session.ts`/`device.ts`; no central drive/wake router | Cluster Mesh session module with injected product session and h2a PTY ports; registration/capacity/drive/wake authority. |
| 8 | `/oauth` | auth `oauth.ts`, `service-s2s.ts`, `well-known.ts`; auth-hono factories | `auth-hono:createOAuthRouter` and `createWellKnownRouter` with product adapters; root projections as defined above. |
| 9 | `/auth` | remaining `api/src/routes/auth/**`, `me.ts`; auth-hono factory | `auth-hono:createAuthRouter` with product identity ports; excludes oauth and session authority. |
| 10 | `/workflows` | `plans.ts`, `todos.ts`, `tasks.ts`, `runs.ts`, `workflow-config.ts`, `queue.ts`; `flow` services | `flow` Hono factory with injected stores/queue; absorbs plans/todos/tasks/runs/workflow-config/workspace-types/queue. |
| 11 | `/agents` | `agent-config.ts`, `prompts.ts`, todo orchestration and catalog agent source | Application namespace factory over flow/skills/catalog ports; absorbs agent-config/prompts. |
| 12 | `/cli` | CLI/build-cli/harness/focus CLI seams; no current HTTP mount or verified PTY driver | Standalone adapter router that delegates all drive/wake to `/session`; no second process authority. |
| 13 | `/chat` | `api/src/routes/api/chat.ts`; real `createChatServer` | Complete `chat-server` factory ports, absorb remaining app-local chat endpoints and delete legacy router. |
| 14 | `/streams` | `api/src/routes/api/streams.ts` with direct DB/PG/domain imports | Application transport factory receiving domain stream ports; absorbs `/api/v1/streams/*` under the frozen streams contract. |
| 15 | `/comments` | comments package plus `api/src/routes/api/comments.ts` | `comments` Hono factory with injected store/event/tenant ports; absorbs `/api/v1/comments/*`. |
| 16 | `/locks` | `locks.ts`, `lock-service.ts`, `lock-presence.ts` | Application collaboration namespace factory; absorbs `/api/v1/locks/*` and exposes a domain stream port. |
| 17 | `/business` | organizations/folders/initiatives/solutions/products/proposals/bids/view-templates routes and context services | Application business factory over existing DB/service ports; legacy aliases are either canonicalized with client migration or deleted in this cutover. |
| 18 | `/analytics` | `api/src/routes/api/analytics.ts` | Application analytics factory with injected query/queue/settings ports; no import from the business router. |
| 19 | `/workspaces` | workspaces/tenants/neutral routes and tenancy services | Cluster Mesh/application workspace factory with injected tenancy/product ports; absorbs `/workspaces`, `/tenants`, `/neutral`. |
| 20 | `/config` | settings/business-config/ai-settings and configuration parts of workflow/models | Application config factory delegating provider/model policy to flow/llm-mesh; excludes connector/client sub-surfaces. |
| 21 | `/documents` | documents/docx/pptx/xlsx routes and document/storage services | Application document factory with injected object/storage/queue ports; absorbs document routes and `/use-cases/:id/docx`. |
| 22 | `/transfers` | `import-export.ts`, storage services | Application transfers factory with injected storage/domain ports; absorbs `/exports/*` and `/imports/*`. |
| 23 | `/connectors` | google-drive/gmail routes, connector account services, connector-host, MCP broker proof | `connector-host` plus application administration factory; absorbs Google/Gmail/account settings, removes broker bypass, retains provider secrets. |
| 24 | `/clients` | Chrome/VSCode/Cowork routes, tab registry, auth-client/cowork clients, bookmarklet residual | Application clients factory; absorbs extension/desktop metadata and tokens, resolves or deletes unmounted bookmarklet residue in the same cutover. |
| 25 | `/admin` | `admin.ts`, tenant-resolution metrics | Application admin factory with injected RBAC/tenancy ports; absorbs `/api/v1/admin/*`. |
| 26 | `/health` | `health.ts` and package probes | Cluster Mesh health aggregator over injected probes; reports module/generation state without becoming domain readiness authority. |
| 27 | `/apps` | `api/src/services/app-control-plane/**`; no current HTTP mount | Application apps factory over the existing control-plane service; build-cli remains a client, not an owner. |
| 28 | `/catalog` | `api/src/services/catalog/**`; no current HTTP mount | Application catalog factory over the composite registry; search/discovery only, effect authorization fail-closed. |
| 29 | `/resources` | `api/src/services/resource-plane/**`; no current HTTP mount | Application resource factory over `ResourceDispatcher`; delegates catalog/provider work and preserves principal/provenance. |

## Single SQL migration and C1 ordering

This branch deliberately uses **one control-stream SQL file**: TARGET `api/drizzle/control/0007_cluster_mesh_r13.sql`. No `api/drizzle/0042_*.sql` is created.

The same migration creates all durable Cluster Mesh state needed by later cutovers:

- `control.cluster_mesh_generations`: generation identity, lifecycle, supervisor lease and configured capacity snapshot;
- `control.cluster_mesh_registrations`: generation/workspace/NHI/custody binding, opaque PTY actuator reference, lease, revocation and LOST state, with covering indexes for A1/A3 active-registration queries by `(generation, workspace, NHI)` including expiry/lease;
- `control.cluster_mesh_capacity_leases`: pre-spawn reservations and release state enforcing `maxConcurrent`, with lease/expiry reclamation after a generation crash so capacity cannot leak;
- `control.cluster_mesh_mcp_servers`: logical MCP server identity and single authoritative supervisor lease per generation;
- `control.cluster_mesh_commands`: idempotent drive/wake/relaunch command state, refusal reason and target registration, with idempotency-key uniqueness per target;
- `control.cluster_mesh_receipts`: transported/verified/acted receipt stages and observable effect reference;
- `control.cluster_mesh_namespace_cutovers`: a durable cutover record keyed by `(compositionRoot, namespace)`, preserving the product-versus-`auth-idp` composition-root dimension together with selected generation, shadow comparison result, active author and rollback checkpoint.

Existing public domain tables remain authoritative for auth, business, chat, documents, connectors and configuration. Existing `control.event_outbox` remains the durable outbox; the migration references it by contract rather than duplicating it. Backfill is `N-A-from-empty`: CURRENT Cluster Mesh attachment state is a process-local `Map`, so no durable rows exist to migrate. The migration contains the required additive indexes and reversible rollback SQL evidence. It lands after package-level contracts/runtime tests but before the first product API or IdP cutover. Every later namespace lot must prove that it needs no additional table; a discovered schema need stops that cutover because a second migration is forbidden.

## D11 namespace transition protocol

Every namespace lot follows the same four-stage gate:

1. **Extraction or wrapping**: expose an injectable Hono router factory in the owner named in the inventory; characterize current wire behavior and test standalone construction with a synthetic `VerifiedInvocationContext`.
2. **Plugin mount**: register one namespace module in `createClusterMeshPlugin`, disabled by default until the shadow proof is configured.
3. **Progressive cutover**: shadow only reads or deterministic projections, compare status/body/effect intent, select one author atomically through the namespace cutover record, observe, and prove rollback to the previous generation without two writers.
4. **Replacement gate**: remove the legacy mount/import/file in the same lot, update clients where the path changes, run package/API/UI tests, and record the one remaining route author.

Shadow never duplicates writes, PTY actuation, connector calls, LLM calls, queue jobs or other effects. For write routes it compares validated intent before execution and invokes exactly one author.

## r13 implementation evidence

The behavior candidate qualified on 2026-09-04 is `1128d28b55f7d8eadfc8c0b364595b1bffdcf41d` on
`feat/cluster-mesh-central-control-plane`. Documentation-only closure commits do not widen that
tested behavior. The sole migration is `api/drizzle/control/0007_cluster_mesh_r13.sql`, SHA-256
`248ce19dc427a43a34ecd0f2b1aee8fdca1be948e9ea647b7a16a83bd64068e0`; no second control or public
migration exists.

The product registry owns exactly these 29 entries; the owner is the exported module/factory, not
the former direct route file:

| Namespace | Product owner |
|---|---|
| `/session` | `productSessionModule` |
| `/cli` | `productCliModule` |
| `/mcp` | `productMcpModule` |
| `/oauth` | `createOAuthNamespaceModule({ compositionRoot: 'product' })` |
| `/gw` | `productGwModule` |
| `/chat` | `productChatModule` |
| `/focus` | `productFocusModule` |
| `/track` | `productTrackModule` |
| `/memory` | `productMemoryModule` |
| `/health` | `createProductHealthNamespaceModule` |
| `/apps` | `productAppsModule` |
| `/catalog` | `productCatalogModule` |
| `/resources` | `productResourcesModule` |
| `/admin` | `productAdminModule` |
| `/clients` | `productClientsModule` |
| `/transfers` | `productTransfersModule` |
| `/documents` | `productDocumentsModule` |
| `/config` | `productConfigModule` |
| `/auth` | `productAuthPlugin().module` |
| `/llm-mesh` | `productLlmMeshModule` |
| `/workflows` | `productWorkflowsModule` |
| `/comments` | `productCommentsModule` |
| `/connectors` | `productConnectorsModule` |
| `/agents` | `productAgentsModule` |
| `/streams` | `productStreamsModule` |
| `/locks` | `productLocksModule` |
| `/business` | `productBusinessModule` |
| `/analytics` | `productAnalyticsModule` |
| `/workspaces` | `productWorkspacesModule` |

The first nine entries are prefix-mounted and the remaining twenty use root remaps. The standalone
IdP composes the same session, OAuth and auth module factories at its established root-specific
paths and projects the same well-known factory; it contains no forked auth handler. A shared-DB UAT
ran the product on 9375 and the IdP on 9376. The product reported active generation
`cluster-mesh-session-v1` and all 29 modules; IdP discovery reported issuer and OAuth endpoints at
9376, and the deterministic authorization-code smoke passed consent, code exchange, token claims
and userinfo. The shared signing-key row required both roots to use the same configured KEK.

Qualification status is deliberately non-aggregate:

- A1 is **PASS for qualification** through a qualification-grade shared-secret invocation verifier,
  available only behind explicit opt-in outside production; production rejects shared-secret evidence:
  a live A-to-B drive produced an observable tick and acted receipt, relaunch returned a non-empty
  replacement incarnation, and the final dead target reconciled to LOST. Production `verify()` uses a
  dedicated Ed25519 mesh public-key ring (not OAuth JWKS), binds the request and ordered
  `transported|verified|acted` receipt coordinates to the active generation, and accepts only the
  deployment audience or its explicit legacy allowlist. Missing keys, invalid signature/audience/time,
  missing generation and replay remain 401 before receipts, commands or PTY effects; production PTY
  activation remains separately fail-closed.
- A2 is **PASS**: more than one registered session resolved to one active logical MCP server under one
  supervisor for the generation, with zero per-session MCP servers; missing-generation refusal produced
  zero provider effects.
- A3 is **PASS**: missing CLI registration refused before parse/delegation, while one canonical CLI
  delegation persisted transported, verified/accepted and acted receipts with a real PTY effect.
- A4 is **PASS in the qualification router against the durable store**: the default generation occupied
  12/12 and rejected request 13 before spawn, while the configured generation occupied 3/3 and rejected
  request 4 before spawn. Canonical `/session/control/*` still reserves through process-local
  `createCapacityAdmission`; `BR75-SG10` remains open as a bounded residual while the API deployment is
  `replicas: 1`. Durable device registration across adapter processes does not make canonical capacity
  admission durable.
- A5 is **PASS**: the inventory proves 29 unique module objects; group 10 runs six tests with zero
  failures, retries or skips and proves module disablement, canonical catalog/streams paths and
  duplicate-prefix 404.

The branch deleted these legacy files: `api/src/routes/api/{agent-config,ai-settings,chat,comments,focus,gmail,google-drive,locks,mcp,models,prompts,settings}.ts`,
`api/src/routes/auth/{device,index,session}.ts`, `api/src/routes/well-known.ts`, and
`api/src/upstream/injected-script.ts`. `api/src/routes/api/index.ts` is now an inert ledger with no
direct mount. There is no dual legacy route path.

Every package whose `src/**` changed also changed its manifest version: `auth-client`, `auth-hono`,
`build-cli`, `chat-server`, `cli`, `cluster-mesh`, `comments`, `connector-host`, `contracts`,
`events`, `flow`, `focus`, `harness`, `llm-gateway`, `llm-mesh` and `mcp-platform`. The API and IdP
are the only composition roots whose manifests/source import `@sentropic/cluster-mesh`; no provider
package manifest lists it. `/apps/instances` remains a global `admin_app` surface with optional or
caller-supplied tenant selection and no predecessor HTTP surface. `/catalog` remains global,
matching `search_catalog`; a future tenant-scoped source needs a scoping port before singleton
registration. `/resources` derives tenant/workspace/role through canonical product authorization
and rejects caller scope, but no installed resource provider currently partitions data by tenant.
Track and memory stay fail-closed. Production PTY activation stays fail-closed; the shared-secret live
adapter can close non-production qualification only and cannot replace Ed25519 in production. The
bookmarklet deletion is N-A as an active router because
inventory found only dead middleware/URL emission.

## Internal conductor gates

| Gate | Blocking proof |
|---|---|
| C1 | The unique migration, backfill and rollback proof lands before product/IdP cutovers; one author is recorded per persistent namespace. |
| C2 | E2E uses `E2E_GROUPS` with space-separated groups. The new file is `e2e/tests/10-cluster-mesh-control-plane.spec.ts`, because `10` is the next free top-level group. Final impacted regression includes `00 01 02 03 04 05 06 07 08 09 10`; groups 07/08/09 are not excluded because workflows, transfers, documents, chat and steering migrate. |
| C3 | `VerifiedInvocationContext` is neutral and injectable; each provider package builds/tests standalone with no `@sentropic/cluster-mesh` dependency and with the plugin disabled. |
| C4 | r9/r10 text is labeled conductor-normalized and the absent complete raw capture stays a source-gap; no fabricated direct quote. |
| C5 | The r7 synthesis is historical and superseded on mandatory/universal runtime language; no build task reintroduces a separate control authority or privileged-tmux-first model. |
| A1 | A real terminal session A drives/wakes a live B through PTY; B produces an observable tick and acted receipt; registration exists; relaunch result is non-empty when action occurs; dead/parked is LOST. |
| A2 | N sessions use one logical MCP server/supervisor authority per generation, zero MCP server per session; thin stdio bridges have no control authority. |
| A3 | Missing/stale/revoked registration rejects before PTY or connector effect with distinct observable reason and no ghost presence. |
| A4 | With default `maxConcurrent=12`, twelve reservations may spawn and the thirteenth is rejected before spawn; a configured non-default cap follows the same rule. |
| A5 | Every namespace module mounts/tests alone, can be disabled in the plugin, and provider dependency graphs contain no `@sentropic/cluster-mesh`; h2a standalone mode remains viable. |

## Ordered realization

1. Socle: neutral context, namespace contract, Hono plugin, integrated generation/runtime, capacity and registration contracts.
2. Unique control migration, adapters and rollback proof before any application cutover.
3. `/session` registration cutover closes the internally provable device-admission gates; the integrated live qualification closes A1, A2, A3 and durable-store A4 in the qualification router. `BR75-SG10` remains open for canonical `/session/control/*` process-local capacity, bounded while the API deployment is `replicas: 1`.
4. Reusable factories: `/mcp`, `/oauth`, `/auth`, `/gw`, `/chat`, including the IdP root and A2/A3.
5. TARGET reusable-package extractions: `/focus`, `/llm-mesh`, `/workflows`, `/comments`, `/connectors`.
6. TARGET application/adapter extractions: the remaining namespaces, each under D11 and immediate legacy deletion.
7. Full E2E C2 matrix, A5 modularity audit, documentation and independent review.

## Convergence invariants

1. D1=B applies to every namespace and provider.
2. The product API has exactly 29 registered namespace keys; root projections such as `/.well-known` and IdP static screens do not add namespaces.
3. Each namespace is independently enableable and has one active author per root/generation.
4. The plugin integrates the control runtime; no separate control authority exists beside it.
5. `VerifiedInvocationContext` lives in neutral contracts and contains references/results, not secrets.
6. Provider packages may import neutral contracts and Hono; they do not import Cluster Mesh.
7. Registration, generation, policy revision, workspace, custody and reachability are verified before an actionable provider call.
8. PTY is preferred; tmux can only be a secondary adapter behind identical gates.
9. Capacity is reserved before spawn and bounded by `clusterMesh.capacity.maxConcurrent`, default 12.
10. MCP is one logical server authority per generation, not one OS process globally and never one server per session.
11. The IdP and product API compose the same auth/oauth factories and the same session module with root-specific mount projection and no forked handlers.
12. `/auth`, `/oauth` and `/session` obey the frozen responsibility split.
13. `/catalog`, `/resources`, `/mcp` and `/connectors` obey the frozen discovery/projection/protocol/provider split.
14. `/streams` owns transport only; domains own payload, hydration, authorization and effects.
15. Migration/backfill/rollback precede app cutover, and there is no second SQL migration.
16. Shadow mode never duplicates effects; cutover selects one author; replacement deletes the legacy path.
17. `LOCAL_ONLY` has no application mirror; `APP_MANAGED` has one fenced canonical writer.
18. Track and Graphify activation remain fail-closed while their source/release contract is a source-gap.
19. Process presence is not acceptance; acted receipt and observable effect close A1.
20. D17 gates are enforced by the conductor without owner re-ratification.

## Acceptance

- A1–A5 pass with evidence from the exact candidate generation.
- The 29 namespace modules are registered once, independently disableable and covered by standalone plus product-root tests.
- `api/src/routes/api/index.ts` no longer mounts a replaced legacy router; deleted files have named replacement tests.
- `api/src/app.ts` and `apps/auth-idp/idp-app.ts` use the plugin/module composition defined here.
- The unique control migration is the only SQL file added and is applied before every app cutover test.
- `createClusterMeshAppAdapter` and `createMcpAuth` remain the real integration symbols where their responsibilities apply.
- No provider package depends on `@sentropic/cluster-mesh`.
- C2 executes groups `00` through `10`, with the new group actually selected.
- C4/C5 provenance and historical-synthesis qualifiers remain present.
- Any unresolved Track, Graphify, PTY adapter, bookmarklet or legacy UI branch gap is reported as source-gap/partial/N-A and cannot receive a green production claim.

## Source gaps for independent review

- A production Sentropic PTY driver remains absent. A1 qualification closes through the real h2a adapter and a non-production-only shared-secret verifier, not through an in-memory actuator; production `/session/control/*` requires Ed25519 and remains fail-closed.
- h2a is outside this branch, so removal of its 44 per-session servers and its standalone fallback are cross-repository qualification, not a local source edit.
- `@sentropic/track` source is not present under `packages/`; `/track` ownership and wire surface require a pinned external package contract.
- Graphify source/release is absent; `/memory` stays fail-closed until the existing h2a↔Graphify contract and provider release are pinned.
- The bookmarklet middleware and generated URLs exist without a mounted router in the inspected table; `/clients` must prove whether this is dead code or an omitted mount.
- The residual “non-ratified” UI branch was not located by repository search; deletion requires a concrete locator rather than inference.
- The r12 review residual n2 says the portable decision-kit HTML omits the convergence-provenance block, while n3 records three labels exactly at the accepted 210px routing cap with leader lines and no overlap. This branch does not edit the kit renderer; source provenance is repeated here, and renderer work is N-A unless `/focus` changes that presentation surface.
- The residual claim of 16 design-system findings is unverified and appears to derive from bundled SvelteFlow dependencies rather than the kit's design-system contract; it is not a build gate without a separately requested global dependency lint.
- The package boundary for application-owned TARGET routers may later justify new reusable server packages, but r13 first freezes injectable factories under `api/src/routes/namespaces/` to avoid speculative package taxonomy.
- The unique migration table/index set must be challenged against actual A1/A2 recovery queries before generation; no second migration can repair an omission.

## Source ledger

- r13 authority: `/home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit/dossier.json`.
- Residuals: `/home/antoinefa/src/sentropic/.tmp/engage/cm-r13-residuals-for-specplan.md`.
- Conditions C1–C5: `/home/antoinefa/src/sentropic/.tmp/engage/cm-review-fable-specplan.md`.
- Qualification A1–A5 and corrected D3 input: `/home/antoinefa/src/sentropic/.tmp/engage/cm-qualif-plan-commun.md`, read through its 2026-08-29 owner correction.
- r11/r12 dossier reviews: `/home/antoinefa/src/sentropic/.tmp/engage/cm-review-fable-r11.md`, `cm-review-fable-r12.md`.
- Historical decision trail: `docs/specs/decisions/cluster-mesh-r8/dossier.json` and its owner-feedback files.
- Historical synthesis: `docs/specs/decisions/cluster-mesh-r8/synthesis-r7.md`; pre-r13 only and superseded for mandatory/universal runtime language.
- Product roots and mounts: `api/src/app.ts`, `api/src/routes/api/index.ts`, `api/src/routes/auth/index.ts`, `api/src/routes/well-known.ts`, `apps/auth-idp/idp-app.ts`, `apps/auth-idp/index.ts`.
- Runtime and adapters: `packages/cluster-mesh/src/**`, `api/src/services/cluster-mesh-adapter.ts`, `api/src/index.ts`.
- Real reusable Hono factories: `packages/auth-hono/src/router.ts`, `packages/auth-hono/src/oauth/router.ts`, `packages/auth-hono/src/oauth/wellknown-handler.ts`, `packages/mcp-auth/src/hono.ts`, `packages/llm-gateway/src/router/index.ts`, `packages/chat-server/src/index.ts`.
- Provider/application sources: `packages/{mcp-platform,mcp-auth,llm-gateway,llm-mesh,connector-host,focus,flow,chat-core,chat-server,comments,auth-hono,auth-client,oauth-verify,harness}/**`, `api/src/services/{app-control-plane,catalog,resource-plane,flow,focus}/**` and the 56 route files.
