# @sentropic/llm-gateway

An authenticated and metered LLM egress data plane. It exposes Anthropic
Messages and OpenAI Chat Completions wires, normalizes them to the canonical
`@sentropic/llm-mesh` request, and executes a bounded opaque route plan.
A consumer can point `ANTHROPIC_BASE_URL` or its OpenAI-compatible base URL at
the mounted gateway.

The gateway owns caller authentication, authorization, metering, wire
translation, retry classification, and response commitment. Mesh owns account
eligibility, credentials, routing policy, health/cooldown, model equivalence,
and affinity. Gateway sees only opaque plan/candidate references and redacted
diagnostics.
`budgetScope` is carried for attribution; quota admission remains a host/BR-47 responsibility.

## Caller authentication (0.18.0)

The root exports no optional auth implementations or peer types. Choose one mode:

- `@sentropic/llm-gateway/auth`: `ServiceAuthVerifyToken`, using canonical
  `@sentropic/mcp-auth/hono`. Install mcp-auth `^0.2.1` and its required jose `^5.10.0` peer.
  mcp-auth 0.2.0 is disqualified because it declares a local-file oauth-verify dependency.
- `@sentropic/llm-gateway/auth-hono`: `AuthHonoVerifyToken`, using session-only
  `@sentropic/auth-hono/middleware`. Install auth-hono `^0.15.0` and its declared peers.

Both bridges lazy-load only the selected mode. They accept Bearer or the SDK
`x-api-key` alias and reject ambiguous credentials. Service mode also verifies
bound DPoP proofs against the actual externally addressed URL, with a required
shared replay store. Session mode rejects DPoP and never reads cookies.

Supply registered service issuer/resource/scopes and map the verified service
client or session user through trusted directory state. Service context does not
expose per-user OBO claims; do not decode raw JWTs to invent those mappings.
Issuer and resource must be absolute HTTP(S) URLs and match their registered
values exactly. No normalization is performed: a trailing-slash issuer is accepted
only when registered with that trailing slash.

```ts
import { PersonalPassthroughCallerAuth, VerifiedCostContextResolver } from '@sentropic/llm-gateway';
import { ServiceAuthVerifyToken } from '@sentropic/llm-gateway/auth';

const callerAuth = new PersonalPassthroughCallerAuth({
  verifyToken: new ServiceAuthVerifyToken({ auth: serviceAuthOptions, resolvePrincipal }),
  costContextResolver: new VerifiedCostContextResolver(),
});
```

The production resolver requires tenantId, principalId, source and the exact
enrollment ownerScopeRef. It assigns gateway-generated request correlation and
`callSite: 'llm-gateway'`; caller headers/body cannot supply financial identity.
Do not combine it with the older `correlation` or `correlationHeader` options.
Trusted custom verifiers that omit the resolver retain their existing projection.

Verifier/store/resolver outages return sanitized provider-shaped **503** with
`caller-auth-unavailable` internally. Denials return **401** without a middleware
challenge. Deliberately deviating from RFC 6750, service insufficient_scope and
session accountPolicy **403** also map to provider-shaped **401**. Neither denial
nor outage enters account selection, dispatch or settlement.

Direct callers must now supply `CallerAuthRequestContext` to `CallerAuthPort.verify`
and `PersonalPassthroughCallerAuth.verify` (second argument), `VerifyToken.verify`
(fourth argument), and `GatewayFlowRequest.authContext`. Successful `CallerAuthResult`
must contain cost; failed results cannot. Header-only custom implementations remain
structurally assignable. Exhaustive GatewayFailureKind switches must handle the new
unavailable member. Consumer `^0.17.0` ranges must explicitly move to `^0.18.0`.
All `PersonalPassthroughCallerAuth` instances, including custom verifiers, now use
`parseCallerCredential`: Authorization together with x-api-key is rejected,
malformed Authorization never falls back to x-api-key, and tokens containing
spaces are rejected. This parsing change applies beyond the optional auth bridges.

## Provider-compatible surface

| Route | Wire |
| --- | --- | --- |
| `POST /v1/messages` | Anthropic Messages, JSON or SSE |
| `POST /v1/chat/completions` | OpenAI Chat Completions, JSON or SSE |
| `GET /v1/models` | caller/pool-filtered discovery |
| `GET /healthz` | liveness |
| `GET /readyz` | DB, secret-store, and pool readiness |

The gateway does not replace either compatible endpoint with `/v1/responses`.
Codex Responses and Cloud Code wire conversion are runtime responsibilities in
mesh. Reasoning, images, tools/results, usage, finish status, allowed provider
headers, and provider-shaped errors are preserved through the canonical form.

## Routing integration

Supply `routePlanner` and `routeMetering` to enable the mesh-owned route flow:

```ts
import { createGatewayRouter } from '@sentropic/llm-gateway';

const router = createGatewayRouter({
  config,
  routePlanner,
  routeMetering: { settleRoute: (settlement) => ledger.write(settlement) },
  publicUrl: (req) => reconstructTrustedExternalUrl(req),
  routeInput: () => ({
    affinityKey: trustedSessionAffinity,
    policyProfile: 'coding',
  }),
});
```

Only verified caller data may determine ownership. `routeInput` is a trusted
host projection for workspace, affinity, intent/profile, and policy overrides;
request bodies never supply an owner identity.
`publicUrl` defaults to the actual request URL. Behind TLS termination or path
rewrites, provide trusted reconstruction of the complete external HTTP(S) URL.
The gateway never trusts arbitrary Forwarded/X-Forwarded headers; invalid or
throwing reconstruction fails closed. Stable session affinity is separate from
unique financial request correlation.

When account ownership is stable across multiple authenticated session
principals, caller authentication may set `CostContext.ownerScopeRef`. The
gateway forwards that verified scope to mesh while preserving `principalId`
for caller identity. Existing callers that omit it retain the
`tenantId:principalId` ownership scope.

Fallback is attempted only before a response is committed. The first visible
canonical stream event and validated first encoded frame commit the route, after which an error is emitted once
in the selected provider's shape and no other provider is tried. All attempts
produce one aggregate financial settlement while retaining operational
per-attempt outcomes. A planning failure after trusted `routeInput` processing
also settles once, with zero usage and no attempts, so host request lifecycles
cannot remain open.
Empty plans also settle once with zero usage. Missing usage is estimated and
reported zeros are preserved. Settlement rejection never redispatches; durable
delivery/reconciliation remains the host sink's responsibility. HTTP cancellation
propagates to mesh and closes the iterator, including before first consumer iteration.

`RouteAttemptDispatch` is the default opaque-attempt adapter. A host may supply
`routeDispatch` only alongside routePlanner and routeMetering. The adapter preserves
the request and AbortSignal and rejects an own `auth` field; it owns no planning,
retry, credentials or settlement. Routed failures never fall back to native ports.

`personal-passthrough` remains the default mode. Cross-user pooling still
requires both `mode: 'cross-user-pool'` and the explicit
`crossUserPoolEnabled` kill switch. Never enable it without the corresponding
authorization and provider-account terms.

## Compatibility ports

- `CallerAuthPort` — verify the sentropic caller, resolve `CostContext` (spec §2).
- `PoolStatePort`, `AuthResolver`, and `GatewayDispatchPort` retain their explicitly
  selected native-flow signatures. Native refresh is gateway-owned; routed refresh is mesh-owned.

Canonical target constants and Codex helpers are direct re-exports from mesh;
gateway keeps no copied routing catalog. New integrations should use
`routePlanner` rather than the legacy pool/dispatch path.
