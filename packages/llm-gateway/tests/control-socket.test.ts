import { it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startControlSocket } from '../src/node/control-socket.js';
import { ControlServer } from '../src/node/control-server.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { GatewaySessionService, type StoredState } from '../src/session-service.js';
it('uses the private published socket client and binds its authenticated owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gw-socket-'));
  let state: StoredState = { schemaVersion: 1, revision: 0, sessions: {}, receipts: {} };
  const service = new GatewaySessionService({ load: async () => state, compareAndSet: async (_, next) => { state = next; return { revision: next.revision }; } });
  const path = join(dir, 'control.sock');
  const stop = await startControlSocket(path, new ControlServer({ service, ownerScopeRef: 'owner-a', controlToken: 'trusted-control-token' }), 'trusted-control-token');
  try {
    const client = createGatewayControlClient({ controlSocket: path });
    const input = { ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c' };
    const issued = await client.acquireSession(input);
    expect(issued.key).toBeDefined();
    expect((await client.acquireSession(input)).key).toBe(issued.key);
    await expect(client.listSessions({ ownerScopeRef: 'owner-b' })).rejects.toMatchObject({ code: 'CONTROL-UNAUTHENTICATED' });
    await expect(createGatewayControlClient({ controlSocket: path, token: issued.key }).listSessions({ ownerScopeRef: 'owner-a' })).rejects.toMatchObject({ code: 'CONTROL-UNAUTHENTICATED' });
    expect(JSON.stringify(await client.listSessions({ ownerScopeRef: 'owner-a' }))).not.toContain(issued.key!);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(`${path}.auth`)).mode & 0o777).toBe(0o600);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
