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

### D8 — GLM 5.3 supplemental fallback

A fourth supplemental fallback candidate, `zai-glm-5-3` served over the
`mistral-vibe` account transport, is appended LAST to every mapped launch
alias (after Muse, Codex and Cloud Code). Owner decisions 2026-10-07 and
2026-10-08, grounded on the Artificial Analysis Intelligence Index v4.3.2
(GLM-5.3 (Max) = 45 = Claude Opus 5 (Medium)):

- The Opus 5 and Opus 4.8 families keep the measured GLM-5.3 (Max)
  configuration: effort `max` on every rung.
- The Claude 5.5 families (opus and sonnet, base/low/medium/high/xhigh/max)
  and the Fable 5.1 family mirror the requested effort at +1 rung on the
  GLM native low/high/max ladder: base/low/medium map to `high`,
  high/xhigh/max map to `max`.
- Sonnet 5 and Fable 5 (non-5.1) aliases stay out of the GLM map.
- Aliases absent from the map get no GLM candidate; no alias loses its
  Anthropic-first route.

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

The `claude-opus-5-5` and `claude-sonnet-5-5` families are standard
multi-candidate launch aliases (base/high/xhigh/max/medium/low): Muse
contributor first, then Codex, then Cloud Code, with no Anthropic faithful
target (no catalog profile exists for either family). Every launch alias
carries Muse, Codex and Cloud Code candidates, so any single enrolled
transport serves any requested id; `no-route` is returned only when no
candidate transport holds a usable account. The Codex slot serves
`gpt-6-astra` only for `claude-opus-5-5-max` and the `claude-fable-5-1`
family, otherwise `gpt-6.1-sol` at +1 effort rung (base to high, high to
xhigh, xhigh to max, max to max by clamp, medium to high, low to medium);
the Muse candidate follows the same +1 rule. Serving choices are grounded
on Artificial Analysis Intelligence Index v4.3.2 (opus-5.5-max 58,
sonnet-5.5-max 56, astra-max 53, fable-5.1-max 53, sol-6.1 52, opus-5-max 51,
muse-1.3-max 48, flash-3.8-high 41).

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

No per-alias affinity exception remains: a stored affinity incompatible
with the requested alias is served as the sticky candidate without mutating
stored state, and a later success never migrates it (callers own the affinity
lifecycle across `/model` switches). A quoted plan ignores an unquoted sticky
target and plans fresh. `cacheContinuityRisk` stays account-scoped: a
same-account model switch reports no risk.

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

Unknown or unsupported model is terminal: no retry or fallback can produce the
model, so the gateway answers 404 (Anthropic `not_found_error` / OpenAI
`invalid_request_error` code `model_not_found`, requested-model-only message)
instead of the misleading overloaded body. A known-model `no-route` without an
enrollment-action diagnostic is a non-retryable HTTP 503 (BR-REL-Q7: Anthropic
`api_error` / OpenAI `server_error` code `no_route`, `x-should-retry: false`, no
`Retry-After`); the enrollment-action branch (`authentication_error` +
`X-Sentropic-Route-Action`) is unchanged. Requests refused before admission emit
no durable or hold-bound financial event (package-level notification only); once
a hold exists the admitted-plan settlement rule applies with release-before-metering,
and a ledger/settlement or `recordOutcome` failure never replaces the typed/terminal
refusal (attempted once, swallowed, original thrown). After response commitment
the HTTP status is never rewritten.

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

The terminal canonical Anthropic `message_delta.usage` carries output usage only.
Provider-reported input/output usage remains authoritative for aggregate
financial settlement and diagnostics; the first-frame estimate is a
caller-compatibility signal, not a billing record. OpenAI stream usage is
unchanged.

### 5.6 Native relay, count and usage

This section describes built mesh/gateway contracts. Native pricing/ledger
wiring is built and inert-tested; live provider gates remain pending and no
production enablement is claimed. Canonical compaction/egress in §5.5 is
unchanged; native usage bytes may contain cumulative input extensions and are
never reconstructed canonically.

Native Messages preserves nested body identity/unknown fields with a shallow
copy, overriding only selected model, boolean stream and validated/admitted
max_tokens. Native JSON success requires kind=json/status=200 and relays the
parsed object semantically, including safeguard_results. SSE relays original
bytes/comments/unknown events/line endings with pull backpressure and a 1 MiB
pending-frame bound. The first complete non-error frame commits once; no retry
after commitment or rejected commit callback. Late errors are sanitized native
error frames, close upstream and never manufacture message_stop. Bounded native
validation messages and terminal request_too_large follow §§5.3–5.4. After
commitment and 15 s of upstream silence the relay emits only `: keepalive`
comments between complete frames; keepalives carry no usage and never
interleave into a frame, and abort shutdown settles promptly with no surviving
timer.

Request forwarding starts empty and permits only anthropic-*, x-app and
x-stainless-* after credential/session/hop-by-hop/Connection/internal exclusions;
caller user-agent/IP/encoding/authority headers are dropped. Hosts derive transport
headers/Content-Length from the trusted URL/serialized bytes and set server auth
last. Native success adds anthropic-* to canonical safe response names, including
owner-accepted organization disclosure; errors forward no upstream headers.
Validation 400s are bounded to a 64 KiB UTF-8 error body and a control-stripped
4096-byte public message. Billing masking precedes truncation/safeguards detection;
only an owned safeguards request rejecting the exact sent classifier beta gets
the narrow rewrite. Canonical 400s and other errors keep fixed sanitization.

X-Sentropic-Relay:native is success-only. Native Messages JSON X-Sentropic-Served
comes only from a safe response ID for one model without fallback/substantive
iterations; selected identity is never a substitute. A safe mismatch can be
reported while pricing remains uncertain. Native SSE omits the header because
late evidence can invalidate identity; no delayed bytes or invented trailers.
Count omits it. Gateway diagnostics are emitted last and cannot be spoofed.

POST /v1/messages/count_tokens is authenticated, partition-checked and JSON-only.
A trusted count port/exact model/version is required; the count port stays
available with native OFF, while ON is native even without beta/safeguards.
OFF/known denial returns 400, unknown catalog models 404. Forward a shallow copy
unchanged, insert no ceiling/stream and make one call without retry. Validate
input_tokens as a nonnegative safe integer. One process limiter keys verified
tenant/principal: burst 10, refill 1/second, two concurrent calls; 429 has
integer Retry-After, cancellation never refunds a dispatch token. Evict idle keys
after ten minutes excluding live calls; at 10,000 keys a new key fails closed
with 503. Count has no generation plan/admission, hold, dispatch marker,
financial settlement, usage observation or debit.

All three POST paths share one checked bounded read and one process-owned pool,
native ON or OFF: L=B=32,000,000 actual bytes by default. Start at zero; check
N+q <= L, grant q atomically, then retain/copy exact q backing capacity. No
Content-Length allocation/reservation, geometric slack, oversized backing views,
raw consolidation, clone or waiting queue. EOF decodes/parses once under exact N.
Unavailable extension cancels reading, discards partial storage and returns
retryable pre-parse request-body-capacity 503 with Retry-After:1 and
x-should-retry:true, without quote/hold/dispatch/financial or observation event.
Actual oversize has 413 precedence. Concurrent small requests reserve actual
bytes rather than one full cap each. Transport chunks are the explicit transient
exception; pool accounting/8x sizing assumptions are not measured memory proof.

N1 retention follows references: native hosts finish/cancel upload and detach
body/serialized/view holders before exposing commit-ready SSE or completed
JSON/count. Response iterators/abort/finalize closures retain response state and
bounded metadata only. Gateway clears cache/body/retry holders before shrinking;
fetch headers alone cannot prove upload completion. Canonical SDK operations and
streams keep measured N through retries and terminal cleanup. N2 cleanup detaches
before once-only release on every post-acquisition refusal, abort/error/timeout,
completion and never-consumed stream, preserving original refusal/hold rules and
adding no financial event. Cleanup never waits for observation hooks. N3 storage
never exceeds granted backing bytes, including forged Content-Length uploads.

The gateway owns one usage fold and freezes one pre-floor terminal snapshot for
settlement and once-only finalize. Physical P=U+R+aggregate writes; TTL splits are
not added twice. Policy anthropic-cache-2026-10-02 prices units40 as
40U+50W5+80W1+4R (Sonnet 5/Opus 5), or 40U+50W5+80W1+R (Fable 5.1). A safe
matching served model, complete JSON/start proof and bounded integers are required.
Missing/null/[] iterations are absent; fallback, mismatch or substantive/malformed
iterations permanently latch served_model_mismatch, disable discounts and use the
pinned selected model's full physical rate with allowance floors. Iterations are
never summed or latest-wins; opaque wire data is not persisted usage.

Start-anchored deltas inherit absent/null U/R/aggregate/split. Equal aggregates
reuse accepted TTL allocation; growth alone uses eligible five-minute weight,
otherwise 2x with separate cache_write_split_inferred evidence, which alone does
not prevent measured clean completion. Reported TTL counts remain distinct from
inference; a later consistent split may resolve allocation. Decrease/conflict or
fractional/nonfinite/unsafe input atomically rejects the update and permanently
revokes proof (N5); safe counts remain physical lower-bound evidence, never a
restored discount. Partial deltas cannot bootstrap a missing start or combine
conflicting starts/models. Cumulative output is not summed; start output is
provisional, final delta plus clean message_stop (or successful JSON) is final.

Clean positive measured input/output has no allowance floor. Interrupted SSE
with usable same-model start-derived input proof preserves latest accepted input
and floors output only. No-proof cases floor both sides; initial unknown write
split uses the sourced 2x bound conservatively. Observation counts stay physical
and pre-floor even if financial output rises from 500 to 32,000. Host pricing must
validate exact pinned provider/model/served identity, policy and units40 bounds;
failed validation uses full physical rate. API persistence/audit joins are built
and inert-tested; live memory/pricing qualification remains a later gate, not
inferred from package tests.

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

## 14. Muse enrollment + `musePosition` contract (BR-75, `feat/muse-enrollment`)

This section records the Meta Muse Code 1.3 (`muse-spark-1.3`) enrollment as
implemented. Every statement below traces to branch code or its tests; routing
invariants from §2 still apply (mesh owns the candidate plan, gateway stays a
thin data plane).

### 14.1 Provider surface (mesh catalog)

- `muse` is the 8th mesh provider id (`openai`, `gemini`, `anthropic`,
  `mistral`, `cohere`, `gcp`, `local`, `muse`) in
  `packages/llm-mesh/src/providers.ts`, with per-provider keys
  `muse-spark-1.3` and `muse-spark-1.3-contributor`.
- Provider profile (`packages/llm-mesh/src/catalog.ts`): family `meta`, label
  `Meta Muse`, status `planned`, reasoning tier `advanced`, account transport
  `['muse']`. Structured output stays at the conservative
  `tool-input-schema` (partial) template until the transport proves the wire.
  Both models carry `advanced` reasoning with vision.
- The `-contributor` key is a discounted tier option (content may improve the
  product); the gateway default is contributor (BR75-Q3). Tier is an option,
  not a separate provider.
- `MuseAdapter` is registered in the default adapters
  (`packages/llm-mesh/src/adapters.ts`); the mesh registry exposes both Muse
  model ids through it.
- Equivalence council: both `muse:muse-spark-1.3` and
  `muse:muse-spark-1.3-contributor` are listed in
  `GENERATED_MODEL_COUNCIL_SOURCE.excludedModelKeys`
  (`packages/llm-mesh/src/generated-model-council.ts`) — excluded for lack of
  pinned benchmark evidence, consistent with §D3 (explicit, justified
  exclusion instead of silent substitution).
- Covered by `packages/llm-mesh/tests/muse.test.ts` (provider set 7→8,
  adapter registration, Meta family) and the council expiry/unknown-key
  checks in `packages/llm-mesh/src/equivalence-council.ts`.

### 14.2 API-key path (Chapitre A)

- Credential precedence in `resolveMuseApiKey`
  (`api/src/services/providers/muse-provider.ts`): explicit per-call
  credential first, then `MUSE_API_KEY` (CI secret name), then
  `MODEL_API_KEY` (repo-root `.env` fallback, BR75-Q1). No other generic
  name is read. Both names are optional strings in `api/src/config/env.ts`;
  `api/src/services/provider-credentials.ts` delegates `muse` to
  `resolveMuseApiKey()`.
- The api registry (`api/src/services/provider-registry.ts`) holds 8
  runtimes including `muse`; `listProviders`/`listModels` cover the 8 mesh
  providers.
- Runtime dispatch status: `MuseProviderRuntime.listModels()` returns `[]`
  until a dispatch path exists — advertising unservable models would route
  live traffic into a throw. `generate`/`streamGenerate` accept only mode
  `'msp'` and otherwise reject with "direct dispatch is not configured".
  Error normalization tags `providerId: 'muse'`, retryable on 429/5xx.
- Covered by `api/tests/unit/muse-provider.test.ts`,
  `api/tests/unit/provider-credentials.test.ts`, and
  `api/tests/unit/provider-registry-expansion.test.ts` (asserts muse lists
  no models yet).

### 14.3 Account-transport path (Chapitre B, local CLI import)

- Source of truth is the Muse CLI store `~/.config/muse/auth.json`, entry
  `providers.meta` (mesh `packages/llm-mesh/src/enrollment/muse.ts`;
  api mirror `readMuseCliEntry` in
  `api/src/services/llm-account-transports.ts`). Token is
  `access_token ?? api_key`; identity is `user_email`. There is no browser
  or device OAuth round-trip — the CLI owns token lifecycle.
- `start` opens a `local-import` session (`source: 'muse-cli-auth-file'`,
  id `enr_muse_…`, 15-minute expiry). `complete` maps the `meta.*` entry to
  a `PreparedCredential`: stable `acct_muse_…` id (SHA-256, 12 hex chars,
  over email, else token, so re-imports converge on one account), 1-hour
  import TTL, `authClientConfigVersion` from `schema_version`. Error paths
  never leak file content (secret-redaction cases in tests). `cancel`
  marks the session; completion afterwards is refused. `resolve` reports
  provider `muse` + account id.
- Refresh re-reads the CLI store for the same account and rejects a
  changed login ("different login than the enrolled account"). Api-side,
  `refreshMuseTokenIfNeeded` runs lazily on acquire only when the stored
  token is expiring (single-flight per account); success rewrites the DB
  secret with source `muse-refresh` and status `active`, failure flips the
  account to `reauth_required`. There is no OAuth refresh endpoint.
- Mesh wiring: `muse` is in `accountTransportProviderIds` and the
  executable list (`packages/llm-mesh/src/auth.ts`); the facade
  (`packages/llm-mesh/src/service/facade.ts`) registers
  `MuseEnrollmentProvider` and exposes `completeMuseImport(enrollmentId,
  code, ownerScopeRef)` — the caller binds the explicit enrolling owner,
  never inferred from stored state
  (`packages/llm-mesh/src/service/local-account-transport-service.ts`,
  label `Muse (…)`).
- DB lease (`api/src/services/llm-account-transports.ts`):
  `storeMuseAccountTransport` upserts `llm_provider_accounts` with
  target/transport `muse`/`muse` (conflict key owner + target + transport
  + external account, source `muse-import`);
  `acquireMuseAccountTransport` leases with default model
  `muse-spark-1.3-contributor` and `stableSessionPrefix: 'muse'`;
  `getPrimaryMuseAccountTransport` / `disconnectMuseAccountTransports`
  complete the lifecycle. Secret envelope is
  `MuseTokenSecretPayload` (`refreshToken: null`, source
  `muse-import | muse-cli | muse-refresh`).
- HTTP surface (`api/src/routes/namespaces/llm-mesh-enrollment*.ts`,
  `api/src/services/provider-connections.ts`): intents `muse:start`
  (accountLabel only), `muse:import` (enrollmentId + accessToken required;
  apiBaseUrl, accountEmail, expiresAt, accountLabel optional),
  `muse:disconnect`. Connection state label is `Meta Muse`; start issues a
  pending CLI-import session, import derives the external account id with
  the same `acct_muse_` scheme and requires the CLI store account email.
- Covered by `packages/llm-mesh/tests/enrollment/muse.test.ts` (session
  shape, `meta.*` mapping, stable id, `api_key` fallback, redaction,
  cancel, refresh-by-reread, resolve) and
  `api/tests/unit/llm-account-transports.test.ts` (store/acquire round
  trip, multi-tenant `userId` isolation, expired-credential refresh on
  acquire).

### 14.4 `musePosition` routing contract

- Type `MusePosition = 'off' | 'after-claude' | 'first'`
  (`packages/llm-mesh/src/routing-targets.ts`); default
  `DEFAULT_MUSE_POSITION = 'after-claude'`. Threaded through
  `createCanonicalTargetResolver` /
  `createCanonicalTargetCandidatesResolver` via
  `CanonicalTargetResolverOptions`; per-position mappings are memoized.
- Muse insertion efforts (`MUSE_ROUTE_EFFORT`, BR75-D1): `claude-fable-5[*]`
  and `claude-fable-5-1[*]` (bare, `-high`, `-xhigh`, `-max`) → `max`;
  `claude-opus-5-high` / `-xhigh` → `xhigh`; `claude-opus-5-max` → `max`;
  `claude-opus-4-8-xhigh` → `xhigh`; `claude-opus-4-8-max` → `max`.
- The muse candidate is always the contributor model
  (`MUSE_CONTRIBUTOR_MODEL = 'muse-spark-1.3-contributor'`) at the mapped
  effort, emitted only when a model profile backs it. Aliases absent from
  `MUSE_ROUTE_EFFORT` get no muse candidate: `claude-sonnet-5`,
  `claude-sonnet-5-xhigh`, `claude-sonnet-4-6` and the bare opus rows plan
  3 candidates (faithful Claude → codex → cloud).
- Candidate order for muse-bearing aliases: faithful Claude, then muse,
  then codex, then cloud (`after-claude`, the default); `first` puts muse
  before faithful Claude; `off` drops the muse candidate, leaving the
  pre-existing 3-route plan. The canonical (single-target) resolver picks
  the first profile-backed candidate, so faithful Claude stays primary
  under the default.
- Cloud fallback for every alias in `STANDARD_ROUTE_DEFINITIONS` is
  `gemini-3.8-flash` at forced `high` effort; the codex side is unchanged
  (`gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna`, `gpt-6-astra` at
  `medium` for opus high/xhigh rows, `high` for `-max` rows).
- Covered by `packages/llm-mesh/tests/routing-targets.test.ts` (order
  claude→muse→codex→cloud, `musePosition` variants, fable-5/5.1 `max`,
  opus-max rows, 3.8-flash fallback, bare muse ids provider-faithful) and
  `packages/llm-gateway/tests/target.test.ts` + `router.test.ts` (same
  order/efforts on the gateway side).

### 14.4b Muse Wonder + Wonder Full (owner request 2026-10-13)

- Catalog (`packages/llm-mesh/src/catalog.ts`): `muse-wonder-1.0` (label
  `Muse Wonder`) and `muse-wonder-full-1.0` (label `Muse Wonder Full`),
  both `advanced` reasoning with vision, same task hints as Spark.
  `muse-wonder-1.0` is the exact model id from the local Muse CLI config
  (`~/.config/muse/settings.json` `model`; model ids only — no secret was
  read or copied). The Full id is verified against the local Muse
  provider catalog as `muse-wonder-full-1.0` (owner correction 2026-10-14).
- Provider routing: both ids in `knownModelIds` /
  `knownModelIdsByProvider.muse` (`providers.ts`), both mapped to the
  `muse`/`muse` target (`routing-targets.ts`), both listed in
  `GENERATED_MODEL_COUNCIL_SOURCE.excludedModelKeys`
  (`generated-model-council.ts`) like Spark (no pinned benchmark evidence).
  The gateway default stays the Spark contributor (`MUSE_CONTRIBUTOR_MODEL`
  unchanged); no api change (account transport acquisition is
  model-agnostic).
- Responses-wire compatibility: execution features are transport-keyed, so
  both Wonder ids inherit the proven `muse` set (`reasoning-controls`,
  `explicit-output-ceiling`, `strict-schema`, §16.3/16.4 amendments apply
  unchanged) and serve through the translated Muse adapter.
- Effort mapping: no per-model effort table exists in mesh — the canonical
  `reasoning.effort` passes through the Responses wire unchanged for every
  muse model (CLI tiers none/minimal/low/medium/high/xhigh/max/ultra per
  `muse model-profile --help`).
- Count/accounting: model-agnostic — `responsesUsage` mapping and
  route settlement/quote allowance apply identically (no per-model pricing
  table in mesh or gateway).
- Covered by `packages/llm-mesh/tests/muse.test.ts` (4-model surface),
  `routing-targets.test.ts` (Wonder resolution), and the real-planner
  replay (`packages/llm-gateway/tests/responses-real-planner.test.ts`:
  a Responses body on each Wonder id serves 200 with usage preserved).

### 14.5 Runtime status and enrollment proofs

- As of this writing the api runtime still lists no muse models
  (§14.2): enrollment (both chapters) and routing candidates are unit
  proven, but no live serving dispatch is claimed.
- Proof 1 (green, 2026-09-20, owner-authorized): `local-import` session →
  account `acct_muse_…` enrolled → acquire OK with real token (never
  printed) → removed, keyring verified empty. Ephemeral in-memory service,
  `/tmp` script only, nothing committed, no secret in logs.
- Proof 2 (RED / open): pooled live dispatch verdict on `loop-mu94uk70`
  is still pending. A live probe returned Meta billing 402, so no live
  muse dispatch is claimed and Lot 4 version bumps stay blocked until a
  pooled live verdict lands.

### 14.6 Native device-flow enrollment — `MuseCodeEnrollmentProvider` (DESIGN CONTRACT, not yet implemented)

Unlike 14.1–14.5, this subsection is NOT implemented in branch code. It is a
design contract whose wire facts are sourced from **static analysis of the
installed `muse` CLI** (wrapper `~/.local/bin/muse` in clear text + ELF
`muse-bin-1.3.0-R3401.1`, read-only, no network, no secrets extracted — only
endpoint literals, header names, and serde field names). Facts are tagged
`[MEASURED]` (literal present in the binary) or `[GAP]` (not determinable
statically; resolvable only by an owner-authorized live probe). It exists
because the import-only path (14.3) **cannot maintain a live session by
construction**: `~/.config/muse/auth.json` persists neither `refresh_token`
nor an expiry, so mesh refresh can only re-import, never renew.

**Why it matters.** The owner's stated criterion requires native enrollment
("il faut aussi tester l'enrolemetn natif") and a working keepalive
("que ca pete pas au bout de 1 min … aussi pour muse-code"). Only a
mesh-driven device flow that keeps `refresh_token` in the keyring satisfies
both. This is the peer-requested `MuseCodeEnrollmentProvider`.

**Flow (three legs):**

1. Authorize — `[MEASURED]` `POST https://auth.meta.com/oidc/device/authorization/`,
   `client_id=1031625952748946` (public RFC 8628 client). Returns
   `device_code`, `user_code`, `verification_uri_complete`, `expires_in`.
   Surface the verification at `https://accountscenter.meta.com/muse_code/`.
2. Poll token — `[MEASURED]` `POST https://auth.meta.com/oidc/device/token/`,
   `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code`,
   `client_id`. Success = `TokenGrant{access_token, refresh_token, expires_in}`.
   Handle `authorization_pending` / `slow_down` / `access_denied` /
   `expired_token`.
3. Mint API key — `[MEASURED]` `POST https://api.meta.ai/muse-code/key`,
   header `x-api-version: 1.0.0`, body `{"dca_token": <access_token>}`
   (`dca_token` is the only request field found adjacent to `KeyMintManager`).
   Response struct `MintedKey` (14 fields, measured, all serde-optional):
   `title, detail, api_key, require_payment, action_url, user_full_name,
   user_email, is_subs_active, subs_tier_id, subs_tier_name,
   is_subs_upgrade_available, has_payment_method, can_subscribe, subs_usage`,
   with `subs_usage{window{window_duration_mins}, weekly{used_percent,
   resets_at}}`.

**Onboarding / payment (not a hard failure).** On `MODEL_API__ONBOARDING_REQUIRED`
/ `4705001` / `4705002`, surface `action_url` to the enrolling user rather
than failing hard — the account exists but needs onboarding or a payment
method.

**Quota MUST be surfaced, never swallowed (h-cond).** `subs_usage`
(`weekly.used_percent`, `weekly.resets_at`) must reach a readable surface,
even minimal. The worst failure mode observed across Codex/Opus this week was
a tool going silent at quota exhaustion instead of saying it was out of
credit; a paid metered service must not repeat it.

**Security guarantee, by construction (h-cond).** `access_token`/`dca_token`
and the minted `api_key` flow service → keyring only. They are never returned
to, logged by, traced by, or messaged through an agent. The surface exposes
"enrolled/authenticated", never the secret. `MintedKey` is deserialized on
the keyring side, out of agent reach.

**Keepalive / refresh (now possible).** Persist `refresh_token` + `expires_in`
(the import-only path discards them). `refresh()` either replays
`grant_type=refresh_token` against the token endpoint `[GAP: refresh grant
string not isolated]`, or re-mints via KeyMint with a fresh `dca_token`.

**GAPs — defensively handled, NOT blocking a build; a live probe only confirms:**

- Auth mode of the mint call: whether an `Authorization: Bearer <token>`
  header is required in addition to the body `[GAP]`. Defensive rule: send
  body-only; on a single `401`, retry **once** with the Bearer header, then
  fail up — **never loop**. This retry is an **unmeasured** hypothesis against
  a production auth endpoint with the owner's token: two consecutive attempts
  may trip attempt-counting or lockout whose policy we do not control, so the
  bound is one and the first executor must know it is probing.
- `Content-Type` `[GAP]`: use `application/json`.
- `onboard` literal `[GAP]`: semantics undetermined (query param vs
  discriminant); handled via the response onboarding fields above.
- `base_url` `[GAP]`: not a `MintedKey` field; default to
  `https://api.meta.ai/v1` (measured ClientBuilder default, matches
  `auth.json.api_base_url`) unless the response carries one.
- Exact success-field subset `[GAP]`: `MintedKey` fields are all optional →
  deserialize permissively.

**Separability.** Enrollment (this provider, mesh-side, `packages/llm-mesh`)
and the Meta **serving leg** (gateway/daemon registry, h-runtime) are separate
concerns: enroll produces a keyring credential; serve consumes it over the
Meta wire (`https://api.meta.ai/v1`, api-key auth, `x-api-version: 1.0.0`).
The serving leg does not depend on this provider's code — it depends on the
same measured wire facts. Both must exist for §14.5 Proof 2 to go green.

## 15. Muse/vibe wires, `count_tokens`, gaps and operational diagnostics (branch `fix/llm-gateway-muse-vibe-wires`)

This section records the branch-scoped evolution on top of v2. Normative
unless marked otherwise. The auto-mode free-classifier billing change is
explicitly OUT of this branch (later PR; the gateway keeps managing
metering/leases/auth with opt-out).

### 15.1 Muse and vibe ingress

- Muse chat needs no new ingress: `POST /v1/chat/completions` already parses.
  The missing piece was catalog route `GET /muse-code/models`, served by the
  shared `/v1/models` handler (Lot 1).
- Vibe needs no new ingress (OpenAI-compatible). Root cause was the missing
  `mistral-medium-3.5` static mapping + catalog profile (256K context per the
  Vibe CLI model card), added via the `llm-mesh-add-model` scaffold (Lot 2).
- Cloud-code rides the same wires: the CLI-default lock test covers the
  muse/vibe/cloud-code triple so no repeat request is needed (Lot 4).

### 15.2 `count_tokens` on the Anthropic wire

`POST /v1/messages/count_tokens` relays the authenticated caller body to the
Anthropic count endpoint and returns the provider count verbatim. No token
estimator is built: an estimate would corrupt Anthropic cache accounting.

- Gateway route (Lot 3, evolved to a real relay): a malformed body or a
  missing model maps to a provider-shaped 400 before authentication;
  authenticated callers get the frozen unknown-model 404 only for
  unrecognized IDs. A `safeguards` field in the body is refused fail-closed
  with 400 (never silently dropped — deliberate deviation from the #633
  native relay draft, which forwards it when native Messages is enabled).
  Without an injected `NativeCountTokensPort` the route keeps an explicit
  provider-shaped refusal (400 `count_tokens is not supported`) so the
  client falls back to its own local counting.
- Host port (api, `gateway-count-tokens.ts`, injected through
  `gateway-route-plane.ts` and the `gw.ts` `nativeCountTokens` option): the
  trusted host resolves the credential — the caller's provider credential
  when present (user BYOK, else workspace key, else the server environment
  key), else the owner's claude-code account transport (only under
  `claude-code` transport mode with an `active` or `cooldown` primary
  account). Caller fields never select a credential, account or URL, and
  the model allowlist is the exact `anthropic` catalog, never an alias
  catalog.
- Transport headers follow the #633 native Messages contract
  (`nativeTransportHeaders`): the gateway-validated forwarded headers
  (`anthropic-beta` and friends) and the negotiated `anthropic-version` ride
  the provider request, so a body that relies on beta fields or tools is
  counted exactly as it will be served. Deviation from #633: the count
  transport uses the Anthropic SDK instead of the native HTTP framer, and
  `safeguards` is refused instead of forwarded.
- Per-principal engineering limits apply before dispatch (`nativeCountRate`,
  429 `rate_limit_error` on exhaustion without a provider call).
- The account lease taken by the host port is advisory-only: any counting
  failure completes the reservation with a neutral `failed` outcome — a
  401/403 from counting never flips the account to `reauth_required`, and a
  429 from counting never starts a cooldown; the inference account keeps
  serving. Nothing is metered and no budget is admitted on any count path
  (the gateway itself takes no lease).
- Upstream failures are re-exposed provider-shaped and sanitized: 401/403 →
  generic 401 `authentication_error`; 429 → 429 with the provider
  `Retry-After` (1-second floor when absent); other 4xx keep their type with
  a byte-capped public message; network/5xx → sanitized 503
  `api_error`. No credential, account or host detail rides out.

### 15.3 Mesh operational gaps 1–4

- Gap 1: a credential that cannot self-recover (no refresh token, or a
  refresh already failed so the status flipped to `reauth_required`) surfaces
  `reauth-required` readiness + `listDiagnostics` even before its status
  flips; the planner excludes it and the gateway answers 503 +
  `X-Sentropic-Route-Action` instead of a silent no-route. A merely expired
  ACCESS token with a live refresh token stays `ready`: `acquire()` refreshes
  it silently before dispatch.
- Gap 2: a lone route suppressed only by UNCOMMITTED failures degrades
  instead of starving for the 300s negative-cache TTL (`committed` stamp on
  `RouteFailureClassification`, `suppressedDegradable` health, single-
  candidate planner fallback). Committed failures stay strict (duplicate-
  dispatch risk); provider rate limits keep their Retry-After window (no
  degrade, no redispatch storm); multi-route suppression is unchanged.
- Gap 3: affinity whose account is gone auto-drops at resolve (deleted from
  the map) and resolves normally; not-ready accounts keep fail-closed.
- Gap 4: cross-process enroll hot-restore verified pre-existing
  (`restorePersistedAccounts` on every serving read path); per-account model
  inventory fixed via catalog profile so `supportedModelIds` + `/v1/models`
  include the scaffolded model.

### 15.4 No-route diagnostics (Lot 7)

- `RoutePlanError` carries optional `diagnostics: readonly
  RouteAvailabilityDiagnostic[]` (absent when no transport matches);
  `diagnostic` stays the first entry for back-compat by caller convention.
- `describeAvailability(subject, ...)` shares
  `matchingAvailabilityDiagnostics` with the planner no-route branch and has
  no planning side effects (it still runs account restoration, which may
  persist owner claims — "read-only" means no plan/affinity writes): an
  explicit transport restriction wins, otherwise model-derived transports
  filter `listDiagnostics` (unfiltered `[0]` once prescribed the wrong repair
  action across transports).
- `admitRoute` takes `subject` and attaches availability to an empty quote by
  throwing `no-route` with the same per-transport entries.
- The no-route 503 body joins per-transport messages (`; `-separated); the
  enrollment-action branch prefers the mesh-authored message, rebuilt template
  as fallback for messageless errors.
- Status, error type/code and headers frozen: 503 `api_error` /
  `server_error` + `no_route`, `x-should-retry: false`, no `Retry-After`;
  the enrollment-action branch (`authentication_error` +
  `X-Sentropic-Route-Action`) is unchanged.

### 15.5 Subsystem 503 messages

- `caller-auth-unavailable` -> `authentication service temporarily
  unavailable`; `pooled-account-unavailable` -> `account service temporarily
  unavailable`; `budget-unavailable` -> `budget service temporarily
  unavailable` (both wires; Anthropic `overloaded_error`, OpenAI
  `rate_limit_error` / `overloaded` unchanged).
- Status, error type/code and headers frozen; bodies carry zero account,
  lease, credential or pricing/store detail.
- Deliberate deviation from `spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md:196` and the
  B3b pin on main, which froze a single generic wording: per-subsystem
  wording is operator-distinguishable by design.

### 15.6 Codex enroll retry

- `CODEX_POLL_NETWORK_RETRIES = 3` on device poll and OAuth token exchange:
  a transient fetch throw follows the same sleep-then-continue path as a 403
  pending poll, never an instant abort.
- Linear backoff scaled on `pollIntervalMs` (`pollIntervalMs * consecutive
  failures`); 403 pending waits one uncapped `pollIntervalMs`.
- Exhausted error names the site, the retry count and the URL, and carries
  `e.cause.code` alone when present (`ETIMEDOUT`, `ECONNRESET`, ...), else
  the raw message. Raw system messages can carry hostnames/paths, so they
  never ride out alongside a code. Non-transient HTTP/incomplete-payload
  failures still fail fast.

### 15.7 Enroll-replace finding (observation, non-normative)

- No mesh defect on the enroll-replace path: all layers in this branch are
  additive (availability surfacing, message wording, retry), none replaces
  enrollment, lease or refresh state handling.
- Disk forensics (read-only, no decryption): a single successful codex
  persistence; remaining evening writes are orphan claim-sized files from
  incomplete attempts, no live-account replacement. Handoff stays on the h2a
  lane: one scope per shell (`H2A_LLM_MESH_OWNER_SCOPE` / hostname).

### 15.8 Test-matrix deltas

- `packages/llm-mesh/tests/route-planner.test.ts`: multi-diagnostic
  no-route (`diagnostic` = first, `diagnostics` = per-transport list) +
  `describeAvailability` sharing the same transport-resolution helper (no
  immutability/parity claim beyond that).
- `packages/llm-mesh/tests/service/local-account-transport-service.test.ts`:
  expired-credential messages + enroll A+B regression.
- `packages/llm-gateway/tests/errors.test.ts`: mesh-message preference +
  joined no-route detail.
- `packages/llm-gateway/tests/route-json-flow.test.ts`: expired-credential
  planner→mapper integration with a realistic entry (real planner, stubbed
  directory, direct mapper call — no HTTP, no live expiry detection).
- `packages/llm-gateway/tests/contract-snapshot.test.ts` +
  `errors.test.ts`: subsystem 503 freeze (status/type/code/headers,
  including per-kind header assertions).
- `packages/llm-mesh/tests/enrollment/codex.test.ts`: retry tests (poll
  recovery, exchange recovery, exhausted error with cause code + URL +
  secret canary, raw-message fallback without code).

## 16. PR #662 completion: Responses ingress and the Vibe wire alias

Design dated 2026-10-12, based on candidate
`904e8d8f3759b270a65d96c45b77f755e84eacd1`. This is an implementation contract,
not a claim that the routes or tests already exist. Complete this work in
PR #662; do not split its blocking defects into another PR. The build handoff
is `.h2a/design/responses-route.md`.

### 16.1 Evidence, corrections and scope

This section supersedes the ingress conclusions in §15.1. The real clients,
not a manually constructed Chat Completions request, determine compatibility:

| Client measured in the UAT | Actual inference request | Required correction |
|---|---|---|
| Muse Code `1.4.6-R6000.1` | `POST /responses`, model `muse-spark-1.3-contributor`, streaming, one tool | Add Responses ingress; retain authenticated `/muse-code/models`. |
| Codex `0.162.1` | `POST /v1/responses`, model `gpt-6.1-sol`, streaming, zero tools in this probe | Add the same ingress under `/v1`; retain `wire_api = "responses"`. |
| Vibe `2.26.1`, unmodified default | `POST /v1/chat/completions`, model `mistral-vibe-cli-latest`, streaming, nine tools, temperature `1` | Resolve its wire alias inside mesh. |
| Antigravity `1.3.3` | Gemini `:streamGenerateContent?alt=sse` | Gemini HTTP ingress is out of scope for this Muse/Vibe PR. |

Evidence: `.h2a/uat/uat-results-904e8d8f3.md` and the campaign's
`evidence/{gateway,parameters}.ndjson` under
`.tmp/llm-gateway-uat/pr662-904e8d8f3-01/`. Muse bodies measured 94,624 and
64,400 bytes; the Codex probe measured 58,150 bytes. The runner retained only
parameter projections, not full `input`, `instructions`, or tool schemas.
These are measured envelopes, not complete captured-body fixtures. The raw
Vibe log records a P0 interception; the UAT report separately records the
native alias rejection. Do not relabel either as a successful provider run.

The remaining fixture acquisition is a build prerequisite (§16.9). Do not
invent full request bodies and describe them as UAT captures. Gemini egress
through `cloud-code` remains available to compatible routed requests; this
does not make the Antigravity HTTP ingress compatible.

### 16.2 D16-A — One routed ingress, two paths, identical admission

Add `openai-responses` to `GatewayWire` and `WIRE_BY_PATH`. Mount both
`POST /responses` and `POST /v1/responses` on one handler, without redirects.
Use `prepareRouteFlow`, `runRouteJsonFlow` and `runRouteStreamFlow`; no second
pool, HTTP self-proxy, gateway-owned credential path, or default Codex target.
The requested model, mesh policy and executable capabilities select the
provider independently of the caller's wire.

Both aliases use the same `CallerAuthPort`, verified cost/owner context,
cross-user kill switch, quota, budget admission and cancellation as Messages.
Malformed JSON/missing model may fail before authentication, matching the
existing router. Semantic validation follows caller verification and precedes
quoting, leasing or dispatch. A missing/invalid caller token returns 401;
verifier failure returns the existing sanitized authentication-subsystem 503.
Never reinterpret a caller bearer as a provider credential. Untrusted owner,
account, transport, provider URL or `providerOptions` body fields are refused;
response ids and client session headers grant no identity or account access.
Trusted host affinity projection remains the only source of routing affinity.

The product mount needs explicit coverage too: add `/responses` and
`/v1/responses` to `GW_PATHS` in `api/src/routes/namespaces/gw.ts`, and run the
same product caller-token bridge for `/responses` that currently runs for
`/v1/*`. Apply `requireAuth` and `settlementModeMiddleware` to that path too;
preserve the author fence, unavailable-module behavior and per-request
bridge-token cleanup. `/api/v1/gw/responses` must receive the
same caller admission as `/api/v1/gw/v1/responses`; a package-only test misses
this boundary. Never execute the bridge twice on the `/v1` alias.

Responses requires routed dependencies. A legacy/scaffold-only router returns
an authenticated, OpenAI-shaped 501 for this wire, without calling its legacy
Chat Completions dispatch. Existing Messages/Chat scaffold behavior is unchanged.

### 16.3 D16-B — Supported request contract and lossless normalization

Create a strict Responses-specific normalizer, selected by
`normalizeGatewayIngress`. Do not feed `input` through the current permissive
`raw.messages` parser or silently discard unknown item types. Preserve order,
string contents, explicit false values and the distinction between an output
item `id` and a tool `call_id`.

| Responses field/item | Canonical mapping and validation |
|---|---|
| `model`; `stream` | Nonempty model; boolean stream, default false. Retain the requested id for diagnostics; mesh chooses the actual model. |
| `instructions` | Optional string, prepended as an instruction message. Preserve ordered system/developer input and the existing transport-specific instruction projection. |
| `input` string | One user message, including an empty string when deliberately supplied. |
| `input` array of messages | Ordered `system`, `developer`, `user`, `assistant` messages; accept the documented shorthand and `type: "message"`. Map `input_text`/assistant `output_text` to text. |
| `input_image` | Preserve URL/data URL and detail; derive `input:image`. A transport unable to preserve requested image semantics is ineligible. Do not fetch URLs in the gateway. |
| `function_call` history | Assistant `ToolCall`; `call_id` becomes `providerCallId` and the round-trip correlation key; preserve name and the exact arguments string. Preserve item id separately. |
| `function_call_output` | Tool result joined to its preceding call by `call_id`; preserve the output string or supported text/image parts. Reject ambiguous duplicates, orphan results and unsupported result parts. Never stringify an unsupported part into prompt text. |
| Flat `tools: [{type:"function", name, description, parameters, strict}]` | `ToolDefinition`, including `strict`; validate unique names and schemas. Map back to nested function tools only in Chat egress adapters. |
| `tool_choice`; `parallel_tool_calls` | Preserve `auto`, `none`, `required`, named `{type:"function",name}` and explicit parallel true/false. Reject a named choice absent from tools. |
| `max_output_tokens`; `temperature`; `top_p` | Finite validated values to `maxOutputTokens`, `temperature`, `topP`; integer positive output ceiling. No coercion, silent clamping or omission of an explicit limit. |
| `reasoning.effort`, `reasoning.summary` | Existing canonical reasoning options and mesh alias-effort policy; reject unsupported values. Preserve summary intent; never expose hidden reasoning as text. |
| `reasoning.context` | Validated string into the native carrier; honored only by native Codex execution (`reasoning-context`). Translated routes never declare it. Reject non-string values. |
| `text.format` | Text, JSON object or JSON schema to `ResponseFormat`, retaining name/schema/description/strict. Eligibility requires the actual transport implementation, not just a catalog model claim. |
| `text.verbosity` | Preserve on a qualified native Responses route; otherwise unsupported unless an equivalent implemented control is demonstrated. |
| `include: ["reasoning.encrypted_content"]` | Request the optional native reasoning artifact. A translated provider may have none; never fabricate encrypted content. Other includes are unsupported in this version. |
| Completed `reasoning` history item | Preserve its summary and opaque encrypted content in a validated native carrier. Encrypted replay requires compatible Codex egress and existing owner-scoped stickiness; it cannot cross to Muse/Mistral/Gemini. |
| `metadata`, `prompt_cache_key`, `safety_identifier` | Validate and bound. Metadata may be echoed locally; cache/safety hints are forwarded only to an adapter declaring support. They never select owner, lease, account or upstream URL; no cache-reuse claim follows from acceptance. |

Functions are the mandatory CLI tool baseline. Namespace-wrapped function
tools flatten to qualified names (`namespace.name`, with the bare name kept
for correlation). Hosted tools, item references, audio/video, provider file
ids, server-side execution, and unsupported content/annotation types return
400 `unsupported_parameter` with a field path. Custom/freeform tools are the
bounded extension the pinned Codex capture requires: validated into the
native carrier and served only on a native Responses route (execution
feature `custom-tools`); translated routes refuse the round trip.
Changing the CLI's tool configuration is not acceptance.

The route is stateless: absent/false `store` becomes false; absent/false
`background` is accepted; absent/`disabled` truncation is accepted. Refuse
`store:true`, `background:true`, `truncation:auto`, a non-null
`previous_response_id` or `conversation`, and retrieval/cancel/compact or
WebSocket behavior. Clients send complete supported history on each POST.
Unknown behavior-affecting fields fail explicitly; known harmless telemetry
fields need an enumerated, tested allowlist rather than a catch-all spread.

Use existing canonical messages/tools/reasoning for common features. Add typed
allowlisted Responses carrier definitions in mesh `responses-wire.ts`, held
in `providerOptions`/event metadata/`providerMetadata`, for native input order,
item identity, completed reasoning artifacts and terminal output snapshots.
Construct this carrier from validated fields; never copy caller routing/auth
controls. Only the matching adapter consumes it. Public responses filter it
again; credentials, raw provider errors and internal headers never enter it.
Encrypted replay requires a trusted stable affinity and a compatible sticky
route; absent that context, refuse it before acquisition. Neither an input
item id nor opaque content may establish that affinity or loosen account scope.

Add optional mesh-owned `requiredExecutionFeatures` to route plan/quote input
for requirements finer than existing `requiredCapabilities`: named/parallel
tool control, strict schema, structured output, reasoning controls, reasoning
context, custom tools, native reasoning replay, verbosity and an explicit
output ceiling. Derive these from validated input, never a caller-supplied
feature list. `reasoning.context` is the second bounded extension the pinned
Codex capture requires: a server-side retention semantic carried in the
native carrier and honored only by native Codex execution (feature
`reasoning-context`); translated adapters never declare it. One pure mesh
predicate filters the actual model/transport pair in both planning and
quoting, including quote identity/revalidation. Capability rejection occurs
before acquisition; unknown support is not support. Gateway consumes this
result, without a provider table. Trusted API runtime adapters must declare
only controls they actually forward. Conflicting requirements and host
restrictions fail closed.

### 16.4 D16-C — Native and translated provider execution

“Native” here describes the provider egress wire; every route still uses the
same opaque mesh attempt and gateway Responses encoder.

| Provider / account transport | Egress already present | Responses execution in this extension |
|---|---|---|
| OpenAI / `codex` | `https://chatgpt.com/backend-api/codex/responses` | Native Responses via `CodexRuntimeClient`; validate/project the native carrier, preserve call ids, terminal items and available reasoning artifacts. Upstream remains streaming with `store:false`; collect for downstream JSON requests. |
| Muse / `muse` | Meta `/v1/chat/completions` | Translate Responses to canonical to Chat and back. The CLI's `/responses` path does not establish a native Meta serving endpoint; do not repoint `MUSE_SERVING_PATH` on that inference. |
| Mistral / `mistral-vibe` | Mistral `/v1/chat/completions` | Translate text, images and qualified function/tool-result controls. Preserve the plan-billed account transport. |
| Gemini / `cloud-code` | Cloud Code generation transport | Translate supported canonical content/tools/summaries; retain required provider continuation signatures or refuse the affected round trip. No Gemini ingress is added. |
| Anthropic / `claude-code` | Qualified CLI runtime seam | Translation is conditional on that runtime's proven capabilities. Its current strict request projector rejects several canonical fields; do not label it universally compatible or substitute an unapproved HTTP transport. |
| Other injected API-key/runtime adapters | Host-selected implementation | Translation only for advertised, tested controls. Being an OpenAI model or having a Responses URL elsewhere does not prove this configured adapter serves it natively. |

Two existing defects directly block CLI tools: both Muse and Mistral runtime
clients currently return `toolCalls: []` and stream text only. Fix their
Chat request projection (including tool history, named choice and parallel
control) and JSON/SSE tool decoding in this PR. Accumulate call fragments by
upstream choice/tool index, retain the provider call id, and honor
`finish_reason` including tool calls, length and content filter. A usage-only
chunk is accounting, not an unconditional early `stop`. Reject malformed
streams; never turn premature EOF into successful text completion.

Codex decoding must also retain item/content indices, final tool arguments,
reasoning-item completion, incomplete status and error codes. Use the completed
reasoning artifact, never an in-progress encrypted fragment. Deduplicate final
snapshots against deltas; some Codex completions omit tool items, so already
observed complete calls remain authoritative. JSON collection and streaming
must agree on the resulting ordered items. Do not use hidden/signature deltas
as visible summary text.

The Codex adapter currently omits `max_output_tokens` because its backend
rejects it. It cannot satisfy an explicit hard output limit in this extension:
exclude it for that requirement and return a capability 400 if no permitted
candidate remains. Do not claim that the existing budget accounting ceiling
enforces provider generation length. Preserve existing budget decisions for
quotes marked `outputCeilingEnforced:false`; default accounting allowances
alone do not create a new output-limit guarantee.

### 16.5 D16-D — JSON and streaming Responses contract

Use a shared bounded output accumulator for JSON and SSE. The JSON response is
an `object:"response"` envelope with a stable unique id, `created_at`, actual
served `model`, `status`, ordered `output`, `error`, `incomplete_details`,
`usage`, `store:false` and the supported effective request fields. Emit
assistant message items containing `output_text` parts with annotations, and
separate `function_call` items with `id`, `call_id`, name and arguments string.
Tool output supplied on the next request is input, not an invented assistant
result. Do not emit Chat `choices`, `chat.completion` objects or SDK-only
`output_text` convenience properties in place of the Responses envelope.

`stop` and a completed `tool_calls` turn map to `status:"completed"`.
`length` maps to `incomplete` / `max_output_tokens`; `content_filter` maps to
`incomplete` / `content_filter`, retaining an actual refusal if provided.
Unknown termination, provider errors and premature EOF are failures, not
completed empty responses. A legitimate provider terminal response may have
empty output. Client cancellation closes the connection and releases the
attempt; it does not manufacture a completed response.

Map provider usage to `input_tokens`, `output_tokens`, `total_tokens`, and
available `input_tokens_details.cached_tokens` /
`output_tokens_details.reasoning_tokens`. Preserve native usage detail through
the carrier/`providerRawUsage`. Total is provider-reported or computed from
known components. Unknown usage is null, never a fabricated exact zero or the
Messages count estimate. Financial settlement may still use the existing
separately marked estimate. Do not add reasoning/cache subcounts to totals a
second time.

SSE uses `event: <type>` plus a JSON `data` object with the same `type` and a
monotonically increasing `sequence_number`, starting at zero. The accumulator
allocates stable item ids and output/content indices once and reuses them:

| Canonical observation | Ordered Responses events |
|---|---|
| First validated content/tool event or legitimate terminal result | `response.created`, then `response.in_progress`. Both remain buffered until the existing pre-commit checks succeed. |
| First text for an item | `response.output_item.added` (assistant message), `response.content_part.added` (empty output text), then `response.output_text.delta`. |
| Later text | Further text deltas with matching `item_id`, `output_index`, `content_index`. |
| Function call start/fragments | `response.output_item.added` (function call with distinct item id and `call_id`), then `response.function_call_arguments.delta`; keep separate buffers for interleaved calls. |
| Qualified visible reasoning summary | Reasoning item plus `response.reasoning_summary_part.added`, `response.reasoning_summary_text.delta`, matching text/part done events, then item done. Opaque artifacts accompany only the validated completed item. |
| Text/item closure | `response.output_text.done`, `response.content_part.done`, `response.output_item.done`, with accumulated final content. |
| Function call closure | `response.function_call_arguments.done`, then `response.output_item.done`, retaining exact final arguments and call id. |
| Terminal `done` | Close open supported parts/items once, then exactly one `response.completed` or `response.incomplete` with the final response snapshot and usage. |
| Failure after commitment | Exactly one sanitized `response.failed` with partial output and `response.error`; no successful terminal follows. |

Interleaved tool items may close independently; final output retains allocation
order. Actual refusal parts use the corresponding refusal delta/done events.
Missing required ids, an inconsistent snapshot or an unsupported provider item
is a protocol failure, not permission to drop data. The encoder must never
consume the whole stream before the first content delta merely to discover ids
or usage. Responses ends on its terminal event and connection close; it does
not use Chat's `[DONE]` sentinel.

Provider `response.created`/status-only events do not commit downstream headers.
Retain `runRouteStreamFlow` priming and mark the attempt committed before
exposing any synthesized start frame. Eligible failures may advance only
through the existing bounded mesh plan before commitment. After any header or
body is exposed there is no replay, account rotation or fallback. Propagate
abort/backpressure, return the upstream iterator, and settle once even when
the caller disconnects before its first read.

### 16.6 D16-E — Lease outcomes, accounting and token counting

Each dispatched attempt takes its existing mesh reservation and finishes once
through `complete`, `recordOutcome` or `releaseCancelled`. Do not acquire a
second lease for wire translation, JSON collection, usage extraction or an
SSE item. An ordinary provider length limit, refusal or completed tool turn is
a successfully served attempt for account health, despite its client-facing
incomplete/tool status. A terminal canonical error/cancellation must not fall
through the current stream flow's generic successful `done` handling.

| Failure source | Lease/account effect |
|---|---|
| Caller auth, malformed/unsupported request, unknown model, capability mismatch, body limit, budget refusal before dispatch | No provider call; no account auth/cooldown outcome. Release any admitted hold under the existing rules. |
| Local codec/size/protocol failure after acquisition | Neutral failed outcome, or cancelled release when aborted. Never infer provider authentication failure from a local error string/status. |
| Provider-confirmed inference 401/403 or provider-confirmed refresh rejection | Existing mesh auth classification and refresh/reauth rules; no new route-specific degradation rule. |
| Provider-confirmed inference 429 | Existing rate-limit outcome and bounded Retry-After handling. |
| Provider 400/model rejection, network/5xx | Existing request/route/transport health scopes and retry eligibility; no invented account auth failure. |
| Caller disconnect | Cancel and release; no retry or availability poisoning. |

Keep source/provenance on failures until classification. In particular, the
generic classifier's auth/rate code matching must not see gateway validation
errors as provider evidence. Provider model 404 and invalid input do not make
the account unusable. Account state, route negative caching and caller billing
are separate effects and each must be asserted in tests.

One aggregate settlement includes all dispatched attempts, including partial
usage from failed attempts, exactly once. Terminal usage is a cumulative
snapshot, not another increment on top of preceding snapshots. Preserve the
existing admitted-request idempotency key, dispatch marker, hold release and
never-zero fallback estimation for genuinely dispatched work. Pre-admission
refusals have zero attempts and no durable debit; operational zero-dispatch
notifications keep the existing behavior. Settlement callback failure must
not replace the original typed error or trigger a retry.

`POST /v1/messages/count_tokens` is unchanged: real Anthropic count or explicit
unsupported refusal, no inference dispatch, no budget/debit, and only the
host's advisory lease. Every count failure, including 401/403/429, completes
that reservation neutrally; it never changes account authentication or
cooldown. Responses adds no count endpoint, no hidden count request and no
model-backed estimator. Existing local client counting remains local.

### 16.7 D16-F — Errors and bounded operation

Before commitment, return the OpenAI error envelope
`{error:{message,type,code,param}}`, with null/omitted `param` except for
validated field errors. Reuse the existing mapper's statuses and sanitized
headers rather than routing errors through Chat output serialization:

| Condition | Public result |
|---|---|
| Bad input / unsupported feature | 400 `invalid_request_error`; `bad_request` or `unsupported_parameter`, with a safe field path. |
| Missing/invalid caller credential | 401, existing OpenAI authentication mapping. |
| Unknown model | 404 `invalid_request_error` / `model_not_found`; requested model only. |
| Known model, no eligible account | Existing 503 `server_error` / `no_route`, `x-should-retry:false`, no Retry-After; preserve enrollment-action diagnostics when applicable. |
| Caller-auth/account/budget subsystem unavailable | Existing distinct sanitized 503 messages from §15.5. |
| Provider auth/rate refusal | Existing terminal 401/429 mappings; forward only allowlisted retry/request headers. |
| Body too large | 413 OpenAI-shaped `request_too_large`, before dispatch. |
| Invalid upstream stream / local encoding failure | Sanitized gateway failure (503 before commitment); `response.failed` after commitment. No fabricated provider-auth signal. |

Carry `X-Sentropic-Request-Id`; add `X-Sentropic-Served` only for an actual
selected target under existing rules. Strip tokens, cookies, upstream URLs,
account ids and arbitrary upstream error text. Once committed, HTTP status
stays 200 and the stream carries the failure; do not append another HTTP body.

Add validated `responsesLimits` router options shared by both aliases:
16 MiB decoded request body, 4,096 input items, 256 tools, 1,024 output items,
1 MiB individual decoded upstream SSE event, and 8 MiB accumulated output
(including arguments and opaque artifacts), as initial defaults. Enforce the
body cap while reading, including missing/false Content-Length; enforce stream
caps incrementally in the codecs/adapters. Pass decoder bounds through the
trusted typed carrier, never from caller body fields. A stricter host limit wins. Any
override must remain finite and positive. These are engineering defaults, not
provider context limits. Reuse host request/abort deadlines and mesh attempt
bounds; do not reset budgets or deadlines between candidates. Output overflow
aborts upstream and fails neutrally; no silent truncation or unbounded final
snapshot. Fragmented UTF-8, CRLF, multi-line data and terminal frames split
across network chunks must parse correctly within the same caps.

### 16.8 D16-G — Vibe alias and catalog consistency

Mesh resolves `mistral-vibe-cli-latest` to:

```ts
{ providerId: 'mistral', transportProviderId: 'mistral-vibe',
  model: 'mistral-medium-3.5' }
```

This is a pinned gateway compatibility alias to the existing catalog model,
not a claim that upstream `latest` can never change. Preserve the requested
alias in audit/cost context and report `mistral-medium-3.5` as actually served.
With no enrolled account it is recognized and returns no-route 503, not
model-not-found 404. It does not gain Muse/Codex/Cloud fallback candidates.

Define the CLI alias once in mesh `routing-targets.ts`, referencing the
canonical target; consume it through all resolver variants, including
nondefault Muse-position options. Do not add a duplicate model profile,
pricing row, equivalence member, account inventory id or gateway alias table.
Capability/context/cost lookup dereferences the target catalog profile
(currently 262,144 context tokens). Discovery may remain the existing filtered
canonical catalog; if it exposes aliases, derive and filter them from this
same mapping rather than maintaining another list.

A pinned Vibe fixture records CLI version, active display alias and actual
API name. Resolver tests assert target profile existence, provider/transport
consistency, unchanged capabilities and identical canonical/alias eligibility.
The CLI/catalog update recipe must update that fixture and its mapping in the
same change when the wire name or target changes. Removing/renaming the target
without updating aliases fails the existing mesh test gate. Never fetch an
unreviewed upstream `latest` during CI to mutate the mapping.

### 16.9 Tests and acceptance

The exact source/test manifest and build order are in
`.h2a/design/responses-route.md`. Required evidence is additive to §15 tests:

1. Unit fixtures cover every supported input/output mapping, tool id versus
   call id, interleaved calls, empty valid responses, reasoning/refusal,
   incomplete/error terminals, UTF-8/chunk boundaries and all limits. Native
   Codex and translated Muse/Mistral fixtures exercise real adapter codecs.
2. Route contracts run both aliases through the same Hono/router/mesh flow,
   with JSON and SSE. Assert caller ownership, zero dispatch on refusal,
   identical lease/meter/budget effects, pre-byte fallback and no post-byte
   fallback, cancellation and cleanup. Verify product `/api/v1/gw` mounting,
   caller bridge and author fence, not just the standalone package.
3. Acquire sanitized full initial and tool-continuation bodies from the pinned
   Muse and Codex clients using an isolated recording endpoint with provider
   dispatch disabled. Preserve types, field presence, tool schemas, ids and
   argument/result structure; replace secret/personal content, not semantics.
   Capture both observed Muse request shapes. Replay committed fixtures in CI
   without installing clients, using synthetic upstream responses. Record
   fixture provenance and SHA-256, and distinguish reconstructed unit cases
   from real captures. Also pin the Vibe default model projection.
4. The UAT P0 interceptor must recognize both new Responses paths before the
   fixed gateway is probed; its current Messages/Chat-only condition is no
   longer sufficient to prevent live inference. No OAuth/enrollment is needed
   for capture. If a required shape is unsupported, resolve it in #662 before
   declaring client compatibility.
5. Re-run existing Messages, Chat, count-token, budget, ownership and health
   regressions. In particular, counting 401/403/429 leaves accounts active,
   local Responses failures never mark reauth/cooldown, and only an actual
   provider inference signal can invoke the existing degradation rules.
6. Real Muse and Codex smoke tests must complete a streamed text turn and a
   tool/result/continuation round trip; Vibe must run with its unmodified
   default model. Record client versions, requested/actual route, candidate
   package provenance, settlement count and lease cleanup. Empty-pool 503
   proves recognition/admission only, not successful inference. Provider
   enrollment remains a separate prerequisite for live qualification; a
   blocked enrollment must not be reported as PASS.

Acceptance requires both Responses paths to leave the router-404 state,
all mandatory full CLI fixtures to pass without parameter loss, the Vibe
default alias to resolve to the pinned Mistral target, and the above accounting
and existing-wire regressions to pass. Gemini native ingress remains explicitly
unqualified and does not block this scoped acceptance. Builds and qualification
belong to the implementation run, not this documentation-only design task.

Wire event names and completed-item semantics follow the
[official OpenAI Responses streaming reference](https://developers.openai.com/api/reference/resources/responses/streaming-events).
Transport availability and limitations above are grounded in this checkout's
runtime clients and UAT, not inferred from that API reference.

## 17. PR #662 native Anthropic fold (option C)

Owner decision, 2026-10-12: integrate the uncovered native Anthropic relay from
[PR #633](https://github.com/rhanka/sentropic/pull/633) into
[PR #662](https://github.com/rhanka/sentropic/pull/662), with one release at
**llm-mesh 0.26.0 / llm-gateway 0.20.0 / cluster-mesh 0.14.0**. This section
defines the combined implementation contract; it does not report a completed
build, qualification, release or activation.

The executable plan, source-commit/file manifest, scope exceptions and ordered
test-first lots are in [native-fold.md](../.h2a/design/native-fold.md). Source
is `feat/llm-gateway-native-relay` at
`9055406f060084ea4212df05cd0432ba4fcbea3b`; destination was inspected at
`95a0219f49cb3a6b15e73307eacf663144d40347`. The owner's coverage input has
SHA-256 `81ecae2e3bfc7dbb27a9d91386dabf259376100d608f7cf21ec984750ed288bb`.
Its earlier destination cutoff predates the Responses egress, fixture replay
and limits now present in #662; those newer changes remain the baseline.

Final observed destination head `c06589b758604db0a5c6d5d4b5d4e52278d54895`
adds only a selected-fixture sibling-integrity refresh. It does not change
these runtime/spec contracts or supply final artifacts for the future fold.

Port C1–C8 and C10–C14 semantically, retaining the already shared C3 header
helpers and C9 ordinary counting instead of duplicating them. C15's native
documentation is consolidated here and in later release documentation; its
old manifests, locks, versions and archive receipts are not source artifacts
to reuse. Where contracts overlap, this section supersedes §15.2's SDK count
transport and unconditional safeguards refusal, and §16.7's separate body
reader. Other §15/§16 behavior and acceptance remain binding.

### 17.1 D17-A — Separate release and native activation

Resolve `LLM_GATEWAY_NATIVE_MESSAGES` once when constructing the API/router:
only the exact string `enabled` enables native Messages. Unset, `true`, `1`,
case changes and surrounding whitespace remain OFF. Reconfiguration requires
reconstruction; no request header/body may alter the switch or qualified list.
The shared router also defaults to native disabled unless explicitly enabled
by its trusted host.

`NATIVE_ANTHROPIC_MESSAGES_MODEL_IDS` remains empty until model-specific live
qualification and owner disposition. A trusted code/test override must contain
exact catalogued Anthropic model IDs, never exclusive launch aliases or a
caller/environment-supplied model list. Switch ON with an empty list enables
no native inference or safeguards count. Do not populate it from the full
catalog, a beta name or an account's mere availability.

Record the switch and the version of the actually loaded gateway module at
startup. Module identity/manifest validation failure yields
`version_unverified`, not a workspace/package-lock version presented as
running proof. Production activation requires separate evidence and owner GO.
Turning native OFF preserves ordinary #662 counting, canonical Messages/Chat,
Responses, Muse/Vibe aliases and diagnostics. It is not rollback of the shared
body-reader or ordinary count transport changes.

### 17.2 D17-B — One count path with explicit safeguards gating

There is one gateway count handler and one host count factory:
`packages/llm-gateway/src/native-count-tokens.ts` and
`api/src/services/llm-runtime/gateway-count-tokens.ts`. Keep the latter's trusted
credential precedence, catalog-based exact-model preparation and advisory
account lease. Replace its SDK invocation with the shared single-attempt raw
Anthropic HTTP count operation; remove the superseded SDK implementation.
Do not introduce a second count factory through `AnthropicNativePort`.

The count port's model list is the exact Anthropic catalog. Native inference
uses the separately qualified subset. Both consumers receive the same resolved
native switch/qualified-list configuration; count does not call inference
preparation or construct an inference observation as an eligibility probe.

| Count condition, after existing parse/model/caller-auth checks | Required behavior |
|---|---|
| Ordinary count, including beta/version headers | Available independently of native switch/qualified list when the existing catalog, trusted auth and prepared API-version checks pass. |
| Own top-level `safeguards`, including null/empty | Relay unchanged only when native is enabled, the exact model is qualified, and count preparation/provider/model/version checks pass. Otherwise safeguards-specific 400; no send. |
| Unknown model | Existing account-independent model-not-found 404; an empty/unready pool must not invent it. |
| Known model without usable count capability | Existing explicit unsupported-count refusal; no estimate or inference fallback. |

Count preserves unknown/nested request fields, inserts no output ceiling or
stream control, and executes JSON-only. Return the entire provider JSON object
after validating nonnegative safe-integer `input_tokens`. Preserve version/beta
and safe success headers through the common filters; omit served-model
diagnostics. Count never creates a generation plan, hold, budget debit,
dispatch marker, financial settlement or usage observation. One host advisory
reservation completes once; every counting failure, including 401/403/429,
is neutral to account authentication/cooldown.

Retain the process-wide verified tenant/principal limiter: burst 10, refill
1/second, two in flight, ten-minute idle eviction excluding active calls,
10,000-key bound. Capacity and rate refusal happen before transport send;
cancellation does not refund a dispatch token. The raw operation has no hidden
retry, shares readiness/body-detachment safeguards, and returns one result.
Existing count public error behavior remains: 401/403→generic 401, bounded
429/Retry-After, sanitized network/5xx. Apply the native trusted validation
policy and typed 413 mapping where relevant; internal shared error types do
not bypass this count-specific neutral outcome/public boundary.

### 17.3 D17-C — Native feasibility composes with execution features

`RoutePlanInput.nativeMessages?: true` and its quote input mean required
native execution. Keep #662's `requiredExecutionFeatures` and existing
capabilities, caller constraints, diagnostics, admission subject, affinity
repair and committed-failure suppression. Both mesh planning/quoting and the
API catalog-quote/route-plane wrappers must enforce this conjunction:

```text
existing target/account/policy eligibility
AND every required execution feature is actually supported
AND (native not required OR exact qualified Anthropic target + native contract)
```

Bind the native flag and sorted execution requirements into quote identity
and revalidate at plan/preparation; absence of both preserves the canonical
identity. Apply native feasibility before sticky selection, health suppression
and candidate truncation. Do not mutate an ineligible stored affinity merely
to find native support. An unknown model is still 404; known native denial is
an explicit native refusal; genuine lack of an available route retains #662's
no-route/enrollment diagnostics. Capability/required-native refusals occur
before provider dispatch, releasing any already admitted hold under existing
rules without inventing a charged attempt.

The product application runtime currently advertises no §16 execution
features. Adding native Messages must not bypass that refusal or claim
Responses reasoning/tool controls it cannot preserve. Its `withCatalogQuote`
path must gain the same requirement checks and identity binding as planning;
a native-only quote wrapper cannot replace the feature wrapper.

Messages classification runs once after checked parsing/caller authentication
and before quote/admission. Plain/version-only requests stay canonical. Beta
presence, even an empty value, makes native optional. An own top-level
`safeguards` property makes native required. OFF, wrong model/version,
missing prepared capability or invalid effective output ceiling causes the
explicit required-mode refusal. Optional mode may choose canonical only
before native invocation; an upstream native failure never reconstructs a
canonical attempt. Recheck fresh account advertisement, prepared protocol and
contract version, exact model, supported API version and admitted ceiling
before marking dispatch.

Native body construction shallow-copies the object and changes only selected
model, boolean stream and the validated/admitted `max_tokens` minimum.
Unknown fields, safeguards, nested values and tool IDs survive. Chat and both
Responses aliases remain their own wires; Anthropic headers cannot activate
this relay on them. Safeguards on those wires is an explicit wire-shaped
refusal. Preserve the strict Responses normalization and its native Codex
carrier; that carrier is not `PreparedNativeMessages`.

### 17.4 D17-D — Shared actual-byte admission and parser order

Use one checked-body predicate and wire/limit resolver for POST to exactly:

| Path, relative to a trusted mount prefix | Wire | Default actual-byte ceiling |
|---|---|---:|
| `/v1/messages` | Anthropic Messages | 32,000,000 |
| `/v1/chat/completions` | OpenAI Chat | 32,000,000 |
| `/responses` | OpenAI Responses | 16,777,216 |
| `/v1/responses` | OpenAI Responses | 16,777,216 |
| `/v1/messages/count_tokens` | Anthropic count | 32,000,000 |

Normalize only the host-configured mount prefix, including product
`/api/v1/gw` and configured `/gw`; reject arbitrary suffix matches, lookalike
paths, non-POST methods and `/responses/count_tokens`. The smaller validated
host/Responses limit wins. Keep §16's other input/tool/output/event limits and
their host overrides. All paths share one process-default 32,000,000-byte
reservation pool even with native OFF; do not allocate separate pools per
router, alias or count endpoint.

Before any gateway parser reads, resolve the common pool and effective path
limits and supply the same immutable policy to middleware and router. A
cached parse under a looser policy must not bypass a stricter Responses or
host bound. Replace the standalone Responses bounded reader and the gateway
settlement parser's `Request.clone().json()` with the checked owner's single
parsed object. No clone, second JSON read or consolidated raw byte buffer.

Read actual bytes: check N+chunk against the effective ceiling, extend the
shared lease atomically, then copy into exactly granted backing storage.
Content-Length supplies neither authority nor proof, including false high or
low values. Decode/parse once at EOF. Overflow precedes capacity refusal;
capacity exhaustion cancels the reader, drops partial storage and returns
retryable 503 with `Retry-After: 1` and `x-should-retry: true`. No waiting queue,
quote, hold, dispatch or financial/observation event follows these refusals.
The reservation/amplification model is not measured RSS qualification.

Product ordering is author fence → product session authentication → checked
body admission → settlement-mode extraction → one-shot verified caller bridge
→ gateway caller/partition authentication → classification/normalization →
quote/admission → plan/dispatch. Preserve the separate `/responses` middleware
registrations and the single `/v1/*` registration covering `/v1/responses`.
Count skips settlement-mode extraction and all financial effects. Standalone
settlement middleware obtains the same checked owner before inspecting a
gateway body; the router reuses it. Preserve package parse/model-before-auth
behavior and scaffold refusal without consuming a body.

### 17.5 D17-E — Transport, stream and terminal ownership

Trusted host code chooses credentials, account, URL and auth headers. Reuse
the existing native request/response filters: open `anthropic-*`, permitted
`x-app`/`x-stainless-*`, with credential/session/hop-by-hop/Connection-nominated
and internal exclusions. Host authentication wins last; no caller endpoint
override or redirect. Native execution makes one raw HTTP attempt with a
55-second response-readiness bound and continuing caller cancellation.

Complete or cancel upload and detach request, serialized-byte and view holders
before exposing JSON/count or a commit-ready stream. Fetch response headers
alone do not prove upload completion. Response/abort/finalize closures retain
only response state and bounded metadata. Canonical SDK/Responses operations
retain checked-body bytes through retries, JSON collection and terminal SDK
or iterator cleanup; native Codex Responses does not inherit Anthropic's early
detach proof. Clear every registered holder before shrinking/releasing.

Transfer stream ownership before middleware exits. Once-only cleanup covers
never-consumed streams, cancellation before first read, malformed returned
envelopes, commit failure, EOF without stop, reader errors and callback
failures. Close/abort the upstream reader and finish the attempt once;
cleanup and the one aggregate financial settlement never wait for observation.

Native JSON preserves the provider object semantically. Native SSE relays
upstream bytes, comments, unknown events and line endings with backpressure
and a 1 MiB pending-frame bound. Observe usage separately. Prime a complete
non-error frame before commitment; after commitment or failed commit callback,
there is no replay/fallback. Missing `message_stop` is failure, not fabricated
completion. Responses keeps §16's accumulator, JSON envelope and SSE encoder,
including its pre-commit buffering and post-commit `response.failed` contract.

Success-only `X-Sentropic-Relay: native` identifies native relay. Native JSON
`X-Sentropic-Served` requires a safe response-served model with no invalidating
fallback/substantive iterations; selected identity is not proof. A safe
mismatch may be reported but cannot qualify discount pricing. Native SSE and
count omit served identity. Emit gateway diagnostics last, after filtering.

Carry forward the pending owner keepalive requirement as new implementation:
after commitment, add `: keepalive\n\n` only between complete frames after
15 seconds of upstream silence. Upstream frames remain byte-identical; added
comments are the sole intended fidelity change. No pre-commit keepalive,
mid-frame insertion, competing reads, extra usage or surviving timer after
terminal cleanup. This was not implemented in #633 and is required before
production activation, with frame-boundary/backpressure tests.

### 17.6 D17-F — Bounded errors and terminal numeric 413

Native validation relay requires a trusted typed parser-result channel,
bounded to 64 KiB input and 4,096 public UTF-8 bytes after control filtering.
Mask billing-state detail before truncation or feature detection; preserve
non-control whitespace and linear identifier handling. Only an own safeguards
request rejecting the exact classifier beta actually sent qualifies for the
narrow rewrite. Arbitrary provider strings/400s do not gain this authority.
Canonical errors and #662's subsystem/no-route diagnostics keep their policy.

Carry validated numeric request-size evidence through mesh errors, provider
wrappers, runtime adapters and every JSON/stream/callback path. Exact size and
observed lower bound are distinct. Report the effective known gateway limit
(including Responses/host limits); when an upstream rejecting limit is unknown,
say it is unavailable rather than inventing it. Never use Content-Length or
caller fields as measured evidence.

Before commitment, terminal 413 is Anthropic-shaped on Messages/count and
OpenAI-shaped on Chat/both Responses aliases. Preserve the original typed 413
if commit/settlement/cleanup also fails; no retry, account rotation or later
successful result. After commitment HTTP remains 200: emit a sanitized native
or Chat error frame, or exactly one Responses `response.failed` carrying
`request_too_large` and safe size detail. Abort/close and settle once with
already observed usage; never append a success terminal. Local body/codec
failures remain neutral account outcomes, not provider auth/rate evidence.

### 17.7 D17-G — Physical usage, proof and exact financial settlement

The gateway owns one cumulative native usage fold and freezes one immutable
pre-financial-floor terminal snapshot for both settlement and observation.
Physical input P=U+R+aggregate W; TTL subcounts are not added again. Missing or
null evidence is unknown, not invented zero. Output is cumulative, not the sum
of frames. Start output is provisional; successful JSON or final output with
clean `message_stop` establishes finality.

Valid start-anchored deltas inherit absent/null fields. Equal aggregate writes
retain accepted TTL allocation; growth alone receives five-minute weight when
outbound cache controls establish that eligibility, otherwise a conservative
2x bound. Inferred growth is marked separately from provider-reported TTL.
A consistent later split reconciles reported evidence, not an invented raw
split. Decreasing/conflicting/fractional/nonfinite/unsafe input rejects the
update atomically and permanently revokes proof; later valid frames or repeated
starts never restore it. Safe physical lower bounds survive. Valid input and
invalid output are handled independently.

Port policy `anthropic-cache-2026-10-02` with safe integer units40:
`40U + 50W5m + 80W1h + rR`, where the sourced policy has r=4 for Sonnet 5/Opus 5
and r=1 for Fable 5.1. Validate safe arithmetic, policy/model identity and
physical bounds. Served-model mismatch/unverified identity, fallback or
substantive/malformed iterations permanently disables discount proof;
missing/null/empty-array iterations are absent. Never sum iterations or use
latest-wins identity to repair an earlier mismatch.

Clean positive measured completion has no allowance floor. Interrupted SSE
with usable same-model input proof retains latest accepted input and floors
output only; missing/revoked proof floors both and uses selected-model full
physical pricing. Unknown initial TTL may retain a conservative premium, never
a discount below charged physical input. Output uncertainty alone does not
revoke valid input proof. Observations retain physical pre-floor counts even
when the financial output rises from 500 to the 32,000 allowance.

Host price eligibility requires an exact pinned provider/model/pricing row,
matching served identity, recognized policy and valid units/proof. A costliest
fallback lookup does not qualify even with matching-looking IDs/rates. Round
integer rational input after multiplying by the pinned input rate, using
`ceil(units40 * input_micro_usd_per_mtok / 40,000,000)`; retain existing output,
minimum-charge and allowance rules. Failed validation uses conservative full
selected-model pricing and closed uncertainty/mismatch audit under the existing
settlement fence. No free classifier/subsidy policy is introduced.

Exactly one aggregate financial row settles all dispatched attempts, protected
by existing request/hold/tenant idempotency, reserve/spend and outbox rules.
Each started native inference attempt may emit one body-free physical
observation, with a separate call ID, null hold/cost and the gateway request ID
as response ID. Readers distinguish roles and never sum both token sets.
Count emits neither role. Finalize runs once from the same frozen snapshot,
with a one-second hook deadline; rejection, timeout or late completion cannot
block cleanup/settlement, retry the observation or replace the wire failure.

Required regressions include M1–M7/N5 revocation, cache growth/equal one-hour
split, missing physical anchor, interrupted output, pinned exact amounts and
rounding, selected-versus-served price mismatch, exact-versus-costliest lookup,
observation/financial replay fencing, and request retention/never-read streams.
The detailed file/commit and numeric fixture matrix is in the build plan.

### 17.8 Ordered build, release scope and acceptance

Every implementation slice is test-first: behavioral RED, smallest GREEN,
then an atomic commit with **fewer than 150 added plus deleted lines**, including
tests/exports/`BRANCH.md` (target ≤140). The numbered work lots below contain
explicit smaller slice boundaries in the build plan; split again as needed,
never import a large source file in one commit or drop regressions to fit.

| Ordered lots | Work and required evidence |
|---|---|
| N00–N02 | Scope/baseline, native public contracts, typed numeric size errors; pure contract and envelope assertions first. |
| N03–N09 | Shared pool/owner/reader, five-path middleware, flow/SDK retention and terminal 413 across all wires. |
| N10–N13 | Feature/body classifier, trusted validation, conjunctive quote/planner feasibility and fresh prepared dispatch guards. |
| N14–N17 | Physical/output fold, irreversible proof, cache growth/pricing and separate financial floors. |
| N18–N24 | Raw HTTP, upload/readiness, auth/lease, native JSON/SSE, headers and the single reconciled count path. |
| N25–N29 | Observation role, exact host prices, OFF product composition/version proof, API ledger and #662 compatibility matrices. |
| N30–N31 | Pending keepalive implementation and inert bounded qualification harness; deterministic fake transport/clock tests only. |
| N32 | Consolidated release documentation, unchanged selected version tuple, regenerated exact artifacts and final gates. |

Before build edits, declare `BR662-EX8` for native runtime/provider/composition
files, `BR662-EX9` for metering/body-parser contracts, `BR662-EX10` for
qualification/API tests and `BR662-EX11` for package release documentation,
with the exact paths/rationale/impact/rollback in the build plan. Extend the
existing count/adapter/namespace and packaging exceptions; supersede the old
native-classifier exclusion. `BRANCH.md` is not changed by this design task.
No schema, Makefile, Compose, workflow, deployment/edge, judge or unused API
lock change is included.

Retain gateway mesh dependency `^0.26.0`, cluster mesh peers
`>=0.22.0 <0.27.0` and gateway peers `>=0.19.0 <0.21.0`, API gateway dependency
`^0.20.0`, and matching catalog/matrix/fixtures. Regenerate root lock and
guarded exact sibling/selected packed fixtures from the final combined source;
old #633 manifests, mesh 0.23.0 literals and interim archive integrities cannot
be copied. Recheck registry availability before release; already published
different contents requires conductor renumbering, never overwrite. A later
source edit invalidates final artifact receipts and requires regeneration.

Combined deterministic acceptance requires current-SHA mesh/gateway/API
typecheck, lint and applicable full unit/endpoint suites, cluster compatibility
and guarded exact-artifact tests, equivalence checks, both Responses-alias
fixture replay, and the native ON/OFF × five-path matrix. Preserve ordinary
count neutrality, caller ownership, no pre-dispatch debit, exactly-once
settlement, affinity/health/expiry behavior, existing aliases and enrollment
retry. All automated tests use isolated `test-*`/`e2e-*` environments and
existing Make targets in the build run; historical branch results are not
new acceptance evidence.

The owner/operator still controls live qualification and activation:

1. Obtain sourced sanitized safeguards/classifier/server-tool fixtures and two
   distinct real-login principals in one isolated tenant, with distinct owner
   scopes, grants, valid sessions, budget/pricing/reaper readiness and exact
   feature/UAT/edge source records. Never invent missing fixture semantics.
2. Authorize a fresh native campaign capped at 13 actual upstream sends:
   SSE/JSON/canonical/count for each of the three source qualification models,
   plus one sourced native server-tool/WebSearch growth call. Preserve the
   durable cap, origin/body/auth binding, zero retries, first-failure seal,
   bounded receipts and SELECT-only ledger joins. Additional cases require a
   new owner disposition, not a hidden extra send. The harness stays inert
   without deliberate arming; no provider calls occur in this design task.
3. Require positive physical/cache/cumulative, exact-price, observation/one
   settlement and measured retention/resource evidence. A real server-tool
   result with native cumulative growth is necessary for N7; absence/equality,
   decrease, local/canonical or mismatched evidence is not PASS. Unresolved
   substantive iterations or source evidence stays explicitly unresolved.
4. Complete #662's real Muse/Codex text and tool-continuation, Vibe default,
   Cloud Code no-repeat and Claude Code counting gates. Keep native OFF
   baseline and authorized ON qualification distinct. The no-dispatch UAT
   interceptor covers both Responses aliases. Empty-pool 503 and fixture tests
   do not prove successful live CLI execution.
5. Qualify keepalives and actual production memory/body/proxy/timeouts. Source
   evidence records L4 idle 50 s, Traefik read 60 s, nginx body 1 MiB and proxy
   60 s. Post-commit keepalives cannot repair pre-commit silence longer than
   the edge idle limit; the 55 s readiness bound therefore needs explicit
   edge-owner reconciliation. Deployment changes remain separate scope.
6. Record separate release and native activation dispositions. A release with
   native disabled may describe its remaining activation gates only with the
   owner's acceptance; it may not claim native production qualification.
   Nonempty qualified defaults and activation require evidence and owner GO.
   Repack after any pre-release list change; post-publication source changes
   require a properly versioned later release.

The release conductor replaces the judge's literal “#633 merged” prerequisite
with the landed combined #662 baseline and coordinates its subsequent tuple
and #664's later release. Judge 2.12, migration generation, 1.26a/b and
TUPLE/packed qualification remain independent gates, not completed by this fold.

**Closing note:** Once the fold lands, close draft #633 with a link to
[#662](https://github.com/rhanka/sentropic/pull/662), its landed commit and this
design/spec, retaining source provenance and the recorded native activation
disposition. Closure alone proves neither native qualification nor judge
readiness.
