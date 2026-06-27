/**
 * @sentropic/mcp-platform — PRIVATE mock-only scaffold.
 *
 * Public surface of the generic Sentropic/STP MCP provider platform contract
 * (SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM, slices 1+2). This package is private and
 * unpublished; the exports below exist only for the in-memory test harness.
 */

// Slice 1 — manifest & capability schemas (§4.2, §4.3).
export type {
  RedactionClass,
  Mutability,
  IdempotencyRequirement,
  CapabilityGates,
  AuthFreshnessPolicy,
  CapabilityResource,
  CapabilityTool,
  CapabilityPrompt,
  AppCapability,
  ConnectorSecretRequirement,
  ConnectorTenantResolutionInput,
  ConnectorTenantContext,
  ElicitationPolicy,
  AppMcpProviderManifest,
} from './manifest.js';

// Slice 1 — runtime contract (§4.3 envelopes, §4.4 adapter, §4.5 context, §6.3/§6.4 records, §7.1, §8).
export type {
  DurableCallRef,
  AppInvocationEnvelope,
  AppToolInvocation,
  AppResourceRead,
  AppPromptRequest,
  AppResultEnvelope,
  AppToolResult,
  AppResourceResult,
  AppPromptResult,
  LifecycleState,
  McpSession,
  ConsentGrant,
  ConnectorEnrollment,
  SecretStatus,
  ConnectorSecretStatus,
  ConnectorVisibilityState,
  McpDurableCallRefs,
  DurableCallWaitingFor,
  StpConnectorContext,
  AppConnectorProviderAdapter,
} from './runtime.js';
