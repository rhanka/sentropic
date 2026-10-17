import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewayControlClient } from '@sentropic/llm-gateway/node/control-client';
import { main } from '../src/index';
import { durableHostFixture, model, routingContract } from '../../../packages/llm-gateway/tests/helpers/durable-host';
it('uses the published durable host from the actual private process entry', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gw-private-entry-'));
  const options = { env: { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0' }, log: () => undefined,
    durable: { stateDir, mesh: durableHostFixture().mesh } };
  let host = await main(options);
  try {
    const session = { ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'private-app', routingContract };
    const first = await createGatewayControlClient({ controlSocket: host.controlSocket }).acquireSession(session);
    const response = await fetch(`${host.endpoint}/v1/chat/completions`, { method: 'POST', headers: {
      authorization: `Bearer ${first.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'synthetic' }] }) });
    expect(response.status, await response.text()).toBe(200);
    const receiptId = response.headers.get('x-sentropic-receipt')!;
    await host.drain(); await host.stop(); host = await main({ ...options, durable: { stateDir, mesh: durableHostFixture().mesh } });
    const control = createGatewayControlClient({ controlSocket: host.controlSocket });
    expect((await control.acquireSession(session)).key).toBe(first.key);
    expect((await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId })).settlement).toBe('stop');
    await control.revokeSession({ ownerScopeRef: 'owner-a', sessionRef: first.sessionRef });
    expect((await host.readiness()).ready).toBe(true);
  } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
});
