# SPEC_EVOL — LLM gateway Lot 2: verified callers, cost context, mesh dispatch

Status: IMPLEMENTED CANDIDATE, 2026-09-24 — 0.18.0 local qualification passed; published service clean-install and conductor consumer/review gates pending.

Branch: Lot C `spec/llm-gateway-lot2`, base `origin/main` `75032fc85`.

Extends:

- `spec/SPEC_EVOL_LLM_GATEWAY.md` (caller auth, financial attribution, provider wire).
- `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` (BR-73 opaque attempts, routing and refresh ownership).

## Build status — 2026-09-24

- [x] I0 workspace dependency/harness readiness; approved Makefile and root lockfile exceptions recorded in BRANCH.md before edits.
- [x] I0 registry service-only qualification: closed 2026-09-24; published mcp-auth 0.2.1 (oauth-verify `^0.1.0`, trusted-publisher provenance) passes the clean service-only fixture with required jose.
- [x] I1 request-bound contracts, publicUrl and generic 503 caller-auth-unavailable.
- [x] I2 concrete service/session auth, trusted cost projection, isolated root and published session consumer qualification.
- [ ] I2 published service consumer qualification awaits I0 registry gate.
- [x] I3 RouteAttemptDispatch adapter and routed integration without native credentials.
- [x] I4 JSON/SSE lifecycle, cancellation, settlement and both-wire integration.
- [x] I5 local documentation, typecheck/lint, 212 passing gateway tests (one pending service install), 240 auth dependency tests and 53 scoped mesh tests; packaging passed.
- [ ] I5 exact-candidate h2a entrypoint compilation/UAT, duplicate mesh E8 and independent review remain conductor gates.

Exact gateway candidate SHA-256: `18f711cbb5113a537a2b50681fb72d3cc58b3506c90cb1e9ced745009c576909`.
Tarballs and clean-consumer evidence: `tmp/llm-gateway-lot2-candidates/qualification`; tested and packaged gateway tarball bytes match.
Workspace auth tarballs are development artifacts, not published service qualification.
Implementation deviations are limited to private package helpers (`internal/caller-auth.ts`, `internal/auth-bridge.ts`, registry validation script/tests) and centralized type/auth integration tests; no added public contract beyond D7.
Strict standalone declarations use TypeScript 5.9.3 for published Hono declarations; repository compiler unchanged (BRLG2-FIXTURE).
The implementation uses the specified `publicUrl`; no `publicOrigin` contract exists in the reviewed design (BRLG2-URL).

## 1. Measured baseline and boundaries

All registry facts below were measured on **2026-09-24**. Gateway is `0.17.1`; mesh is `0.21.2`
(manifests and npm `latest`). The gateway dependency floor is currently mesh `^0.21.0`.
Local auth-hono is `0.15.2`, but npm latest is **0.15.0**; `^0.15.2` is not published.
npm latest **mcp-auth 0.2.0** declares dependency `@sentropic/oauth-verify: file:../oauth-verify`,
optional peer `hono ^4.10.7`, and required peer `jose ^5.10.0`. That manifest is disqualified.
Service mode requires **Lot F / mcp-auth 0.2.1**, replacing the dependency with `^0.1.0`, via `/hono`;
session mode alone uses published auth-hono 0.15.0 via `/middleware`.
Lot F is already in progress on `fix/mcp-auth-oauth-verify-dep` in `tmp/mcp-auth-dep-fix`:
owner **auth lane**, executor **mesh lane**; the auth owner gave GO and confirmed `^0.1.0`.
Its manifest fix and package-local regression test publish through CI at merge; this is a hard prerequisite.
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
transports are outside this lot. No quota admission hook exists. `budgetScope` is only carried;
no source path raises `over-budget`, and Lot 2 emits it nowhere. The existing error union/mapping
does not enforce a budget. Quota admission stays with BR-47 / deployable-process Lot D; settlement
hooks remain as described in D6. No new database migration.
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
`requestId()` source. Add `readonly publicUrl?: (req: Request) => string` to
`CreateGatewayRouterOptions`: call it with `c.req.raw`, defaulting to that request's URL. The host
configures the callback to reconstruct the externally addressed URL behind TLS ingress, including
any rewritten path. Validate an absolute HTTP(S) URL; a thrown callback or invalid result fails closed
as unavailable before verification/routing. Never infer trust from arbitrary `Forwarded`/`X-Forwarded-*`
values. Preserve the actual method and external path for DPoP verification through oauth-verify.
Do not verify a rewritten internal probe URL. Direct flow callers supply the same
trusted URL in `authContext`; a host using TLS termination must supply the callback at composition.
Missing context fails closed at runtime for untyped callers. Custom verifiers may ignore unused
context but must not claim DPoP support without validating method, URL, proof and token binding.

### D2 — Optional auth bridges; canonical service middleware, no new crypto

Add `src/caller-auth/service-auth.ts`, exporting `ServiceAuthVerifyToken implements VerifyToken`
only from `@sentropic/llm-gateway/auth`, using `createRequireServiceAuth` from `@sentropic/mcp-auth/hono`.
Add `src/caller-auth/auth-hono.ts`, exporting session-only `AuthHonoVerifyToken implements VerifyToken`
only from `@sentropic/llm-gateway/auth-hono`, using `createRequireAuth` from `@sentropic/auth-hono/middleware`.
Do not build on auth-hono's service compat wrapper scheduled for removal in 1.0 or private helpers.
Declare mcp-auth `^0.2.1`, jose `^5.10.0` and auth-hono `^0.15.0` as OPTIONAL gateway peers
(`peerDependenciesMeta.optional`). Selecting `/auth` requires both mcp-auth and jose;
jose remains a required peer of mcp-auth. Package-level optionality preserves root-only consumers.
Neither runtime code nor declarations at the gateway root/ports barrels may import or re-export these
bridges or optional peer types. Each subpath's declarations reference only its mode's peers. Load its
middleware with a cached async `import()` on verification; a missing peer fails closed without trying
the other mode. Root import/typecheck must work without mcp-auth, auth-hono or jose installed, matching
`spec/cluster-mesh-lazy-surface`'s optional peers, async loaders and provider-free root declarations.
Select one configured credential family per bridge instance; never try session auth after failed
service auth or guess a JWT family from unverified claims. Local h2a session verifiers can continue
to implement `CallerAuthPort` explicitly; opaque local bearers are not OAuth access tokens.

```ts
import type {
  CreateRequireServiceAuthOptions, ServiceAuthPorts,
} from '@sentropic/mcp-auth/hono'; // /auth declarations only
export type ServiceAuthCallerIdentity = {
  readonly kind: 'service'; readonly issuer: string; readonly resource: string;
  readonly clientId: string; readonly scopes: readonly string[]; readonly jkt: string | null;
};
export interface ServiceAuthVerifyTokenOptions {
  readonly auth: CreateRequireServiceAuthOptions & {
      readonly ports: ServiceAuthPorts & {
        readonly dpopReplay: NonNullable<ServiceAuthPorts['dpopReplay']> } };
  readonly resolvePrincipal: (identity: ServiceAuthCallerIdentity) =>
    Promise<VerifiedPrincipal | undefined> | VerifiedPrincipal | undefined;
}
// Separate /auth-hono declarations; never imported by /auth or the gateway root:
import type { CreateAuthMiddlewareOptions } from '@sentropic/auth-hono/middleware';
export type AuthHonoCallerIdentity = {
  readonly kind: 'session'; readonly userId: string; readonly sessionId: string;
};
export interface AuthHonoVerifyTokenOptions {
  readonly auth: CreateAuthMiddlewareOptions;
  readonly resolvePrincipal: (identity: AuthHonoCallerIdentity) =>
    Promise<VerifiedPrincipal | undefined> | VerifiedPrincipal | undefined;
}
```

Construction validates service issuer, audience/resource and a nonempty required-scope set;
the deployment supplies registered values, not values guessed from tokens. The service replay
store is mandatory and shared across replicas; an unavailable store never disables replay checks.
Issuer comparison follows `@sentropic/mcp-auth` normalization (trailing slashes stripped from the configured issuer).
The service identity emits that same normalized configured issuer for stable principal mapping.
Service middleware requires hono (already a gateway dependency), jose `^5.10.0` and mcp-auth `^0.2.1`
with its registry-resolved oauth-verify dependency; auth-hono itself needs no changes.
Session dependencies are confined to the session subpath; install/qualify that peer's declared peers.

For each verification, construct a bodyless in-process Hono request at the exact context URL and
method, run the configured middleware, then capture only its verified context in the continuation.
Use per-request storage, not a shared mutable result; no HTTP loopback call. A private catch-all
route preserves the original path and method. Register a private Hono `onError` that records an
unavailable outcome in per-request state and returns an internal 503. An unexpected verifier/store
throw (including `recordDpopJti`) reaches this handler; do not let Hono's default 500 become a 401
merely because continuation did not run. After the private request, inspect the recorded error and
response status before accepting a captured identity. A middleware 401/403 is rejection; an exception,
5xx or missing continuation without a known rejection is unavailable. Neither produces a principal.
Do not forward the internal JSON envelope, exception text or authentication challenge to the provider wire.

Service mode reads `serviceClient` (honoring `contextKey`), projects issuer/resource/clientId/scopes/jkt,
then invokes `resolvePrincipal`. It verifies signature, issuer, audience, expiry and required scopes;
bound tokens also require DPoP htm/htu/ath/iat/jti and matching cnf.jkt. The service middleware permits
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
This deliberately deviates from **RFC 6750**: service `403 insufficient_scope` (now from mcp-auth,
formerly auth-hono) and auth-hono session `403 accountPolicy` rejection map to a provider-shaped
**401**, without copying the middleware's WWW-Authenticate challenge. Preserve the existing provider
wire convention and test both 403-to-401 cases explicitly; this bridge is not an RFC 6750 challenge surface.

Add `'caller-auth-unavailable'` to public `GatewayFailureKind` and map it in `src/router/errors.ts`
to generic provider-shaped **503**: Anthropic `overloaded_error`; OpenAI `rate_limit_error` with
`code: 'overloaded'`; fixed message `service temporarily unavailable`, no exception detail.
The bridge throws `GatewayError` with that kind after an unavailable private outcome; native/routed
auth boundaries and `/v1/models` also translate unexpected verifier/resolver exceptions to this kind.
Rejections remain `'caller-auth-failed'`/401. No routing, provider-account access or settlement occurs in either
case. Cancellation stays distinct, stops processing and never initiates an attempt.

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

Production composition is `PersonalPassthroughCallerAuth({ verifyToken: new ServiceAuthVerifyToken(...),
costContextResolver: new VerifiedCostContextResolver() })`, with the verifier imported from `/auth`;
session deployments explicitly select `AuthHonoVerifyToken` from `/auth-hono`. Extract the inline projection
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
Update the `AuthResolver` comment in `src/ports/pool.ts`: gateway-owned refresh applies to the
**native path only**; BR-73 routed refresh is mesh-owned. Remove its blanket "NEVER delegated to
llm-mesh" claim without changing the interface.
Lot 2 production composition uses personal-passthrough with the cross-user switch off; this design
does not authorize activating cross-user mode, even when a host sets a boolean to true.

### D5 — Mesh-backed dispatch is an opaque-attempt adapter

Add the following exports to `ports/dispatch.ts` and `src/route-attempt-dispatch.ts` respectively.
Use `RouteAttemptDispatch*` names to avoid `@sentropic/chat-core/src/mesh-port.ts:126`'s unrelated
`MeshDispatchPort` invocation contract:

```ts
import type { GenerateResponse, PreparedRouteAttempt, StreamRequest, StreamResult }
  from '@sentropic/llm-mesh';
export interface RouteAttemptDispatchRequest {
  readonly attempt: Pick<PreparedRouteAttempt, 'generate' | 'stream'>;
  readonly request: Omit<StreamRequest, 'auth'>;
}
export interface RouteAttemptDispatchPort {
  generate(input: RouteAttemptDispatchRequest): Promise<GenerateResponse>;
  stream(input: RouteAttemptDispatchRequest): Promise<StreamResult>;
}
export class RouteAttemptDispatch implements RouteAttemptDispatchPort {
  generate(input: RouteAttemptDispatchRequest): Promise<GenerateResponse>;
  stream(input: RouteAttemptDispatchRequest): Promise<StreamResult>;
}
// Additive fields (default to one concrete RouteAttemptDispatch):
// RouteFlowDeps: readonly dispatch?: RouteAttemptDispatchPort;
// CreateGatewayRouterOptions: readonly routeDispatch?: RouteAttemptDispatchPort;
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
| `CallerAuthResult` | Boolean/optional fields become the D1 discriminated union | Breaking for widened `ok: boolean`, success without cost, failure with cost, success with reason, or interfaces extending the old interface; migrate implementations by annotating `verify` with `Promise<CallerAuthResult>` (or `as const` literals), no compatibility layer (README migration) |
| `VerifyToken.verify` | Required fourth context argument | Breaking for direct invocations; existing fixture methods ignoring extra arguments may compile unchanged |
| `GatewayFlowRequest` | Add required `authContext` | Breaking for constructed requests to runJsonFlow/runStreamFlow/prepareRouteFlow/runRouteJsonFlow/runRouteStreamFlow |
| `GatewayFailureKind` | Add `'caller-auth-unavailable'`; `router/errors.ts` maps verifier/store unavailability to provider-shaped 503 | Public union addition: breaking for exhaustive switches/records; existing variants unchanged |
| `PersonalPassthroughCallerAuthOptions` | Add optional `costContextResolver?: CostContextResolver` | Additive; conflicting correlation options fail configuration only when the resolver is selected |
| `RouteFlowDeps` | Add optional `dispatch?: RouteAttemptDispatchPort` | Additive; existing direct routed callers use the default adapter |
| `CreateGatewayRouterOptions` | Add optional `routeDispatch?: RouteAttemptDispatchPort` | Additive; createGatewayRouter signature and Hono return type unchanged |
| `CreateGatewayRouterOptions.publicUrl` | Add optional `publicUrl?: (req: Request) => string`, default request URL | Additive; trusted host callback supplies DPoP htu behind TLS ingress; invalid URL/throw fails closed |

New root exports, exactly: `CallerAuthRequestContext`, `CostContextResolver`,
`VerifiedCostContextResolver` (no-argument constructor), `RouteAttemptDispatchRequest`, `RouteAttemptDispatchPort`,
`RouteAttemptDispatch` (no-argument constructor). Keep auth implementation/dependency types out of these barrels.
New `/auth` exports, exactly: `ServiceAuthCallerIdentity`, `ServiceAuthVerifyTokenOptions`,
`ServiceAuthVerifyToken`. New `/auth-hono` exports, exactly: `AuthHonoCallerIdentity`,
`AuthHonoVerifyTokenOptions`, `AuthHonoVerifyToken`. Each verifier constructor takes its own options;
verify implements D1 and returns `Promise<VerifiedPrincipal | undefined>`. Add both subpath export maps.
cluster-mesh must mirror **both** gateway auth subpaths, preserving mode and peer isolation:
`@sentropic/llm-gateway/auth` is service mode (`ServiceAuthVerifyToken`, required mcp-auth `^0.2.1`
and jose `^5.10.0` peers); `@sentropic/llm-gateway/auth-hono` is session mode
(`AuthHonoVerifyToken`, auth-hono peer). The lazy-surface spec is amended separately to match.

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
raise the gateway's mesh floor to **^0.21.2**, the baseline being qualified. h2a's **^0.21.0** range
admits 0.21.2 and its measured lockfile already resolves it (section 3). Add OPTIONAL gateway peers
**mcp-auth ^0.2.1** and **jose ^5.10.0** (both required for service `/auth`), plus
**auth-hono ^0.15.0** (session), with qualified lockfile resolutions.
Use published public exports; do not require unpublished auth-hono 0.15.2 or bump it just to use it.
The gateway release waits until **every declared auth dependency/peer floor is visible on npm**,
including transitive oauth-verify; optional status does not waive this publish-order gate.
Lot F's mcp-auth **0.2.1** publication is mandatory even if a combined workspace install succeeds.
`wait-llm-gateway-auth-dependencies` rejects non-registry specs anywhere in that graph (section 4).
This documentation branch changes no package version.

If implementation proves a mesh source fix necessary, version **0.21.3** for an internal compatible
fix or **0.22.0** for new public functionality/authorized pre-1.0 type changes; update the gateway
floor accordingly. Unlisted mesh contract breaks require owner review, not silent expansion of D7.
Check registry latest before implementation bumps and after every rebase; advance the candidate if
any named version has since been published. Publish only through regular CD in this order:
**Lot F mcp-auth 0.2.1 → llm-mesh only if changed → llm-gateway 0.18.0**, after all dependency gates.
No branch publication, push, PR or merge is authorized here.

## 3. h2a consumer inventory and migration

Evidence is `/home/antoinefa/src/h2a` **origin/main**, fetched and inspected 2026-09-24 at
`75c1dc61e034aceeca5deb6541af2905e445d941`. The brief's import list was correct; the earlier
inventory used a stale local HEAD. Reads use the remote-tracking ref without changing h2a files:

```sh
git -C /home/antoinefa/src/h2a fetch origin -q
git -C /home/antoinefa/src/h2a grep -n "@sentropic/llm-gateway" origin/main -- packages apps
```

Actual gateway import sites, one row per site (paths relative to that h2a root):

| Import site | Imported symbols | Measured Lot 2 effect |
|---|---|---|
| `apps/llm-gateway/src/index.ts:29-34` | `createGatewayRouter`, `stubGatewayConfig`, `CallerAuthPort`, `RouteMeteringSink` | Router signature, stub spread and settlement sink unchanged. Inline `async verify(headers)` at 149-166 stays assignable: literal success includes cost, literal failure has no cost, and ignoring context is valid; typecheck-only confirmation required. `routeInput` at 174-182 already supplies `affinityKey`, independent of request correlation. |
| `packages/h2a-runtime/src/llm-gateway-runtime/index.ts:16-21` | `createGatewayRouter`, `stubGatewayConfig`, `CallerAuthPort`, `RouteMeteringSink` | Same unchanged signatures; inline `async verify(headers)` at 106-123 satisfies the discriminated union without a rewrite; typecheck-only confirmation required. `routeInput` at 133-143 already supplies `affinityKey`, so the correlation change does not affect sticky routing. |
| `apps/llm-gateway/src/session-ledger.ts:6` | `RouteRequestSettlement` | Lines 122-127 read `settlement.cost.principalId`; both settlement and cost shapes are unchanged. No ledger migration. |
| `packages/h2a-runtime/src/llm-gateway-runtime/session-ledger.ts:6` | `RouteRequestSettlement` | Lines 122-127 read `settlement.cost.principalId`; both settlement and cost shapes are unchanged. No ledger migration. |

`apps/llm-gateway/package.json:14-15` and `packages/h2a-runtime/package.json:18-19` both declare
gateway `^0.17.0` and mesh `^0.21.0`. The 0.x caret **excludes gateway 0.18.0**, requiring a manual
range bump. At measured `75c1dc61`, h2a's lockfile **already resolves mesh 0.21.2**, satisfying the
raised `^0.21.2` floor. The remaining risk is duplicate mesh resolution after gateway 0.18.0 and
cluster-mesh are installed together; `spec/cluster-mesh-lazy-surface` **E8** covers that qualification.
No consumer compilation has run on this documentation branch; these are source findings and
explicit I5 acceptance checks.

Migration sequence for the consumer owner:

1. Recheck the target h2a SHA against this origin/main inventory. This spec enumerates the
   **0.17.1 to 0.18.0** delta; both `^0.17.0` ranges require a manual bump to `^0.18.0` at cutover.
2. Integrate the exact candidate gateway tarball and its declared dependencies in an isolated h2a
   worktree. Qualify the existing mesh 0.21.2 resolution in the new dependency graph, recording
   manifest/lockfile changes; exercise lazy-surface E8 with gateway 0.18.0 and cluster-mesh together.
3. Typecheck both unchanged inline CallerAuthPort implementations against D1; update direct calls
   only if new sites need context. Preserve stable principal/enrollment owner mapping.
   Never replace an opaque `gw-*` token verifier by an
   OAuth verifier without also changing its issuer. Existing local token lifecycle stays host-owned.
4. For `/auth` service deployments, install mcp-auth `^0.2.1` and required jose `^5.10.0`;
   for `/auth-hono` session deployments, install auth-hono and its declared peers. Then
   configure issuer/resource/scopes/replay store or session ports, trusted
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
| I0 — Dependency and harness readiness | `package.json`, root `package-lock.json`; proposed reversible Makefile exception only after owner approval | Require Lot F mcp-auth 0.2.1 on npm, then qualify its `/hono` with required jose in a clean service-only Docker fixture without auth-hono. Qualify auth-hono `/middleware` and peers separately. Apply the exact target changes below before I1; workspace links cannot satisfy clean-install qualification. No compose/workflow changes required. |
| I1 — Request-bound auth contracts | `src/ports/caller-auth.ts`, `src/ports/pool.ts` (native-only AuthResolver comment), `src/personal-passthrough/caller-auth.ts`, `src/flow.ts`, `src/route-flow-core.ts`, `src/router/index.ts`, `src/router/errors.ts`, `src/stubs.ts` | Update `tests/fixtures/harness.ts`, `tests/router.test.ts`, `tests/errors.test.ts`, `tests/models.test.ts`, `tests/route-flow-core.test.ts`, `tests/route-json-flow.test.ts`, `tests/route-stream-flow.test.ts`; add `tests/caller-auth.test.ts` and `tests/lot2-types.test.ts`. Test default/custom public URL for both wires/models, trusted TLS ingress versus spoofed forwarded headers, invalid URL/callback throw; both 503 wire mappings and exhaustive failure handling. Header-only direct calls and invalid result variants fail typechecking. |
| I2 — Concrete verification and cost | New `src/caller-auth/service-auth.ts`, `src/caller-auth/auth-hono.ts`, `src/cost-context.ts`; update `src/ports/cost-context.ts`, `src/personal-passthrough/caller-auth.ts`, `src/index.ts`, `src/ports/index.ts`, `package.json` subpath exports | New `tests/service-auth.test.ts`, `tests/auth-hono.test.ts`, `tests/auth-subpaths.test.ts`, `tests/cost-context.test.ts`, `tests/fixtures/auth-hono.ts`. Real mcp-auth service and auth-hono session middleware with deterministic clock/JWKS/stores; validate the matrix below. Root runtime/declarations load without auth peers; service loads without auth-hono; session loads without mcp-auth; missing selected peer fails closed. Update `tests/caller-ownership.test.ts` for forgery and enrolled-owner matching. |
| I3 — Opaque mesh adapter | New `src/route-attempt-dispatch.ts`; update `src/ports/dispatch.ts`, `src/index.ts`, `src/route-flow-core.ts`, `src/route-json-flow.ts`, `src/route-stream-flow.ts`, `src/router/index.ts` | New `tests/route-attempt-dispatch.test.ts`; update `tests/route-json-flow.test.ts`, `tests/route-stream-flow.test.ts`, `tests/router.test.ts`. Exact attempt, signal/tools preservation, no auth injection, default adapter, no native-port calls, cancellation and one terminal outcome. |
| I4 — Lifecycle and wire integration | Same routed flow/router files; only directly required fixes in `src/canonical-ingress.ts`, `src/canonical-egress.ts`, `src/canonical-stream.ts` | Update `tests/route-flow-core.test.ts`, `tests/route-json-flow.test.ts`, `tests/route-stream-flow.test.ts`, `tests/contract-snapshot.test.ts`; new `tests/lot2-router-integration.test.ts`. Cross-wire fixtures, pre/post-commit failure, empty plan/stream, iterator cleanup, settlement rejection without redispatch, missing usage and redaction. |
| I5 — Release and consumer qualification | `package.json` at 0.18.0, root lockfile, `README.md`, final spec/branch evidence; h2a owner edits its own repository | All gateway tests/typecheck/lint/pack; auth dependency tests; mesh regressions below; exact-candidate h2a compilation/UAT for both named entrypoints. Release only after independent review, consumer evidence and O8 owner approval. |

I0's proposed Makefile exception is limited to these targets; it is **reversible by git revert**.
The implementation branch must record its approved exception with this scope, impact and rollback.
This design branch does not touch Makefile or grant that exception.

| Exact target | Planned dependency wiring / acceptance |
|---|---|
| `typecheck-llm-gateway` | Add `build-oauth-verify`, `build-mcp-auth` and `build-auth-hono` prerequisites alongside mesh; link those packages and install/link their peers in the isolated toolset. Typecheck source, tests and each subpath. |
| `build-llm-gateway` | Use the same auth prerequisites and links to emit both bridge subpaths; keep gateway root runtime/declarations independent of optional auth peers. |
| `test-llm-gateway` | Use the same auth prerequisites and links for middleware fixtures; exercise separate root-without-auth, service-only and session-only installs, so a full workspace cannot mask eager dependencies. |
| `package-llm-routing-candidates` | Include exact oauth-verify, mcp-auth and session auth-hono tarballs with gateway/mesh; print SHA-256 for all five and retain qualified peer versions/lockfile. Use the published auth floors for release qualification; local auth-hono 0.15.2 is not evidence for published 0.15.0. |
| `wait-llm-gateway-auth-dependencies` (new), `publish-llm-gateway` | Add a bounded, fail-closed registry wait and make publication depend on it alongside `wait-llm-gateway-mesh-dependency`. Traverse every declared auth dependency and peer recursively, including optional edges and oauth-verify; require registry-resolvable version/range specs and npm visibility at every floor. Reject any non-registry spec anywhere in the transitive auth graph: `file:`, `link:`, `workspace:`, git (including hosted shorthand), relative/absolute paths or direct tarball URLs. Metadata/lookup failure also closes the gate. |

Reuse existing auth build targets; preserve their cleanup and make linked packages able to resolve
their peers from their own paths. Service fixtures require hono and jose `^5.10.0` plus mcp-auth `^0.2.1`
and its transitive oauth-verify; session fixtures additionally qualify auth-hono's zod,
@hono/zod-validator and @simplewebauthn/server
peers. Selecting mcp-auth makes the **service** exception smaller: no session/WebAuthn/Zod dependency
wiring in that fixture or deployment. Full gateway build/typecheck still covers both optional subpaths.

The section 1 mcp-auth 0.2.0 manifest is unconditionally rejected; Lot F mcp-auth 0.2.1 is required
before I0 qualification. In `tests/auth-subpaths.test.ts`, install the exact gateway candidate with
published mcp-auth 0.2.1 and required jose `^5.10.0` in a clean **service-only** fixture outside the
monorepo, without auth-hono, sibling/workspace links, ambient node_modules or dependency overrides.
Resolve oauth-verify only through mcp-auth's declared registry dependency; do not preinstall it.
Assert auth-hono is absent, jose resolves at its qualified version, and `/auth` typechecks and verifies
a service token. A missing required jose must fail closed. This prevents oauth-verify supplied by
auth-hono or fixture setup from masking a broken mcp-auth manifest. Qualify session mode separately.
The registry gate must reject a non-registry edge at any depth even if an install happens to succeed;
cover mcp-auth 0.2.0 and each rejected spec family, including a deeper transitive edge.
This branch changes neither auth sources nor the selected service API.

I2 verification matrix in `tests/service-auth.test.ts` and `tests/auth-hono.test.ts`: Bearer and x-api-key, valid bound DPoP,
wrong signature/issuer/audience/expiry/scope, wrong htm/htu/ath/jkt, stale/future proof iat, missing
proof, reused jti, unbound DPoP scheme, replay-store outage, authorization/key ambiguity, and session
revocation/expiry/disabled account. Check concurrent requests cannot exchange verified identities.
Service tests distinguish `recordDpopJti` returning false (replay rejection, 401) from throwing
(store outage caught by private `onError`, 503), plus verifier/JWKS exceptions. Session tests distinguish
denied account policy (401) from throwing session/user stores (503). Test missing scope and accountPolicy
403-to-401 separately to lock the RFC 6750 deviation. Every rejection/outage asserts zero planner,
dispatch and settlement calls; `tests/router.test.ts` exercises these mappings through the public router,
including `/v1/models`, and verifies DPoP against the external HTTPS URL despite internal HTTP ingress.
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

- `packages/mcp-auth/tests/service-auth.test.ts`, `tests/hono.test.ts` (both under mcp-auth),
  and `packages/oauth-verify/tests/verify-dpop-proof.test.ts`: canonical service middleware and replay behavior.
- `packages/auth-hono/tests/service-auth-middleware.test.ts`, `tests/middleware.test.ts`,
  `tests/oauth-dpop-proof.test.ts` (all three under auth-hono): existing signature/session/replay behavior.
- `packages/llm-mesh/tests/route-planner.test.ts`, `tests/route-selection.test.ts`,
  `tests/route-health.test.ts`, `tests/routing-policy.test.ts`, `tests/service/facade.test.ts`,
  `tests/transport/codex-runtime-wire.test.ts` (all six under llm-mesh): owner binding, expiry,
  bounded policy, health, released attempts and Codex refusal semantics.

Use existing package targets, after I0 dependency wiring is approved and implemented:

```sh
make test-llm-gateway SCOPE=tests/service-auth.test.ts ENV=test-llm-gateway-lot2
make test-llm-gateway SCOPE=tests/auth-hono.test.ts ENV=test-llm-gateway-lot2
make test-llm-gateway SCOPE=tests/auth-subpaths.test.ts ENV=test-llm-gateway-lot2
make test-llm-gateway SCOPE=tests/cost-context.test.ts ENV=test-llm-gateway-lot2
make test-llm-gateway SCOPE=tests/route-attempt-dispatch.test.ts ENV=test-llm-gateway-lot2
make test-llm-gateway SCOPE=tests/lot2-router-integration.test.ts ENV=test-llm-gateway-lot2
make typecheck-llm-gateway ENV=test-llm-gateway-lot2
make lint-llm-gateway ENV=test-llm-gateway-lot2
make test-llm-gateway ENV=test-llm-gateway-lot2
make test-mcp-auth ENV=test-llm-gateway-lot2
make test-oauth-verify SCOPE=tests/verify-dpop-proof.test.ts ENV=test-llm-gateway-lot2
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
implementation worktree root; the candidate directory is bind-mounted by Docker. Pin all five
candidate tarballs and their peers from the qualified lockfile across the separate fixtures;
the service-only fixture resolves oauth-verify transitively and never installs auth-hono. No live credentials
are needed for package tests. No API/UI/browser E2E files change; the Hono integration fixture tests
HTTP/SSE in process. Consumer live UAT is the separate I5 gate from section 3, including compaction.
If later qualification starts services, allocate/check all three ports and pass them on every service
Make command with ENV last, then run make down on that same isolated project.

## 5. Open decisions, defaults and review handoff

| ID | Reversibility / owner | Decision or gate |
|---|---|---|
| O1 | Hard prerequisite / auth lane owner, mesh lane executor; implementation conductor qualifies | Lot F `fix/mcp-auth-oauth-verify-dep` must publish mcp-auth 0.2.1 with oauth-verify `^0.1.0` and its package-local regression test; auth owner GO/range confirmed. Gateway `/auth` requires mcp-auth `^0.2.1` and jose `^5.10.0`, qualified without auth-hono. Session-only `/auth-hono` uses auth-hono 0.15.0 `/middleware`. mcp-auth 0.2.0 is disqualified regardless of install outcome. |
| O2 | Reversible / deployment owner | Supply actual issuer, audience, scopes, public-URL reconstruction and shared replay-store configuration at composition. Missing configuration refuses startup; do not weaken verification to launch. |
| O3 | Reversible / deployment owner | Map service client or session user through trusted directory state; keep per-user OBO out of this lot because current service context cannot express it. |
| O4 | Reversible / gateway owner | Keep native contracts and add the opaque adapter. Reconsider removing native exports only in a separate migration brief; no implicit dual dispatch. |
| O5 | Reversible / h2a conductor | Use measured origin/main `75c1dc61`; its lockfile already resolves mesh 0.21.2. Recheck the release candidate SHA, typecheck both unchanged inline verifiers and manually bump gateway ranges. Qualify duplicate mesh resolution with gateway 0.18.0 plus cluster-mesh under lazy-surface E8. |
| O6 | Reversible scope exception / implementation owner | Approve only I0's named typecheck/build/test, candidate packaging and auth registry-wait/publication wiring; mcp-auth keeps the service fixture smaller. Roll back via git revert. This specification does not authorize Makefile edits. |
| O7 | Irreversible contract/security gate / owner | Any additional published break, new DB migration, changed wire, cross-user activation or per-user OBO claim exposure requires a new decision. Conservative default: none. Quota admission remains BR-47 / deployable-process Lot D: budgetScope is carried only, no quota hook exists, and Lot 2 emits no over-budget failure. |
| O8 | Irreversible publication gate / release owner | npm publication of gateway 0.18.0 freezes D1/D7's enumerated breaks publicly. Require Lot F mcp-auth 0.2.1 publication, a registry-only transitive auth graph and service-only clean-install qualification with required jose, then explicit owner release approval after independent review and I5 consumer evidence. Regular CD order: mcp-auth 0.2.1 → mesh only if changed → gateway 0.18.0. Reverting a Makefile commit or pinning a prior consumer version cannot undo publication. |

O8 release-owner risk: `publish-llm-gateway-token` in Makefile bypasses
`wait-llm-gateway-auth-dependencies`. That target is outside BRLG2-EX1 and remains
unchanged; the release owner must enforce the same dependency and service-only
qualification gates before token-based publication.

D1/D7's enumerated TypeScript breaks and D8's 0.x minor boundary are within the supplied brief;
no further irreversible choice is taken here. Open deployment values do not prevent this design
handoff, but their fail-closed checks are release acceptance criteria. There is no new data migration.

Author review cross-checked public exports, existing tests, auth-hono verification limitations and
both actual consumer entrypoints. No runtime test, peer consensus or h2a UAT is claimed on this branch.
The conductor's independent review should challenge DPoP URL/replay handling, service identity mapping,
no-credential mesh boundaries, callback failure isolation, stream cancellation and the exact D7 delta.
Implementation acceptance requires successful package gates and exact-candidate consumer evidence;
design acceptance does not prove those gates have run.
