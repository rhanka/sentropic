# SPEC OpenERP Runtime Requirements For `@sentropic`

Status: Draft 2026-05-14 — capabilities derived from OpenERP MVP decision pack arbitrated on the same date.

## Context

OpenERP (`github.com/rhanka/openerp`) is a TypeScript / SvelteKit ERP project under MIT license. After arbitrating its MVP decision pack on 2026-05-14, OpenERP confirmed `@sentropic` as its agent runtime base. This spec records the six runtime capabilities OpenERP requires from `@sentropic`.

The six capabilities are functional contracts. Implementation will be carried in follow-up branches (candidates `BR-27` to `BR-30`) split per capability or grouped, after this spec is validated.

Cross-references:

- OpenERP decision pack: `~/src/openerp/docs/study/10-mvp-specs/decision-pack.md`
- OpenERP shared entities canon: `~/src/openerp/docs/study/10-mvp-specs/shared-entities-v1.md`
- OpenERP agentic impacts: `~/src/openerp/docs/study/10-mvp-specs/agentic-impacts.md`
- OpenERP foundation spec: `~/src/openerp/docs/study/10-mvp-specs/foundation-security-i18n.md`

## Capability 1 — MCP client + server

OpenERP must expose its ERP entities (Company, Contact, Opportunity, Project, Invoice, etc.) via a Model Context Protocol server so that any agent runtime (including `@sentropic` itself and external runtimes that consume `@sentropic`) can call OpenERP tools. Conversely, `@sentropic` must provide an MCP client so that agents running inside OpenERP can call external MCP tool providers.

Surfaces expected from `@sentropic`:

- MCP client primitive callable from agent loops, with tool discovery, parameter validation, and standard transport (stdio + HTTP).
- MCP server scaffold so that consumers (OpenERP and others) can expose their entities through a uniform endpoint.
- Tool schema registration and discovery aligned with the Anthropic MCP specification.
- Audit hook that records every MCP tool call with `tenant_id`, `acting_principal`, tool name, parameters, result, latency, and error code.

Drives OpenERP decision pack item: AGT-D-05 (MCP registry), AGT-D-08 (audit MCP calls).

## Capability 2 — OpenTelemetry hooks

OpenERP requires OTel traces for LLM completions, tool calls, and agent runs to feed its observability stack (OpenInference + OpenLLMetry MVP per AGT-D-03).

Surfaces expected from `@sentropic`:

- Span instrumentation around LLM provider calls (model, prompt size, response size, token counts, cost, latency, error).
- Span instrumentation around tool calls and policy decisions.
- Configurable exporter (OTLP HTTP/gRPC) without hard dependency on any specific backend.
- Hooks for downstream consumers to attach span attributes (tenant, user, agent_definition, approval_request).

## Capability 3 — Policy hooks

Every tool call must go through a policy evaluation point that can permit, block, or escalate the call based on tenant-defined rules (amount caps, resource scopes, schedule windows, irreversible-action checkpoints).

Surfaces expected from `@sentropic`:

- Pre-call hook: receives `{tool_name, params, identity_context}` and returns `{decision: permit|block|escalate, reason}`. Block aborts the call. Escalate triggers approval flow.
- Post-call hook: receives `{result, status}` for audit and possibly compensating actions.
- Pluggable policy engine: default native TypeScript, swappable for OPA, Cedar, or Casbin in future packs.
- Audit integration: each policy decision is recorded as an `AuditEvent` with `policy_decision_id` available to downstream `AuditEvent` consumers.

Drives OpenERP decision pack: AGT-D-02 (policy engine), AGT-D-15 (irreversible actions).

## Capability 4 — Multi-tenant identity primitives

OpenERP decided (PG-02 + PG-09) to model identity as `UserIdentity` (global, auth/email/MFA) plus `OrganizationMember` (per-tenant statut + rôles + locale). Delegation of action must support RFC 8693 token exchange with `act` and `may_act` claims so that an agent action carries the full chain `human → agent_definition → tool_call`. SPIFFE/SVID workload attestation is deferred to post-MVP but the abstraction must be ready.

Surfaces expected from `@sentropic`:

- `IdentityProvider` interface with at least: issue JWT, verify JWT, exchange token (RFC 8693), revoke.
- Default implementation: JWT signed with HS256 or RS256 with claims `sub`, `act` (acting entity), `may_act` (permitted delegation), `tenant_id`, `actor_type` ∈ `{human, agent, system}`, `expires_at`.
- Token exchange: trade an approving human session for a short-lived agent JWT bound to `acting_for=user_identity_id` and `policy_decision_id`. The agent JWT is the only thing carried through subsequent tool calls.
- Future-proof slot for `SpiffeIdentityProvider` implementing the same interface against a SPIRE control plane; OpenERP migration must be purely config.
- Audit integration: every JWT use produces an `AuditEvent` with `acting_principal`, `on_behalf_of`, `delegation_id`.

## Capability 5 — Marketplace publication primitives

OpenERP plans an internal-governed marketplace of agent definitions (MVP) with future tiers for inter-tenant publication. `@sentropic` must provide the primitives so that OpenERP can publish, validate, and instantiate agent definitions without duplicating runtime logic.

Surfaces expected from `@sentropic`:

- `AgentDefinition` schema (id, name, version, owner_org_id, allowed_tools, max_spend_per_run, requires_approval_above, tenant_visibility).
- `ApprovalPolicy` schema bound to `AgentDefinition` so that publication can require human approval per run, per amount, per role.
- Capability manifest contract: an agent definition declares the capabilities it consumes (MCP tools, sandbox features). The runtime enforces the manifest at activation time and prevents drift.
- Activation API: register an `AgentDefinition`, instantiate an `AgentRun`, enforce policy + sandbox + identity primitives on every loop step.

## Capability 6 — Sandbox API + capability manifest

OpenERP arbitrated on 2026-05-14 (AGT-D-01) that sandbox isolation is `@sentropic`'s responsibility, not OpenERP's. `@sentropic` exposes a sandbox API; OpenERP requires the capability manifest at the boundary so that an agent only sees the capabilities its definition declared.

Surfaces expected from `@sentropic`:

- Sandbox primitive that isolates tool execution from host (file system, network, process). Implementation strategy is `@sentropic`'s choice (isolated-vm, gVisor, Modal, E2B, or hybrid).
- Capability manifest enforced at boundary: an agent run carries `allowed_tools[]` derived from `AgentDefinition`. Any tool call outside the manifest is denied by the sandbox surface, not just by policy.
- Standard error surface (`SandboxViolation { tool, reason, manifest_id }`) so OpenERP can audit and surface in supervision UI.
- Cooperative-yield protocol for long-running tool calls so the host can apply rate-limiting and budget-enforcement (cf. AGT-D-10 rate-limit triplet, AGT-D-14 budget defaults).

## Implementation notes

This spec frames the contracts. Implementation is staged for follow-up branches scoped in PLAN.md after validation. Each capability lands as its own branch (probable split: `BR-27` MCP, `BR-28` OTel+policy, `BR-29` identity, `BR-30` marketplace+sandbox), with atomic commits and Make-only workflow per `rules/MASTER.md`.

OpenERP project will track these capabilities as preconditions for its foundation, CRM, project, billing, reporting, and agentic-impacts implementation. The OpenERP decision pack is the source of truth for the functional intent; this spec is the `@sentropic` engagement that responds to it.
