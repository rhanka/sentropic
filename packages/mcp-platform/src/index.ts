/**
 * @sentropic/mcp-platform — root `.` : FROZEN read-only pure-adapter contract.
 *
 * This entry re-exports ONLY the read-only pure adapter surface a federated
 * connector drives (SPEC_EVOL_MCP_PLATFORM_ACTIVATION §3.1): manifest & capability
 * classification, the read/result envelopes, lifecycle records, the audited target
 * context, the adapter contract and the dependency-free visibility helper.
 *
 * This surface is PUBLIC and semver-governed (0.x additive-first) — it carries a
 * compat guarantee and is gated by an api-extractor golden report. It MUST NOT
 * re-export any elicitation, mutation-gate, DurableCall struct, store or mock
 * symbol; those ship under `./experimental` (unstable) and `./testing` (fixtures).
 */

// Manifest & capability classification (§3.1 — pure, closed schemas).
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
  AppMcpProviderManifest,
} from './manifest.js';

// Runtime read/result contract: envelopes, records, context, adapter (§3.1).
// `DurableCallRef` is a bare `string` alias — it carries no experimental structure;
// the DurableCall STRUCT types are exposed only via `./experimental`.
export type {
  AppInvocationEnvelope,
  AppToolInvocation,
  AppResourceRead,
  AppPromptRequest,
  AppResultEnvelope,
  AppToolResult,
  AppResourceResult,
  AppPromptResult,
  DurableCallRef,
  StpConnectorContext,
  AppConnectorProviderAdapter,
  LifecycleState,
  McpSession,
  ConsentGrant,
  ConnectorEnrollment,
  SecretStatus,
  ConnectorSecretStatus,
  ConnectorVisibilityState,
} from './runtime.js';

// Visibility / deny-as-missing (read-only discovery only) — dependency-free helper.
export { listVisibleCapabilities } from './visibility.js';
export type { VisibilityContext } from './visibility.js';
