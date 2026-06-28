# SPEC EVOL — Sentropic/STP Application MCP Provider Platform

**Status:** consolidated architecture spec / double consensus reconciled. Both reviewers (Claude architect + Codex) returned ACCEPT_WITH_CONDITIONS; reversible conditions R1–R14 integrated, irreversible items P1–P6 parked in §13.1. No implementation in this spec.

**Track:** `01KW2MHER6QE9WRW3SAJCNH3T8`

**Correction / supersedes prior framing:** this is a **generic Sentropic/STP platform concern**. It must let any Sentropic application or connector expose MCP provider capabilities with auth, tenant isolation, capability registry, elicitation, audit, consent, session storage and durable execution. Domain apps such as immo are consumers and owners of their own domain providers; they are not platform tenants that shape the reusable architecture. Canevas is not owner for this platform work.

Related context:
- `spec/SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP.md` — shared AgentRuntimeLoop, DurableCall, registry, OAuth, workflow, surface parity.
- BR-39 OAuth durable consent grants / `prompt` / `max_age` / `auth_time` context.
- mcp-wave current-state summary: private Hono MCP service, local OAuth, in-memory MCP sessions, Wave GraphQL, 29 tools, desired STP connector adapter.
- Correction Antoine: no immo-specific tenant architecture; domain apps are consumers only.
- `spec/SPEC_STUDY_39_MCP_AUTHKIT_ELICITATION_GAPS.md` — historical BR-39 auth-kit/elicitation study feeding this platform/auth decomposition; not a competing product/platform spec.
- `spec/SPEC_STUDY_39_MCP_LIBRARIZATION.md` — historical BR-39 librarization study feeding candidate implementation decomposition; not a competing product/platform spec.

Any remaining immo-specific MCP spec in the tree must be treated as consumer-only domain framing or explicitly retracted; it is not a Sentropic platform green-light.

## 1. Purpose

Provide a reusable MCP provider platform so apps/connectors can publish MCP resources, tools and prompts to standard MCP clients and Sentropic surfaces:

- Claude.ai / Claude Desktop / other MCP clients;
- Sentropic chat;
- Sentropic VSCode plugin;
- Sentropic CLI (`stp`);
- workflow backend / background agents where policy allows.

The goal is a reusable application/provider contract, not one application-specific provider.

### 1.1 Inputs & lineage / de-duplication map

This spec CONSOLIDATES the generic-platform portions of several MCP-related
inputs without rewriting or deleting them. The inputs and their role relative to
THIS platform spec are:

- `spec/SPEC_STUDY_39_MCP_AUTHKIT_ELICITATION_GAPS.md` — gap-analysis input
  (BR-39 auth-kit / elicitation gaps vs the MCP authorization & elicitation
  drafts); feeds §5, §6 and §6.1.
- `spec/SPEC_STUDY_39_MCP_LIBRARIZATION.md` — librarization-decomposition input
  (candidate `@sentropic/*` package cut and dependency DAG); feeds §2.1 and §12.
- `spec/SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP.md` — canonical
  DurableCall / registry / surface-parity source; referenced, NOT duplicated
  (§8 binds to its `DurableCall`; this spec MUST NOT fork a parallel shape).

De-duplication map — where each major concern lives. CONSOLIDATED-HERE means this
generic platform spec is the home; OWNED-ELSEWHERE means another lane/owner is
authoritative and this spec only references it (it neither restates nor decides
it).

| Concern | Home | Owner / note |
|---|---|---|
| Generic MCP provider, transport, session, registry, elicitation, durable execution, audit, secret-lifecycle, discovery | CONSOLIDATED-HERE | generic platform (§2–§11) |
| RFC 8707 user-flow audience binding, RFC 9728 PRM, `WWW-Authenticate` challenges, DCR, refresh-token policy, published auth-claims contract | OWNED-ELSEWHERE | auth-hono / BR-39l-mcp-authz; HARD prerequisite, owner/contract-gated (§6.1, §6.7, §12; parks P2/P3) |
| `oauth-verify` / `mcp-auth` package cut & publication | OWNED-ELSEWHERE | owner-gated; parked P1 / P2 / P4 (§13.1) |
| `mcp-registry` residence (control-plane vs Resource-Plane; published vs not) | OWNED-ELSEWHERE | joint BR-70 owner; parked P5 (§13.1) |
| 39h identities-table fusion vs additive `identityType` | OWNED-ELSEWHERE | owner-gated; parked P6 (§13.1) |

The study specs are NOT superseded, deleted or retired by this consolidation.
They remain valid inputs: only their generic-platform portions are consolidated
here, while their auth-lane / BR-39l portions stay owned by the auth lane. Wave
and immo are consumers only — they do not shape this architecture — and Canevas
is not an owner.

Adjacent MCP-related specs — explicitly OUT of platform scope. These are
referenced / aligned-with but NOT consolidated into this platform spec; each is
owned by another concern/lane, and pulling its content in here would be scope
creep:

- `spec/SPEC_EVOL_CATALOG.md` — capability catalog/registry concern
  (registry / BR-70 lane). The platform PROJECTS into the registry (see §8) but
  does NOT own catalog modeling.
- `spec/SPEC_EVOL_RESOURCE_FS.md` — resource-plane / virtual-FS concern
  (resource-plane lane). MCP resources MAY surface through it, but FS semantics
  are owned there, not here.
- `spec/SPEC_DECISION_39L_RESOURCE_AUD_RATIFICATION.md` — auth-lane D11/ARCH-12
  ratification of RFC 8707 `resource` → `aud` (BR-39l, auth-hono). This is the
  AS-side prerequisite already noted in §6.7/§12 — owner/contract-gated
  (parked P2), NOT consolidated here.
- `spec/SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md` — skills/tools/marketplace
  study (separate study). Its capability taxonomy MAY inform the registry but is
  not platform-owned.

This spec stays a generic MCP provider platform; these adjacent concerns are
aligned-by-reference only, and pulling their content in would violate the
generic-not-catch-all boundary — the scope-creep failure mode that previously
required the immo retraction.

## 2. Generic core vs connector/domain-app responsibilities

### 2.1 Sentropic/STP core owns

- MCP transport/server toolkit and compatibility probes.
- MCP session lifecycle and persistence.
- OAuth/OIDC resource-server integration and consent/freshness semantics.
- Sentropic principal, tenant/account/workspace mapping primitives.
- Capability registration and registry projection.
- STP MCP multiplexer, discovery, routing and connector visibility.
- Per-capability authz middleware and policy hooks.
- Typed elicitation protocol and surface-neutral rendering contract.
- DurableCall/workflow adapter for long-running tools.
- Audit/provenance/redaction hooks and event schemas.
- Secret lifecycle primitives: connector enrollment, storage interface, rotation/revocation hooks, diagnostics without secret disclosure.
- Candidate package decomposition, informed by BR-39 librarization studies but not frozen here:
  - `oauth-verify`: framework-free verification core;
  - `mcp-auth`: MCP/resource-server authorization kit;
  - `auth-hono`, `auth-client`, `auth-ui` extensions where real consumers justify extraction;
  - registry initially incubated in API/control-plane or resource-plane until a second real package consumer appears.

Avoid creating `mcp-registry` or h2a bridge packages by architecture desire alone; extraction follows real consumption and dependency-DAG pressure.

### 2.2 Connector or domain application owns

- Domain/API semantics and data model.
- Domain authorization resolver and membership checks.
- Domain resources/tools/prompts and schemas.
- Domain data classification, legal basis and UAT.
- Domain-specific mutations, human/legal gates and owner approvals.
- API-specific SDKs, GraphQL/REST calls and business invariants.
- Adapter implementation against the platform contract.

### 2.3 Non-goals / hard constraints

- Do not assign ownership to Canevas.
- Do not special-case immo as platform architecture or tenant model.
- Do not move app-owned invite/enrollment/device/browser gates into IdP by default.
- Do not trust LLM/tool-supplied tenant/user ids as authoritative.
- Do not make connector scopes public/default without Antoine/PRINCIPAL decision.
- Do not touch the `mcp-wave` repository from this Sentropic spec consolidation.
- No implementation beyond spec consolidation unless explicit human approval.

## 3. Component model

```text
MCP Client / Sentropic Surface
  - Claude.ai / Claude Desktop / generic MCP client
  - Sentropic chat
  - VSCode plugin
  - stp CLI
  - backend workflow / background agent
        |
        v
Sentropic/STP MCP Provider Platform
  - MCP transport/session protocol
  - OAuth/OIDC resource-server integration
  - STP multiplexer + connector discovery
  - app/provider registration + capability registry
  - elicitation protocol
  - per-tool/resource/prompt authz
  - audit/provenance/redaction
  - DurableCall + workflow orchestration hooks
  - secret lifecycle interfaces
        |
        v
Application / Connector Provider Adapter
  - app-owned tools/resources/prompts
  - domain-owned authz resolver
  - domain/API data access
  - app-owned UAT and legal gates
```

This model aligns with AgentRuntimeLoop: chat, VSCode, `stp`, MCP clients and backend workflows are surfaces that call the same registry and durable-call capabilities.

## 4. Provider manifest and adapter contract

### 4.1 Two distinct identity axes (do not conflate)

Two orthogonal axes flow through the platform and MUST NOT be collapsed in
authorization or surface-parity logic:

- **Sentropic surface** — closed set `chat | vscode | stp | backend`. This is the
  surface-parity axis: every surface MUST consume the same registry and durable
  calls and render capabilities identically. Parity contracts are expressed
  against this axis only.
- **External MCP client** — open set `claude.ai | claude-code | codex | …`. This
  is the MCP authorization axis: the client identity participates in OAuth client
  binding, elicitation anti-phishing and MCP session isolation.

A single request MAY carry both (e.g. `surface=chat` reached through the
`claude.ai` MCP client). Authorization, parity filtering and elicitation binding
MUST select the correct axis explicitly; a surface value MUST NOT be substituted
where a client identity is required, nor the reverse.

### 4.2 Provider manifest

Applications/connectors expose capabilities through a manifest. Per-capability
gates, idempotency, redaction and freshness are authoritative on each capability
(see §4.3); manifest-level fields are defaults/discovery only and never override
a stricter per-capability declaration.

```ts
type AppMcpProviderManifest = {
  appId: string;
  providerId: string;
  version: string;
  displayName: string;
  resources: CapabilityResource[];
  tools: CapabilityTool[];
  prompts: CapabilityPrompt[];
  elicitation?: ElicitationPolicy[];
  authz: {
    requiredClaims: string[];
    scopes: string[];
    tenantResolution: 'sentropic-account' | 'app-org' | 'connector-instance' | 'custom-resolver';
    freshness?: AuthFreshnessPolicy;
  };
  audit: {
    eventKinds: string[];
    piiClass?: 'none' | 'low' | 'moderate' | 'high';
    retentionClass?: string;
  };
  durability: {
    longRunningTools?: string[];
    workflowBackedTools?: string[];
  };
  secrets?: ConnectorSecretRequirement[];
};
```

### 4.3 Capability schemas (closed)

Every resource/tool/prompt declares its own required scopes/claims, input/output
schema, redaction class, mutability, idempotency-key requirement, elicitation
requirement and human/PRINCIPAL gate. These live on each capability, not only at
manifest level. No capability field is implicitly undefined: read-only
capabilities (resources, prompts) still declare mutability and the
idempotency-key requirement explicitly as a closed exception
(`mutatesExternalSystem: false`, `idempotency.required: false`, with
human-confirmation/idempotency N/A for read-only), rather than leaving the field
absent.

```ts
// Closed redaction classification, reused by capabilities, audit and results.
type RedactionClass = 'none' | 'low' | 'moderate' | 'high' | 'secret';

// Closed mutability classification.
type Mutability = 'read-only' | 'state-transition' | 'append' | 'patch' | 'delete';

// Idempotency requirement for a capability invocation.
type IdempotencyRequirement = {
  required: boolean;                 // when true, the caller MUST supply idempotencyKey
  scope?: 'principal' | 'tenant' | 'connector-instance';
};

// Per-capability human/PRINCIPAL/elicitation gates.
type CapabilityGates = {
  requiresElicitation: boolean;      // a typed, validated elicitation step MUST complete first
  requiresHumanConfirmation: boolean;
  requiresPrincipalGate: boolean;    // owner / PRINCIPAL decision required before invocation
};

// Auth freshness expectation for a capability or the manifest default.
type AuthFreshnessPolicy = {
  maxAgeSeconds: number;             // token auth_time MUST be within this window
  acr?: string[];                    // required authentication context class(es)
  amr?: string[];                    // required authentication method(s)
  stepUp: 'auth' | 'scope' | 'either'; // which step-up satisfies a staleness failure
};

type CapabilityResource = {
  kind: 'resource';
  name: string;
  uriTemplate: string;
  description: string;
  requiredScopes: string[];
  requiredClaims: string[];
  outputSchema: unknown;             // JSON Schema, closed at the adapter
  redactionClass: RedactionClass;
  mutability: 'read-only';
  mutatesExternalSystem: false;      // closed read-only exception: never mutates external state
  idempotency: { required: false };  // idempotency-key requirement N/A for read-only — declared, never implicit
  freshness?: AuthFreshnessPolicy;
  gates: CapabilityGates;
};

type CapabilityTool = {
  kind: 'tool';
  name: string;
  description: string;
  requiredScopes: string[];
  requiredClaims: string[];
  inputSchema: unknown;              // JSON Schema, closed at the adapter
  outputSchema: unknown;
  redactionClass: RedactionClass;
  mutability: Mutability;
  mutatesExternalSystem: boolean;    // generic write flag (replaces connector-specific flags)
  idempotency: IdempotencyRequirement;
  freshness?: AuthFreshnessPolicy;
  gates: CapabilityGates;
};

type CapabilityPrompt = {
  kind: 'prompt';
  name: string;
  description: string;
  requiredScopes: string[];
  requiredClaims: string[];
  argumentSchema: unknown;           // JSON Schema (input), closed at the adapter
  outputSchema: unknown;             // JSON Schema (output), closed at the adapter
  redactionClass: RedactionClass;
  mutability: 'read-only';
  mutatesExternalSystem: false;      // closed read-only exception: never mutates external state
  idempotency: { required: false };  // idempotency-key requirement N/A for read-only — declared, never implicit
  freshness?: AuthFreshnessPolicy;
  gates: CapabilityGates;
};

type AppCapability = CapabilityResource | CapabilityTool | CapabilityPrompt;

// Secret a connector instance requires, declared per scope; always sensitive.
type ConnectorSecretRequirement = {
  name: string;
  scope: 'principal' | 'tenant' | 'workspace' | 'connector-instance';
  sensitive: true;                   // always treated as secret; never model-visible
  rotation?: 'manual' | 'scheduled' | 'provider-driven';
  description?: string;
};

// Input the core hands to an adapter resolveTenant() (see §4.4).
type ConnectorTenantResolutionInput = {
  principalSub: string;              // core-authoritative subject
  tenantRef: string;                 // core-authorized tenant
  workspaceRef?: string;
  connectorInstanceId: string;
  selectorHints?: Record<string, unknown>; // raw client/model-supplied ids, advisory only
};

// Authoritative scoping resolved for a single invocation. Produced by core;
// an adapter resolveTenant() MAY ONLY narrow within it, never broaden.
type ConnectorTenantContext = {
  principalRef: string;              // core-authoritative principal
  tenantRef: string;                 // core-authorized tenant
  workspaceRef?: string;
  connectorInstanceId: string;
  domainScopeRef?: string;           // adapter-internal scope (e.g. Wave businessId)
  defaults?: Record<string, unknown>;
};
```

Request/result envelopes and the durable-call handle:

```ts
type DurableCallRef = string;        // == DurableCall.id (SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP §3.2)

type AppInvocationEnvelope<TInput> = {
  capabilityRef: string;             // capability name within the manifest
  input: TInput;
  ctx: StpConnectorContext;
  idempotencyKey?: string;           // REQUIRED when the capability's idempotency.required
  elicitationRef?: string;           // satisfied elicitation, REQUIRED when gates.requiresElicitation
};

type AppToolInvocation = AppInvocationEnvelope<unknown>;
type AppResourceRead = AppInvocationEnvelope<{ uri: string }>;
type AppPromptRequest = AppInvocationEnvelope<Record<string, unknown>>;

type AppResultEnvelope<TOutput> = {
  ok: boolean;
  output?: TOutput;
  durableCallRef?: DurableCallRef;   // present when the work is durable/long-running
  auditId: string;
  redactionClass: RedactionClass;
  error?: { code: string; message: string; retriable: boolean };
};

type AppToolResult = AppResultEnvelope<unknown>;
type AppResourceResult = AppResultEnvelope<unknown>;
type AppPromptResult = AppResultEnvelope<unknown>;
type ConnectorSecretStatus = SecretStatus[]; // see §6.4
```

### 4.4 Adapter contract

```ts
type AppConnectorProviderAdapter = {
  appId: string;
  connectorId: string;
  manifest: AppMcpProviderManifest;
  resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext>;
  listCapabilities(ctx: ConnectorTenantContext): Promise<AppCapability[]>;
  invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef>;
  readResource(req: AppResourceRead): Promise<AppResourceResult>;
  renderPrompt?(req: AppPromptRequest): Promise<AppPromptResult>;
  validateSecrets(ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus>;
};
```

`resolveTenant` mapping rule: CORE resolves the authoritative principal and
tenant and delivers them on `StpConnectorContext.principal` (and the
`ConnectorTenantResolutionInput`). The adapter's `resolveTenant` maps ONLY to
domain-internal scoping (e.g. a Wave `businessId`) and MAY ONLY narrow within the
core-authorized principal→tenant binding. It MUST NOT establish, broaden or
re-bind the principal→tenant relationship; raw tool/model-supplied ids are
selector hints only, never authoritative.

### 4.5 Target runtime context

```ts
interface StpConnectorContext {
  requestId: string;
  correlationId: string;
  auditId: string;

  // Core context carries verified claims/scopes + tenant/workspace refs only.
  // Domain roles/membership are resolved by the domain resolver (§2.2),
  // never injected into the core context.
  principal: {
    sub: string;                      // verified subject (authorization-derived)
    claims: Record<string, unknown>;  // verified claims only
    scopes: string[];                 // granted scopes
    tenantRef: string;                // core-authorized tenant
    workspaceRef?: string;
    authTime: string;                 // token auth_time (freshness source, §6.5)
    freshness?: AuthFreshnessPolicy;  // effective policy applied to this call
  };

  // Two axes kept distinct (§4.1): surface = parity axis; mcpClient = authz axis.
  surface: 'chat' | 'vscode' | 'stp' | 'backend';
  mcpClient?: { clientId: string; client: 'claude.ai' | 'claude-code' | 'codex' | string };

  session: { mcpSessionId: string };

  // Selected scoping. Raw tool/model-supplied ids are selector hints only,
  // never authoritative; the values below are core-resolved.
  tenantRef: string;
  workspaceRef?: string;
  connectorInstanceId: string;
  consentRefs: string[];
  grantRefs: string[];

  // Durable-call / governance refs (align with DurableCall, §8).
  mandateRef?: string;
  trackRef?: string;

  // Audited just-in-time secret accessor: every access is per-call audited and
  // supports rotation/revocation hooks. No bulk secret map is ever exposed.
  getSecret(name: string): Promise<string>;

  connectorConfig: Record<string, unknown>;
  audit: { emit(event: unknown): Promise<void> };
  logger: unknown;
}
```

## 5. Elicitation

The platform must support MCP/client elicitation as a first-class typed protocol, not ad-hoc chat text.

Elicitation covers:

- missing parameter collection;
- consent prompts;
- tool-specific confirmation;
- tenant/account/workspace/app context selection;
- ambiguous resource resolution;
- human-in-the-loop approval before mutations;
- additional auth freshness / re-login flows when policy requires;
- connector enrollment, secret entry, rotation and revocation confirmations.

Required properties:

- typed elicitation request/response schemas;
- resumable/durable elicitation state linked to DurableCall/workflow where relevant;
- surface-neutral rendering for MCP clients, chat, VSCode and CLI;
- audit of prompt, response, actor, scope and resulting authorization decision;
- fail-closed timeout/cancellation semantics;
- no secret echo in logs, prompts, traces or fixtures;
- elicitation must not smuggle secrets into model-visible text;
- secret collection/enrollment must use controlled UI or credential surfaces with redaction and audit;
- models receive only status, handles or opaque refs for secret operations;
- re-entry after session restart without losing policy context.

### 5.1 Elicitation state machine

Every elicitation is a durable, fail-closed state machine. The forward path is
`requested -> rendered -> answered -> validated -> resumed`; any non-completing
outcome is a terminal that DENIES the gated action.

```ts
type ElicitationState =
  // forward path
  | 'requested' | 'rendered' | 'answered' | 'validated' | 'resumed'
  // terminals (all fail-closed: the gated capability is NOT invoked)
  | 'cancelled' | 'timed_out' | 'denied' | 'expired';

type ElicitationMode = 'form' | 'confirm' | 'consent' | 'url' | 'credential';

type ElicitationRecord = {
  id: string;
  state: ElicitationState;
  mode: ElicitationMode;
  durableCallRef?: DurableCallRef;   // when gating a durable call (§8)
  sessionRef: string;                // owning MCP session (§6.3)
  capabilityRef: string;             // gated capability
  actor: { sub: string; client?: string }; // authorization-derived subject + MCP client
  ttlSeconds: number;
  auditId: string;
  failClosed: true;                  // only state === 'resumed' authorizes the gated action
  createdAt: string;
  updatedAt: string;
};
```

Allowed transitions: `requested -> rendered -> answered -> validated -> resumed`;
from any non-terminal state the machine MAY move to `cancelled`, `timed_out`,
`denied` or `expired`. Terminals are absorbing. Only `resumed` releases the gate.

### 5.2 Normative rules

- (a) Anti-phishing — an elicitation MUST be bound to BOTH the MCP client and the
  authorization-derived `sub`. For sensitive and `url`-mode elicitations the
  platform MUST enforce `initiator.sub == completer.sub`; a mismatch MUST move
  the record to `denied`.
- (b) No secrets in form mode — `form` mode MUST NOT carry secrets. Sensitive
  credential entry MUST use `url` or `credential` mode that does not transit the
  MCP client, and the secret value MUST NOT appear in any model-visible text,
  log, trace or fixture.
- (c) NHI / agent principal — human-targeted elicitation (consent, confirmation,
  secret entry) MUST fail-closed or route to the delegating human when the
  acting principal is a non-human/agent identity. It MUST NEVER be auto-satisfied
  by the model.

## 6. OAuth, MCP session storage, multi-tenant mapping and secret lifecycle

The reusable platform must define:

- OIDC/OAuth client/resource-server integration;
- durable consent grants where applicable;
- `prompt`, `max_age`, `auth_time` and freshness expectations;
- mapping from external MCP/client identity to Sentropic user/principal;
- mapping from Sentropic principal to tenant/account/workspace through app-owned resolver;
- per-capability scope checks on every request, never only session-level authorization;
- revocation and re-consent semantics;
- no default/broad tenant fallback;
- resource-server token validation and audience checks;
- audit records for session creation, consent, revocation, credential access and tool invocation.

### 6.1 MCP authorization interop requirements

The platform auth/session layer must explicitly account for MCP authorization interop seams identified by BR-39 MCP studies:

- RFC 9728 Protected Resource Metadata (PRM) for resource metadata publication/discovery;
- RFC 8707 resource/audience parameter on user authorization-code flow, so access tokens are audience-bound to the MCP resource server;
- RFC 8414 OAuth Authorization Server Metadata / OIDC discovery expectations;
- RFC 9207 authorization server issuer (`iss`) response parameter where applicable;
- `WWW-Authenticate` challenge semantics including `resource_metadata`, `scope` and `insufficient_scope` signaling;
- DPoP / proof-of-possession support where policy requires sender-constrained tokens;
- DCR/CIMD and native-client/refresh-token behavior as known seams that remain decision-gated rather than default platform commitments.

These are interoperability requirements for the resource-server/auth kit boundary; exact package placement remains subject to the extraction-by-real-consumption rule.

### 6.2 MCP session persistence

MCP sessions must be persisted independently from transient chat/CLI sessions. Requirements:

- session id, client id, source surface, user/principal, tenant/workspace context;
- consent/grant refs and auth freshness evidence;
- revocation state and expiry;
- restart-safe lookup when policy allows;
- fail-closed when tenant/workspace is missing or ambiguous;
- model/client/tool-supplied `businessId`, `orgId`, `tenantId`, `workspaceId` or similar identifiers treated only as selector hints, validated against core-resolved authorized context, never authoritative;
- connector/domain adapters receive authorized context from core and may only further narrow it, never broaden it;
- correlationId/auditId for every call.

Secret lifecycle requirements:

- secrets scoped by user/tenant/workspace/connector instance as policy requires;
- no global connector secret by accident;
- explicit enrollment separate from application account enrollment;
- rotation, revocation and diagnostics hooks;
- redacted audit of access without token/customer/PII leakage;
- connector-local secrets may remain during migration but must be replaceable by core-managed storage.

### 6.3 Session, consent and enrollment records

Concrete, restart-safe records back the persistence requirements above. Each
carries a closed lifecycle state and MUST be looked up fail-closed: any state
other than `active` denies use of the record.

```ts
type LifecycleState = 'active' | 'revoked' | 'expired' | 'suspended';

type McpSession = {
  id: string;                        // mcp-session-id (restart-safe lookup key)
  clientId: string;
  client?: string;                   // external MCP client (claude.ai | claude-code | …)
  surface: 'chat' | 'vscode' | 'stp' | 'backend';
  principalSub: string;
  tenantRef: string;
  workspaceRef?: string;
  consentRefs: string[];
  authTime: string;                  // freshness evidence
  state: LifecycleState;
  expiresAt?: string;
  createdAt: string;
};

type ConsentGrant = {
  id: string;
  principalSub: string;
  tenantRef: string;
  connectorInstanceId: string;
  scopes: string[];
  state: LifecycleState;
  grantedAt: string;
  expiresAt?: string;
};

type ConnectorEnrollment = {
  id: string;                        // connectorInstanceId
  connectorId: string;
  principalSub: string;
  tenantRef: string;
  workspaceRef?: string;
  state: LifecycleState;
  secretRefs: string[];
  createdAt: string;
};
```

Restart-safe lookup rules: records are addressable by `id` and by the composite
`(principalSub, tenantRef, connectorInstanceId)`; a process restart MUST be able
to resolve an existing session/grant/enrollment without re-authorization where
policy allows, and MUST deny (fail-closed) when the resolved record's `state` is
`revoked`, `expired` or `suspended`.

### 6.4 Secret status record

```ts
type SecretStatus = {
  name: string;
  scope: 'principal' | 'tenant' | 'workspace' | 'connector-instance';
  state: LifecycleState;             // present-and-active vs revoked/expired/suspended
  rotatedAt?: string;
};
```

`validateSecrets` (§4.4) returns `SecretStatus[]` (= `ConnectorSecretStatus`)
and MUST disclose state only — never the secret value.

Restart-safe lookup rules (mirroring §6.3): a `SecretStatus` is addressable by the
composite key `(principalSub, tenantRef, workspaceRef?, connectorInstanceId, name)`
and MUST be resolved from persisted state, never an in-memory map, so lookups
survive a process restart. Lookup is fail-closed: a missing record, or any `state`
other than `active` (`revoked`, `expired` or `suspended`), denies the gated
capability invocation and routes the principal to enrollment/elicitation (§5).
Only `state === 'active'` authorizes use of the secret.

### 6.5 Per-capability freshness enforcement

At invocation the platform MUST compare the token `auth_time` against the
capability's `max_age` / `AuthFreshnessPolicy`. On staleness the platform MUST
fail-closed and trigger an elicitation step-up. It MUST distinguish:

- **auth step-up** — re-login / re-authentication when `auth_time` is too old or
  `acr`/`amr` are insufficient;
- **scope step-up** — `insufficient_scope` when the principal lacks a required
  scope rather than failing a freshness check.

The `AuthFreshnessPolicy.stepUp` value selects which step-up satisfies the
failure (`auth`, `scope` or `either`).

### 6.6 Token no-passthrough prohibition

- The platform MUST reject any inbound token that is not audience-bound to it
  (issuer/audience mismatch fails closed).
- The platform MUST NOT forward the inbound MCP token to any downstream system.
  Connectors call downstream APIs with core-managed credentials only.
- In the target model the Wave `bearer_passthrough` credential mode is RETIRED;
  it survives only as a migration-phase artifact (§10) and MUST NOT exist after
  parity is proven.

### 6.7 AS-side prerequisite ordering

The authorization-server (AS) side is a HARD prerequisite slice and MUST land
before the resource-server (RS) platform contract is testable: auth-hono must
emit RFC 8707 audience binding on the user authorization-code flow, publish
RFC 9728 Protected Resource Metadata (PRM) and return correct
`WWW-Authenticate` challenges. Today the user-flow access-token audience is
hardcoded to `userinfo`, so user-delegated tokens cannot be audience-bound to an
MCP resource server; until that is fixed the RS contract here cannot be
end-to-end verified (see also §12).

## 7. STP MCP multiplexer, discovery and auth connector visibility

The platform should include a core STP-facing discovery and routing layer so multiple MCP providers/connectors can be exposed consistently.

```text
stp auth / Sentropic auth enrollment
        |
        v
STP connector + MCP capability registry
        |
        +--> list globally available connectors
        +--> list workspace-filtered connectors
        +--> show enrollment/auth/consent status per connector
        +--> expose authorized MCP provider endpoints/sessions
        +--> route chat/VSCode/stp/backend runtime to capabilities
```

A future `stp` package/plugin should expose:

- available MCP providers/connectors;
- auth/enrollment status per connector;
- workspace associations and current tenant mapping;
- active MCP sessions and revocation status;
- required scopes and consent state;
- safe enable/disable/revoke operations;
- diagnostics without secrets;
- connector visibility consistent with chat, VSCode and backend registry.

This must remain a generic STP/Sentropic capability, not a Wave-specific or immo-specific command.

### 7.1 Authz-projected discovery and visibility states

- Discovery listing MUST be authz-projected with deny-as-missing semantics: the
  platform MUST NOT leak the existence of connectors the principal cannot access.
  An unauthorized connector is absent from the listing, not shown as "denied".
- Connector visibility MUST be rendered identically across chat, VSCode and `stp`
  using a single canonical state set:

```ts
type ConnectorVisibilityState =
  | 'unenrolled'
  | 'enrolled-no-consent'
  | 'consented-active'
  | 'revoked'
  | 'expired'
  | 'error';
```

## 8. Registry, AgentRuntimeLoop and DurableCall integration

The required flow is:

```text
provider manifest
  -> registry projection
  -> surface policy / visibility filtering
  -> AgentRuntimeLoop or MCP transport invocation
  -> DurableCall where needed
  -> audit/evidence/provenance
```

Registry visibility is advisory/discovery only. It is never authorization by itself. Per-request authorization must be repeated at invocation time using the current principal, session, scopes, tenant/workspace context, consent/freshness state and adapter policy.

The same capabilities must project into the Sentropic registry so they can be consumed consistently by:

- MCP provider transport;
- Sentropic chat;
- VSCode plugin;
- `stp` CLI;
- workflow backend;
- background agents;
- AgentRuntimeLoop.

Long-running MCP tools MUST bind to the canonical `DurableCall` type defined in
`SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP.md` §3.2. This spec MUST NOT fork a parallel
durable-call shape. `DurableCallRef == DurableCall.id`.

MCP-specific correlation is carried via additional refs alongside the canonical
record (extending, not replacing, its fields):

```ts
// Refs threaded onto / alongside the canonical DurableCall for MCP capabilities.
type McpDurableCallRefs = {
  sessionRef: string;                // owning MCP session (§6.3)
  connectorInstanceRef: string;
  tenantRef: string;
  workspaceRef?: string;
  idempotencyKey?: string;
  elicitationRef?: string;           // gating elicitation (§5.1)
  auditId: string;
  correlationId: string;
  cancellationReason?: string;
};
```

The canonical `state` value `waiting` MUST be qualified by what the call is
waiting for, so observers can act:

```ts
type DurableCallWaitingFor = 'elicitation' | 'consent' | 'freshness' | 'external-workflow';
```

Durable MCP calls inherit the canonical record's `queued | running | waiting |
succeeded | failed | cancelled` states, correlation/audit ids, `workflowRunId`
when orchestrated, `checkpointRef`/resumable status, `evidenceRefs`, cancellation
semantics, and the same observability as chat/VSCode/CLI calls. The governance
refs `mandateRef`/`trackRef` are carried on both `DurableCall` and
`StpConnectorContext` (§4.5).

This spec inherits `SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP.md` constraints: surfaces are clients, not orchestrators; code-workspace harness applies only to code workspaces; irreversible mutations require explicit policy/human gates.

## 9. Wave current-state migration reference — no special-casing

Reference input from `claude:mcp-wave` (2026-06-26): current `mcp-wave` is a private Node/ESM package with a Hono MCP service, local OAuth provider, Wave GraphQL operations and 29 MCP tools. These details are migration evidence, not platform special-casing.

Current Wave boundaries:

- entrypoints: `stdio`, `http`, `oauth-http`;
- Hono app: `/healthz`, `/readyz`, OAuth metadata/routes, protected MCP streamable HTTP on `/mcp` and `/`;
- MCP server built directly on `@modelcontextprotocol/sdk` plus `@hono/mcp` `StreamableHTTPTransport`;
- in-memory MCP session map keyed by `mcp-session-id`;
- local single-tenant OAuth provider and file JSON token/client/code store;
- credential providers: `env_token`, `bearer_passthrough`, `mock`;
- no durable STP user, tenant, workspace or org membership model;
- tools often accept `businessId` directly rather than resolving tenant -> business server-side.

Wave tool inventory at migration start:

- read: `list_businesses`, `list_customers`, `get_customer`, `list_invoices`, `get_invoice`, `get_invoice_payment`, `download_invoice_pdf`, `list_products`, `list_vendors`, `list_accounts`, `get_account`, `list_client_profiles`, `get_payroll_rates`;
- write: `approve_invoice`, `create_invoice`, `send_invoice`, `mark_invoice_paid`, `update_invoice_payment`, `delete_invoice_payment`, `send_invoice_payment_receipt`, `delete_invoice`, `create_customer`, `upsert_product`;
- workflows/domain: `create_invoice_for_client`, `audit_account_mapping`, `setup_account_mapping`, `split_payroll_remittance`, `split_transaction`, `analyze_transactions_csv`.

Wave read-only manifest evidence forwarded by architecture also identifies generic manifest affordances the platform should preserve for any connector, not just Wave:

- `requiredSecrets`: e.g. `waveAccessToken` scoped to connector instance / tenant owner and sensitive;
- optional connector config such as default business/account ids and jurisdiction;
- migration compatibility fields: preserve single-tenant env-token mode during phase 1, current in-memory MCP sessions, target STP durable session store and revocation;
- per-tool category (`read`, `write`, `workflow`, `transaction`), generic `mutatesExternalSystem`/mutability, `idempotency`, and `requiresHumanConfirmation` flags (no connector-specific write flag).

These are generic adapter affordances for elicitation, human gates, audit, rollback and probes. Full tool zod schemas/descriptions remain connector-owned and are not copied into this platform spec.

Migration implication: STP core must absorb generic session/auth/tenant/secret/discovery concerns while Wave keeps Wave API and accounting semantics.

## 10. Single-tenant MCP connector migration phases

Recommended reversible phases for migrating any existing single-tenant MCP
connector onto the platform. Wave is used only as evidence/example; the phases
and probes are app-neutral.

1. **Adapter beside current service**
   - keep existing entrypoints and local OAuth/session store;
   - export a `defineStpMcpConnector(...)` adapter;
   - no production behavior change.

2. **Core-managed sessions and auth in parallel**
   - STP core owns MCP sessions, auth guards, resource-server validation and connector discovery;
   - connector still supports its legacy single-tenant env/file mode for rollback.

3. **Core-managed tenant secrets and workspace mapping**
   - STP resolves `{tenantRef, principalSub, workspaceRef?, connectorInstanceId, defaults}` and serves secrets via the audited accessor (§4.5);
   - connector stops accepting broad direct domain ids unless authorized by core context.

4. **Retire local OAuth/file/session ownership**
   - remove connector-local OAuth AS and MCP session persistence only after probes prove parity;
   - retire any `bearer_passthrough` credential mode (§6.6);
   - connector keeps its domain-specific tools, schemas and API code.

Parity probes before removing connector-local ownership (app-neutral):

- the legacy single-tenant path still works during migration;
- core-managed session survives process restart and supports revocation;
- connector secret scoped per tenant / connector instance;
- ambiguous tenant/workspace mapping fails closed;
- read capabilities work with core context;
- mutating capabilities (`mutatesExternalSystem`) require explicit policy/elicitation/human gate + idempotency + audit;
- audit events redact tokens, customer PII and sensitive domain details according to policy;
- dual-session rollback works (legacy and core-managed sessions can coexist, then legacy is removed).

## 11. Test harness / compatibility probe matrix

Reusable platform tests MUST be app-neutral (mocked OIDC issuer/client/resource
server, mocked MCP client/server, fake tenants/users/apps/connectors). The
required probes are a matrix with explicit pass/fail assertions:

| Probe group | Probe | Pass | Fail |
|---|---|---|---|
| OIDC/MCP auth | PRM published & discoverable | RFC 9728 metadata served and resolvable | metadata missing/malformed |
| OIDC/MCP auth | Audience/resource binding | token `aud` bound to this RS accepted | non-bound token rejected fail-closed |
| OIDC/MCP auth | Issuer mismatch | matching `iss` accepted | mismatched `iss` rejected |
| OIDC/MCP auth | Insufficient scope | required scope present → allow | missing scope → `insufficient_scope` |
| OIDC/MCP auth | Freshness (`max_age`/`auth_time`) | fresh token allowed | stale token → auth step-up, fail-closed |
| OIDC/MCP auth | Revocation | active token allowed | revoked token denied |
| Session persistence | Restart lookup | session resolvable after process restart | unresolved → fail-closed |
| Session persistence | Expiry | non-expired session allowed | expired session denied |
| Session persistence | Revoked-session denial | active session allowed | revoked session denied |
| Session persistence | Cross-client isolation | session usable only by its own client | foreign client cannot reuse session |
| Tenant isolation | Malicious id hints | core-resolved tenant honored | spoofed `tenantId`/`businessId`/`workspaceId` hint fails closed |
| Registry | Manifest projection | capability projects to chat/VSCode/stp/backend identically | divergent projection fails |
| Registry | Invocation rechecks authz | per-request authz re-evaluated | unauthorized → deny-as-missing |
| Secrets | Enroll/rotate/revoke/diagnostics | lifecycle transitions succeed; diagnostics show state only | secret value exposed → fail |
| Secrets | No secret leakage | no secret in logs/prompts/traces/fixtures | any secret echo → fail |
| Elicitation | Resume after restart | elicitation resumes to `resumed` | lost state → fail-closed |
| Elicitation | Cancel/timeout/denied | terminal state denies gated action | gated action proceeds → fail |
| Elicitation | Secret-entry isolation | secret entered via url/credential mode only | secret transits MCP client/form → fail |
| Elicitation | Anti-phishing sub-match | `initiator.sub == completer.sub` enforced | mismatch → `denied` |
| Elicitation | NHI fail-closed | agent principal routes to human or fails closed | model auto-satisfies → fail |
| Writes | Read by scope | scoped read allowed | unscoped read denied |
| Writes | Mutation gating | mutation requires gate + idempotency + audit | ungated mutation → fail |
| DurableCall | Long call lifecycle | queues/runs/waits/resumes/cancels with stable refs | broken/forked refs → fail |
| Migration | Legacy path unchanged | single-tenant path still works during migration | regression → fail |
| Migration | Dual-session rollback | legacy + core-managed sessions coexist, then legacy removed | rollback impossible → fail |
| Migration | Parity before removal | core-managed sessions/secrets prove parity before local ownership removal | premature removal → fail |
| Quota | Per-tenant rate-limit/quota | core hook enforces per-tenant limits | unbounded usage → fail |

The per-tenant rate-limit/quota core hook cross-references
`SPEC_EVOL_QUOTA_LEDGER` for the authoritative quota/metering model.

Real validation with Claude.ai or another external client is UAT, not CI dependency.

## 12. Reversible build slices after consensus

**Hard prerequisite (ordering):** the AS-side slice (auth-hono RFC 8707 user-flow
audience binding + RFC 9728 PRM + correct `WWW-Authenticate` challenges) MUST land
before the RS-side platform contract below is end-to-end testable. Today the
user-flow access-token audience is hardcoded to `userinfo`, so user-delegated
tokens cannot be audience-bound to an MCP resource server (see §6.7). Until that
prerequisite is met, RS-side slices can be unit/mock-tested but not verified
against real audience-bound tokens.

1. App-neutral MCP provider manifest and adapter schemas.
2. Mock OIDC + mock MCP harness.
3. MCP session storage interface and in-memory/test implementation.
4. Capability registry projection for resources/tools/prompts/connectors.
5. Per-request authz middleware and tenant resolver port.
6. Elicitation protocol and surface-neutral renderer contract.
7. Audit/redaction event schema.
8. Secret lifecycle interface and redacted diagnostics.
9. DurableCall/workflow adapter for long-running tools.
10. STP connector discovery/multiplexer read-only projection.
11. Sample fake-data connector/provider.
12. Wave adapter migration guide/probes without touching `mcp-wave` from this branch.
13. Domain provider adoption guide.

## 13. Decisions requiring Antoine / PRINCIPAL

- Making any MCP client/provider path public by default.
- Default connector scopes or broad tenant mapping behavior.
- Mutation tools without explicit human/PRINCIPAL gate.
- Storing app enrollment/device state in a generic IdP instead of app/domain layer.
- Choosing mandatory dependency on a specific MCP framework, ADK or LangGraph.
- Production audit retention and PII policy.
- Production secret store selection and operational rotation policy.
- Owner approval for any real production data exposure or write-capable connector/tool.

### 13.1 Irreversible / owner-gated parks (do not resolve in this spec)

The following are IRREVERSIBLE decisions parked for the owner/architect. They are
NOT resolved here and MUST NOT be pre-empted by build slices.

- **P1 — Package cut / publication / durable names / public-API export stability**
  (e.g. `oauth-verify` + `mcp-auth`): npm publication, trusted-publisher setup and
  compat matrix. IRREVERSIBLE / owner-gated.
- **P2 — Published auth-claims contract mutations** (D11 / ARCH-12 gate): variable
  `aud` on user tokens, `act` claim, `tid` on service tokens, `refresh_token` in
  token responses — these affect pinned prod RPs even at an npm-minor bump.
  IRREVERSIBLE / owner-gated.
- **P3 — Refresh-token policy reversal for native/MCP clients** (reverses the
  IdP-standalone R10 `offline_access` rejection) — a security-posture reversal.
  IRREVERSIBLE / owner-gated.
- **P4 — RS-middleware relocation / auth-hono 1.0 timing** — touches every RS
  consumer. IRREVERSIBLE / owner-gated.
- **P5 — `mcp-registry` residence** (control-plane vs Resource-Plane; published vs
  not) — joint decision with the BR-70 owner. IRREVERSIBLE / owner-gated.
- **P6 — 39h identities-table fusion vs additive `identityType`** — amends the
  memorialized 39h deliverable. IRREVERSIBLE / owner-gated.

## 14. Consensus requests

Required before implementation split:

1. Claude architecture/runtime/auth/registry reviewer: validate platform boundaries, auth/session/registry/runtime alignment and no immo/Canevas ownership leakage.
2. Codex implementability/schemas/probes/tests reviewer: validate adapter schemas, migration phases, session/secret lifecycle, testability and reversible slices.

Consensus responses or blockers must be recorded against Track item `01KW2MHER6QE9WRW3SAJCNH3T8` before build work starts.
