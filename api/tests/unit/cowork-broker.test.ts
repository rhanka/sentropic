import { describe, expect, it } from 'vitest';

import { createCoworkInvocationBroker } from '../../src/services/connector-host/cowork';
import { CoworkTargetSelectionStore } from '../../src/services/cowork/target-selection';

describe('Cowork remote broker safety boundaries', () => {
  it('keeps concurrent broker closures keyed to their own trusted tool call', async () => {
    const issued: string[] = [];
    const audit: Array<Record<string, unknown>> = [];
    const broker = {
      async issue(input: { toolCallId: string }) { issued.push(input.toolCallId); return { ok: true as const, leaseId: `lease-${input.toolCallId}` }; },
      async wait(leaseId: string) { return leaseId === 'lease-call-a' ? 'FAIT' as const : 'PAS-FAIT' as const; },
      async revoke() {},
    };
    const run = (toolCallId: string) => createCoworkInvocationBroker({
      broker, audit: (event) => { audit.push(event); }, userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId,
      capability: 'input_action', action: { action: 'click', x: 1, y: 1 },
    })();

    const [first, second] = await Promise.all([run('call-a'), run('call-b')]);
    expect(issued).toEqual(expect.arrayContaining(['call-a', 'call-b']));
    expect(first).toMatchObject({ ok: true, output: { status: 'FAIT' }, auditId: 'cowork:call-a' });
    expect(second).toMatchObject({ ok: false, error: { message: 'PAS-FAIT' }, auditId: 'cowork:call-b' });
    expect(audit.map((event) => event.toolCallId)).toEqual(expect.arrayContaining(['call-a', 'call-b']));
  });

  it('passes workspace and session into each independent issuance closure', async () => {
    const bindings: Array<Record<string, unknown>> = [];
    const invoke = createCoworkInvocationBroker({
      broker: {
        async issue(input) { bindings.push(input); return { ok: true as const, leaseId: 'lease' }; },
        async wait() { return 'PAS-FAIT' as const; },
        async revoke() {},
      },
      userId: 'user', workspaceId: 'workspace-a', sessionId: 'session-a', targetDeviceId: 'device', toolCallId: 'call', capability: 'screen_capture', action: {},
    });
    await invoke();
    expect(bindings).toEqual([expect.objectContaining({ userId: 'user', workspaceId: 'workspace-a', sessionId: 'session-a', targetDeviceId: 'device', toolCallId: 'call' })]);
  });

  it('requires a human session-bound selection even when exactly one device is eligible', async () => {
    const store = new CoworkTargetSelectionStore({
      requireWorkspaceAccess: async () => undefined,
      findDevice: async () => ({ id: 'only-device', userId: 'user', publicKey: 'key', status: 'active', capabilities: {
        capabilityIds: ['screen_capture', 'input_action'], isolatedVmTarget: true, kioskSurface: 'notepad',
      } }),
      isAttested: async () => true,
      hasExposure: async () => true,
    });
    expect(store.get({ userId: 'user', workspaceId: 'workspace', sessionId: 'session' })).toBeNull();
    await expect(store.select({ userId: 'user', workspaceId: 'workspace', sessionId: 'session', deviceId: 'only-device', selectedAt: Date.now() })).resolves.toBe(true);
    expect(store.get({ userId: 'user', workspaceId: 'workspace', sessionId: 'session' })?.deviceId).toBe('only-device');
  });

  it.each(['timeout', 'offline', 'denial', 'mismatch', 'replay', 'stop', 'malformed'])(
    'maps %s to PAS-FAIT and never a success-shaped result',
    async () => {
      const invoke = createCoworkInvocationBroker({
        broker: {
          async issue() { return { ok: true as const, leaseId: 'lease-failed' }; },
          async wait() { return 'PAS-FAIT' as const; },
          async revoke() {},
        },
        userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId: 'call-failed',
        capability: 'screen_capture', action: {},
      });
      await expect(invoke()).resolves.toMatchObject({
        ok: false,
        error: { message: 'PAS-FAIT' },
      });
    },
  );
});
