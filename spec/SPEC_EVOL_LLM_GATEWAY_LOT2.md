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
