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
  ElicitationPolicyMode,
  AppMcpProviderManifest,
} from './manifest.js';

// Slice 1 — provisional §5.2(b) elicitation-policy secret-safety check (fix F8).
export { elicitationPolicyIsSecretSafe } from './manifest.js';

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
  DurableCallKind,
  DurableCallState,
  DurableCall,
  McpDurableCall,
  StpConnectorContext,
  AppConnectorProviderAdapter,
} from './runtime.js';

// Slice 2 — mock OIDC issuer (§6, §11).
export { MockOidcIssuer } from './mock/oidc.js';
export type {
  MockTokenClaims,
  IssueOptions,
  VerifyOptions,
  VerifyResult,
  VerifyFailure,
} from './mock/oidc.js';

// Slice 2 — mock MCP transport (§9 ref, §11).
export { InMemoryMcpServer, InMemoryMcpClient } from './mock/mcp-transport.js';
export type {
  McpRequest,
  SanitizedMcpRequest,
  McpResponse,
  McpRequestHandler,
  TokenAuthorizer,
} from './mock/mcp-transport.js';

// Slice 2 — app-neutral fake connector fixture (+ slice-7 long-running tool).
export { createFakeConnector, fakeManifest } from './mock/fake-connector.js';
export type { FakeConnectorDeps } from './mock/fake-connector.js';

// Slice 2 — audit sink + redaction (§5, §6).
export { InMemoryAuditSink, SecretRedactor, REDACTION_TOKEN } from './audit.js';
export type { AuditEvent } from './audit.js';

// Slice 2 — audited context + secret store (§4.5, §6.4).
export { createStpConnectorContext, MockSecretStore, SecretAccessError } from './context.js';
export type { ContextDeps } from './context.js';

// Slice 2 — elicitation state machine (§5.1, §5.2).
export { ElicitationManager } from './elicitation.js';
export type {
  ElicitationState,
  ElicitationMode,
  ElicitationRecord,
  Completer,
  CreateInput,
  DelegationResolver,
} from './elicitation.js';

// Slice 2 — per-request authz middleware (§6, §7.1, §11).
export {
  authorizeRequest,
  resolveAuthorizedTenant,
  InMemoryTenantRegistry,
  InMemoryConsentRegistry,
} from './authz.js';
export type {
  AuthzResult,
  AuthzRequest,
  AuthzDenyReason,
  AuthorizeDeps,
  TenantResolver,
  ConsentResolver,
} from './authz.js';

// Slice 2 — discovery + mutation gating (§7.1, §10, §11).
export { listVisibleCapabilities, assertMutationGate, invokeGuardedTool } from './guard.js';
export type {
  VisibilityContext,
  MutationGateResult,
  MutationGateReason,
  GuardedInvokeDeps,
} from './guard.js';

// Slice 3 — restart-safe mock persistence primitive (§6.3/§6.4/§5.1, §11).
export { MemoryRecordStore, FileRecordStore } from './persistence.js';
export type { RecordStore } from './persistence.js';

// Slice 3 — typed, restart-safe stores for §6.3 / §6.4 / §5.1 records (§11 probes).
export {
  PersistentSessionStore,
  PersistentConsentStore,
  PersistentEnrollmentStore,
  PersistentSecretStatusStore,
  PersistentElicitationStore,
  secretKeyOf,
} from './stores.js';
export type {
  SessionStore,
  ConsentStore,
  EnrollmentStore,
  SecretStatusStore,
  ElicitationStore,
  SecretKey,
} from './stores.js';

// Slice 7 — mock durable-call / workflow adapter for long-running MCP tools (§8, §11).
export { DurableCallAdapter, PersistentDurableCallStore } from './durable.js';
export type { DurableCallStore, DurableCallAdapterDeps, DurableLaunchInput } from './durable.js';
