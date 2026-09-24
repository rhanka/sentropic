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

## 4. D4 — Verified identity to workspace (schema proposal; irreversible build gate G1)

The application/control-data owner owns **`control.llm_identity_workspaces`**, implemented in the control migration stream and read through an injected `IdentityWorkspaceStore`. Gateway owns lookup semantics; cluster-mesh and h2a are consumers, not storage owners. Use the existing Postgres cluster and per-tier database, no new database service, no cross-schema foreign keys. Product membership rows remain authoritative for product users; this table binds external/service identities to validated local scopes and never grants product membership by itself.

| Proposed column/group | Format and constraint |
|---|---|
| `id`, `schema_version` | Opaque text id; version 1 with CHECK. |
| `issuer`, `subject`, `audience`, `identity_kind` | Exact verified issuer/subject/resource strings; kind `user`, `service`, or `sentropic_key`; no wildcard audience or email-derived key. A key's subject is its verified server-side credential-record id, never the raw key. |
| `tenant_id`, `workspace_id`, `principal_id` | Required opaque text soft ids; tenant/workspace existence and ownership checked by the trusted provisioning adapter. Unique identity binding `(identity_kind, issuer, subject, audience, tenant_id, workspace_id)`. |
| `owner_scope_ref`, `owner_user_id` | Explicit mesh owner scope plus existing account-store user owner for hydration; no string-cast between them. Required for own-seat eligibility; an identity without a seat mapping cannot acquire a seat. |
| `budget_strategy_id`, `agent_id`, `source` | Server-provisioned budget strategy, optional verified agent reference, constrained caller surface; never taken from provider request JSON. |
| `status`, `valid_until`, `revision`, timestamps | `active` or `revoked`; optional expiry, positive monotonic revision, created/updated timestamps. Audit provisioning/revocation with actor and reason; no credentials in the row. |

Identity verification precedes lookup. Reuse `@sentropic/oauth-verify` and the auth-hono/service-auth seams; the current auth-hono wrapper shares this verification core. Validate signature, issuer, audience, expiry, scopes and, when bound, DPoP `ath`, `jkt`, `htm`, `htu`, replay and time window. Network mode needs durable replay protection, not a per-process set. `x-api-key` accepts a verified Sentropic credential only, never an upstream provider credential. Session-token verification delegates to the existing authoritative session store.

Select exactly one active binding: trusted token/session workspace context must match a provisioned row; otherwise accept only a single unambiguous row. Multiple eligible workspaces without trusted selection are refused; a header/body `workspaceId`, `ownerScopeRef`, `tenantId`, or `agentId` cannot select or override one. Product calls resolve membership/tenant authoritatively and cross-check any external binding. Revocation/expiry is checked on each admission in v0; a DB failure is 503, not cached authorization success. Invalid identity or unavailable binding maps to the existing provider-shaped caller-auth failure (401); dependency failure remains 503.

Project the result to existing `CostContext {tenantId, workspaceId, principalId, ownerScopeRef, source, correlationId, callSite, budgetScope}` and `VerifiedRoutingSubject`; preserve existing product ownership strings such as `workspace:<workspace>:principal:<user>`. Mint request/ledger ids server-side; caller correlation/affinity is bounded metadata, never a globally trusted financial idempotency key. Carry additional principal kind/agent/strategy attribution through an additive internal admission context rather than misusing `principalId` as `user_id` for service identities.

Provisioning is an authenticated, audited admin/import operation, initially via a make-wrapped host command with a versioned JSON array matching the table fields. Validate every row before a transactional upsert; reject owner reassignment, duplicate/ambiguous bindings and cross-tenant mappings. Revocation blocks new calls immediately; operator emergency revocation also cancels active work. No admin mutation endpoint on the data-plane listener. An account owner claim remains immutable and separate from workspace authorization.

## 5. D5 — Real budget admission and HTTP 429 (port reversible; ledger changes gated by G1)

The **gateway emits** `GatewayError('over-budget', ..., retryAfterSeconds)` from a new admission stage; `router/errors.ts` produces the existing Anthropic/OpenAI 429 body plus `Retry-After`. It is a local quota refusal, distinct from the already implemented upstream-provider 429. Mesh never emits financial quota HTTP errors. Neither `control.cost_ledger` observation hooks nor cluster capacity counters are admission authorities.

The application-owned adapter implements BR-47 reserve/settle/refund against `control.budgets`, immutable `control.model_pricing`, `control.tenant_budget_strategy`, durable reservation holds and `control.blocked_attempts`, with **one financial record in the existing `control.cost_ledger`**. These additional tables/constraints and ledger extension are TARGET, not assumed present. Preserve the current ledger's `generate|stream` operation enum and historical nullable records; add principal/strategy/pricing/result/reconciliation attribution without rewriting historical cost as zero. G1 must reconcile BR-47's broader conceptual operation names with this deployed schema.

1. Verify identity, resolve its binding/strategy, validate request size/model/wire and a finite output ceiling. Anonymous mode stays off in v0; missing strategy or price refuses dispatch. BYOK exemption applies only to platform-funded caps, not configured caller/workspace limits or attribution.
2. Obtain a **side-effect-free priced liability quote** from mesh catalog/policy: all permitted fallback models, bounded attempt count, finite input/output/reasoning/image/tool allowances and credential funding classes, without acquiring any account. If existing `plan()` cannot supply a pure quote, add a mesh quote seam; do not duplicate the equivalence council in the host. Reserve the conservative total possible liability, including billable failed attempts. Pin quote/policy/pricing versions so execution cannot introduce an unreserved candidate or larger ceiling.
3. In one short Postgres transaction, lock all applicable tenant/workspace/principal/per-model funding buckets in deterministic order; require `spent + reserved + liability <= cap` for every finite cap. Missing required bucket is a configuration refusal. Atomically create a unique hold and increment all reserves, or roll back everything. Preserve explicit tenant/workspace columns and tenant-qualified uniqueness; never use an unqualified cross-tenant `scope_key`.
4. A cap rejection writes one `blocked_attempts` audit event with no cost row and no account acquisition/dispatch. Raise `over-budget` **outside the provider retry/classification loop**. Use positive integer `Retry-After = max(1, ceil(resetAt - now))` seconds from the latest relevant blocking reset/hold deadline; it is a retry hint, not a promise of funding. Pricing/store failure returns a sanitized 503, never a false 429 or free request.
5. After reservation, plan and execute through mesh. Release the hold if no attempt was dispatched. For each dispatched attempt preserve normalized usage and the quoted model's price version; absent usage must become a conservative nonzero estimate unless no billable dispatch occurred. Current `routeUsage()` returns estimated zeros when usage is missing: the production adapter must resolve that gap, not silently accept zero liability.
6. On success, error, cancellation or shutdown, settle **one aggregate request** across all attempts: debit actual/estimated micro-USD unconditionally, release the original hold, write the ledger row and settlement outbox event atomically. No cap predicate on settlement; an underestimated actual cost is still charged and prevents later admission. Keep per-attempt price/usage detail in a redacted breakdown, without opaque plan refs/account ids. Do not price mixed-provider attempts as one final model.
7. Database idempotency fences settlement by server request/hold id, not just an in-memory “settled” boolean. Gateway settlement is the only financial writer for gateway traffic; mesh `onResponse` remains telemetry-only there. Observation-only API calls retain their own sink until their explicit cutover. Refactor settlement errors out of provider-fallback catches: a DB failure after successful generation must never trigger another paid provider attempt.

Crash handling is part of admission: durable holds have a deadline, dispatch-start marker and fenced ownership. A reaper refunds only proven never-dispatched work; an expired potentially dispatched hold converts to conservative estimated spend plus a reconciliation record, rather than freeing liability and permitting overspend. Late settlement/reaper races use the same idempotency fence and auditable corrections. No DB transaction is held during streaming. If the ledger fails after bytes are sent, terminate/record the stream failure without trying to replace HTTP status with 429; leave recoverable durable liability and make readiness fail until settlement storage recovers.

Per-tenant financial strategy and funding remain BR-47 decisions. This spec does not approve new cross-principal pooling, introduce billing, or turn a flat-price seat into an unmetered bypass. Seat operational quota/cooldown and financial workspace caps are separate; metered-key fallback must reserve its own liability before dispatch.

## 6. D6 — Container and Kubernetes workload (reversible settings; delivery gate G2)

Build a dedicated `sentropic-llm-gateway` image from `apps/llm-gateway/Dockerfile` with repo-root context. Reuse `node:24-bookworm-slim`, already exercised by `LLM_MESH_NODE_IMAGE`, for build and runtime, pinning its reviewed digest in the build lot. Compile TypeScript in a multi-stage build; copy only the host bundle and required production dependencies. Runtime command is the compiled Node entry point, with Node receiving signals as PID 1. No TypeScript interpreter in production, no Python, no full `node:24-bookworm` toolchain, no provider CLI subprocesses or h2a source. A dependency requiring such a toolchain must be replaced or isolated before this image qualifies.

The image must resolve the lockfile's tested local mesh/gateway builds, contain their license/version provenance, run as non-root UID/GID 1000, and pass the repository's production dependency audit and container scan. Do not embed `.env`, kubeconfigs, keyrings, seat payloads or credentials in layers/build arguments. Base-image reuse is a starting point, not a claim that the new image has already passed scanning.

| Planned resource | Required wiring |
|---|---|
| `deploy/k8s/base/36-llm-gateway.yaml` | ConfigMap, ClusterIP Service `llm-gateway` with TCP port/targetPort 3001, Deployment `llm-gateway`; labels `app.kubernetes.io/name: sentropic`, component `llm-gateway`; added to base kustomization. |
| Deployment | One replica, `Recreate`, `enableServiceLinks: false`, `automountServiceAccountToken: false`, existing `sentropic-app` image-pull identity/`sentropic-registry`. No Secret API permissions. Service routing requires readiness. |
| Security/resources | Read-only root filesystem, drop all capabilities, `allowPrivilegeEscalation: false`, runtime-default seccomp; writable memory-backed `/tmp` only. Initial requests 100m/256Mi, limits 500m/512Mi; verify live namespace quota headroom before apply, not from old IdP comments. |
| Probes | Startup `/healthz`: 5-second period, 30 failures; liveness `/healthz`: 15-second period, 3 failures; readiness `/readyz`: 5-second period, 2 failures; HTTP timeout 2 seconds, named port `http`. Dependency outages affect readiness, not liveness. |
| Lifecycle | 40-second termination grace, D3 bounded drain. No gateway PVC; durable state resides in existing Postgres. Replicas greater than one require shared affinity/lease/refresh/DPoP state tests first; one replica still requires persistent budgets. |
| Tier overlays | Namespace-agnostic base; `overlays/preprod` stamps `sentropic-preprod`, prod stamps `sentropic`. Separate identities, keys, DB grants, seats and immutable image pins. Platform owns namespaces/quotas/baseline policies. |

Use a gateway-specific database credential with only required identity/ledger/mesh access and no DDL. The schema owner runs approved migrations before rollout. The serving process checks compatibility and fails ready if missing; it never bootstraps a schema. A failed new release rolls back to the prior compatible digest/configuration; no destructive down-migration during rollback.

Extend `deploy/k8s/base/15-networkpolicy.yaml` with gateway ingress from same-namespace `api` and explicitly approved consumer workload selectors on 3001; pairs of namespace+pod selectors belong in the **same** peer item for cross-namespace consumers. Unlabelled/foreign tenants, UI, and public Traefik receive no gateway grant by default. Add the reciprocal gateway-to-Postgres ingress allowance on 5432: egress permission alone cannot pass existing Postgres isolation. Preserve pgbackup and IdP rules.

Select gateway pods with an egress policy allowing only Postgres:5432, cluster DNS over UDP/TCP 53, verifier/JWKS reachability and enabled-provider HTTPS endpoints. Standard NetworkPolicy has no FQDN/URL matching: use approved external CIDRs or the platform's existing verified FQDN/egress-proxy capability, with DNS/TLS tests. Selecting between those mechanisms awaits operator evidence (G3); do not substitute unrestricted internet:443 or claim a URL allowlist from NetworkPolicy. Enable no new public ingress in v0; later public exposure reuses the ratified `llm.sent-tech.ca` identity and requires its own TLS/auth/rate-limit rollout.
