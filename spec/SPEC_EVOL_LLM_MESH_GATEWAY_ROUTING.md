# SPEC_EVOL — Consumer-neutral LLM routing across mesh and gateway

Status: ACCEPTED DESIGN v2, 2026-08-08 — owner decisions encoded; independent
Gemini 3.6 High and h2a reviews reconciled; implementation authorized.

Branch: BR-73 `feat/llm-mesh-gateway-routing`

Extends:

- `spec/SPEC_EVOL_LLM_MESH.md`
- `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md`
- `spec/SPEC_EVOL_LLM_GATEWAY.md`

BR-73 supersedes those specifications only for internal route selection,
account acquisition, lease/affinity ownership, route-health state, refresh
ownership and the former personal-passthrough target map. It does not replace
their public wire contracts, authentication, quota, metering or enrollment
semantics. In particular, `/v1/messages` and `/v1/chat/completions` remain
compatible. `/v1/responses` may be added; it does not replace either existing
endpoint in this compatible-minor evolution.

## 1. Problem and intended outcome

The current system has two conflicting ownership models:

1. `@sentropic/llm-mesh` already owns the model catalog, account transports,
   enrollment, refresh, account eligibility, leases, reservations and a stable
   session identifier.
2. `@sentropic/llm-gateway` currently owns canonical target maps, launch aliases
   and a fixed retry loop. A consumer can therefore accidentally collapse the
   system to one transport by wiring only the gateway defaults it knows.

That split produced the observed regression: after the latest h2a evolution,
only the Cloud Code path remained wired even though more accounts had been
enrolled. The libraries need one authoritative control plane and one thin data
plane so a consumer cannot silently replace product policy.

BR-73 delivers:

- consumer-neutral routing across Claude Code, Codex, Cloud Code and future
  account transports;
- a benchmark-backed, versioned model-equivalence council;
- last-successfully-enrolled-first selection for new affinities;
- strict account stickiness by default;
- bounded, configurable pre-first-byte fallback with negative availability
  caching;
- provider-compatible ingress and streaming in every direction;
- deterministic refresh/check recipes so catalog and equivalence data cannot
  drift in CI or downstream releases.
- serializable ordered, round-robin and per-model routing policies that a thin
  consumer can expose without copying mesh data.

## 2. Owner-ratified decisions

### D1 — New-affinity precedence

When no explicit route and no active lease exist, the most recently completed
successful enrollment is tried first. The ordering key is
`enrollmentCompletedAt DESC`, then stable `accountId ASC` as the deterministic
tie breaker. A consumer may expose an override, but may not substitute a
hardcoded provider or transport default.

### D2 — Routing ownership

Routing policy lives in `@sentropic/llm-mesh`. This includes:

- requested-id and launch-alias resolution;
- model-equivalence classification;
- capability filtering;
- account/transport eligibility and ordering;
- health, cooldown and negative availability state;
- session affinity and route-stickiness decisions;
- generation of a bounded candidate route plan.

### D3 — Equivalence council

Mesh maintains a versioned model-equivalence council based on benchmark
evidence. Every model-catalog addition must update the council or add an
explicit, justified exclusion. Council defaults are overridable by the host,
workspace, consumer or request within the precedence rules in §7.

### D4 — Fallback modes

Two modes are public:

- `retest-preferred` (default): skip a recently unavailable route until its
  negative-cache TTL expires, then test it again before lower-ranked routes;
- `one-way`: after a fallback route succeeds, promote it for that affinity and
  do not automatically return to the previous route until explicit reset,
  rebind or invalidation of the enrolled account.

Default negative-cache TTL is 5 minutes. It is configurable, including 10
minutes, and bounded to prevent accidental permanent suppression.

Fallback prefers the same account-transport type before another type. It is
always bounded and never runs after the first response byte.

### D5 — Account stickiness and cache continuity

An affinity is strictly sticky to model/transport/account by default.
Equivalent-account rotation is opt-in and is presented as discouraged because
provider prompt/context cache continuity may be lost.

The routing contract provides affinity, not a generic provider context cache:

- mesh maintains a stable lease and `stableSessionId`;
- the stable transport lease is keyed from the owner-scoped mesh affinity and
  never exposed through the route plan;
- Cloud Code currently creates a fresh request id and does not map
  `stableSessionId` to a proven upstream cache key;
- Codex sends `stableSessionId` as its session header, but still uses
  `store: false` and no `previous_response_id`.

No API, metric or UI may claim provider cache reuse until a transport has a
verified upstream cache/session mapping. Account rotation therefore carries a
`cacheContinuityRisk` diagnostic.

### D6 — Migration

Codex must be re-enrolled through the current mesh enrollment contract. BR-73
does not infer credentials from legacy h2a state or environment variables.

### D7 — Delivery order

Sentropic specifies, implements, versions and prepares both libraries first.
h2a then integrates the exact candidate locally and performs functional UAT.
The Sentropic PR merges only after h2a UAT and CI are green. npm publication is
performed only by merge-triggered CD.

## 3. Hard architecture boundary

```text
Claude Code / Codex / AGY / OpenCode / Hermes / other compatible callers
                              |
                              v
                  @sentropic/llm-gateway
       ingress wire, authn/z, quota/metering, execution,
             SSE/headers/errors, response commitment
                              |
                       RoutePlan API
                              |
                              v
                    @sentropic/llm-mesh
     catalog, equivalence council, policy, account transports,
       enrollment/refresh, health/cooldown, leases/stickiness
```

Dependency direction is gateway to mesh only. Mesh has no Hono, HTTP server,
gateway session token, caller quota or provider-compatible response concern.
Gateway has no canonical model table, equivalence policy, provider credential,
account identifier, refresh-token ownership or durable account-health policy.

### 3.1 Mesh responsibilities

- Provider and model catalog/capabilities.
- Canonical requested-id and alias resolution.
- Equivalence groups and benchmark evidence.
- Account transport metadata, enrollment sequence and executable readiness.
- Eligibility, cooldown, negative cache and outcome recording.
- Leases/reservations, affinity and optional audited rebinding.
- Pure route planning and redacted route diagnostics.
- Lossless canonical request/provider-event contracts and provider egress
  adapters. Mesh resolves provider credentials internally and never returns
  them to gateway.

### 3.2 Gateway responsibilities

- Anthropic/OpenAI and future compatible ingress adapters.
- Caller authentication/authorization, owner isolation, quota and metering.
- Wire normalization to a canonical mesh request.
- Execution of a bounded mesh-produced candidate list.
- The response-commit boundary: no retry once headers/body/SSE are committed.
- Provider-shaped headers, errors and event-stream fidelity.
- Gateway session tokens, request cancellation and server health.

Gateway derives a `VerifiedRoutingSubject` from authenticated caller state. No
owner, account, clock or executable candidate value is accepted from an ingress
body or an untrusted consumer configuration.

### 3.3 Consumer responsibilities

h2a and other consumers own only:

- CLI flags/configuration and process lifecycle;
- choice of gateway ingress wire/base URL;
- explicit user overrides exposed through the public libraries;
- enrollment commands and human-facing diagnostics;
- forwarding a stable affinity key;
- local integration and UAT.

A consumer may relay an opaque, short-lived gateway bearer to its child
process. It never stores or interprets provider access tokens, refresh tokens,
client secrets, routing seeds, account identifiers, affinity state or the model
council. Gateway defines bearer mint, expiry, revocation and reacquisition after
restart; the initial h2a integration keeps the bearer in memory only.

Consumers do not copy route tables, equivalence lists, client secrets or refresh
logic. h2a must wire all supported options; a Cloud-Code-only default is a
contract failure.

## 4. Mesh public contracts

Names below are normative semantics; final TypeScript naming may change during
review without changing the contract.

### 4.1 Equivalence record

```ts
interface ModelEquivalenceGroup {
  readonly id: string;
  readonly revision: string;
  readonly intent: 'coding' | 'general' | 'reasoning' | 'fast';
  readonly members: readonly ModelEquivalenceMember[];
  readonly evidence: readonly BenchmarkEvidence[];
  readonly updatedAt: string;
  readonly expiresAt: string;
}

interface ModelEquivalenceMember {
  readonly providerId: string;
  readonly modelId: string;
  readonly effort?: string;
  readonly rank: number;
  readonly requiredCapabilities: readonly CapabilityRequirement[];
  readonly transportPreferences?: readonly string[];
}

type CapabilityRequirement =
  | { readonly capability: ModelCapability; readonly required: true }
  | { readonly capability: ModelCapability; readonly minimum: number };

interface ModelAlias {
  readonly alias: string;
  readonly targetProviderId: string;
  readonly targetModelId: string;
  readonly effort?: string;
  readonly revision: string;
}

interface EquivalenceExclusion {
  readonly providerId: string;
  readonly modelId: string;
  readonly reason: string;
  readonly reviewer: string;
  readonly revision: string;
  readonly expiresAt: string;
  readonly provenance: string;
}

interface BenchmarkEvidence {
  readonly suite: string;
  readonly artifact: string;
  readonly measuredAt: string;
  readonly dimensions: Readonly<Record<string, number | string>>;
}
```

An equivalence means “acceptable for this declared intent and capability set”,
not “the same provider identity”. Discovery always reports requested and actual
provider/model/transport separately.

### 4.2 Initial council and migration seed

The existing owner-ratified suffixed aliases migrate from gateway to mesh:

| Requested alias | Codex candidate | Cloud Code candidate | Effort |
|---|---|---|---|
| `claude-opus-5-high` | `openai:gpt-5.6-terra` | `gemini:gemini-3.1-flash-lite` | `high` |
| `claude-opus-5-xhigh` | `openai:gpt-5.6-terra` | `gemini:gemini-3.1-flash-lite` | `xhigh` |
| `claude-opus-4-8-xhigh` | `openai:gpt-5.6-terra` | `gemini:gemini-3.1-flash-lite` | `xhigh` |
| `claude-fable-5-high` | `openai:gpt-5.6-sol` | `gemini:gemini-3.1-flash-lite` | `high` |
| `claude-fable-5-xhigh` | `openai:gpt-5.6-sol` | `gemini:gemini-3.1-flash-lite` | `xhigh` |
| `claude-fable-5-max` | `openai:gpt-5.6-sol` | `gemini:gemini-3.1-flash-lite` | `max` |
| `claude-sonnet-5-xhigh` | `openai:gpt-5.6-luna` | `gemini:gemini-3.1-flash-lite` | `xhigh` |

Bare provider model ids remain provider-faithful. A suffixed launch alias is an
explicit owner-ratified multi-transport route: its ordered policy may select the
Codex or Cloud Code candidate above and bounded pre-byte fallback may try the
other. This explicit alias contract is not benchmark equivalence evidence and
does not make bare models interchangeable. Before any additional automatic
equivalence fallback is enabled for a group, its evidence must be fresh and its
required capabilities must be satisfied. Stale evidence fails closed for
automatic substitution while exact requested routes remain usable.

The first implementation ships a conservative coding council using only
existing ratified aliases plus benchmark evidence available in the repository.
Adding broad cross-family groups without evidence is out of scope.

### 4.3 Catalog completeness invariant

Every `ModelProfile` must have exactly one of:

1. membership in one or more current equivalence groups; or
2. an `EquivalenceExclusion` naming the model, reason, reviewer, revision,
   provenance and expiry.

CI fails on an unclassified model, duplicate conflicting membership, missing
catalog member, stale schema, expired evidence/exclusion, or a group whose
typed capability requirements are absent from a member profile. `ModelAlias`
is validated separately and never counts as equivalence evidence.

### 4.4 Refresh and publication recipe

The repository exposes Make targets with these semantics:

- `make refresh-llm-model-equivalences`: read pinned benchmark artifacts,
  deterministically regenerate the council candidate and its provenance digest;
- `make check-llm-model-equivalences`: regenerate in check mode and fail on
  dirty output, incomplete catalog classification, stale evidence or schema
  violation.

The refresh operation never fetches unpinned “latest” data during CI. Updating
benchmark inputs is a reviewed source change. CI runs the check target whenever
mesh catalog, council, refresh script or relevant package files change. The
generated council is included in `@sentropic/llm-mesh`; the gateway consumes it
through mesh and does not publish a copy.

The same check also runs unconditionally in every package-publication CI job so
an expired evidence record, override or exclusion cannot be published merely
because path detection skipped the council files.

### 4.5 Route-planning input

```ts
interface VerifiedRoutingSubject {
  readonly principalRef: string;
  readonly ownerScopeRef: string;
  readonly grants: readonly string[];
}

interface RoutePlanInput {
  readonly requestedModel: string;
  readonly intent?: 'coding' | 'general' | 'reasoning' | 'fast';
  readonly requiredCapabilities?: readonly CapabilityRequirement[];
  readonly affinityKey?: string;
  readonly workspaceId?: string;
  readonly policyProfile?: string;
  readonly policyOverride?: Partial<RoutePolicy>;
  readonly explicit?: RouteSelector;
}

interface EligibleAccountDescriptor {
  readonly diagnosticAccountRef: string;
  readonly targetProviderId: string;
  readonly transportProviderId: string;
  readonly supportedModelIds: readonly string[];
  readonly enrollmentCompletedAt: string;
  readonly readiness: 'ready' | 'cooldown' | 'reauth-required' | 'disabled';
  readonly revision: string;
}

interface AccountDirectoryPort {
  listEligible(subject: VerifiedRoutingSubject):
    Promise<readonly EligibleAccountDescriptor[]>;
}
```

`VerifiedRoutingSubject` is produced only by gateway authentication. Mesh reads
owner-scoped, redacted descriptors through `AccountDirectoryPort`; the ingress
cannot supply them. `enrollmentCompletedAt` is persisted on every successful
enrollment, restored with the account and updated by successful re-enrollment.
It is unavailable outside the owner-scoped directory and redacted diagnostics.

Completed enrollment also persists the exact enrollment `ownerScope` as the
account `ownerScopeRef`. Local records created before owner tagging are not
eligible by default; a host may bind them once through the explicit
`legacyAccountOwnerScopeRef` facade option. This migration never infers owner
from an untrusted request or from whichever subject happens to arrive first.

Account executable material is resolved only inside mesh for the exact planned
candidate. It is never embedded in a plan or returned to gateway.

### 4.6 Route policy

```ts
interface RoutePolicy {
  readonly strategy: RouteStrategy;
  readonly rules: readonly RouteRule[];
  readonly fallbackMode: 'retest-preferred' | 'one-way';
  readonly negativeCacheTtlMs: number;       // default 300_000
  readonly maxAttempts: number;              // default 3, hard maximum 8
  readonly preferSameTransport: boolean;     // default true
  readonly stickyAccount: boolean;           // default true
  readonly rotateEquivalentAccounts: boolean;// default false
  readonly allowEquivalentModels: boolean;   // default true when evidence fresh
}

type RouteStrategy =
  | { readonly kind: 'last-enrolled' }
  | { readonly kind: 'ordered'; readonly preferences: readonly RouteSelector[] }
  | { readonly kind: 'round-robin'; readonly scope: 'new-affinity' };

interface RouteSelector {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly alias?: string;
  readonly transportProviderId?: string;
  readonly diagnosticAccountRef?: string;
}

interface RouteRule {
  readonly match: {
    readonly requestedModel?: string;
    readonly alias?: string;
    readonly intent?: ModelEquivalenceGroup['intent'];
    readonly capabilities?: readonly CapabilityRequirement[];
  };
  readonly strategy?: RouteStrategy;
  readonly preferences?: readonly RouteSelector[];
  readonly fallback?: Partial<Pick<RoutePolicy,
    'fallbackMode' | 'allowEquivalentModels' | 'rotateEquivalentAccounts'>>;
}

interface RoutePolicyProfile {
  readonly name: string;
  readonly revision: string;
  readonly policy: RoutePolicy;
}
```

Accepted TTL range is 1 second through 1 hour. Zero may disable negative
caching only through an explicit development/test override. Invalid bounds fail
configuration; they are not silently clamped.

Policies and named profiles are versioned, schema-validated, serializable and
atomically activated. Mesh exposes `validateRoutePolicy`,
`describeRoutePolicy`, `listRoutePolicyProfiles` and `activateRoutePolicyProfile`.
Ordered rules are first-match. Round-robin applies only when creating a new
affinity and never moves an existing lease. Selectors are validated against the
catalog/council; consumers never carry a copied target table.

Round-robin state and affinity identity are keyed by stable owner scope (plus
model, and workspace/affinity where applicable), not by the ephemeral
authenticated session principal. Plans remain bound to the full verified
subject, so changing principals cannot replay an existing plan, while a
re-authenticated session for the same owner retains its established affinity.

### 4.7 Override precedence

Highest to lowest:

1. request-explicit provider/model/transport/account, subject to auth and
   capability eligibility;
2. consumer runtime override;
3. workspace policy;
4. host policy;
5. mesh defaults.

Credential precedence from the account-transport spec remains independent and
unchanged. A request override token still disables account transports.

### 4.8 Deterministic candidate ordering

For a new affinity:

1. resolve the requested exact model or alias;
2. filter for required capabilities and caller-owned eligible accounts;
3. apply an explicit account/transport/model constraint if supplied;
4. apply the selected `last-enrolled`, `ordered` or new-affinity round-robin
   strategy and the first matching model/alias/intent/capability rule;
5. for the default strategy, order exact-model accounts by successful
   enrollment completion descending before any priority, weight or load hint;
6. append fresh-equivalent candidates, same transport type first;
7. within each candidate class, order accounts by successful enrollment
   completion descending and then stable account id;
8. remove routes suppressed by cooldown/negative cache unless their TTL expired;
9. truncate to `maxAttempts`.

For an existing affinity, the active sticky lease is candidate zero. With
`stickyAccount=true`, no different account is appended. Equivalent models on
the same account may be appended when supported. A different account is
appended only when `rotateEquivalentAccounts=true`, and the plan reports the
cache-continuity warning.

Candidate leases are provisional while a new affinity experiences pre-commit
failures. The first candidate that reaches a validated first stream frame or a
non-stream success becomes sticky. An established affinity never changes
account automatically. `retest-preferred` may retest only permitted routes on
that account; `one-way` may promote only an equivalent model/transport on that
account by default. Cross-account rebind requires `rotateEquivalentAccounts`
or an explicit audited reset/rebind. `auth_failed` invalidates the account and
does not trigger another model on the same invalid credential.

### 4.9 Health and negative cache

Mesh records redacted route outcomes at an adapter-declared health scope.
Minimum reason codes:

- `success`
- `network_unavailable`
- `provider_5xx`
- `rate_limited`
- `auth_failed`
- `reauth_required`
- `unsupported_model`
- `invalid_request`
- `cancelled`

`stream_started` is an attempt-state transition, not a terminal outcome.
Adapter failure classification is:

```ts
interface RouteFailureClassification {
  readonly reason: RouteOutcomeReason;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly healthScope: 'route' | 'account' | 'transport' | 'provider-model';
}
```

Only availability-class outcomes (`network_unavailable`, `provider_5xx`, and
policy-approved `rate_limited`) populate the negative cache. Authentication
failure updates the account state; invalid requests do not poison route health;
cancellation releases the reservation with no health impact.

A valid provider `retryAfterMs` overrides the generic TTL for that entry within
the configured safety bounds. The scope prevents repeatedly trying equivalent
models backed by the same broken account or transport. Time comes from an
injected `Clock`; ingress input never supplies it outside tests.

The default implementation may be in memory, with an injected state port and
clock so a host can provide durable/distributed storage. Cache state must be
bounded and evict expired entries.

### 4.10 Opaque route plan and attempt

A plan contains candidate ids and explanations, not secrets:

```ts
interface RoutePlan {
  readonly planRef: string;
  readonly expiresAt: string;
  readonly candidateRefs: readonly string[];
  readonly policy: RoutePolicy;
  readonly councilRevision: string;
  readonly diagnostics: readonly RouteDiagnostic[];
}

interface PreparedRouteAttempt {
  readonly attemptRef: string;
  execute(request: CanonicalLlmRequest, signal?: AbortSignal):
    AsyncIterable<CanonicalProviderEvent>;
  complete(): Promise<void>;
  releaseCancelled(): Promise<void>;
}

interface RoutePlanner {
  plan(subject: VerifiedRoutingSubject, input: RoutePlanInput): Promise<RoutePlan>;
  prepareAttempt(
    subject: VerifiedRoutingSubject,
    planRef: string,
    candidateRef: string,
    requestId: string,
    attemptIndex: number,
  ): Promise<PreparedRouteAttempt>;
}
```

`planRef` and `candidateRef` are opaque, expiring and bound to subject, policy
revision, council revision and affinity revision. `prepareAttempt` atomically
revalidates ownership, eligibility, revision and stickiness, reserves exactly
that candidate and never substitutes another. Gateway receives neither
`accountId`, diagnostic account ref nor `SecretAuthMaterial`.

Mesh exposes owner-scoped, audited `describeAffinity`, `promoteAffinityRoute`,
`resetAffinityRoute` and explicit `rebindAffinityRoute`. Mutations use revision
comparison or per-affinity serialization. Policy changes affect new affinities;
an existing affinity changes only through reset/rebind. Diagnostics may show a
redacted account reference, requested/actual model and transport, reason and
`cacheContinuityRisk`, but never an executable reference after plan expiry.

### 4.11 Lossless canonical execution contract

The canonical contract preserves, without flattening, system instructions,
ordered user/assistant content, text, images, tool definitions, tool calls,
tool results, thinking/reasoning blocks, generation controls and provider
metadata required for a faithful response. Provider events preserve content
block boundaries and order, stop reason, usage, safe response headers and a
typed terminal error.

Each adapter publishes a conversion matrix from canonical capabilities to its
wire. Planning rejects a candidate before response commitment when any required
capability is not representable losslessly. Silent deletion or textification of
tools, tool results, images or thinking is forbidden. Anthropic, OpenAI and
Google fixture tests cover conversion in both supported directions, including
SSE ordering. BR-73 adds an executable Codex/OpenAI adapter; Codex re-enrollment
creates a descriptor with `targetProviderId='openai'` and
`transportProviderId='codex'`, without legacy import or normalization.

## 5. Gateway execution contract

### 5.1 Ingress neutrality

Gateway ingress adapters translate caller wire to a canonical request. The
package preserves Anthropic Messages (`/v1/messages`) and OpenAI Chat
Completions (`/v1/chat/completions`). OpenAI Responses (`/v1/responses`) may be
added without replacing either established wire. New adapters can serve client
conventions used by Claude Code, Codex, AGY, OpenCode or Hermes without changing
mesh policy.

Ingress identity never selects a provider implicitly. A Claude-compatible
caller may route to an evidence-approved OpenAI or Google equivalent, and an
OpenAI-compatible caller may route to another family, while the response stays
faithful to the caller's selected ingress contract.

### 5.2 Execution loop

1. Authenticate caller and establish owner/cost context.
2. Normalize the request and ask mesh for a route plan.
3. Ask mesh to prepare the exact opaque candidate reference.
4. Execute through the opaque attempt and await a valid first result before
   sending downstream status, headers or body.
5. If a retryable failure occurs before commitment, record the outcome and try
   the next bounded candidate.
6. Commit downstream status/headers and the first body/SSE frame together,
   mark the attempt committed and bind a provisional affinity; all later
   failures are terminal and no fallback occurs.
7. Complete/fail exactly once or release a cancelled attempt, then emit exactly
   one aggregate financial usage event for the whole request.

No attempt recursively requests another plan. The list is fixed per request,
which makes attempt count auditable and prevents retry explosions.

Every prepared attempt is an idempotent `AttemptLease`: it records one terminal
operational outcome, one optional commitment transition and exactly one real
reservation release. Pre-commit attempts may already incur upstream usage; the
single financial event aggregates actual or explicitly estimated consumption
across all attempts. Operational attempt outcomes and financial settlement are
separate records.

### 5.3 Retry classification

Eligible before commitment:

- connection/DNS/TLS failure;
- timeout before headers/first byte;
- provider 429 when policy permits and another candidate exists;
- provider 500/502/503/504;
- provider-declared model temporarily unavailable.

Terminal without fallback:

- malformed or capability-invalid request;
- caller auth/authz/quota failure;
- provider 400/404 unless explicitly classified as temporary model
  unavailability by that adapter;
- any error after commitment;
- cancellation;
- account auth failure when strict stickiness forbids another account and no
  same-account equivalent route exists.

### 5.4 Wire invariants

- Anthropic ingress returns Anthropic-shaped errors and event order.
- OpenAI ingress returns OpenAI-shaped errors and event order.
- No upstream credential, account id, internal provider URL, benchmark artifact
  or council internals leak into headers/body.
- Request/cost correlation is stable across attempts, with a separate attempt
  index for audit.
- Only one financial cost event is emitted per request, aggregating actual or
  explicitly estimated upstream usage across all attempts; failed zero-usage
  attempts remain operational outcome events.

### 5.5 Anthropic streaming usage and compaction

Anthropic-compatible streaming clients use the input-token count carried by
the first `message_start` event to track context occupancy and decide when to
compact. A routed `/v1/messages` stream must therefore emit a non-zero,
request-derived `message_start.message.usage.input_tokens` for non-empty
context before consuming the provider stream to completion. Emitting a
hard-coded zero and disclosing input usage only in the terminal event is not
wire-compatible: Claude Code can compact repeatedly without recovering space.

When exact upstream input usage is unavailable before response commitment, the
gateway computes a deterministic bounded estimate from the normalized request.
It includes system instructions, ordered textual content and tool definitions,
but does not scale with embedded base64/binary bytes. The estimate must not
buffer the provider response, make an extra provider call or alter route
selection. If an adapter can provide exact input usage before commitment, exact
usage takes precedence.

The terminal Anthropic `message_delta.usage` carries output usage only.
Provider-reported input/output usage remains authoritative for aggregate
financial settlement and diagnostics; the first-frame estimate is a
caller-compatibility signal, not a billing record. OpenAI stream usage is
unchanged.

## 6. Compatibility and migration

Canonical target maps, aliases and discovery move from
`llm-gateway/src/personal-passthrough/target.ts` into mesh. Gateway consumes the
new mesh API. To avoid an abrupt source break, gateway may re-export deprecated
symbols for one minor release, with deprecation pointing to mesh. It must not
keep a second value copy.

The fixed `maxRetries=2` loop is replaced by execution of the mesh plan. Legacy
gateway configuration is translated to `RoutePolicy` where unambiguous;
unsupported implicit defaults fail with a clear migration error.

Codex enrollment is explicit and new. Existing Cloud Code enrollment remains
valid: legacy local records require the host's explicit stable owner binding,
then retain their stored credential and `google` -> `gemini` normalization. No
h2a file or secret is read by either package during migration.

## 7. Configuration surface for consumers

Minimum public options consumers must be able to wire:

- requested model/alias;
- explicit provider, transport and redacted account constraints;
- `last-enrolled`, ordered and new-affinity round-robin strategies;
- ordered per-model/alias/intent/capability rules;
- named policy profile show/validate/use/set-order operations;
- affinity key;
- fallback mode;
- negative-cache TTL;
- maximum attempts;
- same-transport preference;
- strict stickiness;
- equivalent-model fallback;
- opt-in equivalent-account rotation;
- host/workspace council override or exclusion extension;
- redacted route diagnostics.

The default configuration is safe and useful without consumer routing code:
last-enrolled-first, `retest-preferred`, five-minute negative cache, maximum
three attempts, same-transport preference, strict sticky account, equivalent
models allowed only with fresh evidence, equivalent-account rotation disabled.

## 8. Security and operational invariants

- Caller-owned accounts only unless cross-user pooling has both explicit grant
  and kill switch enabled.
- Gateway obtains the owner exclusively from verified authentication context;
  body/config owner fields are rejected.
- Mesh owns provider credentials and executes opaque prepared attempts; gateway
  never receives provider tokens, refresh tokens, client secrets or account ids.
- Gateway session bearers are opaque, short-lived, revocable and distinct from
  provider credentials; consumers may keep them in memory only.
- Routing diagnostics use opaque account refs; tokens never serialize.
- Negative-cache keys and affinity keys contain no raw token or email.
- Host overrides cannot invent an executable transport below its readiness
  level or bypass a model allowlist.
- Benchmark refresh inputs are pinned and reviewed; CI has no live model call.
- A council override is versioned and its provenance appears in diagnostics.
- One-way promotion and manual reset are audited.
- State growth is bounded by TTL and maximum entry count.
- Gateway preserves request body/stream size limits across attempts.

## 9. Test and acceptance matrix

### 9.1 Mesh unit/contract tests

- Last successfully enrolled account is first for a new affinity.
- Existing lease wins regardless of later enrollment.
- Enrollment completion persists/restores and deterministic ties are stable.
- Ordered strategy, per-model rules and named-profile activation are atomic.
- Round-robin affects only new affinities and never breaks a lease.
- Explicit request/consumer/workspace/host precedence is deterministic.
- Capability-incompatible equivalences are rejected.
- Stale evidence and expired exclusions fail council validation.
- Every catalog model is classified or explicitly excluded.
- Refresh output is deterministic and check mode detects drift.
- Same-transport equivalents precede cross-transport equivalents.
- Negative cache suppresses until TTL and retests exactly at expiry.
- One-way promotion persists until explicit reset.
- Promotion/reset/rebind are owner-scoped, audited and race-safe.
- Strict sticky mode never changes account.
- Account rotation requires opt-in and reports cache risk.
- `maxAttempts` bounds plans; invalid TTL/attempt settings fail.
- Auth/invalid-request/cancellation outcomes do not poison availability.
- Plans and diagnostics contain no executable material.
- Plan/candidate references reject replay, forged owners, expiry and stale
  policy/council/affinity revisions.
- Health scopes suppress a broken account/transport across equivalent routes;
  valid `Retry-After` overrides generic TTL within bounds.
- Lossless fixtures cover tools, tool results, images, thinking, stop reasons,
  usage, safe headers and SSE order; unsupported capability fails pre-commit.
- Codex/OpenAI adapter executes through a newly enrolled Codex descriptor.

### 9.2 Gateway unit/contract tests

- Candidate two runs only after candidate one fails before commitment.
- No candidate runs after first header/body/SSE byte.
- Attempt count never exceeds the mesh plan.
- 429/5xx/network mappings are adapter-specific and deterministic.
- Cancellation releases without retry or negative-cache health outcome.
- Caller ownership and cross-user kill switch hold on every attempt.
- Anthropic/OpenAI error and stream fixtures remain wire-compatible.
- Anthropic `message_start` reports bounded request-derived input usage
  before provider completion; terminal `message_delta` reports output only.
- Long text, Unicode, tools and embedded binary/image data exercise the
  estimator, while OpenAI usage and provider settlement remain unchanged.
- Deprecated gateway route exports are identical mesh re-exports.
- Cost events are not duplicated across attempts.
- Pre-commit usage from failed attempts is included once in aggregate usage.
- Status/headers are not committed until the first valid stream frame exists.
- Gateway never observes provider credentials or raw account identity.
- No secret/account identity leaks in response or logs.

### 9.3 CI gates

- `make check-llm-model-equivalences`
- `make typecheck-llm-mesh`
- `make test-llm-mesh`
- `make build-llm-mesh`
- `make pack-llm-mesh`
- `make typecheck-llm-gateway`
- `make test-llm-gateway`
- `make build-llm-gateway`
- `make pack-llm-gateway`
- repository package-bump enforcement for both changed `src/**` trees

### 9.4 h2a functional UAT before merge

h2a integrates the exact PR candidate locally and reports its Sentropic commit
SHA, package versions, tarball SHA-256 values and provenance. Sentropic supplies
`npm pack` artifacts from that commit plus the complete local gate results; h2a
installs them in an isolated worktree and restores its prior state afterward.
The UAT must cover:

1. enroll Cloud Code and Codex/another available transport;
2. confirm a new session selects the last successfully enrolled eligible route;
3. confirm explicit selection overrides that default;
4. make the preferred route unavailable before streaming and observe bounded
   fallback with same-transport preference;
5. repeat within TTL (no bombardment), then after TTL (preferred retested);
6. confirm a started stream is never replayed through another provider;
7. confirm strict session/account stickiness and the warning/behaviour of the
   opt-in rotation mode;
8. run a real Claude Code session through the gateway, including compact
   continuation, to detect the prior 500/502 and Cloud-Code-only regressions;
9. logout, re-enroll and confirm routing state updates without stale secrets;
10. verify redacted diagnostics and no credential leakage.
11. verify ordered inversion, round-robin only across new affinities and two
    distinct per-model rules with requested/actual evidence;
12. execute both Cloud Code and Codex, including tools and image input when the
    enrolled transports support them;
13. exercise reset/one-way, concurrent requests and suppression of repeated
    equivalent routes backed by the same unavailable account/transport.

Any failure in items 2–10 blocks merge. h2a owns its local integration changes;
this Sentropic branch records only the returned evidence.

## 10. Versioning and release

This is an additive public feature with ownership migration:

- bump `@sentropic/llm-mesh` minor version;
- bump `@sentropic/llm-gateway` minor version and its mesh dependency floor;
- check registry versions before choosing numbers and again after final rebase;
- never run manual publication from the branch;
- merge-triggered CD publishes only versions absent from npm;
- CD publishes mesh first, waits until the gateway dependency floor is visible,
  then publishes gateway; gateway publication before mesh visibility fails;
- verify both versions become visible after merge.

## 11. Explicit non-goals

- Editing h2a in this repository/branch.
- Cross-user pooling by default.
- Retrying or replaying a partially emitted stream.
- Claiming provider prompt-cache continuity without wire proof.
- Live benchmark execution in CI.
- Auto-enrolling or recovering legacy Codex credentials.
- Building a second routing table in gateway or a consumer.
- Adding new provider transports unrelated to routing.

## 12. Review questions

Reviewers must challenge at least:

1. whether any policy or catalog knowledge still leaks into gateway;
2. whether any wire/execution concern has been incorrectly moved into mesh;
3. interaction of strict account stickiness, equivalence fallback and one-way
   promotion;
4. correctness of response commitment and retry classification;
5. catalog/council completeness and refresh reproducibility;
6. consumer configuration sufficiency for h2a without copied routing data;
7. secret, caller-ownership, cost and cache-continuity risks;
8. whether the proposed lots can ship as compatible minor releases.

## 13. Review log

- Gemini 3.6 High: `APPROVE_WITH_CHANGES` on v1 SHA-256
  `e260831daebb04525382b1e10a0030b993cfb5875e06802a421302d04cc02d82`;
  archived in `docs/reviews/llm-mesh-gateway-routing/GEMINI_3_6_HIGH.md`.
- h2a consumer: `APPROVE_WITH_CHANGES` plus addendum on the same v1 SHA-256;
  archived in `docs/reviews/llm-mesh-gateway-routing/H2A.md`.
- Reconciliation: all blocking and major findings are normative in v2. The
  reviewers requested no further owner decision. Product implementation is
  authorized; h2a integration remains gated on the exact package candidate.
