import type { ConnectorHostDriver, CoworkTrustedInvocation } from '@sentropic/connector-host';

const COWORK_CAPABILITIES = new Set(['screen_capture', 'input_action']);

export type TrustedCoworkCatalogCall = Readonly<{
  toolCallId: string;
  capabilityRef: 'screen_capture' | 'input_action';
  assertedModelArgs: Record<string, unknown>;
  principalSub: string;
  tenantRef: string;
  workspaceRef: string;
  selectedTarget: Readonly<{ deviceId: string; source: 'human-controller' }>;
}>;

/**
 * Additive catalog handler. The catalog resolves `capabilityRef` before this
 * handler runs; raw model tool names and hints never choose a Cowork policy.
 */
export function createCoworkCatalogHandler(driver: ConnectorHostDriver) {
  return async (call: TrustedCoworkCatalogCall) => {
    if (!COWORK_CAPABILITIES.has(call.capabilityRef) || call.selectedTarget.source !== 'human-controller') {
      return { ok: false, error: { code: 'connector_not_found' } };
    }
    const invocation: CoworkTrustedInvocation = Object.freeze({
      toolCallId: call.toolCallId,
      principalSub: call.principalSub,
      tenantRef: call.tenantRef,
      workspaceRef: call.workspaceRef,
      targetDeviceId: call.selectedTarget.deviceId,
      selectedBy: 'human-controller',
    });
    return driver.invoke({
      sessionPrincipalSub: call.principalSub,
      requestedWorkspaceRef: call.workspaceRef,
      connectorId: 'cowork-general',
      capabilityRef: call.capabilityRef,
      input: call.assertedModelArgs,
      coworkTrustedInvocation: invocation,
    });
  };
}
