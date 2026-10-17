import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGatewayHost } from '../src/node/gateway-host.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { createGatewayRouter } from '../src/router/index.js';
import { durableHostFixture, model, routingContract } from './helpers/durable-host.js';
const body = JSON.stringify({ model, messages: [{ role: 'user', content: 'synthetic' }] });
it('links requested/selected identities without asserting an echoed model is provider attestation', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gw-model-receipt-'));
  const host = await startGatewayHost({ stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 } });
  try {
    const control = createGatewayControlClient({ controlSocket: host.controlSocket });
    const issued = await control.acquireSession({ ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c', routingContract });
    const response = await fetch(`${host.endpoint}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${issued.key}`, 'content-type': 'application/json' }, body });
    expect(response.status, await response.text()).toBe(200);
    const receipt = await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId: response.headers.get('x-sentropic-receipt')! });
    expect(receipt).toMatchObject({ model, attempts: 1, policyRevision: 'p1', settlement: 'stop', physicalAttempts: [{
      selectedModel: model, selectedProviderId: 'openai', selectedTransport: 'codex', outcome: 'success',
      observedServedModel: null, modelEvidence: 'selection-only', usage: { inputTokens: 1, outputTokens: 1 } }] });
    expect(JSON.stringify(receipt)).not.toContain(issued.key!);
  } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
});
it('refuses a physical attempt whose durable acknowledgement fails before any provider call', async () => {
  const f = durableHostFixture();
  const app = createGatewayRouter({ ...f.mesh.gateway, routePlanner: f.mesh.createRoutePlanner({}),
    config: { ...f.mesh.gateway.config, callerAuth: { verify: async () => ({ ok: true, cost: {
      ownerScopeRef: 'owner-a', tenantId: 't', principalId: 'p', workspaceId: 'w', source: 'test', correlationId: 'r' } }) } },
    requestAudit: { admit: async () => ({ receiptId: 'receipt' }), beginAttempt: async () => { throw new Error('store unavailable'); } } });
  expect((await app.request('/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(503);
  expect(f.calls).toHaveLength(0);
});
