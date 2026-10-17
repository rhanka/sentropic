import { describe, expect, it } from 'vitest';
import { ControlServer } from '../src/node/control-server.js';
import { GatewaySessionService, type GatewayStateStore, type StoredState } from '../src/session-service.js';
describe('control owner binding', () => {
  it('refuses a caller-supplied owner that differs from the authenticated host', async () => {
    let state: StoredState = { schemaVersion: 1, revision: 0, sessions: {}, receipts: {} };
    const store: GatewayStateStore = { load: async () => state, compareAndSet: async (_, next) => { state = next; return { revision: next.revision }; } };
    const server = new ControlServer({ service: new GatewaySessionService(store), controlToken: 'trusted-owner-control-token', ownerScopeRef: 'owner-a' });
    await expect(server.invoke('acquireSession', { ownerScopeRef: 'owner-b', workspaceRef: 'w', clientSessionRef: 'c' }, 'trusted-owner-control-token')).rejects.toMatchObject({ code: 'CONTROL-UNAUTHENTICATED' });
    expect(state.revision).toBe(0);
  });
});
