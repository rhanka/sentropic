import { expect, it } from 'vitest';
import { createGatewayRouter } from '../src/router/index.js';
import { durableHostFixture, model } from './helpers/durable-host.js';
const send = (app: ReturnType<typeof createGatewayRouter>) => app.request('/v1/chat/completions', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'synthetic' }] }),
});
const cost = { tenantId: 't', principalId: 'p', ownerScopeRef: 'owner-a', workspaceId: 'w', source: 'test', correlationId: 'c' };
it('refuses before provider dispatch when durable request admission fails', async () => {
  const f = durableHostFixture();
  const app = createGatewayRouter({ ...f.mesh.gateway, routePlanner: f.mesh.createRoutePlanner({}), config: { ...f.mesh.gateway.config, callerAuth: { verify: async () => ({ ok: true, cost }) } },
    requestAudit: { admit: async () => { throw new Error('store unavailable'); } } });
  expect((await send(app)).status).toBe(503); expect(f.calls).toHaveLength(0);
});
it('returns a durable receipt reference and carries it into single settlement', async () => {
  const f = durableHostFixture(); let settlements = 0;
  const app = createGatewayRouter({ ...f.mesh.gateway, routePlanner: f.mesh.createRoutePlanner({}), config: { ...f.mesh.gateway.config, callerAuth: { verify: async () => ({ ok: true, cost }) } },
    requestAudit: { admit: async () => ({ receiptId: 'receipt-a' }) }, routeMetering: { settleRoute: (context) => {
      expect(context.cost.gatewayReceiptId).toBe('receipt-a'); settlements += 1;
    } } });
  const response = await send(app);
  expect(response.status, await response.text()).toBe(200);
  expect(response.headers.get('x-sentropic-receipt')).toBe('receipt-a'); expect(settlements).toBe(1);
});
