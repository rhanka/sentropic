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
`budgetScope` is carried for attribution; quota pricing and storage remain a host/BR-47
responsibility behind the opt-in budget admission port (see Budget admission).

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
Issuer comparison follows `@sentropic/mcp-auth` normalization (trailing slashes stripped from the configured issuer).
The service identity emits that same normalized configured issuer for stable principal mapping.

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

Migration: `CallerAuthPort` implementations must return literal or annotated
discriminated results; a verifier declared outside a contextually typed position
infers `ok: boolean` and no longer type-checks (no compatibility shape is accepted):

```ts
import { stubGatewayConfig } from '@sentropic/llm-gateway';
import type { CostContext } from '@sentropic/llm-gateway';

// Host-owned mapping from verified headers to a cost context.
declare function resolveCost(headers: Readonly<Record<string, string>>): CostContext | undefined;

// Before (0.17.x): a standalone object is not contextually typed, so `ok` is
// inferred as boolean; passing `config` to createGatewayRouter fails in 0.18.0.
const config = {
  ...stubGatewayConfig,
  callerAuth: {
    async verify(headers: Readonly<Record<string, string>>) {
      const cost = resolveCost(headers);
      return cost ? { ok: true, cost } : { ok: false, reason: 'verified caller unavailable' };
    },
  },
};
```

```ts
import { stubGatewayConfig } from '@sentropic/llm-gateway';
import type { CallerAuthResult, CostContext } from '@sentropic/llm-gateway';

declare function resolveCost(headers: Readonly<Record<string, string>>): CostContext | undefined;

// After: annotate the result (or use `ok: true as const` / `ok: false as const`).
const config = {
  ...stubGatewayConfig,
  callerAuth: {
    async verify(headers: Readonly<Record<string, string>>): Promise<CallerAuthResult> {
      const cost = resolveCost(headers);
      return cost ? { ok: true, cost } : { ok: false, reason: 'verified caller unavailable' };
    },
  },
};
```

The same verifier written inline inside `createGatewayRouter({ config: { ... } })`
is contextually typed and compiles without the annotation.

## Provider-compatible surface

| Route | Wire |
| --- | --- | --- |
| `POST /v1/messages` | Anthropic Messages, JSON or SSE |
| `POST /v1/messages/count_tokens` | Native Anthropic token estimate, JSON only |
| `POST /v1/chat/completions` | OpenAI Chat Completions, JSON or SSE |
| `GET /v1/models` | caller/pool-filtered discovery |
| `GET /healthz` | liveness |
| `GET /readyz` | DB, secret-store, and pool readiness |

The gateway does not replace either compatible endpoint with `/v1/responses`.
Codex Responses and Cloud Code wire conversion are runtime responsibilities in
mesh. Reasoning, images, tools/results, usage, finish status, allowed provider
headers, and provider-shaped errors are preserved through the canonical form.

## Native Anthropic relay (unreleased 0.20.0)

The package implements native selection, relay, counting and usage contracts.
API transport/pricing wiring and live qualification remain later integration
gates. The compiled native model allowlist is currently empty; trusted test hosts
can supply validated exact Anthropic model IDs. An enabled switch alone does not
make an unqualified model eligible or supply a missing native port.

For routed Messages, own top-level `safeguards` (including null) requires native
execution. `anthropic-beta` presence, including an empty value, selects optional
native; version-only requests remain canonical. Selection runs once after caller
authentication and before quote/admission. A trusted `nativeMessagesEnabled:
false` returns safeguards 400 before model lookup; optional traffic stays
canonical. With native available, the prepared exact model and supported version
must match. Optional fallback is allowed only before invocation. Required native
without a port, supported capability or valid ceiling returns 400; standalone
routers also refuse safeguards instead of silently discarding it. OpenAI ingress
with safeguards returns an OpenAI-shaped 400 naming the Messages endpoint.

Native Messages shallow-copies the body and preserves unknown fields and nested
references. Only selected `model`, boolean `stream` and validated/admitted
`max_tokens` are set; malformed supplied ceilings are rejected. Auth, ownership,
partition and upstream URL come from trusted ports, never opaque body fields.

Caller request headers forward only non-credential, non-hop-by-hop `anthropic-*`,
`x-app` and `x-stainless-*`. Drop caller user-agent, sessions, internal
`X-Sentropic-*` and Connection-nominated headers. Hosts recompute transport
headers and attach server credentials last. Native success extends canonical
safe response headers with `anthropic-*`, including owner-accepted disclosure of
`anthropic-organization-id` (R-Q3). Errors never copy upstream headers.

Successful native JSON preserves provider fields; SSE preserves bytes, comments,
unknown events and line endings, with bounded 1 MiB frames and no synthetic stop.
Success sets `X-Sentropic-Relay: native` and the server request ID. Messages JSON
sets `X-Sentropic-Served` only from a safe response model identifying one served
model without fallback/substantive iterations; never substitute the selected
model. Native SSE and count omit that header. Canonical served headers are
unchanged. Native validation 400s retain recognized type/message within a 64 KiB
error-body bound after control stripping and a 4096-byte UTF-8 message cap.
Billing-state text is masked; only the sent classifier-beta refusal receives the
narrow safeguards rewrite. Other errors retain fixed sanitized envelopes.

Count requires `nativeMessagesEnabled: true`, an authenticated/partition-checked
caller and `nativeCountTokens` port. OFF returns 400; ON uses native even without
beta/safeguards, with exact model/version eligibility and no generation ceiling.
It shallow-copies every field unchanged, adds neither `stream` nor `max_tokens`,
and makes one JSON call without retry. The shared process limiter uses verified
(tenant, principal): burst 10, refill 1/second, two concurrent calls, ten-minute
idle eviction excluding live calls, and 10,000 keys. Excess returns 429 with
integer Retry-After; a full map refuses a new key with 503. Cancellation does not
refund a dispatched token. Count creates no hold, financial settlement, usage
observation or debit; `input_tokens` estimates prospective input.

All three POST paths share a 32,000,000-byte ingress cap and one default
32,000,000-byte process body pool, including native OFF. Check actual N+q against
the cap, grant q bytes, then allocate exact chunk storage. Content-Length never
sizes allocations/reservations or establishes N; EOF decodes/parses once without
a Request clone or duplicate raw consolidation. Concurrent small bodies reserve
their actual bytes, with no semaphore or waiting queue. Unavailable capacity
returns pre-parse 503 `request-body-capacity`, `Retry-After: 1`,
`x-should-retry: true`; actual oversize takes precedence as terminal 413 with
`x-should-retry: false`. Anthropic uses `request_too_large`; OpenAI uses
`invalid_request_error` / `request_too_large`. Numeric messages distinguish exact
bytes, received lower bounds and unknown upstream rejecting limits.

Lease shrink follows detached references. Native hosts must finish/cancel upload
and drop body/serialized holders before returning commit-ready SSE or completed
JSON/count; gateway drops its own cache/body/retry holders before releasing N.
Open native responses can then admit more small bodies. Canonical SDK operations
and streams retain N through retries and terminal cleanup. Every post-acquisition
refusal, abort, error and unconsumed-stream cleanup releases once, independently
of observation hooks. Byte accounting and the assumed 8x representation allowance
are not a measured process-memory guarantee; host memory qualification is pending.

Usage counts physical U+R+aggregate writes once. Policy
`anthropic-cache-2026-10-02` uses full-rate uncached input, reads 0.1x for Sonnet 5/
Opus 5 or 0.025x for Fable 5.1, and writes 1.25x/2x for five-minute/one-hour TTLs.
Start-anchored cumulative deltas inherit absent/null categories and unchanged
splits. Only aggregate growth gets inferred five-minute pricing when eligible,
otherwise the 2x bound with separate inference evidence. Decreases, conflicts or
malformed input permanently revoke proof. Missing/null/[] iterations are absent;
fallback, mismatch or substantive/malformed iterations latch uncertainty and
disable discounts. Clean measured completion has no output allowance floor;
interrupted streams with usable same-model input proof floor output only.
No-proof usage floors both sides; unknown initial write splits use the sourced
2x bound conservatively. Observations stay physical/pre-floor. Pinned selected
prices and opaque feature/fallback costs retain uncertainty until integration and
qualification prove them; caller fields never supply pricing authority.

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

## Budget admission (0.19.0)

Budget admission is opt-in. Without `budget`, the routed flow is unchanged: no
quote is computed and plans are not pinned. With it, the host injects a
`BudgetAdmissionPort` (`admit`, `markDispatched`, `release`) and settles
through the existing `routeMetering.settleRoute`:

```ts
const router = createGatewayRouter({
  config, routePlanner, routeMetering,
  budget: { port: budgetAdmission, defaultOutputTokens: 4096 },
});
```

- The planner must implement `quote()` (mesh `^0.22.0`); otherwise router
  construction throws `BudgetConfigurationError` (`budget-quote-required`).
  A decorator that copies planner methods must keep `quote`.
- Order: caller auth → ingress → finite ceiling → in-process quote → `admit` →
  `plan({ quote })` → attempts → one settlement. The quote is never read from the
  request body or headers.
- A request without a finite output ceiling (and no `defaultOutputTokens`) or a
  quote `invalid-ceiling` returns 400. An empty quote reserves nothing and fails
  like an empty route (503). When `defaultOutputTokens` applies, it is also sent
  to the provider as the request `maxOutputTokens`.
- The ceiling input side is an estimate (bytes / 4 plus
  `BUDGET_ATTACHMENT_INPUT_TOKENS` per image/file/tool media, counted as
  `imageUnits`), not an upper bound: the adapter applies its own input margin.
  For `outputCeilingEnforced: false` (codex) candidates the adapter prices the
  reservation at the model's maximum output.
- `admit` prices every quoted candidate at its maximum liability over effort
  variants (candidate identity carries no effort) and reserves
  `maxAttempts × max(candidate liability)`. `over-budget` returns the frozen 429
  body with `Retry-After = min(60, max(1, ceil((resetAtMs - nowMs) / 1000)))`.
  `unavailable`, a rejection or a malformed decision returns the sanitized 503.
  Refusals happen before any account acquisition or emitted byte and never settle
  (the OFF path settles a zero-usage failure when planning fails).
- Each provider call is preceded by `markDispatched(holdRef, attemptIndex)`;
  if it fails the provider is never called and the request returns 503. A
  rejected marker may still be written: `release` must be idempotent and must
  not free a hold whose durable marker exists.
- Every hold carries a deadline and expires. A failed `release` is ignored (the
  hold expires); after a settlement sink failure the adapter reconciles the
  hold by `requestId` through the durable dispatch marker.
- Settlement stays one aggregate per request and gains `requestId`, `holdRef`,
  `quoteRef`. When nothing was dispatched, `release(holdRef)` runs first and the
  settlement has zero usage. A dispatched attempt without measured usage
  (missing, empty `{}`, partial, non-finite or zero counts) is charged at least
  its quoted allowance. Attempts whose reported usage exceeds
  the allowance (for example codex, `outputCeilingEnforced: false`) are charged
  in full and listed in `overrun`; the host records the audit entry.

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
