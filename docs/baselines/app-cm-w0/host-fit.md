# W2 host fit and selected provider contract

Frozen against the source and package tuple in [published-tuple.json](published-tuple.json). One host-owned compiled registry selects exactly `sentropic.artifacts`, `google-drive`, `gmail`. The latter two are explicit local registrations from the existing app connector adapters/manifests, not invented published packages. `packages/mcp-connector-google` is workspace version `0.0.0` at the pinned source; a guessed registry selector is not a dependency. The new artifact package is `0.1.1`; its logical provider manifest version is `0.1.0` (`packages/artifacts/src/mcp.ts:24`).

## Assembly selected for T2

1. New `api/src/services/mcp/cluster-registry.ts` owns `createClusterMeshModules`, `createMcpRegistry`, `createArtifactsBuiltin`, explicit app registrations, selection/configuration and a single startup compile. Required peers are exactly those in the tuple. Duplicate names, unavailable/incompatible peers and bad configuration prevent readiness; never activate a partial plan.
2. Use cluster-mesh's `loadMcpPlatformHono` entrypoint with the **existing** product auth and connector ports. Keep `/api/v1/mcp` and its relative metadata, `/`, `/invoke`, `/resources/read` paths. Preserve Google Drive/Gmail `connectorId`, `capabilityRef`, `workspaceRef`, `accountSelectorHint` and resource semantics. Do not add `/api/v1/mcp/mcp` accidentally.
3. Preserve `productMcpModule`, PostgreSQL cutover/supervisor guard and one active author/generation. Introduce dispatch of artifacts through the compiled plan, W1 service and current host policy; route each operation once. Provider selection cannot bypass enrollment, consent, account/workspace resolution or domain authorization.
4. Keep verified `sub`, `clientId`, `tid`, scopes as separate claims, resolve workspace/tenant membership freshly and intersect current policy before effect. A body workspace is a selector; the mesh's `workspaceId` is not a tenant and `principalId` is not automatically the OAuth client. Never reinterpret header/model claims as identity.
5. Mount the artifact HTTP adapter within the existing `/resources` module boundary, using W1's same service instance and verified host identity. Reserve `/api/v1/resources/artifacts/*` for these additive operations and W3 trusted activation. Keep existing `/resources/{list,stat,read,grep,edit,invoke}` unchanged. No new namespace authority.
6. W4 consumes the compiled exact-name map directly; do not pass these names through `McpCatalogSource` sanitization. Its source is identity-free and joins the existing composite catalogue. O1 stays separately gated; no OAuth-provider replacement in T2.

The convenience `createMcpNamespaceModule` is excluded for this host fit: it refuses resource reads, adds relative `/mcp`, and projects a mesh identity needing additional resolution (`packages/cluster-mesh/src/compose/mcp.ts:204,208,245`). This is a bounded host assembly using existing leaves; no generic package compatibility change was shown necessary by the prototype. Auth/transport redesign or an extra compatibility PR requires SC reforecast and tuple requalification.

## Executed prototype

On 2026-10-18 at approximately 23:31 UTC, a disposable Node 24 container installed the exact published tuple with scripts disabled and ran [host-fit-probe.mjs](host-fit-probe.mjs). No listener, database, bucket or production credential was used. Output:

```json
{"registryTools":15,"invoke":200,"resourcesRead":200,"calls":2,"fixtureOnly":true,"verifierPositive":1,"verifierNegative":3}
```

The probe compiled all artifact public names, resolved each to `sentropic.artifacts`, rejected an unknown provider, loaded the Hono leaf and dispatched one invoke and one resource read at the existing app URL. It used fixture auth/connector responses; it did **not** prove real connector registration/configuration, consent, artifact persistence, HTTP/MCP service parity or integrated app cutover. Those are T2 gates, not W0 achievements. The first attempt failed with container workdir EACCES before npm installation; a user-owned temporary directory fixed the probe environment.

Root lock peer resolution is SDK `1.32.1`, Hono `4.13.0`, JOSE `5.10.0`; the API separately locks JOSE `6.2.4`. API's standalone lock still records cluster `0.13.0`, gateway `0.19.1`, SDK `1.30.0`; root workspace lock records the current tuple. W1 owns lock reconciliation under the repository build discipline; do not splice integrity strings or claim the older standalone lock identifies the deployed image. W5 inspects the pruned physical dependency tree and exact image.

## T2 acceptance scope retained

- New `api/tests/api/app-mcp-registry.test.ts`: exact provider/tool names, configuration/selection compile, missing peer/duplicate-name refusal, spoofed subject/tenant/client/workspace denial, discovery/invoke parity, same HTTP/MCP service and one effect.
- Existing `api/tests/api/{mcp-resource-server,cluster-mesh-mcp-singleton,cluster-mesh-namespace-inventory,cluster-mesh-gw,cluster-mesh-gw-native,session-adoption}.test.ts`: URLs, resource reads, gateway, D1 and 28-namespace regression gates.
- Consumed-package `packages/cluster-mesh/tests/{mcp-registry,mcp-composition}.spec.ts` and standalone/packed-consumer evidence remain required.
- W1's `api/tests/api/artifacts-host-storage.test.ts`, real PostgreSQL/MinIO restart/two-process/restore checks and `make test-artifacts-integration` qualify storage separately; fixture service replies cannot substitute.
