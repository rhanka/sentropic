# Domain provider adoption guide (MOCK-ONLY scaffold)

> **Status: PRIVATE, unpublished, reversible scaffold.** `@sentropic/mcp-platform`
> is `"private": true`, is NOT wired into any publish filter / CI publish job /
> Makefile target / trusted-publisher config, and MUST NOT be published. Everything
> below describes the **mock** contract built in slices 1+2+3+7 of
> `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` (track `01KW2MHER6QE9WRW3SAJCNH3T8`).
> Package activation, publication, and any production wiring are **owner/architect
> gated** — see [What stays owner/architect-gated](#what-stays-ownerarchitect-gated-before-production).

This is the spec §12 "domain provider adoption guide": how a domain application
builds an MCP connector/provider on this platform **without** re-implementing (or
weakening) the security-critical core. It is faithful to the real adapter contract
in `src/` — every symbol it cites exists in the built code.

---

## 1. What you build vs what the core gives you

A domain connector is **one object**: an `AppConnectorProviderAdapter`
(`src/runtime.ts`). You implement the domain behaviour; the **core** owns every
security-critical decision and never delegates it back to your adapter.

| Concern | Owner | Where |
| --- | --- | --- |
| Manifest + closed capability schemas | **You (domain)** | `AppMcpProviderManifest`, `CapabilityResource\|Tool\|Prompt` (`src/manifest.ts`) |
| `resolveTenant` (narrow-only), `listCapabilities`, `invokeTool`, `readResource`, `renderPrompt?`, `validateSecrets` | **You (domain)** | `AppConnectorProviderAdapter` (`src/runtime.ts`) |
| Per-request token verification + principal/tenant derivation | **Core** | `authorizeRequest` (`src/authz.ts`) |
| Deny-as-missing discovery projection | **Core** | `listVisibleCapabilities` (`src/guard.ts`) |
| Mutation gate + idempotency enforcement | **Core** | `assertMutationGate` / `invokeGuardedTool` (`src/guard.ts`) |
| Elicitation state machine (anti-phishing, NHI fail-closed) | **Core** | `ElicitationManager` (`src/elicitation.ts`) |
| Audited, just-in-time secret access (no plaintext map) | **Core** | `StpConnectorContext.getSecret` (`src/context.ts`) |
| Durable / long-running calls | **Core** | `DurableCallAdapter` (`src/durable.ts`) |
| Audit + redaction | **Core** | `InMemoryAuditSink`, `SecretRedactor` (`src/audit.ts`) |
| Restart-safe lifecycle stores | **Core** | `src/stores.ts`, `src/persistence.ts` |

**The golden rule:** your adapter receives an already-authorized
`StpConnectorContext` (`src/runtime.ts`). The principal, tenant, scopes, claims,
consent refs and freshness are **core-resolved from the token**. Your adapter
never authenticates, never reads a raw bearer, never establishes a tenant, and
never broadens the resolved scope.

---

## 2. Step 1 — declare your manifest

A connector advertises its capabilities through an `AppMcpProviderManifest`
(`src/manifest.ts`). Each capability is a **closed schema**: every governance
field is declared explicitly, never left implicit.

For every capability declare:

- `requiredScopes` / `requiredClaims` — checked per-request by the core
  (`authorizeRequest`), and used by the core's deny-as-missing discovery
  (`listVisibleCapabilities`). A principal who lacks them does not see the
  capability at all.
- `redactionClass` — one of `RedactionClass`
  (`none | low | moderate | high | secret`); flows onto every `AppResultEnvelope`.
- `mutability` — one of `Mutability`
  (`read-only | state-transition | append | patch | delete`).
- `mutatesExternalSystem` — the single generic write flag. When `true`, the core
  requires a gate + idempotency key before the work runs.
- `idempotency` — `IdempotencyRequirement` (`{ required, scope? }`). When
  `required`, the caller MUST supply `idempotencyKey`.
- `freshness?` — `AuthFreshnessPolicy` (`maxAgeSeconds`, optional `acr`/`amr`,
  `stepUp`). The capability value overrides the manifest default; the core enforces
  it and returns the right step-up.
- `gates` — `CapabilityGates`
  (`requiresElicitation`, `requiresHumanConfirmation`, `requiresPrincipalGate`).

### Read-only closed exception (do not skip it)

Read-only capabilities (`CapabilityResource`, `CapabilityPrompt`) MUST declare the
exception **explicitly** — it is part of the type, never implicit:

```ts
mutatesExternalSystem: false; // closed read-only exception
idempotency: { required: false }; // N/A for read-only — declared, never implicit
mutability: 'read-only';
```

A read-only **tool** (e.g. a long export) is still a `CapabilityTool` with
`mutability: 'read-only'` and `mutatesExternalSystem: false`; it can still be
long-running (see [Long-running tools](#6-long-running-tools--return-a-durablecallref)).

### Manifest-level fields are discovery defaults only

`manifest.authz` / `manifest.audit` / `manifest.durability` are **defaults /
discovery hints**. They never override a stricter per-capability declaration
(§4.2/§4.3). Declare secrets the connector instance needs via
`manifest.secrets: ConnectorSecretRequirement[]` (`sensitive: true` is mandatory
and fixed).

---

## 3. Step 2 — implement the adapter contract

```ts
import type { AppConnectorProviderAdapter } from '@sentropic/mcp-platform';
```

`AppConnectorProviderAdapter` (`src/runtime.ts`) is:

```ts
{
  appId: string;
  connectorId: string;
  manifest: AppMcpProviderManifest;
  resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext>;
  listCapabilities(ctx: ConnectorTenantContext): Promise<AppCapability[]>;
  invokeTool(req: AppToolInvocation): Promise<AppToolResult | DurableCallRef>;
  readResource(req: AppResourceRead): Promise<AppResourceResult>;
  renderPrompt?(req: AppPromptRequest): Promise<AppPromptResult>;
  validateSecrets(ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus>;
}
```

### `resolveTenant` — narrow ONLY

The core hands you a `ConnectorTenantResolutionInput` whose `principalSub` and
`tenantRef` are already core-authoritative; `selectorHints` are raw client/model
ids and are **advisory only**. You return a `ConnectorTenantContext` that MAY
**narrow** within the authorized binding (e.g. map the tenant to a domain
`domainScopeRef`) but MUST NEVER re-bind or broaden it:

```ts
async resolveTenant(input) {
  return {
    principalRef: input.principalSub,
    tenantRef: input.tenantRef,        // keep the core tenant — never from selectorHints
    workspaceRef: input.workspaceRef,
    connectorInstanceId: input.connectorInstanceId,
    domainScopeRef: `widget-space:${input.tenantRef}`, // domain narrowing only
  };
}
```

### `invokeTool` returns `AppToolResult | DurableCallRef`

- For an inline tool, return an `AppToolResult` (`AppResultEnvelope`): `ok`,
  optional `output` (model-safe — already redaction-classed), `auditId`,
  `redactionClass`, and a structured `error?` on failure.
- For a long-running tool, return a `DurableCallRef` (`== DurableCall.id`); the
  core's `DurableCallAdapter` owns the lifecycle from there (see §6).

`readResource` returns an `AppResourceResult`; `renderPrompt` (optional) returns an
`AppPromptResult`. `validateSecrets` returns a `ConnectorSecretStatus`
(`SecretStatus[]`) and **discloses state only** — never a value.

---

## 4. Step 3 — rely on the core (do not re-implement it)

Your adapter is invoked **only after** the core has authorized the request. Lean
on these instead of reinventing them:

- **Per-request authz** — `authorizeRequest` (`src/authz.ts`) verifies the
  audience-bound token (issuer/audience/expiry/revocation), derives
  principal + tenant **from the token only** (selector hints are cross-checked and
  fail closed on `cross_tenant` / `ambiguous_tenant`), checks per-capability scopes
  (`insufficient_scope` → scope step-up), required claims (`missing_claims`),
  freshness (`stale_auth` → auth/scope step-up), and consent
  (`no_consent` / `consent_revoked`). Tenant access is **fail-closed**: an
  unenrolled principal (empty authorized set) is denied `no_enrollment` — an empty
  set is never a wildcard.
- **Deny-as-missing discovery** — `listVisibleCapabilities` (`src/guard.ts`)
  returns only the capabilities the principal can actually use; everything else is
  **absent**, never shown as "denied". A tenant the principal cannot access leaks
  nothing.
- **Audited secret access** — `ctx.getSecret(name)` (`src/context.ts`) resolves
  one value per call, audits the access (**name only, never the value**), and fails
  closed (`SecretAccessError`) when the record is missing or not `active`. There is
  **no bulk secret map** on the context.
- **Elicitation** — `ElicitationManager` (`src/elicitation.ts`) runs the
  fail-closed state machine; only `state === 'resumed'` releases a gate (see §7).
- **Durable calls** — `DurableCallAdapter` (`src/durable.ts`) owns the
  long-running lifecycle (see §6).
- **Audit / redaction** — `InMemoryAuditSink` + `SecretRedactor` (`src/audit.ts`)
  redact every registered secret value before anything is recorded.
- **Restart-safe stores** — `src/stores.ts` / `src/persistence.ts` keep
  session/consent/enrollment/secret-status/elicitation/durable-call records
  fail-closed across a restart.

### Mutation gating + idempotency

For a `mutatesExternalSystem` capability, run it through `invokeGuardedTool`
(`src/guard.ts`) — never call your mutation directly:

```ts
const result = await invokeGuardedTool(capability, envelope, {
  elicitations,            // ElicitationManager
  audit, auditId,
  run: (env) => adapter.invokeTool(env), // runs ONLY after the gate passes
});
```

`assertMutationGate` enforces both the gate and the idempotency key. The gate is
**non-fungible**: a `resumed` elicitation only releases the gate for the **same**
capability, session, and principal it was raised for — a resumed record for another
capability/session/principal can never be replayed. Read-only capabilities pass
through. A gate failure runs nothing and still emits a denial audit event.

---

## 5. Worked example — the fake "widgets" connector

`src/mock/fake-connector.ts` is the app-neutral reference. It bakes in **no**
domain shape (no Wave/immo) — it exists solely to exercise the harness. Cite it as
the canonical pattern:

- `listWidgets` — `CapabilityResource`, `requiredScopes: ['widgets:read']`,
  `redactionClass: 'low'`, the read-only closed exception declared explicitly.
- `createWidget` — `CapabilityTool`, `requiredScopes: ['widgets:write']`,
  `mutability: 'append'`, `mutatesExternalSystem: true`,
  `idempotency: { required: true, scope: 'tenant' }`,
  `freshness: { maxAgeSeconds: 300, stepUp: 'auth' }`,
  `gates: { requiresElicitation: true, requiresHumanConfirmation: true, … }` — the
  mutating path that the core gates.
- `exportWidgets` — `CapabilityTool`, **read-only but long-running**
  (`mutatesExternalSystem: false`), declared in
  `manifest.durability.longRunningTools` / `workflowBackedTools`. Its `invokeTool`
  returns a `DurableCallRef` via an injected `launchDurable`, and **fails closed**
  (`durable_backend_unavailable`) when no durable backend is wired.
- `fakeManifest` — the assembled `AppMcpProviderManifest`
  (`secrets: [{ name: 'fakeAccessToken', sensitive: true, … }]`).
- `createFakeConnector(deps)` — returns the `AppConnectorProviderAdapter`; its
  `resolveTenant` keeps the core tenant and only adds `domainScopeRef`.

Copy this structure; swap "widgets" for your domain. Do **not** copy any pattern
the example deliberately avoids — see DON'Ts below.

---

## 6. Long-running tools — return a `DurableCallRef`

When work outlives a single interaction, `invokeTool` returns a `DurableCallRef`
instead of an inline result. The core's `DurableCallAdapter` (`src/durable.ts`)
drives the canonical `DurableCall` lifecycle (transcribed verbatim from
`SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP` §3.2 — the shape is **never forked**; MCP
correlation is threaded alongside via `McpDurableCallRefs` /
`McpDurableCall = { call, refs, waitingFor? }`):

`queued → running → waiting(<reason>) → succeeded | failed | cancelled`, where
`waiting` is qualified by `DurableCallWaitingFor`
(`elicitation | consent | freshness | external-workflow`).

Guarantees you inherit for free:

- **Idempotent launch** — a repeated `launch` with the same `idempotencyKey`
  returns the **same** call, never a duplicate.
- **Fail-closed resume** — a `waiting` call only resumes once its wait is cleared
  (elicitation gate released, or an injected `isWaitCleared` resolver for
  consent/freshness/external-workflow; with no resolver it **never** clears).
  `succeed` is reachable only from `running`, so a waiting-on-consent call can never
  succeed until consent is present.
- **Audited** — every transition emits a redacted audit event with ids/state/refs
  only — never a token, secret value, or PII.

Wire it via `FakeConnectorDeps.launchDurable` (or your equivalent) so the adapter
hands the envelope to the core and returns the ref.

---

## 7. Elicitation — anti-phishing + NHI fail-closed

When a capability declares `gates.requiresElicitation` (or human/principal gate),
the flow goes through `ElicitationManager` (`src/elicitation.ts`). The forward path
is `requested → rendered → answered → validated → resumed`; **only `resumed`**
releases the gate. Every non-completing outcome (`cancelled`, `timed_out`,
`denied`, `expired`) is an absorbing terminal that **denies** the gated capability.

The core enforces, before accepting an answer:

- **Client binding** — an elicitation initiated from an MCP client can only be
  completed by that same client.
- **Anti-phishing sub-match** — `url` / `credential` / `consent` modes require
  `initiator.sub === completer.sub`.
- **Secret-safe modes** — `form` mode MUST NOT carry secrets; sensitive credential
  entry uses `url` / `credential` mode (which does not transit the MCP client). The
  provisional `elicitationPolicyIsSecretSafe` check enforces this for
  `ElicitationPolicy` (the final canonical policy shape is architect-gated — fix
  F8).
- **NHI fail-closed** — a human-targeted elicitation (`confirm` / `consent` /
  `credential`) completed by a non-human / agent principal requires an
  **independently confirmed** delegation via an injected `DelegationResolver`. A
  self-declared `completer.delegatingHumanSub` is **never** trusted; absent a
  resolver, any NHI fails closed.

`advance()` only performs the non-security hop `requested → rendered`; every later
hop must go through `answer()` / `validate()` / `resume()` so no caller can skip the
checks.

---

## 8. DON'Ts (these are security boundaries, not style)

- **No token passthrough.** Never read, forward, log, or store a raw bearer. The
  transport consumes it at the auth boundary; your handler receives a
  `SanitizedMcpRequest` and a core-resolved `StpConnectorContext` — the token is
  structurally absent.
- **No plaintext secret map.** Never put secret values on the context or in
  `connectorConfig`. Use `ctx.getSecret(name)` per access; it audits name-only and
  fails closed.
- **No self-declared NHI delegation.** An agent/model must never auto-satisfy a
  human-targeted elicitation; delegation is confirmed out-of-band by the trusted
  `DelegationResolver`, never by a field the caller supplies.
- **No broad / default tenant fallback.** Never treat "no enrollment" as
  "all tenants". Never establish or re-bind the tenant from `selectorHints`. The
  tenant comes from the token (`tid`); `resolveTenant` may only narrow.
- **No domain roles/membership in the core context.** `StpConnectorContext`
  carries verified claims/scopes + tenant/workspace refs only. Resolve domain
  roles/membership in your own resolver — never inject them into the core context.
- **No implicit read-only.** Always declare `mutatesExternalSystem: false` and
  `idempotency: { required: false }` on read-only capabilities.
- **No forking the `DurableCall` shape.** Thread MCP correlation via
  `McpDurableCallRefs`; never add/rename fields on the canonical record.
- **No secrets in logs/audit/prompts/fixtures.** Register secret values with the
  `SecretRedactor`; emit ids/state/refs only.

---

## 9. Verifying your connector (mock harness)

This package has no Makefile target by design (it is private and unactivated). Run
its own ephemeral toolchain inside the repo's Docker node image (see the package
`README.md` "Running the gates"): a typecheck (`tsc --noEmit`) and the vitest suite
(80/80 across 10 files at the time of writing). Real validation against Claude.ai or
another external MCP client is **UAT, not a CI dependency** (spec §11).

---

## What stays owner/architect-gated before production

The scaffold is mock-only on purpose. The following are **NOT** in scope here and
MUST NOT be pre-empted by a connector build — they are owner/architect decisions
(spec §13) and irreversible parks (spec §13.1):

- **AS-side prerequisite (hard ordering, §12).** Real audience-bound user tokens
  need the authorization-server work first: RFC 8707 user-flow audience binding,
  RFC 9728 Protected Resource Metadata (PRM), and correct `WWW-Authenticate`
  challenges in `auth-hono`. Until that lands, RS-side connectors can only be
  unit/mock-tested, never verified against real tokens.
- **Package cut / publication / activation (P1).** npm publication,
  trusted-publisher setup, durable names, public-API export stability, and adding
  this package to the root lockfile (= activation). Owner/architect-gated.
- **Published auth-claims contract mutations (P2).** Variable `aud`, `act`, `tid`
  on service tokens, refresh-token in token responses — affect pinned prod RPs.
- **Refresh-token policy for native/MCP clients (P3).** A security-posture reversal.
- **RS-middleware relocation / auth-hono 1.0 timing (P4).**
- **`mcp-registry` residence (P5)** and **39h identities-table fusion (P6).**
- **Production audit retention + PII policy** and **production secret-store
  selection + rotation policy** (spec §13) — the in-memory `MockSecretStore` /
  `InMemoryAuditSink` are deliberately not production stores.
- **Any real production data exposure or write-capable connector/tool** requires
  explicit owner approval (spec §13).

Build your connector against the mock contract; escalate the above before anything
touches production.
