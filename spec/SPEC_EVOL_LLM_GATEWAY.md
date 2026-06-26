# SPEC_EVOL_LLM_GATEWAY — the sentropic llm-gateway (WP16 Layer B)

Status: proposal, 2026-06-21, architect. Double consensus Opus 4.8 + Codex 5.5 xhigh (CONVERGED). WP16 Layer B
(A = `@sentropic/llm-mesh` pure lib, contract GO; B = THIS; C = remote consumer). An authenticated, pooled,
metered LLM EGRESS server exposing provider-compatible wire. NB a prior worktree spec already designs the
pool/sticky rules: `tmp/feat-llm-mesh-account-transports/spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md` — REUSE
it (do not reinvent the sticky-binding / FOR UPDATE SKIP LOCKED / no-silent-rebind rules).

> **NAMING (owner-ratified 2026-06-21):** package = **`@sentropic/llm-gateway`**, ingress = **`llm.sent-tech.ca`**.
> Supersedes the earlier working name `mesh-gateway` / `mesh.sent-tech.ca` (never owner-ratified — was a pending
> D0). Rationale: paired with `@sentropic/llm-mesh` (Layer-A, the pure account-pool lib), a consumer experiences
> "an LLM gateway" (it sets `ANTHROPIC_BASE_URL` to it), not "a mesh" — the mesh is the internal lib. The build
> **lane** stays `claude:mesh` (agent/scope); only the published PACKAGE is `llm-gateway`. Internal abstractions
> tied to the lib (`MeshDispatchPort`, `api/.../mesh-dispatch.ts`, `chat-core/mesh-port.ts`) keep their names —
> they reference the llm-MESH layer, not the gateway's public identity.

> **GATEWAY, not proxy.** A proxy relays to an upstream without owning business logic. This server OWNS caller-auth,
> authorization (the cross-user 3-mode model below), metering/quota, policy-based account selection, server-side
> credential swap, and multi-protocol normalization (Anthropic ↔ OpenAI). The transparent `ANTHROPIC_BASE_URL`
> drop-in is only the proxy-SHAPED wire ergonomics; the substance is a gateway.

## 1. Shape
NOT chat-server, NOT the pure llm-mesh lib: the gateway OWNS caller-auth, pool state, quota reservation, account
selection, auth-swap, dispatch, settlement, observability. The split exists in code: api delegates provider/model
to llm-mesh (`provider-runtime.ts`); chat-core sees only the opaque `MeshDispatchPort` (`chat-core/mesh-port.ts`);
BR-47 defines the quota ledger. It REUSES: `@sentropic/llm-mesh` (adapters + the Layer-A account-selection
surface `AccountTransportCoordinator.acquire()` returning `AccountTransportAcquisition` + the account-transport
AuthMaterial), the BR-47 ledger (metering), `auth-hono`/`auth-client` (caller auth).

> **PUBLIC SELECTION SURFACE (FL-1(a), architect-verified):** the Layer-A selection + sticky-lease surface the
> gateway consumes is the PUBLIC `AccountTransportCoordinator.acquire()` (returning `AccountTransportAcquisition`).
> `selectAccount` is a PRIVATE method on `InMemoryAccountTransportCoordinator`, NOT an exported pure planner.
> Exposing a pure, side-effect-free planner from llm-mesh is DEFERRED to llm-mesh v0.6+; until then the gateway
> selects exclusively through `acquire()`. This spec therefore names `acquire()` everywhere (not `selectAccount`).

## 2. Request flow (`POST /v1/messages`)
caller-auth (Bearer OIDC/session OR DPoP S2S; `auth-hono service-auth-middleware` verifies iss/aud/scope/ath/jti)
→ resolve `CostContext` (tenant/workspace/principal/source/correlationId/callSite/budgetScope — from the VERIFIED
identity, NEVER the body) → parse provider/model + max-token estimate → BR-47 `budget_reservations` BEFORE
dispatch (deny-over-cap → provider-shaped quota error, no account selected) → Layer-A account selection via
`AccountTransportCoordinator.acquire()` over the gateway's eligible pool snapshot + budget signal → short
in-flight pool reservation + sticky binding → resolve
the selected pooled `AuthMaterial` via the gateway `AuthResolver` (refresh under lock if expired) → dispatch via
llm-mesh → provider-compat SSE stream back → SETTLE one `cost_event` with normalized usage (estimated if usage
missing — BR-47 never-zero).
Failures: stale base / unsupported wire version → reject BEFORE reservation; stale pool snapshot → one refresh +
re-plan; no eligible account → 503/429 + `Retry-After`; mid-stream provider failure → settle/release with
failure/estimated usage; **no retry after bytes have streamed**.

## 3. Wire contract (FROZEN v1 surface — expand only with contract tests)
`POST /v1/messages` (Anthropic Messages compat), `POST /v1/chat/completions` (OpenAI Chat Completions compat),
`GET /v1/models` (filtered by caller/pool policy), `GET /healthz`, `GET /readyz`. Auth = SENTROPIC auth (NOT
provider auth): `Authorization: Bearer <OIDC/session>` OR `DPoP <token>` + DPoP proof for S2S OR `x-api-key:
<sentropic-key>` (the Anthropic-SDK drop-in scheme — the SDK sends its key as `x-api-key`, never
`Authorization: Bearer`, so a client with `ANTHROPIC_BASE_URL=<gateway>` + the standard `ANTHROPIC_API_KEY` reaches
the gateway as `x-api-key`; the VALUE is a sentropic key, NOT a provider key — the gateway swaps in the pooled
provider credential). FAITHFUL passthrough: request/response JSON shape + SSE framing (Anthropic SSE vs OpenAI
`[DONE]`) + provider response headers (request-id/version/beta/rate-limit/retry, via an allowlist; the gateway
forwards only the allowlisted provider headers + `X-Sentropic-Request-Id` and NEVER a pool-internal header) +
provider-style error bodies. Gateway-added but INVISIBLE: caller-auth, account selection, pooled-cred
swap, metering, request ids. **TERMINATOR OWNERSHIP**: the gateway relays provider bytes VERBATIM and synthesizes
NO terminator — a real OpenAI transport emits its own `data: [DONE]`; Anthropic terminates with `message_stop`
(no `[DONE]`); on a mid-stream error NO synthetic `[DONE]` is appended (it would mask the error as a clean stop).
**NEVER expose** pooled account ids/tokens/refresh-state/pool errors NOR any pool-internal id (lease/reservation/
account id) on the wire, in logs, or in the metering record (surface only provider-shaped availability/rate-limit
errors; logs/metering carry a gateway-local OPAQUE correlation id, never a reversible fingerprint). Provider-compat
= the PRIMARY surface (Layer-C drop-in via `ANTHROPIC_BASE_URL`/OpenAI base URL); a sentropic-native API only for
admin/status/debug.

> **CALLER==PROVIDER (B1, personal-passthrough v0):** llm-mesh's `acquire()` selects over EVERY account in its
> coordinator and ignores `userId`, and its sticky lease key omits the caller. The gateway — the only layer that
> knows account OWNERSHIP — enforces caller==provider MECHANICALLY: each pool account carries an OWNER (the
> enrolling caller's verified user id, `metadata.ownerUserId`); a given caller is handed a coordinator built over
> ONLY their own accounts, and the caller identity is folded into the sticky `affinityKey`. A caller can neither
> select nor stick to another caller's account; an unowned account is never selectable (deny by default). This is a
> mechanical guarantee, not a convention — and it does NOT modify llm-mesh (published `@sentropic/llm-mesh@0.5.0`).

> **REMOTE/SENTROPIC BOUNDARY (WP16 rectification, 2026-06-24):** Sentropic owns the durable `@sentropic/llm-gateway`
> product/service contract: provider mapping, Anthropic Messages → OpenAI/Codex Responses translation, Codex OAuth
> transport, provider/account policy, fallback, quota/metering, specs, and publication. `remote` owns only launcher
> and session responsibilities: tmux/resume/single-writer UX, local start/stop/status/logs glue, environment
> injection (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`), and local session acquisition. Any `remote/apps/llm-gateway`
> mirror is a temporary, private launcher shim and must be removed or explicitly linked to the Sentropic PR once this
> branch lands.
>
> **CODEX OAUTH BACKEND CONTRACT:** Codex/ChatGPT-plan OAuth tokens (from `codex auth login`) do NOT call
> `api.openai.com/v1/chat/completions` because those tokens lack the public API `model.request` scope. The gateway's
> Codex OAuth transport targets `https://chatgpt.com/backend-api/codex/responses` (Responses API). For that transport,
> Anthropic/Claude family requests that map to Codex use `gpt-5.5` (not `gpt-5.3-spark`), system/developer
> `string | block[]` content is flattened into a single `instructions` string, `xhigh` reasoning is downgraded to
> Codex-supported `high` and documented as a provider-capability downgrade, and Codex `response.completed.response.usage`
> is preserved into stream `done.data.usage` for BR-47 settlement. This behavior is exported by `@sentropic/llm-gateway`
> so remote can consume the published package instead of carrying a provider-semantics mirror.
>
> **CLAUDE CODE OAUTH FAIL-CLOSED CONTRACT:** Claude Code OAuth access tokens (`sk-ant-oat...`) are NOT Anthropic
> API keys and MUST NOT be sent to `https://api.anthropic.com/v1/messages` as `Authorization: Bearer` or `x-api-key`.
> They are enrollment/refresh credentials only. The executable dispatch credential is a gateway-minted Anthropic API
> key produced by the verified Claude Code OAuth control-plane flow (e.g. validate/profile/create_api_key with the
> required organization scope/header, once ratified). Until the gateway has such an executable key, `claude-code-account`
> dispatch MUST fail closed. Remote may configure local Claude to use the gateway token (`gw-*`) but must not own or
> shadow this provider policy.

### 3b. Precise contract (for Layer-C/B integration tests)
- **Request**: provider-NATIVE body passed through verbatim (Anthropic Messages `{model,messages,max_tokens,
  stream?,...}`; OpenAI `{model,messages,stream?,...}`). Headers: `Authorization: Bearer <sentropic>` | `DPoP
  <token>`+proof | `x-api-key: <sentropic-key>` (Anthropic-SDK drop-in), `Content-Type: application/json`,
  provider version headers passed through. The gateway resolves provider/model from the body `model` via the
  catalog/pool. A malformed JSON body is a `400` bad-request (provider invalid-request) — NOT a 503.
- **Response (non-stream)** = provider-NATIVE JSON passed through + gateway header `X-Sentropic-Request-Id` + the
  allowlisted provider response headers (#4).
- **Response (stream/SSE)** = provider-NATIVE framing passed through VERBATIM, gateway synthesizes no terminator
  (Anthropic `event: message_start\ndata:…` → `message_stop`, NO `[DONE]`; OpenAI `data:…\n\n` → the provider's
  own `data: [DONE]`). A failure BEFORE the first byte returns a provider-shaped `503` HTTP error (never an empty
  `200` stream); after the first byte the gateway settles and does NOT retry (no synthetic terminator on error).
- **Errors** = provider-SHAPED, gateway-mapped, NEVER leak pool internals. Anthropic shape
  `{"type":"error","error":{"type","message"}}`; OpenAI `{"error":{"message","type","code"}}`. Mapping:
  401 caller-auth-fail (provider auth-error); 429 over-budget BR-47 (provider rate-limit + `Retry-After`);
  429/503 no-eligible-account (provider overloaded + `Retry-After`); 502/503 pooled-account-unavailable AFTER
  refresh-fail/exclusion (provider overloaded — NOT the pool detail); 400 bad-request/unsupported-model/malformed-JSON
  (provider invalid-request). Mid-stream provider failure: provider-native error event in the SSE, then settle.

## 4. Pool + auth-swap
Pool STATE = gateway-owned: control-plane DB for metadata/leases/reservations/quota/cooldown/audit; KMS/
envelope-encrypted secret store for refresh/access bundles. llm-mesh already separates executable
`SecretAuthMaterial` from redacted `AuthDescriptor` (hooks receive DESCRIPTORS, not secrets — `mesh.ts:131`).
Sticky binding key = `caller/workspace + affinityKey + provider + model + transport`; the prior account-transport
spec's hard constraints APPLY: short DB tx, `FOR UPDATE SKIP LOCKED`, NO lock held during streams, explicit
non-secret affinity, NO silent rebind when a leased account is exhausted (audited manual/policy rebind only).
Enrolment seam: v0 = operator/imported Codex/Claude-Code OAuth bundles (Layer-C `~/.sentropic/`); later = the
sentropic-app enrolment writes the SAME pool rows via admin UI. Refresh is GATEWAY-owned + coordinated, NEVER
delegated to llm-mesh.

## 5. Metering (BR-47, directly)
ONE pre-call reservation + ONE post-call settlement; append-only `cost_events`; mutable `budget_reservations`/
rollups only. Per-CALLER and per-ACCOUNT are SEPARATE but LINKED: the caller ledger = "who consumed / who pays"
(financial, rolled by `CostContext`); the pool-account state = "which paid account is cooling/exhausted/reauth"
(operational). **Do NOT double-write financial `cost_events`** for one call — add account-attribution fields OR a
linked pool-outcome record, but the financial spend rolls by `CostContext` only.

## 6. Deployment + relation to api/chat-server
`@sentropic/llm-gateway` = a PACKAGE (Hono router + core ports) deployed as a SEPARATE service (the security/cost
chokepoint), MOUNTABLE into the api during transition (api is already Hono-mounted, `app.ts:193`). chat-server
(chat-route/queue/SSE only, NOT `/v1/*`) CONSUMES it via an HTTP `MeshDispatchPort` adapter or SDK base-URL —
NOT in-process provider creds. api background call-sites (`callLLMStream` in tools/context-document/comments)
MIGRATE behind the same gateway client; `api/src/services/llm-runtime/mesh-dispatch.ts` becomes gateway-internal
or is deleted after the api routes through the gateway. Ingress = `llm.sent-tech.ca` or `/llm/v1` behind ARCH-17
(trusted-forwarded headers, per-caller rate-limits, DPoP for S2S pods, private DNS for internal consumers).

## 7. Owner/architect decisions
**OWNER D0 (IRREVERSIBLE / legal):**
- **Provider-ToS pooling**: cross-user pooling of paid Claude/Codex accounts may breach provider ToS →
  **explicit OWNER acceptance + a KILL SWITCH** required before any cross-user pool ships. (NEW — surfaced by
  Codex.) **Sequencing (refined w/ remote)**: ship gateway mode **PERSONAL-PASSTHROUGH first** (1 caller =
  their OWN enrolled accounts, ToS-conforming — remote's Layer-C personal pool); the CROSS-USER pool activates
  ONLY after the owner ToS-acceptance + kill-switch. The personal-passthrough path is the unblocked v0.
  **The kill switch is FAIL-CLOSED (#7):** while OFF, the gateway rejects ANY non-personal selection path — both
  a request configured for `cross-user-pool` mode AND any request carrying an authorization grant — not merely
  grant-carrying ones. With the switch ON, a cross-user selection MUST carry an authorization grant (no anonymous
  cross-user dispatch). The v0 personal-passthrough path needs no grant (caller==provider).
- **CROSS-USER AUTHORIZATION MODEL (owner-ratified 2026-06-21):** cross-user pooling IS permitted, but with
  **traceability of authorization management**. Invariant: **when a user supplies their account, they take on a
  FULL SESSION and the associated RESPONSIBILITIES** (the account-provider is accountable for what runs under
  their session — not an anonymous credit dump). Three authorization modes govern how a third party may use a
  supplied account:
  1. **direct authorization** — the provider pre-authorizes; third-party requests run without per-request gating.
  2. **explicit validation** — each (or batched) third-party request requires the provider's explicit approval
     before it runs.
  3. **assisted mode** — an ASSISTANT processes the requests submitted by a third party on the provider's behalf
     (mediated execution, provider-accountable).
  This authorization layer sits ON TOP of the pool: the lease + the Layer-A `acquire()` result
  (`AccountTransportAcquisition`) MUST carry the authorization-mode + the responsible provider-identity (the
  gateway wraps the public acquisition in its own `PoolSelection`, attaching an `AuthorizationGrant` =
  `AuthzMode` + `ProviderIdentity`), so every dispatch is traceable to a responsible provider session. Gated
  behind the kill-switch with the cross-user activation (personal-passthrough v0 is
  exempt — caller == provider).
- **Package NAME `@sentropic/llm-gateway`** — owner-ratified 2026-06-21 (supersedes `mesh-gateway`); ingress
  `llm.sent-tech.ca`. Durable published name.
- **Wire contract** (`/v1/messages` + `/v1/chat/completions` provider-compat) — IRREVERSIBLE once consumers depend.
**Architect reco-defaults (converged, renumbered contiguous):** D1 provider-compat primary (native only for
admin); D2 package + separate service, mountable in api for transition; D3 pool-state = DB (metadata/selection)
+ KMS (secrets); D4 the api mesh-dispatch routes THROUGH the gateway (stage: mount → remove direct bypasses);
D5 sticky = NO silent rebind (audited rebind only); D6 freeze only `/v1/{messages,chat/completions,models}` +
health for v1 (expand w/ contract tests).

## 8. Risks
Provider-API drift (the compat SSE is a frozen contract — Anthropic SSE vs OpenAI `[DONE]`; needs fixtures);
pooled-account limits (account cooldown/`Retry-After` must feed selection immediately; no retry post-stream);
secret custody (refresh tokens + pooled paid creds = high-value target); single chokepoint (isolate, autoscale,
fail-closed; readiness on DB+secret-store+pool); credential leakage (logs/hooks/traces = redacted descriptors
ONLY); double-metering (one financial charge); **provider TERMS** (owner acceptance + kill switch).

## 9. Review log
- 2026-06-21: framed (WP16 Layer B); double consensus Opus 4.8 + Codex 5.5 xhigh CONVERGED. Key: harden via a
  `@sentropic/llm-gateway` package+service (not a from-scratch service, not an api-module-only); REUSE the
  prior `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS` sticky/pool rules; ONE financial cost_event + pool-outcome
  record; provider-ToS pooling = an OWNER legal D0 (acceptance + kill switch). Reviews: `.tmp/mesh-gateway-{opus,codex}.md`.
- 2026-06-21: RENAMED `mesh-gateway` → **`llm-gateway`** (owner-ratified) + ingress `mesh.sent-tech.ca` →
  `llm.sent-tech.ca`; folded in the owner-ratified cross-user 3-mode authorization model (§7 D0). Build lane =
  `claude:mesh`. Pending: architect review of the renamed spec; remote notified of the package/env/ingress change.
- 2026-06-22: architect §7 corrections applied (Lot-3a freeze prep). (a) §1/§2/§7 wording: `selectAccount`
  references replaced with the real PUBLIC API `AccountTransportCoordinator.acquire()` / `AccountTransportAcquisition`
  (FL-1(a): `acquire()` is public, `selectAccount` is private; exposing a pure planner DEFERRED to llm-mesh v0.6+).
  (b) §7 reco-defaults renumbered contiguous D1..D6 (the prior list skipped D2 — was D1,D3,D4,D5,D6,D7; content
  unchanged, numbering hygiene only — architect to confirm at sign). (c) code: `authzMode`+`providerIdentity`
  carried on a gateway `PoolSelection` wrapping the PUBLIC `AccountTransportAcquisition` (not a private
  selectAccount), carried-but-NOT-enforced in v0 (personal-passthrough = caller==provider, kill-switch OFF).
  The wire is NOT frozen-final until the Lot-3 double-review (Opus 4.8max + Codex 5.5xhigh) + BR-46 contract-snapshot
  + architect sign + owner re-confirm.
- 2026-06-22: Lot-3b — DOUBLE-REVIEW (Opus 4.8max + Codex 5.5) returned FIX-FIRST; all 11 findings resolved
  gateway-side (NO llm-mesh change — `@sentropic/llm-mesh@0.5.0` published, untouched). Blockers: B1 caller==provider
  enforced mechanically (owner-scoped per-caller coordinator + owner filter + per-caller affinity key; deny-as-missing;
  unowned accounts non-selectable); B2 metering/log surface carries a gateway-local OPAQUE correlation id — no
  `leaseId`/lease/raw account id (the redacted view dropped `leaseId`); B3 terminator ownership — gateway relays
  provider bytes verbatim and synthesizes NO `[DONE]` (provider emits its own; no synthetic terminator after a
  mid-stream error). Majors: #4 provider response headers forwarded via an allowlist (+ `X-Sentropic-Request-Id`,
  pool-internal headers dropped); #5 malformed JSON → exact 400; #6 stream failure before first byte → 503 (not
  empty 200); #7 kill-switch FAIL-CLOSED (reject any non-personal path while OFF; grant required when ON); #8 authz
  shape aligned to the ratified §7 (`authzMode`+`providerIdentity`); #9 BR-46 contract-snapshot is now a real freeze
  (router-derived unknown-route guard + exact bodies/SSE bytes/error envelopes+headers); #10 `x-api-key` caller-auth
  (Anthropic-SDK drop-in). Minor: #11 `fingerprint()` removed (was dictionary-reversible) — logs use a fixed
  `[redacted]` mask + an opaque correlation id. Gate: `make typecheck-llm-gateway` clean, `make test-llm-gateway`
  65/65. #353 stays DRAFT, version unchanged (0.1.0), NOT published — awaits architect sign + owner re-confirm.
