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
