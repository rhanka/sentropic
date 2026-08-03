import { describe, expect, it } from 'vitest';
import { createCoworkGeneralAdapter, type CoworkBrokerClosure, type CoworkTrustedInvocation } from '../src/index.js';

function invocation(tenantRef: string, toolCallId = 'call-1'): CoworkTrustedInvocation {
  return { toolCallId, principalSub: 'user-1', tenantRef, workspaceRef: `workspace-${tenantRef}`, targetDeviceId: `device-${tenantRef}`, selectedBy: 'human-controller' };
}

function request(trusted: CoworkTrustedInvocation, input: unknown = {}) {
  return {
    capabilityRef: 'input_action', input,
    ctx: {
      auditId: `audit-${trusted.tenantRef}`,
      principal: { sub: trusted.principalSub }, tenantRef: trusted.tenantRef, workspaceRef: trusted.workspaceRef,
      connectorConfig: { coworkTrustedInvocation: trusted }, audit: { emit: async () => undefined },
    },
  } as never;
}

describe('Cowork general adapter C1 boundary', () => {
  it('keeps same toolCallId closures isolated by trusted tenant and returns one closure per logical call', async () => {
    const closures = new Map<string, CoworkBrokerClosure>();
    const adapter = createCoworkGeneralAdapter({
      async open(trusted) {
        const key = `${trusted.tenantRef}:${trusted.workspaceRef}:${trusted.toolCallId}`;
        const existing = closures.get(key);
        if (existing) return existing;
        const closure: CoworkBrokerClosure = {
          invocation: trusted,
          async invoke() { return { outcome: 'DÉPOSÉ-EN-ATTENTE', durableCallRef: `call:${key}` }; },
        };
        closures.set(key, closure);
        return closure;
      },
    });
    const [first, second, retry] = await Promise.all([
      adapter.invokeTool(request(invocation('tenant-a'))),
      adapter.invokeTool(request(invocation('tenant-b'))),
      adapter.invokeTool(request(invocation('tenant-a'))),
    ]);

    expect(closures).toHaveLength(2);
    expect(first).toMatchObject({ durableCallRef: 'call:tenant-a:workspace-tenant-a:call-1' });
    expect(second).toMatchObject({ durableCallRef: 'call:tenant-b:workspace-tenant-b:call-1' });
    expect(retry).toMatchObject({ durableCallRef: 'call:tenant-a:workspace-tenant-a:call-1' });
  });

  it('denies a missing or context-mismatched trusted invocation as a missing capability', async () => {
    const adapter = createCoworkGeneralAdapter({ async open() { throw new Error('must not open'); } });
    const absent = await adapter.invokeTool({ capabilityRef: 'input_action', input: {}, ctx: { connectorConfig: {} } } as never);
    const trusted = invocation('tenant-a');
    const mismatched = await adapter.invokeTool({
      ...request(trusted), ctx: { ...request(trusted).ctx, tenantRef: 'tenant-b' },
    } as never);

    expect(absent).toMatchObject({ error: { code: 'connector_not_found' } });
    expect(mismatched).toMatchObject({ error: { code: 'connector_not_found' } });
  });
});
