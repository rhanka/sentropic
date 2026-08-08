import {
  mountConnectorHost,
  type AccountResolver,
  type ConnectorHostDriver,
  type TenantWorkspaceResolver,
} from '@sentropic/connector-host';
import type {
  AppCapability,
  AppConnectorProviderAdapter,
  AppMcpProviderManifest,
  AppResourceResult,
  AppToolResult,
  ConnectorSecretStatus,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
} from '@sentropic/mcp-platform';

import { findActiveCoworkDevice } from '../cowork/device-identity';
import { issueLease, readLeaseOutcome, revokeLease, type LeaseOutcome } from '../cowork/device-lease-service';
import { redactCoworkAudit, type CoworkAuditEvent } from '../cowork/redacted-audit';
import { logger } from '../../logger';
import { requireWorkspaceAccess } from '../workspace-access';
import { hasCoworkWorkspaceExposure, listCoworkWorkspaceExposureCapabilities } from '../cowork/provisioning';

export const COWORK_CONNECTOR_ID = 'cowork-desktop';
export const COWORK_CAPABILITIES = ['screen_capture', 'input_action'] as const;
type CoworkCapability = typeof COWORK_CAPABILITIES[number];

const gates = { requiresElicitation: true, requiresHumanConfirmation: true, requiresPrincipalGate: true };
const tool = (name: CoworkCapability, mutability: 'read-only' | 'state-transition'): AppCapability => ({
  kind: 'tool', name, description: `Remote Cowork ${name.replace('_', ' ')} on a selected isolated kiosk.`,
  requiredScopes: [`cowork:${name === 'screen_capture' ? 'screen:capture' : 'input:act'}`], requiredClaims: [],
  inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, redactionClass: 'high', mutability,
  ...(mutability === 'state-transition' ? { category: 'write' } : { category: 'read' }),
  mutatesExternalSystem: name === 'input_action', idempotency: { required: name === 'input_action' }, gates,
});

export const coworkManifest: AppMcpProviderManifest = {
  appId: 'sentropic', providerId: COWORK_CONNECTOR_ID, version: '0.1.0', displayName: 'Cowork isolated kiosk',
  resources: [], tools: [tool('screen_capture', 'read-only'), tool('input_action', 'state-transition')], prompts: [],
  authz: { requiredClaims: [], scopes: ['cowork:screen:capture', 'cowork:input:act'], tenantResolution: 'connector-instance' },
  audit: { eventKinds: ['lease_issued', 'lease_result', 'lease_denied'], piiClass: 'high' }, durability: {}, secrets: [],
};

const deny = (reason: string) => ({ deny: true as const, reason });

export type CoworkInvocationBrokerPort = {
  issue(input: { userId: string; workspaceId: string; sessionId: string; targetDeviceId: string; toolCallId: string; capability: CoworkCapability; action: Record<string, unknown> }): Promise<{ ok: true; leaseId: string } | { ok: false }>;
  wait(leaseId: string, timeoutMs: number): Promise<LeaseOutcome>;
  revoke(leaseId: string, userId: string): Promise<void>;
};

const defaultBroker: CoworkInvocationBrokerPort = {
  async issue(input) {
    const result = await issueLease({
      userId: input.userId, deviceId: input.targetDeviceId, turnRef: input.toolCallId, workspaceId: input.workspaceId, sessionId: input.sessionId,
      scope: { capability: input.capability, action: input.action },
    });
    return result.ok ? { ok: true, leaseId: result.lease.leaseId } : { ok: false };
  },
  async wait(leaseId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const outcome = await readLeaseOutcome(leaseId);
      if (outcome) return outcome;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { outcome: 'PAS-FAIT' };
  },
  async revoke(leaseId, userId) { await revokeLease(leaseId, 'bounded_result_timeout', userId); },
};

export function createCoworkInvocationBroker(input: {
  broker?: CoworkInvocationBrokerPort;
  audit?: (event: CoworkAuditEvent) => void | Promise<void>;
  userId: string;
  workspaceId: string;
  sessionId: string;
  targetDeviceId: string;
  toolCallId: string;
  capability: CoworkCapability;
  action: Record<string, unknown>;
}) {
  const broker = input.broker ?? defaultBroker;
  const audit = input.audit ?? (() => undefined);
  return async (): Promise<AppToolResult> => {
    const issued = await broker.issue(input);
    if (!issued.ok) {
      await audit({ kind: 'lease_denied', toolCallId: input.toolCallId, targetDeviceId: input.targetDeviceId, capability: input.capability, outcome: 'PAS-FAIT' });
      return { ok: false, auditId: `cowork:${input.toolCallId}`, redactionClass: 'high', error: { code: 'cowork_not_done', message: 'PAS-FAIT', retriable: false } };
    }
    await audit({ kind: 'lease_issued', toolCallId: input.toolCallId, leaseId: issued.leaseId, targetDeviceId: input.targetDeviceId, capability: input.capability });
    const completion = await broker.wait(issued.leaseId, 30_000);
    if (completion.outcome !== 'FAIT') await broker.revoke(issued.leaseId, input.userId);
    await audit({ kind: 'lease_result', toolCallId: input.toolCallId, leaseId: issued.leaseId, targetDeviceId: input.targetDeviceId, capability: input.capability, outcome: completion.outcome });
    return completion.outcome === 'FAIT'
      ? { ok: true, output: { status: 'FAIT', result: completion.result }, auditId: `cowork:${input.toolCallId}`, redactionClass: 'high' }
      : { ok: false, auditId: `cowork:${input.toolCallId}`, redactionClass: 'high', error: { code: 'cowork_not_done', message: 'PAS-FAIT', retriable: false } };
  };
}

const coworkAdapter: AppConnectorProviderAdapter = {
  appId: 'sentropic', connectorId: COWORK_CONNECTOR_ID, manifest: coworkManifest,
  async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
    return { principalRef: input.principalSub, tenantRef: input.tenantRef, workspaceRef: input.workspaceRef, connectorInstanceId: input.connectorInstanceId };
  },
  async listCapabilities(): Promise<AppCapability[]> { return [...coworkManifest.tools]; },
  async invokeTool(): Promise<AppToolResult> { throw new Error('Cowork execution must use the per-invocation broker closure.'); },
  async readResource(): Promise<AppResourceResult> { return { ok: false, auditId: 'cowork-no-resource', redactionClass: 'high', error: { code: 'connector_not_found', message: 'Connector capability not found.', retriable: false } }; },
  async validateSecrets(): Promise<ConnectorSecretStatus> { return []; },
};

export const createCoworkAccountResolver = (): AccountResolver => ({
  async resolve(input) {
    if (input.connectorId !== COWORK_CONNECTOR_ID) return deny('connector_not_found');
    const deviceId = input.accountSelectorHint?.trim();
    // C2: even one eligible device is ambiguous until a human picked it.
    if (!deviceId) return deny('human_target_selection_required');
    const device = await findActiveCoworkDevice(input.principalSub, deviceId);
    if (!device) return deny('target_not_eligible');
    if (!(await hasCoworkWorkspaceExposure({ userId: input.principalSub, deviceId, workspaceId: input.workspaceRef }))) {
      return deny('workspace_exposure_required');
    }
    return { connectorInstanceId: `cowork-device:${deviceId}`, enrollmentRef: `cowork-device:${deviceId}`, secretRefs: [] };
  },
});

export const createCoworkTenantWorkspaceResolver = (): TenantWorkspaceResolver => ({
  async resolve(input) {
    if (!input.requestedWorkspaceRef) return deny('workspace_required');
    try { await requireWorkspaceAccess(input.sessionPrincipalSub, input.requestedWorkspaceRef); }
    catch { return deny('workspace_access_denied'); }
    const capabilityIds = await listCoworkWorkspaceExposureCapabilities({
      userId: input.sessionPrincipalSub,
      workspaceId: input.requestedWorkspaceRef,
    });
    return {
      principalSub: input.sessionPrincipalSub, tenantRef: input.requestedWorkspaceRef, workspaceRef: input.requestedWorkspaceRef,
      exposure: { capabilityIds },
    };
  },
});

/** Shared durable mount: it stores only ports. Each call creates its own broker closure. */
export function createCoworkConnectorHost(input: { broker?: CoworkInvocationBrokerPort; audit?: (event: CoworkAuditEvent) => void | Promise<void> } = {}): ConnectorHostDriver {
  const audit = input.audit ?? ((event: CoworkAuditEvent) => {
    logger.info({ cowork: redactCoworkAudit(event) }, 'Cowork redacted audit event');
  });
  return mountConnectorHost({
    adapters: { [COWORK_CONNECTOR_ID]: coworkAdapter },
    ports: { secret: { async resolve() { throw new Error('Cowork has no secret port.'); } }, account: createCoworkAccountResolver(), tenantWorkspace: createCoworkTenantWorkspaceResolver(), audit: { async emit() {} } },
    exposurePolicy: { isCapabilityAllowed: ({ capabilityRef }) => (COWORK_CAPABILITIES as readonly string[]).includes(capabilityRef) },
    async invokeResolved({ request, account }) {
      const execution = request.execution;
      const capability = request.capabilityRef as CoworkCapability;
      const targetDeviceId = account.connectorInstanceId.replace('cowork-device:', '');
      if (!execution || !COWORK_CAPABILITIES.includes(capability)) {
        return { ok: false, auditId: 'cowork-missing-trusted-context', redactionClass: 'high', error: { code: 'cowork_not_done', message: 'PAS-FAIT', retriable: false } };
      }
      if (!(await hasCoworkWorkspaceExposure({ userId: request.sessionPrincipalSub, deviceId: targetDeviceId, workspaceId: request.requestedWorkspaceRef ?? '', capability }))) {
        return { ok: false, auditId: 'cowork-workspace-exposure-required', redactionClass: 'high', error: { code: 'cowork_not_done', message: 'PAS-FAIT', retriable: false } };
      }
      return createCoworkInvocationBroker({ broker: input.broker, audit, userId: request.sessionPrincipalSub, workspaceId: request.requestedWorkspaceRef ?? '', sessionId: execution.sessionId, targetDeviceId, toolCallId: execution.toolCallId, capability, action: request.input as Record<string, unknown> })();
    },
  });
}

export function redactedAuditLog(event: CoworkAuditEvent): Record<string, string> {
  return redactCoworkAudit(event);
}
