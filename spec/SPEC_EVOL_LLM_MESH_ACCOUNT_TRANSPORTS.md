# SPEC EVOL - LLM Mesh Account Transports

Status: Draft, planned by BR-44.

Related specs: `SPEC_EVOL_LLM_MESH.md`, `SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`.

## Objective

Expose product-account subscriptions as `@sentropic/llm-mesh` account
transports with multi-account enrollment, inter-session balancing,
intra-session affinity, token refresh, quota state, and DB-backed coordination.

The immediate BR-44 delivery target is executable Claude Code account transport
for Anthropic/Claude. The same pattern must remain extensible to Codex/OpenAI,
Agy or Gemini Code Assist/Gemini, and Mistral Vibe/Mistral without changing the
coordinator contract.

## Baseline

The current app supports one Codex account as an OpenAI transport, but it is
app-local and singleton: `provider-connections.ts` stores one Codex state in
`settings`, `codex-provider-auth.ts` owns enrollment, `openai-provider.ts`
injects the Codex fetch path, and `provider-credentials.ts` resolves API-key
strings only. `teamclaude` proves multi-account Claude/Codex behavior, but uses
a local JSON config plus in-memory quota state, not a multi-instance DB model.

Claude Code documentation and `teamclaude` both separate Console API keys from
Claude subscription OAuth. `ANTHROPIC_API_KEY` is an API-billing credential sent
as `X-Api-Key`; Claude Pro/Max/Team/Enterprise subscription usage is OAuth
material sent as `Authorization: Bearer`. For BR-44, Claude Code therefore uses
Anthropic Messages API wire format with OAuth bearer material. It is not a
browser or `claude.ai` UI mimic.

## Account Transport Family Matrix

| Target provider | API-key credential path | Account transport id | Product account source | Expected wire path | Status |
|---|---|---|---|---|---|
| `openai` | OpenAI API key | `codex` | ChatGPT/Codex account OAuth | ChatGPT Codex backend via OpenAI-compatible runtime adapter | Executable in BR-44 Codex slice |
| `anthropic` | Anthropic Console API key | `claude-code` | Claude Code OAuth from Claude Pro/Max/Team/Enterprise | Anthropic Messages API (`/v1/messages`) with `Authorization: Bearer` | Mandatory BR-44 delivery |
| Explicit `gemini` or `gcp` binding | AI Studio API key or Vertex ADC | `gemini-code-assist` | Agy/Gemini Code Assist Google account OAuth | To be proven; must be a machine HTTP endpoint, not UI automation | Planned extension |
| `mistral` | Mistral API key | `mistral-vibe` | Mistral Vibe account OAuth/session material | To be proven; must be a machine HTTP endpoint, not UI automation | Planned extension |

The target provider is the model family that owns catalog entries and capability
metadata. The account transport id is the product-account enrollment/runtime
mechanism used to acquire executable request credentials for that provider.

## Decisions

D1. Product accounts are transports, not providers.

- `codex` targets provider `openai`.
- `claude-code` targets provider `anthropic`.
- `gemini-code-assist` is the canonical planned transport for Agy/Gemini Code
  Assist style Google product accounts. Its target provider is `gemini` when the
  wire endpoint is Gemini API compatible, or `gcp` when the proven wire endpoint
  is Vertex/GCP based. The catalog key must make that target explicit. If both
  endpoints are supported later, they are separate provider bindings and lease
  domains keyed by `(targetProviderId, transportProviderId)`; no runtime policy
  may acquire an ambiguous `gemini|gcp` binding.
- `mistral-vibe` is the canonical planned transport for Mistral product-account
  usage targeting provider `mistral`.
- Provider/model catalog entries remain provider-native.

D2. `llm-mesh` stays DB-agnostic but persistent-runtime-ready.

- No Postgres, Drizzle, or Sentropic settings dependency in package core.
- The package owns coordinator types, routing policy types, family capability
  descriptors, and in-memory tests.
- Sentropic API owns Postgres, encryption, migrations, UI, and admin policy.

D3. Use one atomic coordinator port.

Separate account, lease, and quota stores cannot guarantee atomic selection.
The package exposes `AccountTransportCoordinator.acquire(input)`, returning an
`AccountTransportAcquisition` with redacted descriptor, executable material,
lease metadata, runtime affinity metadata, and `recordOutcome(outcome)`.

The coordinator input must be fully provider-family agnostic:

- `targetProviderId`: the catalog/runtime provider (`openai`, `anthropic`,
  `gemini`, `gcp`, `mistral`, ...).
- `transportProviderId`: the product-account transport (`codex`,
  `claude-code`, `gemini-code-assist`, `mistral-vibe`, ...).
- `modelId`: the target provider model id or globally unique catalog key.
- `affinityKey`: the non-secret session key used for sticky account selection.

`modelId` is resolved to the canonical runtime catalog id before acquisition.
Display aliases or provider-specific nicknames must not be used in lease keys;
quota grouping can still use separate transport-specific quota keys.

D4. Secrets remain app-owned.

- Hooks, events, traces, and UI receive only `AuthDescriptor`.
- Execution receives access-token material only for the active call.
- Refresh tokens never leave the app-owned coordinator.

D5. Split stable leases from in-flight reservations.

- Lease: durable affinity from session/provider/model/transport to one account.
- Reservation: short TTL per in-flight request, used to balance new sessions
  before provider quota updates arrive.

D6. Acquisition is a short DB transaction.

The Sentropic implementation must:

1. Lock an active lease by affinity key with `FOR UPDATE`.
2. If no lease exists, select an eligible account with `FOR UPDATE SKIP LOCKED`.
3. Consider status, cooldown, quota, model allowlist, priority, weight, and
   active reservations.
4. Create lease and reservation, then commit.
5. Run the provider call outside the transaction.
6. Call `recordOutcome()` to release reservation and update quota/cooldown.

No DB lock may be held during a model stream.

D7. Affinity keys are explicit and non-secret.

- Chat default: `chat_session:{sessionId}`.
- Provider-specific cache/session headers are stable for a lease and derived by
  HMAC from workspace, session, target provider, transport, model, and lease id.
  Codex uses this value as `session_id`; future transports may map it to their
  own cache/session header only when the wire protocol documents or proves one.
- Automatic failover inside an existing session is disabled by default.
- If a leased account becomes exhausted, cooled down, or `reauth_required`,
  acquisition for the same affinity key returns an unavailable or reauth result
  rather than silently rebinding the session. New sessions may select another
  eligible account. Existing-session rebind requires an explicit audited policy.
- Manual session rebind is a separate audited operation.

D8. Credential precedence remains explicit.

Default precedence:

1. Request override token.
2. User BYOK key.
3. Workspace key.
4. Environment key.
5. Account transport, only when selected by scoped policy.

`request_override` always disables account transports for that request.

For BR-44, Claude Code can be activated without the later v2 UI only through an
explicit backend policy source owned by Sentropic API: active account rows are
not enough by themselves. The policy must name `(targetProviderId:
anthropic, transportProviderId: claude-code)` and workspace/scope eligibility.
Direct API keys and request overrides still win over this policy.

The concrete BR-44 policy source is the existing settings-backed transport mode
pattern: `provider_connection_mode:anthropic` defaults to `token` and routes
through account transports only when set to `claude-code`. Tests and non-UI
operation set this key plus at least two active `llm_provider_accounts` rows for
`(anthropic, claude-code)`. Later `/provider-connections/v2` UI can author the
same policy, but no implicit auto-enable is allowed.

D9. Token refresh is coordinated.

- Refresh happens under row lock or optimistic version guard.
- Concurrent refreshes coalesce.
- Failed refresh marks `reauth_required` when user action is needed.
- Codex migration must infer and persist `token_expires_at` when possible.
- Claude Code refresh uses Claude Code OAuth bearer semantics. BR-44 may accept
  imported or externally obtained OAuth token material through a backend import
  path, but refresh ownership still lives in the app-owned coordinator.
- Before `claude-code` can be marked `app-executable`, Lot 4 must pin the
  refresh endpoint, required client metadata, token lifetime handling, and
  profile/account identity strategy from public docs, `teamclaude`, or a local
  machine-HTTP proof. If this cannot be proven, the branch is blocked; an
  access-token-only implementation is not an acceptable substitute.
- The minimum Claude Code import bundle is: `targetProviderId=anthropic`,
  `transportProviderId=claude-code`, a stable external account id or
  operator-supplied local account ref, bearer access token, token expiry when
  known, refresh token for durable app-executable use, credential schema
  version, and optional profile/scopes/client metadata. Access-token-only rows
  may be accepted only as short-lived/manual fixtures and must move to
  `reauth_required` on expiry; they do not satisfy the mandatory multi-account
  BR-44 delivery.
- Claude Code account identity is resolved from a proven profile/account
  endpoint when available. If no such endpoint is proven for the imported
  material, BR-44 must require a stable operator-supplied account ref and verify
  the token through the Anthropic Messages machine HTTP path, never through a
  browser UI.
- Planned Agy/Gemini and Mistral Vibe transports cannot become executable until
  their refresh endpoint, token lifetime semantics, and profile/account-id lookup
  are proven.

D10. Quota state is heterogeneous.

- Claude Code records Anthropic unified 5h/7d headers and standard limits.
- Codex records retry-after, 401/403/429, synthetic cooldowns, and local usage.
- Agy/Gemini records Google product-account quota only after a proven header or
  response contract exists. Until then, it may record local request usage and
  provider status outcomes only.
- Mistral Vibe records Mistral product-account quota only after a proven header
  or response contract exists. Until then, it may record local request usage and
  provider status outcomes only.
- Unknown quota is a valid probing state.

D11. API and UI migrate in two versions.

- Existing Codex settings endpoints remain as a compatibility facade.
- New `/provider-connections/v2` returns `providers[].transports[].accounts[]`.
- Settings UI moves to a multi-account list and per-transport runtime policy.

D12. Product gates are mandatory.

- Subscription account pooling and cross-user pooling are disabled by default.
- Admin kill switch per transport.
- Audit enrollment, refresh, routing, disconnect, and session rebind.
- Enabling subscription transports requires explicit owner acceptance of
  provider Terms and quota-policy risk.

D13. Account transports have an executable-readiness ladder.

Each transport family moves through these states:

1. `planned`: catalog/spec placeholder only; no access token may be accepted as
   executable material.
2. `proven`: local reference or public docs prove enrollment, refresh, account
   identity, endpoint, auth headers, and quota/error semantics.
3. `package-executable`: `@sentropic/llm-mesh` accepts executable
   `account-transport` material for that transport and has conformance tests.
4. `app-executable`: Sentropic API can store, refresh, acquire, use, and record
   outcomes for one or more accounts.
5. `ui-managed`: Sentropic UI exposes enrollment and policy controls.

BR-44 requires `claude-code` to reach at least `package-executable` and
`app-executable` for backend use through `llm-mesh`. Sentropic UI management is
optional for this branch.

Readiness is enforced in two places: `@sentropic/llm-mesh` rejects executable
material for transports below `package-executable`, and Sentropic API rejects
storage/acquisition for transports below `app-executable`. Planned transports
can appear in metadata/catalogue responses only as non-executable descriptors.

D14. UI mimic is not an account transport.

An account transport requires a machine HTTP request path with defined or
locally proven auth material. Browser automation or HTML/UI mimicry is not part
of `@sentropic/llm-mesh`; if a future product account only works by UI mimic, it
is a separate connector/product decision and must not be shipped as an account
transport without a new spec and owner acceptance.

D15. Transport ids are stable and aliases are metadata.

Runtime policy, leases, reservations, quota rows, and audit logs use canonical
transport ids only. Product names and CLI/tool names such as "Agy", "Gemini Code
Assist", or "Mistral Vibe" are labels or metadata aliases. Renaming a transport
id after publication is a breaking migration.

D16. Provider API keys and product-account subscriptions never collapse into one
credential class.

For every provider family:

- API keys remain `direct-token`, `workspace-token`, `user-token`, or
  `environment-token` credentials for direct provider billing.
- Product subscriptions use `account-transport` material with account id,
  transport id, token expiry, refresh metadata, and lease metadata.
- Credential precedence must keep request overrides and BYOK/provider keys
  explicit; account transports run only when selected by policy.

## Sentropic DB Model

- `llm_provider_accounts`: scope, owner, target provider, transport provider,
  external account id, status, labels, model allowlist, priority/weight,
  encrypted account-transport secret bundle, token expiry, timestamps, last
  error, and transport metadata such as product account source, credential
  schema version, profile fields, and endpoint family. Direct provider API keys
  are not stored here unless they are explicitly modeled as non-subscription
  account rows in a separate future spec.
- `llm_account_leases`: unique active lease on `(workspace_id, affinity_key,
  target_provider_id, transport_provider_id, model_id)`.
- `llm_account_reservations`: short TTL in-flight reservation linked to
  account, lease, and request correlation id.
- `llm_account_quota_state`: unique `(account_id, quota_key)` with status,
  utilization, remaining count, reset time, cooldown, raw payload, and version.

## Migration

1. Add package coordinator types and in-memory tests.
2. Add app Postgres tables and service implementation.
3. Import existing `provider_connection_secret:codex` into accounts.
4. Keep current Codex endpoints as v1 facade.
5. Cut OpenAI/Codex dispatch to coordinator acquisition.
6. Add Claude Code account-transport runtime through `llm-mesh`: backend import
   of externally obtained OAuth bearer bundles, refresh, account identity
   handling, `provider_connection_mode:anthropic=claude-code` backend activation
   policy, Anthropic Messages request path, outcome mapping, and multi-account
   leases.
7. Keep Claude Code Sentropic UI enrollment optional for BR-44; backend
   `llm-mesh` usability with at least two Claude Code accounts is mandatory.
8. Switch Settings to v2 account transport UI in a later UI-management slice.
9. Add Agy/Gemini and Mistral Vibe only after each reaches the `proven` state
   in D13.

## Required Tests

- Same chat session reuses the same account.
- Concurrent new sessions distribute under two workers.
- No transaction is held during stream execution.
- Concurrent token refresh coalesces.
- Disconnect closes or invalidates active leases.
- 429 and retry-after update quota/cooldown.
- Codex singleton settings migrate without token leakage.
- Claude Code executable path uses `Authorization: Bearer` and does not send
  `X-Api-Key`.
- Claude Code runtime calls Anthropic Messages API format, not a Claude web UI
  endpoint.
- Claude Code backend import rejects missing durable refresh material for
  app-executable accounts unless the row is marked short-lived/manual and cannot
  satisfy branch delivery gates.
- Claude Code refresh tests pin request composition, client metadata, expiry
  handling, and the profile/account identity strategy used by imported bundles.
- Claude Code runtime requires explicit backend policy activation; merely
  storing an active account row does not route traffic.
- Claude Code acquisition supports at least two configured accounts, sticky
  affinity, and cooldown failover for new sessions.
- Planned Agy/Gemini and Mistral Vibe transports remain non-executable until
  their endpoint/auth/refresh contracts are proven.
- Hooks, traces, and logs never expose access or refresh tokens.
