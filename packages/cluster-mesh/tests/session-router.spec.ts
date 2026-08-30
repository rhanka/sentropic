import type { VerifiedInvocationContext } from '../../contracts/src/index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createClusterMeshRuntime,
  createRegistrationGate,
  createSessionNamespaceModule,
  type ClusterMeshRegistration,
  type PtyActuatorPort,
} from '../src/index.js';

const registration: ClusterMeshRegistration = {
  registrationId: 'registration-1', generationId: 'generation-1',
  principalId: 'workload-1', workspaceId: 'workspace-1',
  custodyHolderPrincipalId: 'workload-1', custodyEpoch: 1,
  actuatorRef: 'h2a:session-1', status: 'active',
  expiresAt: '2026-09-01T00:00:00.000Z', leaseExpiresAt: '2026-09-01T00:00:00.000Z',
};

const verifiedContext = (invocationId: string): VerifiedInvocationContext => ({
  invocationId, correlationId: invocationId, generationId: 'generation-1',
  principal: { principalId: 'workload-1', kind: 'workload', verifierId: 'test' },
  workspace: { bindingId: 'binding-1', workspaceId: 'workspace-1', revision: '1' },
  scopes: ['session:drive'], policyRevision: '1', issuedAt: '2026-08-30T12:00:00.000Z',
  registration: {
    registrationId: registration.registrationId, generationId: registration.generationId,
    workspaceId: registration.workspaceId, actuatorRef: registration.actuatorRef,
    custodyEpoch: registration.custodyEpoch, expiresAt: registration.expiresAt,
  },
  custody: { custodyId: 'custody-1', holderPrincipalId: 'workload-1', epoch: 1 },
});

function fixture(input: {
  record?: ClusterMeshRegistration | null;
  pty?: PtyActuatorPort;
  target?: 'alive' | 'dead' | 'parked' | 'unknown';
  context?: (invocationId: string) => VerifiedInvocationContext;
  receiptFailureStage?: 'acted';
} = {}) {
  const receipts: unknown[] = [];
  const pty = input.pty ?? {
    kind: 'pty' as const,
    async isAvailable() { return true; },
    actuate: vi.fn(async () => ({ effectRef: 'tick-1' })),
  };
  const runtime = createClusterMeshRuntime({
    generationId: 'generation-1', config: { capacity: { poolSize: 4 } },
    context: { async verify(request) { return (input.context ?? verifiedContext)(request.invocationId); } },
    registration: createRegistrationGate({
      generationId: 'generation-1',
      registrations: { async find() { return input.record === undefined ? registration : input.record; } },
      pty, now: () => new Date('2026-08-30T12:00:00.000Z'),
    }),
    receipts: {
      async append(receipt) {
        receipts.push(receipt);
        if (receipt.stage === input.receiptFailureStage) throw new Error('receipt persistence failed');
      },
    },
    now: () => new Date('2026-08-30T12:00:00.000Z'),
  });
  const store = {
    enqueueCommand: vi.fn(async () => true),
    updateCommand: vi.fn(async () => true),
    markRegistrationLost: vi.fn(async () => true),
  };
  const ok = (c: { json(value: unknown): Response }) => c.json({ ok: true });
  const module = createSessionNamespaceModule({
    handlers: {
      current: ok, refresh: ok, extensionToken: ok, logout: ok, logoutAll: ok, list: ok,
    },
    devices: { issue: ok, poll: ok, approve: ok },
    projection: { session: '/', device: '/device', control: '/control' },
    control: {
      runtime, store, targets: { async inspect() { return input.target ?? 'alive'; } },
      author: { async ensureAuthor() { return { ok: true }; } },
      now: () => new Date('2026-08-30T12:00:00.000Z'),
    },
  });
  return { app: module.createRouter({ context: runtime.context, receipts: runtime.receiptPort }), pty, receipts, store };
}

const command = (id: string) => ({
  commandId: id, targetRegistrationId: registration.registrationId, idempotencyKey: `key-${id}`,
});

describe('session namespace router', () => {
  it('projects product session and device handlers under one namespace author', async () => {
    const { app } = fixture();
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/device/code', { method: 'POST' })).status).toBe(200);
  });

  it.each([
    [null, 'missing_registration'],
    [{ ...registration, leaseExpiresAt: '2026-08-29T00:00:00.000Z' }, 'stale_registration'],
  ] as const)('fails closed before PTY for %s', async (record, reason) => {
    const pty: PtyActuatorPort = {
      kind: 'pty', isAvailable: vi.fn(async () => true),
      actuate: vi.fn(async () => ({ effectRef: 'must-not-run' })),
    };
    const { app } = fixture({ record, pty });
    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command(`command-${reason}`)),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: reason });
    expect(pty.actuate).not.toHaveBeenCalled();
  });

  it('reconciles an unavailable parked target to LOST without actuation', async () => {
    const pty: PtyActuatorPort = {
      kind: 'pty', isAvailable: vi.fn(async () => false),
      actuate: vi.fn(async () => ({ effectRef: 'must-not-run' })),
    };
    const { app, store } = fixture({ pty, target: 'parked' });
    expect((await app.request('/control/wake', {
      method: 'POST', body: JSON.stringify(command('command-lost')),
      headers: { 'content-type': 'application/json' },
    })).status).toBe(409);
    expect(store.markRegistrationLost).toHaveBeenCalledWith(
      registration.registrationId, '2026-08-30T12:00:00.000Z',
    );
    expect(pty.actuate).not.toHaveBeenCalled();
  });

  it('refuses the thirteenth concurrent action before PTY at the real runtime cap', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const pty: PtyActuatorPort = {
      kind: 'pty', async isAvailable() { return true; },
      actuate: vi.fn(async () => { await blocked; return { effectRef: 'tick' }; }),
    };
    const { app } = fixture({ pty });
    const requests = Array.from({ length: 12 }, (_, index) => app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command(`command-${index}`)),
      headers: { 'content-type': 'application/json' },
    }));
    await vi.waitFor(() => expect(pty.actuate).toHaveBeenCalledTimes(12));
    const refused = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-13')),
      headers: { 'content-type': 'application/json' },
    });
    expect(refused.status).toBe(429);
    await expect(refused.json()).resolves.toEqual({ error: 'capacity_exhausted' });
    expect(pty.actuate).toHaveBeenCalledTimes(12);
    release();
    await Promise.all(requests);
  });

  it('preserves the acted command when receipt persistence fails after the effect', async () => {
    const { app, pty, store } = fixture({ receiptFailureStage: 'acted' });

    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-post-effect-failure')),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'post_effect_persistence_failed', status: 'acted', effectRef: 'tick-1',
    });
    expect(pty.actuate).toHaveBeenCalledOnce();
    expect(store.updateCommand.mock.calls.map(([, update]) => update.status)).toEqual([
      'accepted', 'acted',
    ]);
  });
});
