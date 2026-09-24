# SPEC_EVOL — LLM gateway Lot 2: verified callers, cost context, mesh dispatch

Status: PROPOSED DESIGN, 2026-09-23 — planning only; conductor independent review pending.

Branch: Lot C `spec/llm-gateway-lot2`, base `origin/main` `75032fc85`.

Extends:

- `spec/SPEC_EVOL_LLM_GATEWAY.md` (caller auth, financial attribution, provider wire).
- `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` (BR-73 opaque attempts, routing and refresh ownership).

## 1. Measured baseline and boundaries

The gateway is `0.17.1`; mesh is `0.21.2` (manifests and npm `latest`, checked 2026-09-23).
The gateway dependency floor is currently mesh `^0.21.0`; auth-hono is present at `0.15.2`.
The three `src/ports/{caller-auth,cost-context,dispatch}.ts` comments still describe v0 seams.
The actual baseline already contains `PersonalPassthroughCallerAuth`, `PassthroughDispatch`,
`runRouteJsonFlow` and `runRouteStreamFlow`; this is completion and composition, not a new gateway.
`VerifyToken.verify(token, scheme, headers)` lacks the HTTP method/URL needed for DPoP.
`CallerAuthResult` permits `ok: true` without cost. Cost attribution is currently built inline.
The native dispatch port carries `SecretAuthMaterial`; BR-73 attempts already execute without it.
`AuthResolver.resolve(PoolSelection)` resolves provider secrets, not caller tokens or billing identity.

BR-73 supersedes the older gateway-owned refresh/pool architecture for routed execution.
Lot 2 must not feed a routed attempt through `AuthResolver`, reselect accounts or copy route policy.
DB/KMS provisioning, BR-47 reservation storage, cross-user activation, new endpoints and provider
transports are outside this lot. Existing quota/settlement hooks remain; no new database migration.
Native transport exports remain supported as explicitly selected APIs; a failed mesh route never
falls back to them. Removing those published exports is a separate owner decision.

## 2. Numbered decisions

### D1 — Request-bound caller authentication (authorized breaking change)

Keep headers as the first argument and require a second argument on both verifier seams:

```ts
export interface CallerAuthRequestContext {
  readonly method: string;
  readonly url: string; // Absolute externally addressed URL, reconstructed by trusted ingress.
  readonly requestId: string; // Gateway-generated; never taken from identity/body headers.
  readonly signal?: AbortSignal;
}
export interface CallerAuthPort {
  verify(headers: Readonly<Record<string, string>>, context: CallerAuthRequestContext):
    Promise<CallerAuthResult>;
}
export type CallerAuthResult =
  | { readonly ok: true; readonly cost: CostContext; readonly reason?: never }
  | { readonly ok: false; readonly cost?: never; readonly reason?: string };
export interface VerifyToken {
  verify(token: string, scheme: CallerAuthScheme,
    headers: Readonly<Record<string, string>>, context: CallerAuthRequestContext):
    Promise<VerifiedPrincipal | undefined> | VerifiedPrincipal | undefined;
}
```

`GatewayFlowRequest` gains required `authContext: CallerAuthRequestContext`; both flow families and
`GET /v1/models` pass it. `createGatewayRouter` derives it from the actual request and its existing
`requestId()` source. The trusted host must reconstruct the public URL before mounting the router;
never trust arbitrary `Forwarded`/`X-Forwarded-*` values. Preserve method/path for DPoP; let auth-hono's
shared verifier apply RFC URL normalization. Do not verify a rewritten internal probe URL.
Missing context fails closed at runtime for untyped callers. Custom verifiers may ignore unused
context but must not claim DPoP support without validating method, URL, proof and token binding.

### D2 — Concrete auth-hono bridge; no new crypto implementation

Add `src/caller-auth/auth-hono.ts`, exporting `AuthHonoVerifyToken implements VerifyToken`.
It imports the existing public `createRequireServiceAuth` and `createRequireAuth` factories.
The former is an auth-hono compatibility wrapper over `@sentropic/oauth-verify`; the canonical
resource-server middleware now lives in mcp-auth. Do not deep-import private verification helpers.
Select one configured credential family per bridge instance; never try session auth after failed
service auth or guess a JWT family from unverified claims. Local h2a session verifiers can continue
to implement `CallerAuthPort` explicitly; opaque local bearers are not OAuth access tokens.

```ts
import type {
  CreateRequireServiceAuthOptions, CreateAuthMiddlewareOptions, ServiceAuthPorts,
} from '@sentropic/auth-hono';
export type AuthHonoCallerIdentity =
  | { readonly kind: 'service'; readonly issuer: string; readonly resource: string;
      readonly clientId: string; readonly scopes: readonly string[]; readonly jkt: string | null }
  | { readonly kind: 'session'; readonly userId: string; readonly sessionId: string };
export type AuthHonoVerifyTokenOptions = (
  | { readonly kind: 'service'; readonly auth: CreateRequireServiceAuthOptions & {
      readonly ports: ServiceAuthPorts & {
        readonly dpopReplay: NonNullable<ServiceAuthPorts['dpopReplay']> } } }
  | { readonly kind: 'session'; readonly auth: CreateAuthMiddlewareOptions }
) & {
  readonly resolvePrincipal: (identity: AuthHonoCallerIdentity) =>
    Promise<VerifiedPrincipal | undefined> | VerifiedPrincipal | undefined;
};
```

Construction validates service issuer, audience/resource and a nonempty required-scope set;
the deployment supplies registered values, not values guessed from tokens. The service replay
store is mandatory and shared across replicas; an unavailable store never disables replay checks.
The gateway dependency becomes `@sentropic/auth-hono: ^0.15.2`; auth-hono itself needs no changes.

For each verification, construct a bodyless in-process Hono request at the exact context URL and
method, run the configured middleware, then capture only its verified context in the continuation.
Use per-request storage, not a shared mutable result; no HTTP loopback call. A private catch-all
route preserves the original path and method. Middleware denial or absence of continuation cannot
produce a principal. Do not forward its internal JSON error envelope to the provider wire.

Service mode reads `serviceClient` (honoring `contextKey`), projects issuer/resource/clientId/scopes/jkt,
then invokes `resolvePrincipal`. It verifies signature, issuer, audience, expiry and required scopes;
bound tokens also require DPoP htm/htu/ath/iat/jti and matching cnf.jkt. Auth-hono currently permits
the DPoP scheme with an unbound token: the bridge additionally requires a non-null verified jkt for
that scheme. A replay failure or key mismatch returns failure before any route/account operation.
Service context exposes clientId, not full subject/tenant/OBO claims. Map an allowlisted
`(issuer, resource, clientId)` to its service principal and owner using trusted host data. This mode
authorizes that service identity only; per-user OBO attribution requires a separately reviewed
claims API and is not inferred by decoding the raw JWT after middleware verification.

Session mode uses `createRequireAuth`: signed session verification, token-hash lookup, matching
user/session, expiry/revocation, user existence and account policy all precede projection of
`userId`/`sessionId`. Do not pass `AuthHonoAuthContext.token` to the principal mapper. Session mode
rejects DPoP rather than pretending a session bearer is proof-bound.

Both modes accept a Sentropic token via Bearer or the Anthropic SDK's `x-api-key` alias. The bridge
normalizes the latter to Bearer on its private request. It does not accept provider keys or invent
an API-key database. Reject simultaneous authorization and x-api-key, malformed authorization,
and empty credentials; never downgrade from an invalid Authorization header to another scheme.
Header lookup is case-insensitive. Strip cookies from the private request: gateway authentication
is explicit-token only. Auth denial, missing scope, disabled session and missing principal mapping
use the existing provider-shaped 401; diagnostics retain a sanitized internal category only.
Verifier/store exceptions fail closed as generic provider-shaped 503, without routing or settlement;
they are not bad-credential verdicts. Cancellation stops processing and never initiates an attempt.

### D3 — A trusted, reusable cost-context resolver

Add `src/cost-context.ts`; keep the published `CostContext` and `VerifiedPrincipal` field shapes.
The bridge principal mapper resolves tenant, stable principal, enrollment owner, workspace membership,
source and budget scope from trusted configuration/directory state. No identity or billing field is
copied from the provider body, raw JWT payload, arbitrary tenant headers or account credentials.

```ts
export interface CostContextResolver {
  resolve(principal: VerifiedPrincipal, context: CallerAuthRequestContext):
    Promise<CostContext | undefined> | CostContext | undefined;
}
export class VerifiedCostContextResolver implements CostContextResolver {
  resolve(principal: VerifiedPrincipal, context: CallerAuthRequestContext): CostContext | undefined;
}
// Additive field on PersonalPassthroughCallerAuthOptions:
// readonly costContextResolver?: CostContextResolver;
```

`VerifiedCostContextResolver` requires nonempty tenantId/principalId/source/ownerScopeRef and a
nonempty gateway requestId. It preserves trusted optional workspaceId/budgetScope, sets
`correlationId = context.requestId` and `callSite = 'llm-gateway'`, and returns a fresh readonly value.
An unmapped owner or invalid principal returns undefined: auth fails before model discovery/planning.
The canonical owner must match enrollment's ownerScopeRef exactly; never synthesize a new owner
format during deployment. Existing optional owner fields remain optional for custom consumers;
the production bridge plus this resolver always supplies them, avoiding the tenant:principal fallback.

Production composition is `PersonalPassthroughCallerAuth({ verifyToken: new AuthHonoVerifyToken(...),
costContextResolver: new VerifiedCostContextResolver() })`. Extract the current inline projection
into a private helper for callers that omit the new option: existing `correlation`, `correlationHeader`
and trusted custom-verifier behavior remain. That helper is not a fallback after resolver denial.
With an explicit resolver, it alone controls correlation; reject configuration also supplying the
two old correlation options. Never use caller correlation as a financial idempotency key.
Stable session affinity is separate: hosts supply it through the existing trusted `routeInput`
projection. Production request correlation is unique; one session may make many charged requests.

### D4 — Two credential boundaries, one owner authority

Caller tokens authenticate a Sentropic principal; provider material authenticates upstream execution.
`AuthResolver`, `PoolStatePort`, `PoolSelection` and `PassthroughAuthResolver` keep their current
native-path types. Routed production uses mesh `RoutePlanner.prepareAttempt` exclusively; mesh owns
refresh, leases and provider material. Caller auth must never depend on `AuthResolver.resolve`, and
cost resolution must never see a provider token. No cross-user grant is added by a principal mapper.
Lot 2 production composition uses personal-passthrough with the cross-user switch off; this design
does not authorize activating cross-user mode, even when a host sets a boolean to true.

### D5 — Mesh-backed dispatch is an opaque-attempt adapter

Add the following exports to `ports/dispatch.ts` and `src/mesh-dispatch.ts` respectively:

```ts
import type { GenerateResponse, PreparedRouteAttempt, StreamRequest, StreamResult }
  from '@sentropic/llm-mesh';
export interface MeshDispatchRequest {
  readonly attempt: Pick<PreparedRouteAttempt, 'generate' | 'stream'>;
  readonly request: Omit<StreamRequest, 'auth'>;
}
export interface MeshDispatchPort {
  generate(input: MeshDispatchRequest): Promise<GenerateResponse>;
  stream(input: MeshDispatchRequest): Promise<StreamResult>;
}
export class MeshDispatch implements MeshDispatchPort {
  generate(input: MeshDispatchRequest): Promise<GenerateResponse>;
  stream(input: MeshDispatchRequest): Promise<StreamResult>;
}
// Additive fields (default to one concrete MeshDispatch):
// RouteFlowDeps: readonly dispatch?: MeshDispatchPort;
// CreateGatewayRouterOptions: readonly routeDispatch?: MeshDispatchPort;
```

`generate`/`stream` delegate to the exact prepared attempt, preserving canonical messages, tool
definitions/results, images, reasoning, generation controls, metadata and AbortSignal. Reject an
own `auth` property at runtime too; no cast can turn this API into credential injection. Mesh applies
the planned provider/model/effort; untrusted payload fields cannot choose an account or override
authentication. Normalization remains `normalizeGatewayIngress`; response conversion remains
`encodeGatewayResponse`/`encodeGatewayStream`. Unsupported lossy conversion fails before commitment.

Route flows call this adapter instead of calling attempt.generate/stream directly. It never plans,
retries, resolves credentials, records outcomes or settles money. The flow owns those lifecycle
calls, preventing double completion. Preserve thrown typed status/code/retryAfterMs/usage internally
for existing classification; sanitize at the wire boundary, never expose arbitrary exception text.

`GatewayDispatchPort`, `GatewayDispatchRequest`, `GatewayDispatchResponse`, `GatewayDispatchStream`,
`GatewayDispatchStreamEvent`, `ProviderResponseHeaders`, `ProviderTransport`, `ProviderTransportRequest`,
`PassthroughDispatch` and `PassthroughDispatchOptions` are unchanged. They describe native JSON/SSE
and cannot truthfully represent mesh's normalized events. In particular, no synchronous-to-Promise
change is imposed on native `dispatchStream`. Update its stale Lot 2 comment to point to this separate
opaque seam. These are explicit contracts for different inputs, not automatic fallback paths.
No new mesh API is needed: use the published `PreparedRouteAttempt.generate/stream`, not BR-73's
earlier illustrative `execute` method, which does not exist in the current TypeScript interface.

### D6 — Commitment, cancellation and metering remain flow-owned

Authenticate once, resolve cost once, normalize, plan once, then prepare exact candidates from that
bounded plan. The native `config.pool`, `config.authResolver`, and `config.dispatch` are never touched
when routePlanner/routeMetering select routed execution. Missing one of those two routed dependencies
is a configuration error when routeDispatch is supplied; it must not silently select native execution.
No account rotation beyond mesh policy, no recursive plan and no retry after downstream commitment.

Before commitment, skip non-visible status events, retain safe metadata and wait for a valid event.
Empty streams, early terminal errors and cancellation fail before returning a 200 stream. Validate
the first encoded frame before marking commitment; no fallback after markCommitted or HTTP output.
Keep status/header/body commitment coupled. Provider 400/401/429 classification and Retry-After follow
the `0.17.1` terminal mappings, including the Codex refusal fix at the base commit.

Native SSE is relayed byte-for-byte with no added terminator. Routed SSE is encoded from mesh events:
one Anthropic message_stop or OpenAI [DONE] on successful completion, neither after error/cancellation.
Preserve tools, block order and reasoning signatures. Preserve BR-74 nonzero bounded Anthropic
message_start input estimation; final message_delta contains output usage only. Billing uses actual
provider usage, not that wire estimate. Headers remain restricted to the router's existing allowlist.
For routed streams retain pre-commit status `data.metadata.responseHeaders` string values when present;
absence is valid and must not lead to invented upstream headers. Late metadata cannot mutate sent headers.

Propagate abort to every attempt; close iterators on early failure, HTTP disconnect and consumer return,
including cancellation before first iteration. The Hono ReadableStream needs an explicit cancel path;
do not rely only on a finally block inside an unstarted generator. Cancellation never falls back.
Each prepared attempt has one terminal outcome/release, even when next/return/abort race.
Record operational outcomes per attempt and invoke `RouteMeteringSink.settleRoute` once per request
after authentication/planning admission; failures before any provider call may have zero usage and
an empty attempts list. Requests rejected by auth have no financial event. Aggregate attempted
provider usage across retries, using bounded request/output estimates when usage is missing and a
provider call may have consumed tokens; preserve genuine reported zeros. Empty candidate plans settle
once with failed/zero usage. Keep callback exceptions outside provider retry handling: a settlement
failure cannot trigger another dispatch or second settlement. Durable sink delivery/reconciliation is
the host's existing responsibility; this lot does not promise exactly-once database delivery.

### D7 — Exact public type delta and compatibility classification

This table is exhaustive for existing public declarations changed by Lot 2. No export is removed.

| Declaration | Exact delta from 0.17.1 | Compatibility |
|---|---|---|
| `CallerAuthPort.verify` and `PersonalPassthroughCallerAuth.verify` | Required second `CallerAuthRequestContext` argument | Breaking for call sites that pass only headers; implementations accepting fewer args can remain structurally assignable |
| `CallerAuthResult` | Boolean/optional fields become the D1 discriminated union | Breaking for widened `ok: boolean`, success without cost, failure with cost, success with reason, or interfaces extending the old interface |
| `VerifyToken.verify` | Required fourth context argument | Breaking for direct invocations; existing fixture methods ignoring extra arguments may compile unchanged |
| `GatewayFlowRequest` | Add required `authContext` | Breaking for constructed requests to runJsonFlow/runStreamFlow/prepareRouteFlow/runRouteJsonFlow/runRouteStreamFlow |
| `PersonalPassthroughCallerAuthOptions` | Add optional `costContextResolver?: CostContextResolver` | Additive; conflicting correlation options fail configuration only when the resolver is selected |
| `RouteFlowDeps` | Add optional `dispatch?: MeshDispatchPort` | Additive; existing direct routed callers use the default adapter |
| `CreateGatewayRouterOptions` | Add optional `routeDispatch?: MeshDispatchPort` | Additive; createGatewayRouter signature and Hono return type unchanged |

New root exports, exactly: `CallerAuthRequestContext`, `AuthHonoCallerIdentity`,
`AuthHonoVerifyTokenOptions`, `AuthHonoVerifyToken` (constructor takes those options; verify implements
the D1 signature and returns Promise<VerifiedPrincipal | undefined>), `CostContextResolver`,
`VerifiedCostContextResolver` (no-argument constructor), `MeshDispatchRequest`, `MeshDispatchPort`,
`MeshDispatch` (no-argument constructor). Export through the existing root/ports barrels; no subpath.

Unchanged field shapes/signatures: `CostContext`, `VerifiedPrincipal`, `CallerAuthScheme`,
`CorrelationSource`, `GatewayConfig`, `AuthResolver`, pool/authz types, all native dispatch types,
`RouteMeteringSink`, `RouteRequestSettlement`, `RouteAttemptSettlement`, `SettleUsage`, `MeteringSink`,
`stubGatewayConfig` and the target/Codex re-exports. Settlement types reference the unchanged CostContext.
`routingSubjectForCost` retains its current fallback for trusted custom consumers; the production
resolver supplies an explicit enrollment owner. Changes to validation, auth failure handling and
the production resolver's correlation policy are runtime changes even where TypeScript still compiles.

### D8 — Release boundary

Publish the implementation as gateway **0.18.0**, the next 0.x minor after 0.17.1. The explicit
pre-1.0 source breaks above must not ship as 0.17.2. Keep mesh source unchanged at **0.21.2** and
raise the gateway's mesh floor to **^0.21.2**, the baseline being qualified. Add auth-hono **^0.15.2**
and the corresponding lockfile resolution; consume its public exports and existing peer requirements.
Do not bump auth-hono just to use it. This documentation branch changes no package version.

If implementation proves a mesh source fix necessary, version **0.21.3** for an internal compatible
fix or **0.22.0** for new public functionality/authorized pre-1.0 type changes; update the gateway
floor accordingly. Unlisted mesh contract breaks require owner review, not silent expansion of D7.
Check registry latest before implementation bumps and after every rebase; advance the candidate if
any named version has since been published. Publish only through regular CD, mesh first if changed,
then gateway after dependency visibility. No branch publication, push, PR or merge is authorized here.

## 3. h2a consumer inventory and migration

Evidence is the read-only checkout `/home/antoinefa/src/h2a`, HEAD `0d6b2eaf`, inspected 2026-09-23.
Both `apps/llm-gateway/src/index.ts` and
`packages/h2a-runtime/src/llm-gateway-runtime/index.ts` currently import local `handleMessages` and
`acquireSession`; neither imports any of the five gateway symbols named in the brief. A source search
under both apps/packages trees finds no occurrences of those five symbols. Both package manifests
declare gateway `^0.10.0`. Do not present a newer consumer as measured on this checkout.

Actual gateway import sites (paths relative to that h2a root):

| Import site | Imported symbol | Lot 2 effect |
|---|---|---|
| `apps/llm-gateway/src/proxy-openai.ts:19` | `CODEX_RESPONSES_URL` | No type change |
| `packages/h2a-runtime/src/llm-gateway-runtime/proxy-openai.ts:19` | `CODEX_RESPONSES_URL` | No type change |
| `apps/llm-gateway/src/model-catalog.ts:1` | `describeCanonicalTargetRoutes` | No type change |
| `packages/h2a-runtime/src/llm-gateway-runtime/model-catalog.ts:1` | `describeCanonicalTargetRoutes` | No type change |
| `apps/llm-gateway/src/model-catalog.test.ts:2` | `describeCanonicalTargetRoutes` | No type change |
| `packages/h2a/test/runtime-status-contract.test.js:4` | `describeCanonicalTargetRoutes` | No type change |

Expected newer integration named by the brief, to recheck at **each** of
`apps/llm-gateway/src/index.ts` and `packages/h2a-runtime/src/llm-gateway-runtime/index.ts` before release:

| Consumer import | Exact impact if present at either site |
|---|---|
| `createGatewayRouter` | Import/call signature preserved; router supplies auth context automatically; optional routeDispatch needs no consumer change |
| `stubGatewayConfig` | Export and GatewayConfig shape preserved; spreading it remains valid; it supplies no real authentication or metering |
| `CallerAuthPort` | Update header-only verify invocations to pass context; annotate result or return literal discriminants; custom implementations ignoring context can still compile |
| `RouteMeteringSink` | Signature unchanged; keep one aggregate settleRoute, no per-attempt financial write |
| `RouteRequestSettlement` | All fields unchanged; production resolver supplies request correlation and stable enrollment owner, so recheck ledger/affinity assumptions |

Migration sequence for the consumer owner:

1. Record the actual target h2a SHA and re-run the import inventory. The observed `^0.10.0` ranges
   cannot receive 0.18.0 automatically. Qualify prior BR-73 migrations separately; this spec is an
   exhaustive **0.17.1 to 0.18.0** delta, not proof of a safe direct 0.10 upgrade.
2. Integrate the exact candidate gateway tarball and its declared dependencies in an isolated h2a
   worktree. Change the two package manifests/lockfile to the reviewed 0.18.x release only at cutover.
3. Update custom CallerAuthPort/VerifyToken implementations and all direct calls per D1; preserve
   stable principal/enrollment owner mapping. Never replace an opaque `gw-*` token verifier by an
   OAuth verifier without also changing its issuer. Existing local token lifecycle stays host-owned.
4. For auth-hono deployments, configure issuer/resource/scopes/replay store or session ports, trusted
   principal mapping and VerifiedCostContextResolver. Supply stable affinity separately via routeInput.
   Wire routePlanner and routeMetering together, plus a real readiness probe. The routed path does
   not invoke native stubs even if config was assembled from stubGatewayConfig.
5. Verify both ingress wires, SDK x-api-key/Bearer, DPoP replay, models ownership, revocation, JSON/SSE,
   cancellation, bounded fallback, Codex refusal classes and Anthropic compaction continuation. Assert
   one aggregate settlement and no secrets. Record candidate SHA, tarball hashes and test evidence.
6. Consumer owner signs off before implementation merge. Roll back by pinning the prior gateway and
   consumer code together; no data/credential re-enrollment migration is introduced by Lot 2. No h2a
   file is modified by this specification branch.

## 4. Ordered implementation lots and file-level verification

These are future implementation tasks, not changes authorized on this two-file design branch.
Paths below are relative to `packages/llm-gateway/` unless explicitly qualified. Each lot may use
several atomic commits under approximately 150 lines; none is separately published before final gates.

| Lot | Implementation files | Tests and acceptance |
|---|---|---|
| I0 — Dependency and harness readiness | `package.json`, root `package-lock.json`; proposed Makefile exception only after owner approval | Confirm auth-hono public exports and peers load in the gateway's isolated Docker toolset. Existing Make recipes only install mesh/Hono; add dependency build/link/install wiring through an approved exception before I1. No compose/workflow changes required by this design. |
| I1 — Request-bound auth contracts | `src/ports/caller-auth.ts`, `src/personal-passthrough/caller-auth.ts`, `src/flow.ts`, `src/route-flow-core.ts`, `src/router/index.ts`, `src/stubs.ts` | Update `tests/fixtures/harness.ts`, `tests/router.test.ts`, `tests/models.test.ts`, `tests/route-flow-core.test.ts`, `tests/route-json-flow.test.ts`, `tests/route-stream-flow.test.ts`; add `tests/caller-auth.test.ts` and `tests/lot2-types.test.ts`. Both wires and models receive the actual method/URL/id; header-only direct calls and invalid result variants fail typechecking. |
| I2 — Concrete verification and cost | New `src/caller-auth/auth-hono.ts`, new `src/cost-context.ts`; update `src/ports/cost-context.ts`, `src/personal-passthrough/caller-auth.ts`, `src/index.ts`, `src/ports/index.ts` | New `tests/auth-hono.test.ts`, `tests/cost-context.test.ts`, `tests/fixtures/auth-hono.ts`. Real in-process auth-hono with deterministic clock/JWKS/session stores, not a fake success verifier; validate the matrix below. Update `tests/caller-ownership.test.ts` for body/header forgery and stable enrolled-owner matching. |
| I3 — Opaque mesh adapter | New `src/mesh-dispatch.ts`; update `src/ports/dispatch.ts`, `src/index.ts`, `src/route-flow-core.ts`, `src/route-json-flow.ts`, `src/route-stream-flow.ts`, `src/router/index.ts` | New `tests/mesh-dispatch.test.ts`; update `tests/route-json-flow.test.ts`, `tests/route-stream-flow.test.ts`, `tests/router.test.ts`. Exact attempt, signal/tools preservation, no auth injection, default adapter, no native-port calls, cancellation and one terminal outcome. |
| I4 — Lifecycle and wire integration | Same routed flow/router files; only directly required fixes in `src/canonical-ingress.ts`, `src/canonical-egress.ts`, `src/canonical-stream.ts` | Update `tests/route-flow-core.test.ts`, `tests/route-json-flow.test.ts`, `tests/route-stream-flow.test.ts`, `tests/contract-snapshot.test.ts`; new `tests/lot2-router-integration.test.ts`. Cross-wire fixtures, pre/post-commit failure, empty plan/stream, iterator cleanup, settlement rejection without redispatch, missing usage and redaction. |
| I5 — Release and consumer qualification | `package.json` at 0.18.0, root lockfile, `README.md`, final spec/branch evidence; h2a owner edits its own repository | All gateway tests/typecheck/lint/pack; auth-hono reference tests; mesh regressions below; exact-candidate h2a compilation/UAT for both named entrypoints. Release only after independent review and consumer evidence. |

I2 verification matrix in `tests/auth-hono.test.ts`: Bearer and x-api-key, valid bound DPoP,
wrong signature/issuer/audience/expiry/scope, wrong htm/htu/ath/jkt, stale/future proof iat, missing
proof, reused jti, unbound DPoP scheme, replay-store outage, authorization/key ambiguity, and session
revocation/expiry/disabled account. Check concurrent requests cannot exchange verified identities.
`tests/cost-context.test.ts` covers missing/empty trusted fields, explicit owner mapping, optional
workspace/budget projection, spoofed body/header fields, request correlation versus stable affinity,
resolver denial/exception, and rejection of conflicting correlation configuration.

I4 retains the complete existing gateway regression file set, without rewriting unrelated tests:
`tests/canonical-ingress.test.ts`, `tests/canonical-egress.test.ts`, `tests/canonical-stream.test.ts`,
`tests/caller-ownership.test.ts`, `tests/codex.test.ts`, `tests/contract-snapshot.test.ts`,
`tests/errors.test.ts`, `tests/models.test.ts`, `tests/passthrough.test.ts`, `tests/redaction.test.ts`,
`tests/route-flow-core.test.ts`, `tests/route-json-flow.test.ts`, `tests/route-stream-flow.test.ts`,
`tests/router.test.ts`, `tests/sticky.test.ts`, `tests/target.test.ts`.
Keep native fixtures `tests/fixtures/{anthropic,openai,transport}.ts` intact unless an assertion
requires adaptation; these prove unchanged passthrough bytes/headers and terminator ownership.

Dependency regression files (no source changes planned):

- `packages/auth-hono/tests/service-auth-middleware.test.ts`, `tests/middleware.test.ts`,
  `tests/oauth-dpop-proof.test.ts` (all three under auth-hono): existing signature/session/replay behavior.
- `packages/llm-mesh/tests/route-planner.test.ts`, `tests/route-selection.test.ts`,
  `tests/route-health.test.ts`, `tests/routing-policy.test.ts`, `tests/service/facade.test.ts`,
  `tests/transport/codex-runtime-wire.test.ts` (all six under llm-mesh): owner binding, expiry,
  bounded policy, health, released attempts and Codex refusal semantics.

Use existing package targets, after I0 dependency wiring is approved and implemented:

```sh
make test-llm-gateway SCOPE=tests/auth-hono.test.ts ENV=test-llm-gateway-lot2
make test-llm-gateway SCOPE=tests/cost-context.test.ts ENV=test-llm-gateway-lot2
make test-llm-gateway SCOPE=tests/mesh-dispatch.test.ts ENV=test-llm-gateway-lot2
make test-llm-gateway SCOPE=tests/lot2-router-integration.test.ts ENV=test-llm-gateway-lot2
make typecheck-llm-gateway ENV=test-llm-gateway-lot2
make lint-llm-gateway ENV=test-llm-gateway-lot2
make test-llm-gateway ENV=test-llm-gateway-lot2
make test-auth-hono ENV=test-llm-gateway-lot2
make test-llm-mesh SCOPE=tests/route-planner.test.ts ENV=test-llm-gateway-lot2
make test-llm-mesh SCOPE=tests/route-selection.test.ts ENV=test-llm-gateway-lot2
make test-llm-mesh SCOPE=tests/route-health.test.ts ENV=test-llm-gateway-lot2
make test-llm-mesh SCOPE=tests/routing-policy.test.ts ENV=test-llm-gateway-lot2
make test-llm-mesh SCOPE=tests/service/facade.test.ts ENV=test-llm-gateway-lot2
make test-llm-mesh SCOPE=tests/transport/codex-runtime-wire.test.ts ENV=test-llm-gateway-lot2
make pack-llm-gateway ENV=test-llm-gateway-lot2
make package-llm-routing-candidates LLM_ROUTING_PACK_DIR="$PWD/tmp/llm-gateway-lot2-candidates" ENV=test-llm-gateway-lot2
```

These commands are the implementation plan, **not executed design-branch checks**. Run from the
implementation worktree root; the candidate directory is bind-mounted by Docker. Pin candidate
auth-hono dependencies from the lockfile as well as the gateway/mesh tarballs. No live credentials
are needed for package tests. No API/UI/browser E2E files change; the Hono integration fixture tests
HTTP/SSE in process. Consumer live UAT is the separate I5 gate from section 3, including compaction.
If later qualification starts services, allocate/check all three ports and pass them on every service
Make command with ENV last, then run make down on that same isolated project.

## 5. Open decisions, defaults and review handoff

| ID | Reversibility / owner | Decision or gate |
|---|---|---|
| O1 | Reversible / implementation conductor | Use auth-hono's published wrapper now. Its future removal at auth-hono 1.0 requires a deliberate adapter migration, not a private import today. |
| O2 | Reversible / deployment owner | Supply actual issuer, audience, scopes, public-URL reconstruction and shared replay-store configuration at composition. Missing configuration refuses startup; do not weaken verification to launch. |
| O3 | Reversible / deployment owner | Map service client or session user through trusted directory state; keep per-user OBO out of this lot because current service context cannot express it. |
| O4 | Reversible / gateway owner | Keep native contracts and add the opaque adapter. Reconsider removing native exports only in a separate migration brief; no implicit dual dispatch. |
| O5 | Reversible / h2a conductor | Re-inventory the actual consumer candidate; the supplied checkout and described five-import integration differ. Qualify both entrypoints at the target SHA. |
| O6 | Irreversible scope gate / implementation owner | I0 Makefile changes require a separately approved exception before implementation. This specification records the dependency gap and does not authorize touching infrastructure. |
| O7 | Irreversible contract/security gate / owner | Any additional published break, new DB migration, changed wire, cross-user activation or per-user OBO claim exposure requires a new decision. Conservative default: none. |

D1/D7's enumerated TypeScript breaks and D8's 0.x minor boundary are within the supplied brief;
no further irreversible choice is taken here. Open deployment values do not prevent this design
handoff, but their fail-closed checks are release acceptance criteria. There is no new data migration.

Author review cross-checked public exports, existing tests, auth-hono verification limitations and
both actual consumer entrypoints. No runtime test, peer consensus or h2a UAT is claimed on this branch.
The conductor's independent review should challenge DPoP URL/replay handling, service identity mapping,
no-credential mesh boundaries, callback failure isolation, stream cancellation and the exact D7 delta.
Implementation acceptance requires successful package gates and exact-candidate consumer evidence;
design acceptance does not prove those gates have run.
