import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGatewayHost } from '../src/node/gateway-host.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { durableHostFixture, model, routingContract } from './helpers/durable-host.js';
const session = { ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c', routingContract };
const send = (endpoint: string, key: string) => fetch(`${endpoint}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'synthetic' }] }) });
describe('durable published host composition', () => {
  it('serves through the real planner, recovers its key/receipts and retains revocation', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-host-'));
    const options = { ownerScopeRef: 'owner-a', stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 } };
    let host = await startGatewayHost(options);
    try {
      expect((await host.readiness()).ready).toBe(true);
      let control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession(session);
      const response = await send(host.endpoint, issued.key!);
      const body = await response.text(); expect(response.status, body).toBe(200);
      const receiptId = response.headers.get('x-sentropic-receipt')!;
      expect(receiptId).toBeTruthy();
      expect((await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId })).settlement).toBe('stop');
      expect(await readFile(join(stateDir, 'gateway-state.enc'), 'utf8')).not.toContain(issued.key!);
      await host.stop(); host = await startGatewayHost({ ...options, mesh: durableHostFixture().mesh });
      control = createGatewayControlClient({ controlSocket: host.controlSocket });
      expect(await control.acquireSession(session)).toMatchObject({ key: issued.key, sessionRef: issued.sessionRef, expiresAt: issued.expiresAt });
      expect((await send(host.endpoint, issued.key!)).status).toBe(200);
      await control.revokeSession({ ownerScopeRef: 'owner-a', sessionRef: issued.sessionRef });
      await host.stop(); host = await startGatewayHost({ ...options, mesh: durableHostFixture().mesh });
      expect((await send(host.endpoint, issued.key!)).status).toBe(401);
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });
  it('refuses a second writer without unlinking the first host control socket', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-writer-'));
    const options = { ownerScopeRef: 'owner-a', stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 } };
    const host = await startGatewayHost(options);
    try {
      await expect(startGatewayHost(options)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await createGatewayControlClient({ controlSocket: host.controlSocket }).acquireSession(session)).key).toBeDefined();
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });
  it('reports not ready and issues nothing with the wrong key or corrupt state', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-corrupt-'));
    const options = { ownerScopeRef: 'owner-a', stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 } };
    let host = await startGatewayHost(options);
    try {
      await createGatewayControlClient({ controlSocket: host.controlSocket }).acquireSession(session);
      await host.stop(); host = await startGatewayHost({ ...options, mesh: durableHostFixture('b').mesh });
      expect((await host.readiness()).ready).toBe(false);
      await expect(createGatewayControlClient({ controlSocket: host.controlSocket }).acquireSession(session)).rejects.toMatchObject({ code: 'STORE-FAILED' });
      await host.stop().catch(() => undefined);
      await writeFile(join(stateDir, 'gateway-state.enc'), 'corrupt');
      host = await startGatewayHost(options); expect((await host.readiness()).ready).toBe(false);
      expect(await readFile(join(stateDir, 'gateway-state.enc'), 'utf8')).toBe('corrupt');
    } finally { await host.stop().catch(() => undefined); await rm(stateDir, { recursive: true, force: true }); }
  });
});
