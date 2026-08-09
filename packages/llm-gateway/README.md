# @sentropic/llm-gateway

An authenticated and metered LLM egress data plane. It exposes Anthropic
Messages and OpenAI Chat Completions wires, normalizes them to the canonical
`@sentropic/llm-mesh` request, and executes a bounded opaque route plan.
A consumer can point `ANTHROPIC_BASE_URL` or its OpenAI-compatible base URL at
the mounted gateway.

The gateway owns caller authentication, authorization, quota/metering, wire
translation, retry classification, and response commitment. Mesh owns account
eligibility, credentials, routing policy, health/cooldown, model equivalence,
and affinity. Gateway sees only opaque plan/candidate references and redacted
diagnostics.

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
  routeInput: ({ cost }) => ({
    affinityKey: cost.correlationId,
    policyProfile: 'coding',
  }),
});
```

Only verified caller data may determine ownership. `routeInput` is a trusted
host projection for workspace, affinity, intent/profile, and policy overrides;
request bodies never supply an owner identity.

When account ownership is stable across multiple authenticated session
principals, caller authentication may set `CostContext.ownerScopeRef`. The
gateway forwards that verified scope to mesh while preserving `principalId`
for caller identity. Existing callers that omit it retain the
`tenantId:principalId` ownership scope.

Fallback is attempted only before a response is committed. The first visible
canonical stream event commits the route, after which an error is emitted once
in the selected provider's shape and no other provider is tried. All attempts
produce one aggregate financial settlement while retaining operational
per-attempt outcomes. A planning failure after trusted `routeInput` processing
also settles once, with zero usage and no attempts, so host request lifecycles
cannot remain open.

`personal-passthrough` remains the default mode. Cross-user pooling still
requires both `mode: 'cross-user-pool'` and the explicit
`crossUserPoolEnabled` kill switch. Never enable it without the corresponding
authorization and provider-account terms.

## Compatibility ports

- `CallerAuthPort` — verify the sentropic caller, resolve `CostContext` (spec §2).
- `PoolStatePort`, `AuthResolver`, and `GatewayDispatchPort` support the legacy
  gateway flow for one compatible release.

Canonical target constants and Codex helpers are direct re-exports from mesh;
gateway keeps no copied routing catalog. New integrations should use
`routePlanner` rather than the legacy pool/dispatch path.
