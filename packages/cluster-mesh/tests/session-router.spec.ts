import type { VerifiedInvocationContext } from '../../contracts/src/index.js';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  createCliNamespaceModule,
  createClusterMeshPlugin,
  createClusterMeshRuntime,
  createRegistrationGate,
  createSessionNamespaceModule,
  type CliSessionDelegatePort,
  type ClusterMeshRegistration,
  type PtyActuatorPort,
  type SignedInstruction,
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
  instruction?: SignedInstruction | null;
  receiptFailureStage?: 'acted';
} = {}) {
  const receipts: unknown[] = [];
  const pty = input.pty ?? {
    kind: 'pty' as const,
    async isAvailable() { return true; },
    async probeState() { return 'alive' as const; },
    actuate: vi.fn(async () => ({ effectRef: 'tick-1', outcome: 'acted' as const })),
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
  const instructions = {
    resolve: vi.fn(async () => input.instruction === undefined
      ? { kind: 'signed-instruction' as const }
      : input.instruction),
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
      instructions,
      author: { async ensureAuthor() { return { ok: true }; } },
      now: () => new Date('2026-08-30T12:00:00.000Z'),
    },
  });
  return {
    app: module.createRouter({ context: runtime.context, receipts: runtime.receiptPort }),
    module, runtime, pty, receipts, store, instructions,
  };
}

const command = (id: string) => ({
  commandRef: id, targetRegistrationId: registration.registrationId, idempotencyKey: `key-${id}`,
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
      probeState: vi.fn(async () => 'alive'),
      actuate: vi.fn(async () => ({ effectRef: 'must-not-run', outcome: 'acted' })),
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

  it('maps verifier rejection to 401 before receipts, commands or PTY effects', async () => {
    const { app, pty, receipts, store } = fixture({
      context() { throw new Error('invalid signed evidence'); },
    });
    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-unverified')),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(401);
    expect(receipts).toEqual([]);
    expect(store.enqueueCommand).not.toHaveBeenCalled();
    expect(pty.actuate).not.toHaveBeenCalled();
  });

  it('rejects a target registration that differs from verified context', async () => {
    const { app, pty, store, instructions } = fixture({
      context: (invocationId) => ({
        ...verifiedContext(invocationId),
        registration: { ...verifiedContext(invocationId).registration!, registrationId: 'registration-other' },
      }),
    });
    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-registration-mismatch')),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'registration_mismatch' });
    expect(store.enqueueCommand).not.toHaveBeenCalled();
    expect(instructions.resolve).not.toHaveBeenCalled();
    expect(pty.actuate).not.toHaveBeenCalled();
  });

  it('returns duplicate_command without repeating authorization or actuation', async () => {
    const { app, runtime, pty, store } = fixture();
    store.enqueueCommand.mockResolvedValueOnce(false);
    const authorize = vi.spyOn(runtime.registration, 'authorize');
    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-duplicate')),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'duplicate_command' });
    expect(authorize).not.toHaveBeenCalled();
    expect(pty.actuate).not.toHaveBeenCalled();
  });

  it('refuses an unresolved command before admission or actuation', async () => {
    const { app, instructions, pty, receipts, store } = fixture({ instruction: null });

    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-unresolved')),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'command_unresolved' });
    expect(instructions.resolve).toHaveBeenCalledWith({
      commandRef: 'command-unresolved', registrationId: registration.registrationId, action: 'drive',
    });
    expect(pty.actuate).not.toHaveBeenCalled();
    expect(receipts).toContainEqual(expect.objectContaining({
      stage: 'verified', decision: 'refused', reason: 'command_unresolved',
    }));
    expect(store.updateCommand).toHaveBeenCalledWith('command-unresolved', {
      status: 'refused', refusalReason: 'command_unresolved',
    });
  });

  it('passes the resolved signed instruction to the actuator', async () => {
    const instruction = { kind: 'signed-instruction' as const, signature: 'opaque-signature' };
    const { app, pty } = fixture({ instruction });

    await app.request('/control/wake', {
      method: 'POST', body: JSON.stringify(command('command-resolved')),
      headers: { 'content-type': 'application/json' },
    });

    expect(pty.actuate).toHaveBeenCalledWith({
      registration, action: 'wake', commandRef: 'command-resolved', resolvedInstruction: instruction,
    });
  });

  it('reconciles an unavailable parked target to LOST without actuation', async () => {
    const pty: PtyActuatorPort = {
      kind: 'pty', isAvailable: vi.fn(async () => false),
      probeState: vi.fn(async () => 'parked'),
      actuate: vi.fn(async () => ({ effectRef: 'must-not-run', outcome: 'acted' })),
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

  it.each([
    ['custody_mismatch', (invocationId: string) => ({
      ...verifiedContext(invocationId),
      custody: { ...verifiedContext(invocationId).custody!, holderPrincipalId: 'workload-other' },
    })],
    ['custody_required', (invocationId: string) => ({
      ...verifiedContext(invocationId), custody: undefined,
    })],
  ] as const)('does not mark a parked registration LOST for %s', async (reason, context) => {
    const { app, store } = fixture({ target: 'parked', context });
    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command(`command-${reason}`)),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: reason });
    expect(store.markRegistrationLost).not.toHaveBeenCalled();
  });

  it('finalizes an authorization throw as failed', async () => {
    const pty: PtyActuatorPort = {
      kind: 'pty', isAvailable: vi.fn(async () => { throw new Error('probe failed'); }),
      probeState: vi.fn(async () => 'alive'),
      actuate: vi.fn(async () => ({ effectRef: 'must-not-run', outcome: 'acted' })),
    };
    const { app, store } = fixture({ pty });
    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-authorization-throw')),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'authorization_failed' });
    expect(store.updateCommand).toHaveBeenLastCalledWith('command-authorization-throw', {
      status: 'failed', refusalReason: 'authorization_failed',
    });
    expect(pty.actuate).not.toHaveBeenCalled();
  });

  it('finalizes an instruction resolution throw as failed', async () => {
    const { app, instructions, pty, store } = fixture();
    instructions.resolve.mockRejectedValueOnce(new Error('resolver failed'));
    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-resolver-throw')),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'instruction_resolution_failed' });
    expect(store.updateCommand).toHaveBeenLastCalledWith('command-resolver-throw', {
      status: 'failed', refusalReason: 'instruction_resolution_failed',
    });
    expect(pty.actuate).not.toHaveBeenCalled();
  });

  it('refuses the thirteenth concurrent action before PTY at the real runtime cap', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const pty: PtyActuatorPort = {
      kind: 'pty', async isAvailable() { return true; },
      async probeState() { return 'alive'; },
      actuate: vi.fn(async () => { await blocked; return { effectRef: 'tick', outcome: 'acted' }; }),
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

  it('persists a deferred outcome and returns 202 without an acted receipt', async () => {
    const pty: PtyActuatorPort = {
      kind: 'pty', async isAvailable() { return true; },
      async probeState() { return 'alive'; },
      actuate: vi.fn(async () => ({ effectRef: 'deferred-effect', outcome: 'deferred' })),
    };
    const { app, receipts, store } = fixture({ pty });
    const response = await app.request('/control/drive', {
      method: 'POST', body: JSON.stringify(command('command-deferred')),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'deferred', effectRef: 'deferred-effect' });
    expect(store.updateCommand.mock.calls.map(([, update]) => update.status)).toEqual(['accepted', 'deferred']);
    expect(receipts).not.toContainEqual(expect.objectContaining({ stage: 'acted' }));
  });

  it.each(['failed', 'adapter-bug'] as const)(
    'maps a %s outcome to a persisted failed command and HTTP 502',
    async (outcome) => {
      const pty: PtyActuatorPort = {
        kind: 'pty', async isAvailable() { return true; },
        async probeState() { return 'alive'; },
        actuate: vi.fn(async () => ({ effectRef: `${outcome}-effect`, outcome: outcome as 'failed' })),
      };
      const { app, receipts, store } = fixture({ pty });

      const response = await app.request('/control/drive', {
        method: 'POST', body: JSON.stringify(command(`command-${outcome}`)),
        headers: { 'content-type': 'application/json' },
      });

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        error: 'actuation_failed', status: 'failed', effectRef: `${outcome}-effect`,
      });
      expect(store.updateCommand).toHaveBeenLastCalledWith(`command-${outcome}`, {
        status: 'failed', refusalReason: 'actuation_failed',
      });
      expect(receipts).not.toContainEqual(expect.objectContaining({ stage: 'acted' }));
    },
  );

  it('composes CLI delegation at /auth/session/control through the registration gate', async () => {
    const pty: PtyActuatorPort = {
      kind: 'pty', isAvailable: vi.fn(async () => true),
      probeState: vi.fn(async () => 'alive'),
      actuate: vi.fn(async () => ({ effectRef: 'must-not-run', outcome: 'acted' })),
    };
    const { module, runtime, instructions } = fixture({ record: null, pty });
    const sessionApp = new Hono().route('/auth', createClusterMeshPlugin({
      runtime, namespaces: [module],
    }));
    const session: CliSessionDelegatePort = {
      kind: 'session-control-http',
      delegate: ({ method, path, headers, body }) => sessionApp.request(path, {
        method, headers, body: JSON.stringify(body),
      }),
    };
    const cliApp = new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime,
      namespaces: [createCliNamespaceModule({
        enabled: true,
        generationId: 'generation-1',
        adapters: [{
          runnerId: 'harness', source: '@sentropic/harness',
          parseIntent: (argv) => ({ runnerId: 'harness', source: '@sentropic/harness', argv }),
        }],
        session,
      })],
    }));

    const response = await cliApp.request('/api/v1/cli/delegations/drive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cluster-mesh-invocation-id': 'command-cli',
      },
      body: JSON.stringify({
        runnerId: 'harness', argv: ['drive'], commandId: 'command-cli',
        targetRegistrationId: registration.registrationId, idempotencyKey: 'key-command-cli',
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'missing_registration' });
    expect(pty.actuate).not.toHaveBeenCalled();
    expect(instructions.resolve).not.toHaveBeenCalled();
    expect((await sessionApp.request('/auth/session/drive', {
      method: 'POST', body: JSON.stringify(command('command-bypass')),
      headers: { 'content-type': 'application/json' },
    })).status).toBe(404);
    expect(pty.actuate).not.toHaveBeenCalled();
  });
});
