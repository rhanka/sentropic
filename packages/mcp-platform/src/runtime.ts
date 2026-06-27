/**
 * Slice 1 — Runtime contract: envelopes, target context, adapter, lifecycle
 * records and durable-call refs.
 *
 * Concrete TypeScript transcription of SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM §4.3
 * (envelopes), §4.4 (adapter), §4.5 (StpConnectorContext), §6.3/§6.4 (session,
 * consent, enrollment, secret records), §7.1 (visibility) and §8 (DurableCall
 * refs). This spec MUST NOT fork the canonical DurableCall shape — only refs are
 * threaded alongside it. `DurableCallRef == DurableCall.id`.
 */

import type {
  AppCapability,
  AppMcpProviderManifest,
  AuthFreshnessPolicy,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
  RedactionClass,
} from './manifest.js';

// == DurableCall.id (SPEC_EVOL_AGENT_RUNTIME_HERMES_LOOP §3.2).
export type DurableCallRef = string;

// ---------------------------------------------------------------------------
// Request / result envelopes (§4.3)
// ---------------------------------------------------------------------------

export type AppInvocationEnvelope<TInput> = {
  capabilityRef: string; // capability name within the manifest
  input: TInput;
  ctx: StpConnectorContext;
  idempotencyKey?: string; // REQUIRED when the capability's idempotency.required
  elicitationRef?: string; // satisfied elicitation, REQUIRED when gates.requiresElicitation
};

export type AppToolInvocation = AppInvocationEnvelope<unknown>;
export type AppResourceRead = AppInvocationEnvelope<{ uri: string }>;
export type AppPromptRequest = AppInvocationEnvelope<Record<string, unknown>>;

export type AppResultEnvelope<TOutput> = {
  ok: boolean;
  output?: TOutput;
  durableCallRef?: DurableCallRef; // present when the work is durable/long-running
  auditId: string;
  redactionClass: RedactionClass;
  error?: { code: string; message: string; retriable: boolean };
};

export type AppToolResult = AppResultEnvelope<unknown>;
export type AppResourceResult = AppResultEnvelope<unknown>;
export type AppPromptResult = AppResultEnvelope<unknown>;

// ---------------------------------------------------------------------------
// Lifecycle records (§6.3, §6.4)
// ---------------------------------------------------------------------------

export type LifecycleState = 'active' | 'revoked' | 'expired' | 'suspended';

export type McpSession = {
  id: string; // mcp-session-id (restart-safe lookup key)
  clientId: string;
  client?: string; // external MCP client (claude.ai | claude-code | …)
  surface: 'chat' | 'vscode' | 'stp' | 'backend';
  principalSub: string;
  tenantRef: string;
  workspaceRef?: string;
  consentRefs: string[];
  authTime: string; // freshness evidence
  state: LifecycleState;
  expiresAt?: string;
  createdAt: string;
};

export type ConsentGrant = {
  id: string;
  principalSub: string;
  tenantRef: string;
  connectorInstanceId: string;
  scopes: string[];
  state: LifecycleState;
  grantedAt: string;
  expiresAt?: string;
};

export type ConnectorEnrollment = {
  id: string; // connectorInstanceId
  connectorId: string;
  principalSub: string;
  tenantRef: string;
  workspaceRef?: string;
  state: LifecycleState;
  secretRefs: string[];
  createdAt: string;
};

export type SecretStatus = {
  name: string;
  scope: 'principal' | 'tenant' | 'workspace' | 'connector-instance';
  state: LifecycleState; // present-and-active vs revoked/expired/suspended
  rotatedAt?: string;
};

// validateSecrets (§4.4) returns SecretStatus[] and MUST disclose state only.
export type ConnectorSecretStatus = SecretStatus[];

// ---------------------------------------------------------------------------
// Discovery visibility (§7.1)
// ---------------------------------------------------------------------------

export type ConnectorVisibilityState =
  | 'unenrolled'
  | 'enrolled-no-consent'
  | 'consented-active'
  | 'revoked'
  | 'expired'
  | 'error';

// ---------------------------------------------------------------------------
// DurableCall MCP refs (§8) — threaded ALONGSIDE the canonical DurableCall.
// ---------------------------------------------------------------------------

export type McpDurableCallRefs = {
  sessionRef: string; // owning MCP session (§6.3)
  connectorInstanceRef: string;
  tenantRef: string;
  workspaceRef?: string;
  idempotencyKey?: string;
  elicitationRef?: string; // gating elicitation (§5.1)
  auditId: string;
  correlationId: string;
  cancellationReason?: string;
};

// Qualifies the canonical `waiting` state so observers can act (§8).
export type DurableCallWaitingFor = 'elicitation' | 'consent' | 'freshness' | 'external-workflow';

// ---------------------------------------------------------------------------
// Target runtime context (§4.5)
// ---------------------------------------------------------------------------

export interface StpConnectorContext {
  requestId: string;
  correlationId: string;
  auditId: string;

  // Core context carries verified claims/scopes + tenant/workspace refs only.
  // Domain roles/membership are resolved by the domain resolver (§2.2),
  // never injected into the core context.
  principal: {
    sub: string; // verified subject (authorization-derived)
    claims: Record<string, unknown>; // verified claims only
    scopes: string[]; // granted scopes
    tenantRef: string; // core-authorized tenant
    workspaceRef?: string;
    authTime: string; // token auth_time (freshness source, §6.5)
    freshness?: AuthFreshnessPolicy; // effective policy applied to this call
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

// ---------------------------------------------------------------------------
// Adapter contract (§4.4)
// ---------------------------------------------------------------------------

export type AppConnectorProviderAdapter = {
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
