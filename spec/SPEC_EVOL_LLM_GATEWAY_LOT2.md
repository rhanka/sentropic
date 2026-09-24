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
