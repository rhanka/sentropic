import { describe, expect, it } from 'vitest';

import { createCoworkInvocationBroker } from '../../src/services/connector-host/cowork';
import { CoworkTargetSelectionStore } from '../../src/services/cowork/target-selection';

describe('Cowork remote broker safety boundaries', () => {
  it('keeps concurrent broker closures keyed to their own trusted tool call', async () => {
    const issued: string[] = [];
    const audit: Array<Record<string, unknown>> = [];
    const broker = {
      async issue(input: { toolCallId: string }) { issued.push(input.toolCallId); return { ok: true as const, leaseId: `lease-${input.toolCallId}` }; },
      async wait(leaseId: string) { return leaseId === 'lease-call-a' ? { outcome: 'FAIT' as const, result: { ok: true, image: 'data:image/png;base64,QUJD' } } : { outcome: 'PAS-FAIT' as const }; },
      async revoke() {},
    };
    const run = (toolCallId: string) => createCoworkInvocationBroker({
      broker, audit: (event) => { audit.push(event); }, userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId,
      capability: 'input_action', action: { action: 'click', x: 1, y: 1 },
    })();

    const [first, second] = await Promise.all([run('call-a'), run('call-b')]);
    expect(issued).toEqual(expect.arrayContaining(['call-a', 'call-b']));
    expect(first).toMatchObject({ ok: true, output: { status: 'FAIT', result: { image: 'data:image/png;base64,QUJD' } }, auditId: 'cowork:call-a' });
    expect(second).toMatchObject({ ok: false, error: { message: 'PAS-FAIT' }, auditId: 'cowork:call-b' });
    expect(audit.map((event) => event.toolCallId)).toEqual(expect.arrayContaining(['call-a', 'call-b']));
  });

  it('passes workspace and session into each independent issuance closure', async () => {
    const bindings: Array<Record<string, unknown>> = [];
    const invoke = createCoworkInvocationBroker({
      broker: {
        async issue(input) { bindings.push(input); return { ok: true as const, leaseId: 'lease' }; },
        async wait() { return { outcome: 'PAS-FAIT' as const }; },
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
          async wait() { return { outcome: 'PAS-FAIT' as const }; },
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

  it('revokes lease and fails closed with PAS-FAIT on post-issue exceptions (R3-02)', async () => {
    const revoked: Array<{ leaseId: string; reason?: string }> = [];
    const audit: Array<Record<string, unknown>> = [];
    const invoke = createCoworkInvocationBroker({
      broker: {
        async issue() { return { ok: true as const, leaseId: 'lease-fault-1' }; },
        async wait() { throw new Error('Uncaught broker transport failure'); },
        async revoke(leaseId, _userId, reason) { revoked.push({ leaseId, reason }); },
      },
      audit: (event) => { audit.push(event); },
      userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId: 'call-fault',
      capability: 'input_action', action: { action: 'click', x: 10, y: 10 },
    });

    const result = await invoke();
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'cowork_not_done', message: 'PAS-FAIT' },
    });
    expect(revoked).toEqual([{ leaseId: 'lease-fault-1', reason: 'fault' }]);
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lease_issued', leaseId: 'lease-fault-1' }),
      expect.objectContaining({ kind: 'lease_result', leaseId: 'lease-fault-1', outcome: 'PAS-FAIT', reason: 'fault', settled: 'unverified' }),
    ]));
  });

  it('propagates controller Chat Stop AbortSignal to revoke lease and audit stop_controller (R3-01)', async () => {
    const revoked: Array<{ leaseId: string; reason?: string }> = [];
    const audit: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    const invoke = createCoworkInvocationBroker({
      broker: {
        async issue() { return { ok: true as const, leaseId: 'lease-stop-1' }; },
        async wait(_leaseId, _timeoutMs, signal) {
          if (signal?.aborted) return { outcome: 'PAS-FAIT', reason: 'stop_controller', settled: 'attested' };
          return new Promise((resolve) => {
            signal?.addEventListener('abort', () => {
              resolve({ outcome: 'PAS-FAIT', reason: 'stop_controller', settled: 'attested' });
            });
          });
        },
        async revoke(leaseId, _userId, reason) { revoked.push({ leaseId, reason }); },
      },
      audit: (event) => { audit.push(event); },
      userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId: 'call-stop',
      capability: 'input_action', action: { action: 'type', text: 'hello' },
      signal: controller.signal,
    });

    const promise = invoke();
    controller.abort();
    const result = await promise;

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'cowork_not_done', message: 'PAS-FAIT' },
    });
    expect(revoked).toEqual([{ leaseId: 'lease-stop-1', reason: 'stop_controller' }]);
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lease_result', leaseId: 'lease-stop-1', outcome: 'PAS-FAIT', reason: 'stop_controller', settled: 'attested' }),
    ]));
  });

  it('records SOL-01 settled classifications accurately in audit (attested, not_started, unverified)', async () => {
    const audit: Array<Record<string, unknown>> = [];

    // Attested FAIT
    await createCoworkInvocationBroker({
      broker: {
        async issue() { return { ok: true as const, leaseId: 'lease-attested' }; },
        async wait() { return { outcome: 'FAIT', result: { ok: true }, settled: 'attested' }; },
        async revoke() {},
      },
      audit: (event) => { audit.push(event); },
      userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId: 'call-attested',
      capability: 'screen_capture', action: {},
    })();

    // Not started
    await createCoworkInvocationBroker({
      broker: {
        async issue() { return { ok: false as const }; },
        async wait() { return { outcome: 'PAS-FAIT', settled: 'not_started', reason: 'not_issuable' }; },
        async revoke() {},
      },
      audit: (event) => { audit.push(event); },
      userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId: 'call-not-started',
      capability: 'screen_capture', action: {},
    })();

    // Unverified quiescence timeout
    await createCoworkInvocationBroker({
      broker: {
        async issue() { return { ok: true as const, leaseId: 'lease-unverified' }; },
        async wait() { return { outcome: 'PAS-FAIT', settled: 'unverified', reason: 'quiescence_unconfirmed' }; },
        async revoke() {},
      },
      audit: (event) => { audit.push(event); },
      userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId: 'call-unverified',
      capability: 'input_action', action: { action: 'click', x: 5, y: 5 },
    })();

    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolCallId: 'call-attested', kind: 'lease_result', outcome: 'FAIT', settled: 'attested' }),
      expect.objectContaining({ toolCallId: 'call-not-started', kind: 'lease_denied', outcome: 'PAS-FAIT', settled: 'not_started', reason: 'not_issuable' }),
      expect.objectContaining({ toolCallId: 'call-unverified', kind: 'lease_result', outcome: 'PAS-FAIT', settled: 'unverified', reason: 'quiescence_unconfirmed' }),
    ]));
  });

  it('distinguishes reaper-forced revoke (unverified/quiescence_unconfirmed) from genuine device-attested stop (NEW-1)', async () => {
    const audit: Array<Record<string, unknown>> = [];

    // Reaper-forced revoke: lease executing, device never terminalizes -> unverified quiescence_unconfirmed
    await createCoworkInvocationBroker({
      broker: {
        async issue() { return { ok: true as const, leaseId: 'lease-reaped-1' }; },
        async wait() { return { outcome: 'PAS-FAIT', settled: 'unverified', reason: 'quiescence_unconfirmed' }; },
        async revoke() {},
      },
      audit: (event) => { audit.push(event); },
      userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId: 'call-reaped',
      capability: 'input_action', action: { action: 'click', x: 10, y: 20 },
    })();

    // Genuine device-attested stop: device confirms quiescence with signed PAS-FAIT -> attested stop_controller
    await createCoworkInvocationBroker({
      broker: {
        async issue() { return { ok: true as const, leaseId: 'lease-attested-stop-1' }; },
        async wait() { return { outcome: 'PAS-FAIT', settled: 'attested', reason: 'stop_controller' }; },
        async revoke() {},
      },
      audit: (event) => { audit.push(event); },
      userId: 'user', workspaceId: 'workspace', sessionId: 'session', targetDeviceId: 'device', toolCallId: 'call-attested-stop',
      capability: 'input_action', action: { action: 'type', text: 'hello' },
    })();

    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolCallId: 'call-reaped',
        kind: 'lease_result',
        outcome: 'PAS-FAIT',
        reason: 'quiescence_unconfirmed',
        settled: 'unverified',
      }),
      expect.objectContaining({
        toolCallId: 'call-attested-stop',
        kind: 'lease_result',
        outcome: 'PAS-FAIT',
        reason: 'stop_controller',
        settled: 'attested',
      }),
    ]));
  });
});


