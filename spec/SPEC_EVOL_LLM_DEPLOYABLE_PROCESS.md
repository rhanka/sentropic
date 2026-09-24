# SPEC_EVOL — Deployable LLM process

Status: proposed build specification, 2026-09-23. Lot D is **design only**; no implementation, migration, infrastructure exception, or release is authorized by this document. Reversible defaults are selected below; irreversible build gates remain explicitly pending conductor/owner ratification. Independent review belongs to the conductor; no consensus is claimed here.

Branch: `spec/llm-deployable-process`; inspected base: `75032fc85c6c341a3d2d69611decd2695ed4154e`.

## 0. Authority, evidence, and the gap

Extends [gateway](SPEC_EVOL_LLM_GATEWAY.md), [routing](SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md), [quota ledger](SPEC_EVOL_QUOTA_LEDGER.md), [metering](SPEC_EVOL_LLM_METERING_OBSERVABILITY.md), and [cluster composition](SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md). Routing BR-73 supersedes older gateway wording on selection/refresh ownership. Cluster D1/D14 require autonomous providers and optional composition. Neither changes gateway financial admission or the frozen provider wire.

Seat dependency: the in-progress [seat-custody design](../../seat-custody/spec/SPEC_EVOL_LLM_SEAT_CUSTODY.md), read at `/home/antoinefa/src/sentropic/tmp/seat-custody/spec/SPEC_EVOL_LLM_SEAT_CUSTODY.md` (accepted design v1, 2026-09-21). This sibling-worktree reference must be replaced with its merged spec revision before build.

The conductor item supplied in the brief, `env_mesh_scond_validation_20260912a` (2026-09-12), states: “Neither package has a `bin`; no `deploy/k8s/base` manifest deploys a gateway; we need an entry point + image + Deployment/Service/NetworkPolicy.” It also identifies zero `over-budget` emitters and a missing generic identity-to-workspace table. **SOURCE-GAP:** exact-id/wording searches, including ignored/hidden text artifacts, found no original record in the four supplied `.tmp`, `spec`, `plan`, and h2a `scratchpad` roots. This quotation is attributed to the brief, not to a recovered artifact.

| CURRENT evidence at the inspected base | Consequence |
|---|---|
| `packages/llm-mesh/package.json` 0.21.2 and `packages/llm-gateway/package.json` 0.17.1 export libraries and have no `bin`; their `src/index.ts` barrels contain no listener. | Add a composition root, not another model runtime. |
| `createGatewayRouter` accepts `routePlanner`, `routeMetering`, `routeInput`, `readiness`; missing flow dependencies return 501, missing readiness returns 200. `stubGatewayConfig` is explicitly non-production. | Production boot must require real ports and readiness. |
| `api/src/routes/namespaces/gw.ts` already mounts the router with a real application route plane, but spreads `stubGatewayConfig`, supplies `settleRoute() {}`, and omits readiness. `llm-mesh.ts` already supplies an application namespace wrapper. | Older “no app consumer” study statements are historical; a mounted namespace is still not a standalone deployable process. |
| `api/drizzle/control/0005_clumsy_spacker_dave.sql`, `api/src/db/control-schema.ts`, and `llm-metering/cost-ledger-sink.ts` implement `control.cost_ledger`, unique call idempotency, and observe-only writes with null cost. | Reuse this ledger; no claim that all persistence is absent. Existing fail-open observation is insufficient for admission. |
| Gateway source contains `over-budget` only in `router/errors.ts` (type/mapping); no production emitter. No budget/pricing/reservation tables occur in control migrations/schema. | Mapping tests alone cannot prove quota enforcement. |
| `deploy/k8s/base/kustomization.yaml` includes API, IdP, UI, Postgres, network rules, and pgbackup; no gateway resource. | Add explicit service/image/secret/network delivery. |
| h2a `apps/llm-gateway/src/index.ts` starts Hono on port 3001; exposes health, session creation/listing, accounts, models, and Anthropic messages. | It is a consumer-specific host, not the generic upstream process contract. |

CURRENT denotes inspected code; TARGET below denotes planned work. New symbols, files, make targets, tables, and manifests are design locators, not existing capabilities.

## 1. D1 — Host and package ownership (reversible)

Choose a thin private `apps/llm-gateway` Node application, built to `apps/llm-gateway/dist/index.js`. Its source entry is `src/index.ts`; `src/app.ts` constructs the host without listening on import. Neither library acquires a `bin` in v0. This follows the repository's standalone `apps/auth-idp` composition precedent while allowing a dedicated, smaller image; an npm CLI would unnecessarily freeze installation/configuration contracts now.

| Owner | Responsibility |
|---|---|
| `@sentropic/llm-mesh` | Catalog, equivalence, account eligibility, ownership, enrollment, refresh policy, sticky leases, opaque route planning/execution; no dependency on cluster-mesh or the product HTTP process. |
| `@sentropic/llm-gateway` | Provider wire, verified subject projection, budget admission port, bounded execution, response commitment, cancellation, one aggregate settlement, redacted errors. No credentials or raw account ids in gateway flow. |
| Thin host and injected application adapters | Listener, configuration, caller verifier, identity lookup, Postgres ledger adapter, mesh persistence/keyring binding, hydration and lifecycle. Application/control-schema owners retain storage and migrations. |
| `@sentropic/cluster-mesh` | Optional composition and neutral admission/lifecycle under D14; never LLM policy, provider secrets, or financial ledger authority. |
| h2a | CLI/session UX, launch/stop/logs, child environment/base URL, enrollment commands, stable affinity and consumer UAT. |

Move generic listener/configuration/probes/shutdown and production port assembly upstream. Consume the published mesh/gateway routing and codec behavior rather than copying h2a proxy/account modules. h2a's session creation/listing and account diagnostics stay in its authenticated consumer/control adapter until the gateway bearer lifecycle is integrated; they are not added to frozen `/v1/*`. Gateway remains the authority for mint/expiry/revocation of any delegated gateway bearer; h2a only requests and relays it. The h2a file's comment that NetworkPolicy protects an HTTP endpoint is insufficient: policies filter connections/ports, not URL paths.

Extract only the necessary storage bindings from `api/src/services/llm-runtime/gateway-route-plane.ts`, account transport, auth, and metering modules into injectable host ports. The standalone graph must not import `api/src/app.ts`, namespace cutover globals, queue workers, or `cluster-mesh-adapter`. Do not copy the product wrapper's internal caller-header map into a network authentication protocol.

## 2. D2 — Autonomous and composed routes (existing authority; reversible binding)

| Binding | Exact paths | Authority |
|---|---|---|
| Standalone gateway Service | `/v1/messages`, `/v1/chat/completions`, `/v1/models`, `/healthz`, `/readyz` | Existing gateway factory, real host ports; optional public host remains `llm.sent-tech.ca`. |
| Product namespace `/gw` | `/api/v1/gw/v1/messages`, `/api/v1/gw/v1/chat/completions`, `/api/v1/gw/v1/models`, `/api/v1/gw/healthz`, `/api/v1/gw/readyz` | `productGwModule` composes the same factory and ports under the existing prefix. No extra `/gw` inside the router. |
| Product namespace `/llm-mesh` | Existing catalog/settings/provider-enrollment routes from `llm-mesh-router.ts` and its cutover map | Mesh domain/application adapter; admin authorization; separate from provider-compatible inference. |

Initial standalone deployment adds no public ingress and does not remount administrative enrollment on the data-plane listener. Direct autonomous mounting must work without cluster-mesh; the product wrapper retains its own author fence. Disabling cluster composition must not disable an independently hosted gateway. Kubernetes namespace names (`sentropic`, `sentropic-preprod`) are unrelated to these HTTP namespaces.

The factory supports both hosts, but a tenant's production inference must have **one active path**. Any subsequent product cutover to the Service is a separate D11 lot: compare read-only intent, switch once, prove rollback, delete the replaced in-process dispatch. Never mirror inference for shadow comparison or let both paths debit. Existing public paths are preserved; a future HTTP forwarding adapter must preserve DPoP's externally signed URL and use a verified delegation contract, not forwarded identity headers.

## 3. D3 — Boot, readiness, and shutdown (reversible)

Production configuration is validated once: `NODE_ENV=production`, `PORT=3001`, `HOST=0.0.0.0`, database/issuer/audience/scope configuration, identity store, pricing strategy, mesh account store, and runtime secret-key delivery. Non-secret policy is versioned configuration; secrets are references/files or explicit secret-backed variables. Startup rejects unknown mode, empty key, ambiguous identity configuration, missing required adapter, or stub/noop production wiring. Cross-user pool remains disabled for this own-seat rollout.

Construct the mesh route planner over owner-scoped durable storage, then `createGatewayRouter` with real `callerAuth`, `routePlanner`, `routeMetering`, admission and readiness. `GatewayConfig` still contains legacy pool/auth/dispatch fields: the build must either supply concrete compatible ports or add a typed routed-host configuration that excludes unused ports. Spreading `stubGatewayConfig` is not an acceptable production completion criterion. No local-file/in-memory fallback when Postgres is unavailable; no migrations from the serving process.

| Probe/lifecycle | Required behavior |
|---|---|
| `GET /healthz` | 200 while the listener/event loop is alive; no remote dependency call or credential details. |
| `GET /readyz` | 200 only after configuration, expected schema version, database query, identity/verifier readiness, runtime decryption self-check, ledger/pricing, and mesh inventory initialization succeed; otherwise 503. Probe must be explicitly injected. |
| Dependency degradation | Bound checks to 2 seconds, cache readiness for at most 5 seconds; request admission still validates dependencies. Unknown signing key with unavailable JWKS fails closed; a still-valid cached key may verify. No live generation or token refresh in probes. |
| Pool readiness | Initial inventory must expose at least one executable configured route. Afterwards, individual tenant exhaustion/expiry remains a request-level refusal; do not drain all tenants for one caller's cap. Global absence of executable routes makes readiness 503. |
| Shutdown | SIGTERM marks not-ready immediately, stops new admission, drains active streams up to 25 seconds, aborts remaining provider work, persists settlement/reconciliation, then closes HTTP/DB. Pod grace period 40 seconds. |

Expose only coarse probe responses; detailed failure reasons go to restricted, redacted telemetry. Log request/correlation references and outcome, never prompts, authorization headers, seat ids, refresh material or reversible account fingerprints. Export request refusals, estimated settlements, pending reconciliation, seat degradation, metered-fallback count, and drain failures through the existing telemetry sink; building alert delivery is a required dependency, not an assumed installed stack.
