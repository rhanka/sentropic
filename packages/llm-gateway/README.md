# @sentropic/llm-gateway

WP16 Layer-B: an authenticated, pooled, metered LLM **egress gateway** for
Sentropic. It exposes a provider-compatible wire (Anthropic Messages + OpenAI
Chat Completions) and dispatches over the `@sentropic/llm-mesh` (Layer-A)
account pool. A consumer experiences "an LLM gateway" by pointing
`ANTHROPIC_BASE_URL` (or an OpenAI base URL) at it.

> **GATEWAY, not proxy.** It OWNS caller-auth, authorization, metering/quota,
> policy-based account selection, server-side credential swap, and multi-protocol
> normalization. Spec: `spec/SPEC_EVOL_LLM_GATEWAY.md`.

## Status — v0 scaffold (personal-passthrough)

This package is a **kickoff scaffold** (`version 0.0.0`, NOT published). The
frozen v1 wire surface (spec §3) is mounted; health endpoints are real; the
provider-compat routes are typed stubs returning provider-shaped `501`
not-implemented until the concrete flow lands.

- v0 mode = **personal-passthrough** (caller == provider, ToS-conforming).
- Cross-user pooling is gated behind a **kill switch** (`crossUserPoolEnabled`,
  **default OFF**) per spec §7 OWNER D0. The 3-mode authorization model
  (`direct` / `explicit-validation` / `assisted`) is represented as TYPES only,
  NOT enforced this lot.

## Frozen v1 surface (spec §3, D7)

| Route | Wire | v0 |
| --- | --- | --- |
| `POST /v1/messages` | Anthropic Messages | provider-shaped 501 |
| `POST /v1/chat/completions` | OpenAI Chat Completions | provider-shaped 501 |
| `GET /v1/models` | filtered by caller/pool policy | empty list |
| `GET /healthz` | liveness | real |
| `GET /readyz` | readiness (DB + secret-store + pool) | real |

## Ports (spec §1/§4/§6)

- `CallerAuthPort` — verify the sentropic caller, resolve `CostContext` (spec §2).
- `PoolStatePort` — gateway-owned pool selection + sticky lease (spec §4).
- `AuthResolver` — resolve pooled `SecretAuthMaterial`, refresh under lock (spec §4).
- `GatewayDispatchPort` — opaque llm-mesh-backed dispatch seam (spec §1/§6).

Account selection reuses Layer-A `@sentropic/llm-mesh`
(`AccountTransportCoordinator.acquire()`).

## First publish

Brand-new package — NOT published this lot. First publish requires the one-shot
bootstrap (`workflow_dispatch` on `ci.yml` with
`bootstrap_publish_target=llm-gateway`) **gated behind owner re-confirmation +
the contract double-review** (Opus 4.8max + Codex 5.5xhigh + architect sign).
