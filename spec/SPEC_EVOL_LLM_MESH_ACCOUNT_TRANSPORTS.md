# SPEC EVOL - LLM Mesh Account Transports

Status: Draft, planned by BR-44.

Related specs: `SPEC_EVOL_LLM_MESH.md`, `SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`.

## Objective

Expose Codex and Claude Code subscription accounts as `@sentropic/llm-mesh`
account transports with multi-account enrollment, inter-session balancing,
intra-session affinity, token refresh, quota state, and DB-backed coordination.

## Baseline

The current app supports one Codex account as an OpenAI transport, but it is
app-local and singleton: `provider-connections.ts` stores one Codex state in
`settings`, `codex-provider-auth.ts` owns enrollment, `openai-provider.ts`
injects the Codex fetch path, and `provider-credentials.ts` resolves API-key
strings only. `teamclaude` proves multi-account Claude/Codex behavior, but uses
a local JSON config plus in-memory quota state, not a multi-instance DB model.

## Decisions

D1. Codex and Claude Code are transports, not providers.

- `codex` targets provider `openai`.
- `claude-code` targets provider `anthropic`.
- Provider/model catalog entries remain provider-native.

D2. `llm-mesh` stays DB-agnostic but persistent-runtime-ready.

- No Postgres, Drizzle, or Sentropic settings dependency in package core.
- The package owns coordinator types, routing policy types, and in-memory tests.
- Sentropic API owns Postgres, encryption, migrations, UI, and admin policy.

D3. Use one atomic coordinator port.

Separate account, lease, and quota stores cannot guarantee atomic selection.
The package exposes `AccountTransportCoordinator.acquire(input)`, returning an
`AccountTransportAcquisition` with redacted descriptor, executable material,
lease metadata, runtime affinity metadata, and `recordOutcome(outcome)`.

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
- Codex `session_id` is stable for a lease and derived by HMAC from workspace,
  session, provider, transport, model, and lease id.
- Automatic failover inside an existing session is disabled by default.
- Manual session rebind is a separate audited operation.

D8. Credential precedence remains explicit.

Default precedence:

1. Request override token.
2. User BYOK key.
3. Workspace key.
4. Environment key.
5. Account transport, only when selected by scoped policy.

`request_override` always disables account transports for that request.

D9. Token refresh is coordinated.

- Refresh happens under row lock or optimistic version guard.
- Concurrent refreshes coalesce.
- Failed refresh marks `reauth_required` when user action is needed.
- Codex migration must infer and persist `token_expires_at` when possible.

D10. Quota state is heterogeneous.

- Claude Code records Anthropic unified 5h/7d headers and standard limits.
- Codex records retry-after, 401/403/429, synthetic cooldowns, and local usage.
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

## Sentropic DB Model

- `llm_provider_accounts`: scope, owner, target provider, transport provider,
  external account id, status, labels, model allowlist, priority/weight,
  encrypted token secret, token expiry, timestamps, and last error.
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
6. Add Claude Code enrollment, refresh, and profile lookup.
7. Switch Settings to v2 account transport UI.

## Required Tests

- Same chat session reuses the same account.
- Concurrent new sessions distribute under two workers.
- No transaction is held during stream execution.
- Concurrent token refresh coalesces.
- Disconnect closes or invalidates active leases.
- 429 and retry-after update quota/cooldown.
- Codex singleton settings migrate without token leakage.
- Hooks, traces, and logs never expose access or refresh tokens.
