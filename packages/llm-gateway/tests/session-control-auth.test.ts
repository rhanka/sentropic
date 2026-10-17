/**
 * Authenticated session control (L1, spec 6.1/6.2).
 *
 * Only the dedicated authenticated acquisition channel returns caller keys:
 * a valid control token admits control operations, a wrong token or an
 * inference Bearer [REDACTED] is refused before any state change, and revocation through
 * control survives restart.
 */
import { describe, expect, it } from 'vitest';

import { ControlServer, createInProcessControlTransport } from '../src/node/control-server.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { GatewaySessionService } from '../src/session-service.js';
import type { GatewayStateStore, StoredState } from '../src/ports/gateway-state.js';

const emptyState = (): StoredState => ({
  schemaVersion: 1,
  revision: 0,
  sessions: {},
  receipts: {},
});

const trackingStore = () => {
  let current = emptyState();
  let commits = 0;
  const store: GatewayStateStore = {
    load: async () => structuredClone(current),
    compareAndSet: async (expected, next) => {
      if (expected !== current.revision) {
        const error = new Error('concurrent write') as Error & { code: string };
        error.code = 'CONFLICT';
        throw error;
      }
      commits += 1;
      current = structuredClone(next);
      return { revision: current.revision };
    },
  };
  return { store, commits: () => commits };
};

const harness = () => {
  const { store, commits } = trackingStore();
  const controlToken = 'control-token-for-trusted-launcher-only';
  const server = new ControlServer({
    service: new GatewaySessionService(store),
    controlToken,
  });
  return { server, commits, controlToken, store };
};

describe('authenticated session control', () => {
  it('issues a key through the authenticated channel and resolves it on the data plane', async () => {
    const { server, controlToken, store } = harness();
    const client = createGatewayControlClient({
      transport: createInProcessControlTransport(server),
      token: controlToken,
    });
    const issued = await client.acquireSession({
      ownerScopeRef: 'owner-a',
      workspaceRef: 'workspace-a',
      clientSessionRef: 'client-1',
    });
    expect(issued.key).toBeDefined();
    const dataPlane = new GatewaySessionService(store);
    const caller = await dataPlane.resolveCaller({
      sessionRef: issued.sessionRef,
      key: issued.key as string,
    });
    expect(caller.ownerScopeRef).toBe('owner-a');
  });

  it('refuses a wrong control token with zero state change', async () => {
    const { server, commits } = harness();
    const client = createGatewayControlClient({
      transport: createInProcessControlTransport(server),
      token: 'wrong-token',
    });
    await expect(
      client.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c' }),
    ).rejects.toMatchObject({ code: 'CONTROL-UNAUTHENTICATED' });
    await expect(client.listSessions({ ownerScopeRef: 'owner-a' })).rejects.toMatchObject({
      code: 'CONTROL-UNAUTHENTICATED',
    });
    expect(commits()).toBe(0);
  });

  it('refuses an inference Bearer [REDACTED] on the control channel', async () => {
    const { server, controlToken } = harness();
    const owner = createGatewayControlClient({
      transport: createInProcessControlTransport(server),
      token: controlToken,
    });
    const issued = await owner.acquireSession({
      ownerScopeRef: 'owner-a',
      workspaceRef: 'workspace-a',
      clientSessionRef: 'client-1',
    });
    const bearer = createGatewayControlClient({
      transport: createInProcessControlTransport(server),
      token: issued.key as string,
    });
    await expect(bearer.listSessions({ ownerScopeRef: 'owner-a' })).rejects.toMatchObject({
      code: 'CONTROL-UNAUTHENTICATED',
    });
  });

  it('revokes through control and keeps the revocation after restart', async () => {
    const { store } = trackingStore();
    const controlToken = 'control-token-for-trusted-launcher-only';
    const first = new ControlServer({ service: new GatewaySessionService(store), controlToken });
    const client = createGatewayControlClient({
      transport: createInProcessControlTransport(first),
      token: controlToken,
    });
    const issued = await client.acquireSession({
      ownerScopeRef: 'owner-a',
      workspaceRef: 'workspace-a',
      clientSessionRef: 'client-1',
    });
    await client.revokeSession({ ownerScopeRef: 'owner-a', sessionRef: issued.sessionRef });
    const restarted = new ControlServer({ service: new GatewaySessionService(store), controlToken });
    const after = createGatewayControlClient({
      transport: createInProcessControlTransport(restarted),
      token: controlToken,
    });
    const listed = await after.listSessions({ ownerScopeRef: 'owner-a' });
    expect(listed).toHaveLength(1);
    expect(listed[0].revoked).toBe(true);
  });
});
