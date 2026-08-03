import type {
  AppCapability,
  AppMcpProviderManifest,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
} from '@sentropic/mcp-platform';
import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  ConnectorSecretStatus,
} from '@sentropic/mcp-platform';

/**
 * This context is made by the trusted catalog handler. It is intentionally not
 * part of model input or advisory hints: the C1 closure owns it per tool call.
 */
export type CoworkTrustedInvocation = Readonly<{
  toolCallId: string;
  principalSub: string;
  tenantRef: string;
  workspaceRef: string;
  targetDeviceId: string;
  selectedBy: 'human-controller';
}>;

export type CoworkBrokerResult =
  | { outcome: 'DÉPOSÉ-EN-ATTENTE'; durableCallRef: string }
  | { outcome: 'PAS-FAIT'; reason: string };

export interface CoworkBrokerClosure {
  readonly invocation: CoworkTrustedInvocation;
  invoke(assertedModelInput: unknown): Promise<CoworkBrokerResult>;
}

export interface CoworkBrokerFactory {
  open(invocation: CoworkTrustedInvocation): Promise<CoworkBrokerClosure | null>;
}

const tools: AppMcpProviderManifest['tools'] = [
  {
    kind: 'tool', name: 'screen_capture', description: 'Request a human-gated Cowork observation.',
    requiredScopes: [], requiredClaims: [], inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    redactionClass: 'high', mutability: 'read-only', category: 'read', mutatesExternalSystem: false,
    idempotency: { required: true, scope: 'connector-instance' },
    gates: { requiresElicitation: false, requiresHumanConfirmation: true, requiresPrincipalGate: true, requiresPolicy: true },
  },
  {
    kind: 'tool', name: 'input_action', description: 'Request a human-gated Cowork action.',
    requiredScopes: [], requiredClaims: [], inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    redactionClass: 'secret', mutability: 'state-transition', category: 'transaction', mutatesExternalSystem: true,
    idempotency: { required: true, scope: 'connector-instance' },
    gates: { requiresElicitation: false, requiresHumanConfirmation: true, requiresPrincipalGate: true, requiresPolicy: true },
  },
];

export const coworkGeneralManifest: AppMcpProviderManifest = {
  appId: 'sentropic', providerId: 'cowork-general', version: '1.0.0', displayName: 'Cowork General (gated)',
  resources: [], tools, prompts: [],
  authz: { requiredClaims: [], scopes: [], tenantResolution: 'custom-resolver' },
  audit: { eventKinds: ['cowork.call.deposited', 'cowork.call.denied'], piiClass: 'none' },
  durability: { longRunningTools: ['screen_capture', 'input_action'] },
};

const missing = (auditId = 'cowork-general-missing'): AppToolResult => ({
  ok: false, auditId, redactionClass: 'none',
  error: { code: 'connector_not_found', message: 'Connector capability not found.', retriable: false },
});

function invocationFrom(req: AppToolInvocation): CoworkTrustedInvocation | null {
  const value = req.ctx.connectorConfig.coworkTrustedInvocation;
  if (!value || typeof value !== 'object') return null;
  const invocation = value as CoworkTrustedInvocation;
  if (
    invocation.selectedBy !== 'human-controller'
    || !invocation.toolCallId
    || invocation.principalSub !== req.ctx.principal.sub
    || invocation.tenantRef !== req.ctx.tenantRef
    || invocation.workspaceRef !== req.ctx.workspaceRef
    || !invocation.targetDeviceId
  ) return null;
  return invocation;
}

function sameInvocation(left: CoworkTrustedInvocation, right: CoworkTrustedInvocation): boolean {
  return left.toolCallId === right.toolCallId
    && left.principalSub === right.principalSub
    && left.tenantRef === right.tenantRef
    && left.workspaceRef === right.workspaceRef
    && left.targetDeviceId === right.targetDeviceId
    && left.selectedBy === right.selectedBy;
}

/**
 * Shared mount state stays limited to connector identity and exposure. Every
 * invoke opens a C1 closure; the closure, never this adapter, owns call state.
 */
export function createCoworkGeneralAdapter(factory: CoworkBrokerFactory): AppConnectorProviderAdapter {
  return {
    appId: 'sentropic', connectorId: 'cowork-general', manifest: coworkGeneralManifest,
    async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
      return { principalRef: input.principalSub, tenantRef: input.tenantRef, workspaceRef: input.workspaceRef, connectorInstanceId: input.connectorInstanceId };
    },
    async listCapabilities(): Promise<AppCapability[]> { return [...tools]; },
    async invokeTool(req: AppToolInvocation): Promise<AppToolResult> {
      if (!tools.some((tool) => tool.name === req.capabilityRef)) return missing();
      const invocation = invocationFrom(req);
      if (!invocation) return missing();
      const closure = await factory.open(invocation);
      if (!closure || !sameInvocation(closure.invocation, invocation)) return missing();
      const result = await closure.invoke(req.input);
      await req.ctx.audit.emit({ kind: result.outcome === 'DÉPOSÉ-EN-ATTENTE' ? 'cowork.call.deposited' : 'cowork.call.denied', auditId: req.ctx.auditId });
      return { ok: result.outcome === 'DÉPOSÉ-EN-ATTENTE', output: result, durableCallRef: result.outcome === 'DÉPOSÉ-EN-ATTENTE' ? result.durableCallRef : undefined, auditId: req.ctx.auditId, redactionClass: 'none', ...(result.outcome === 'PAS-FAIT' ? { error: { code: 'cowork_not_done', message: 'Cowork request was not performed.', retriable: false } } : {}) };
    },
    async readResource(_req: AppResourceRead): Promise<AppResourceResult> { return missing(); },
    async validateSecrets(_ctx: ConnectorTenantContext): Promise<ConnectorSecretStatus> { return []; },
  };
}
