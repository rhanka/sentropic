# W2 host fit and selected provider contract

The current freeze is [published-tuple.json](published-tuple.json). The original 18/26 October assembly and receipts below remain historical. Preserve Google Drive/Gmail's local registrations and current readers; a guessed connector registry selector is not a dependency.

## Current W0-close.d authority — 28 October reconciliation

Use [#796's host fit at ea8e84431](https://github.com/rhanka/sentropic/blob/ea8e84431/docs/baselines/app-cm-w0/host-fit.md), its [tuple](https://github.com/rhanka/sentropic/blob/ea8e84431/docs/baselines/app-cm-w0/published-tuple.json) and [qualification](https://github.com/rhanka/sentropic/blob/ea8e84431/docs/baselines/app-cm-w0/tuple-refresh-2026-10-27.md). Artifacts 0.2.4 / cluster-mesh 0.22.4 replace the dated selections below; APP-P1 manifest is `020aacfec500d754b76c90d3ad4a05097e0f996b8b9282145ca458917ea6fb27`. UP-T's durable adapter/SQL is delivered in published artifacts 0.2.4; host authority/restart/conformance remains receiving qualification. No tuple or integration implementation is copied here. The following 18/26 October observations, including the then-missing UP-T handoff, remain historical.

## Historical W0-close.d refresh — 27 October

Consume artifacts **0.2.3**, cluster-mesh **0.22.4**, llm-mesh **0.28.1**, gateway **0.21.3**, Comments **0.3.1**, platform **0.4.0**, auth-hono **0.17.0** and mcp-auth **0.2.2**. Workspace-source mode is retained: merge W2.b `d0ce8aeb0`, #702 `5dfab2cf3` and published UP-T/main `72bb2da3d`; the tuple records the exact qualified source head and root/API lock hashes. API and mesh resolve the same physical artifacts 0.2.3; no artifacts source alias or nested private peer is admitted.

APP-P1's compiled profile digest remains `0de19f966eacb5b63142b525611a6210a0d4aaeefbdaad92dfb3b6227575b6ef`. The manifest, explicitly using **`mcp:tools:invoke`**, now hashes to **`80ca4b067a010690dc71036a3237a70b91d99d7c025ded7173566d0ae55b1600`**. The four public tools and internal-port boundaries below remain frozen. The old artifacts 0.2.1 manifest `ccf8a4dd…7090e9a` is refused by a regression test; profile and manifest digests are distinct inputs.

The [refresh procedure and results](tuple-refresh-2026-10-27.md) bind verified published archives, clean workspace builds, normalized path/byte maps, the **entire workspace lock and installed development/runtime trees**, loaded Comments/gateway and physical/bundled API registry tests. Artifacts and llm-mesh payloads are byte-identical. Mesh/gateway each retain one generated declaration difference consisting only of string-union member order; raw bytes/hashes and the bounded semantic check are retained. This is not an assertion of full raw-byte equality for those two packages.

**No cluster-mesh upstream bump is needed:** published 0.22.4 consumes published artifacts 0.2.3 and compiles the selected builtin. UP-T is delivered in published 0.2.3, including `./adapters/postgres-activation` and `sql/0001_activation.sql`; W1.c composes this adapter. Its host authority/restart/conformance qualification remains W1.c/W3, with activation default-closed. W3 still owns the canonical pruned API/IdP/content image and image-digest receipt; this refresh neither deploys nor qualifies that image.

## Historical published/source freeze — 26 October

Workspace-source base: `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`, merged without rebase at `79a4f2703ffd34ad2b66999d3daf8b7516e90735`. [Current tuple](published-tuple-2026-10-26.json) pins artifacts **0.2.0**, mesh **0.22.1**, platform **0.4.0**, Comments **0.3.0**, gateway **0.21.0**, llm-mesh **0.27.1**, auth-hono **0.16.0**, mcp-auth **0.2.2** and external peers. The complete root workspace resolution is the immutable base's entire `package-lock.json.packages` map (**1700 entries**, exact Git blob/SHA-256 in the tuple); member declarations include API/UI/apps and every package. This is lock metadata, not a claimed installed/pruned image. API's standalone lock still resolves gateway **0.19.1** and links mesh from source; **W2.b alone** reconciles both locks and final physical resolution.

Upstream Immo #861 is Sentropic **PR #739**, merged 25 October at `e9f82d14a1a62b95050a91c36b4a01a1aed153c0`. The formerly proposed #729/0.21.3 repair actually merged as **0.22.1** at the pinned main. Registry GETs and downloaded archives verify all three published artifacts/mesh releases against npm SHA-512 SRI. Artifacts 0.2.0 matches the repaired `packages/artifacts/probe/CONTRACT-GAPS-RECEIPT.md` archive `6122ed8d…f2ae82`, whose implementation `62dc8de0fefcd59ceb833472379535f035550e85` is an ancestor of main. Older L8d failed candidate receipts remain historical failures, not final app acceptance.

The [published-fit receipt](published-fit-2026-10-26.json) records an isolated strict npm install (175 packages, no source links), actual `modules.load('comments')` and `modules.load('gateway')`, one physical cluster-mesh, shared gateway/mesh llm-mesh, explicit profile compilation and four-tool manifest. It retains the **whole installed resolved tree** and lock SHA-256 `07fd0f2d5bab5e7464e9ccea1e788673ee4893e9c91198acc7351136ca6137ca`. Comments' packed catalogue self-range is `>=0.21.0 <0.23.0`; the packed 0.22.1 common-v1 interpreter only accepts `comments`/`engram-live`. Gateway is within `>=0.19.0 <0.22.0`; the loaded tree passes the package topology guard. No Comments-store migration or app HTTP/storage qualification is inferred.

Reproduce with the existing `w0-host-fit` target in `probe.mk`, `W0_HOST_PROBE=published-fit-probe.mjs`, and exact `W0_PROBE_PACKAGES` from the tuple: artifacts 0.2.0, mesh 0.22.1, platform 0.4.0, auth-hono 0.16.0, mcp-auth 0.2.2, gateway 0.21.0, llm-mesh 0.27.1, Comments 0.3.0, SDK 1.32.1, Hono 4.13.0, JOSE 5.10.0, pg 8.22.0 and AWS S3 SDK 3.1095.0. Prefix with the shared Docker `flock`, use `make -f Makefile -f docs/baselines/app-cm-w0/probe.mk ... ENV=test-app-w0`, then the same locked invocation with `down`. Only the existing pinned Compose qualification service starts, without application services/ports/credentials. Initial probe failed because it passed `effectiveProfile` instead of the published API's required `profile`; the one-field correction passes, retaining missing-profile refusal. Both attempts were cleaned up.

## APP-P1 public profile and internal ports

Select exactly **artifacts_ensure, artifacts_publish, artifacts_list, artifacts_get** in discovery, HTTP mapping, MCP, executor and composition digests. Explicitly compile the published `RADAR_ARTIFACTS_PROFILE` as APP-P1's frozen bounded inline input; no implicit selection. Profile digest is `0de19f966eacb5b63142b525611a6210a0d4aaeefbdaad92dfb3b6227575b6ef`; L0 freeze SHA-256 is `4e16117a38f8ff46a80f621667d0ac4baf020f82a384050a6dc2d2ab20a61854`. Keep 1–32 files, ≤262144 decoded bytes/file and total, closed MIME/path/input rules, `inline-original` provenance and upstream key derivation. Version witness: publish A, publish B with a different key, stable B, pinned A. Unselected upload/promote/fork/access/renew/delete/restore operations refuse before storage; omitted profile refuses and empty selection exposes nothing. W2/W3 qualify HTTP/MCP/executor parity, not just metadata.

| Frozen internal port / owner | Boundary |
| --- | --- |
| Atomic publication / W1 | `createPostgresCommitExecutor`, coordinator finalization/replay, request-bound authorization/identity/quota participants and unchanged SQL assets; no second coordinator |
| Reader tickets / W1.c + W3 | Package `TicketStore.put/peek/take/remove`, `TicketService.issue/redeem` and grant signer; host session/browser binding and exact-origin validation remain app-owned. No public tool dispatcher |
| Content read / W3 | Package content handler and per-request ACL/profile checks; stable vs pinned routing, bounded grants and invalidation; separate content process 8791/local 9717 or 9727 |
| Bounded preparation cleanup / W1.d | `inspectPreparations`, `scheduleBoundedPreparationCleanup`, `PreparationCleanupHost` with durable intents/blobs/refs/deletion claims; host-maintenance authority only, never model/caller authority |
| Blob collection / W1.d | Package `createPostgresGcService.collect` and shared deletion exclusion, scoped prefix/host authorization; no public lifecycle/delete/restore selection |

**UP-T remains an upstream delivery dependency:** source and published 0.2.0 expose `TicketStore` plus `createMemoryTicketStore`, but no PostgreSQL activation/ticket adapter or associated SQL asset was found. Owner: #861 package integrator. Bounded handoff: deliver one public durable activation/ticket implementation and unchanged neutral SQL/journal identity; qualify restart, cross-process single consume, wrong binding, expiry and revocation; provide published archive/export/asset hashes and conformance receipt. W1.c composes/imports that implementation only after this receipt; it must not duplicate it locally. APP-P1's public profile is verified; UP-T readiness is not asserted. Any extra public capability or internal operation goes through upstream L8 qualification and a revised estimate before adoption.

## Payload equivalence and receiving gates

Verified now: archive SHA-512 SRI/SHA-256; all three shipped artifacts SQL assets and four L0 freeze inputs compare byte-for-byte with selected main; runtime loads use installed published files. Mesh 0.22.0→0.22.1 archive differences are only package.json and common-contract JS/source/declaration maps. Mesh source TS is not shipped, so no TS-to-built-JS byte equivalence is claimed.

W2.b/W3 must (1) extract those exact archives and list normalized path/byte hashes, including manifests/exports/types/SQL/examples; (2) clean-build the pinned workspace with frozen tools/locks and compare its shipped payload map to the published reference, explaining only approved package metadata differences; (3) strict-install the complete app workspace and reject duplicate/private peer trees, unresolved links or lock drift; (4) build/prune the API/IdP/content image from those same inputs, inspect actual exports/assets/physical dependencies and bind the image digest. Repeat on integration-base movement. Existing registry/namespace/topology/Comments suites plus installed consumer-topology remain receiving gates. No app lock, image or deployment is changed here.

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

Historical 18 October lock reading: SDK `1.32.1`, Hono `4.13.0`, JOSE `5.10.0`; standalone API JOSE `6.2.4`, cluster `0.13.0`, gateway `0.19.1`, SDK `1.30.0`. Current lock state/ownership is frozen above; W2.b owns reconciliation. W5 inspects the pruned physical dependency tree and exact image.

## T2 acceptance scope retained

- New `api/tests/api/app-mcp-registry.test.ts`: exact provider/tool names, configuration/selection compile, missing peer/duplicate-name refusal, spoofed subject/tenant/client/workspace denial, discovery/invoke parity, same HTTP/MCP service and one effect.
- Existing `api/tests/api/{mcp-resource-server,cluster-mesh-mcp-singleton,cluster-mesh-namespace-inventory,cluster-mesh-gw,cluster-mesh-gw-native,session-adoption}.test.ts`: URLs, resource reads, gateway, D1 and 28-namespace regression gates.
- Consumed-package `packages/cluster-mesh/tests/{mcp-registry,mcp-composition}.spec.ts` and standalone/packed-consumer evidence remain required.
- W1's `api/tests/api/artifacts-host-storage.test.ts`, real PostgreSQL/MinIO restart/two-process/restore checks and `make test-artifacts-integration` qualify storage separately; fixture service replies cannot substitute.
