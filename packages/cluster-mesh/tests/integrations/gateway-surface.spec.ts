import { describe, expect, it } from 'vitest';
import * as gatewayProvider from '@sentropic/llm-gateway';
import * as serviceProvider from '@sentropic/llm-gateway/auth';
import * as sessionProvider from '@sentropic/llm-gateway/auth-hono';
import * as gatewayLeaf from '../../src/integrations/gateway/index.js';
import * as serviceLeaf from '../../src/integrations/gateway/auth.js';
import * as sessionLeaf from '../../src/integrations/gateway/auth-hono.js';
import { createClusterMeshModules } from '../../src/index.js';
import { loadGateway } from '../../src/loaders/gateway/index.js';
import { loadGatewayAuth } from '../../src/loaders/gateway/auth.js';
import { loadGatewayAuthHono } from '../../src/loaders/gateway/auth-hono.js';

const pairs = [
  ['gateway', gatewayLeaf, gatewayProvider],
  ['gateway/auth', serviceLeaf, serviceProvider],
  ['gateway/auth-hono', sessionLeaf, sessionProvider],
] as const;

describe('gateway static leaves', () => {
  it.each(pairs)('should re-export the full %s namespace with identical bindings', (_id, leaf, provider) => {
    expect(Object.keys(leaf).sort()).toEqual(Object.keys(provider).sort());
    for (const key of Object.keys(provider)) {
      expect((leaf as Record<string, unknown>)[key]).toBe((provider as Record<string, unknown>)[key]);
    }
  });

  it('should keep both auth modes out of the gateway root leaf', () => {
    expect(gatewayLeaf).not.toHaveProperty('ServiceAuthVerifyToken');
    expect(gatewayLeaf).not.toHaveProperty('AuthHonoVerifyToken');
    expect(typeof gatewayLeaf.createGatewayRouter).toBe('function');
    expect(gatewayLeaf.stubGatewayConfig).toBe(gatewayProvider.stubGatewayConfig);
  });

  it('should route through the provider router with its caller-auth gate', async () => {
    const router = gatewayLeaf.createGatewayRouter({ config: gatewayLeaf.stubGatewayConfig });
    expect((await router.request('/healthz')).status).toBe(200);
    expect((await router.request('/v1/models')).status).toBe(401);
  });

  it('should acquire gateway and both preflighted auth modes from the installed gateway', async () => {
    const modules = createClusterMeshModules();
    const gateway = await loadGateway(modules);
    expect(gateway.createGatewayRouter).toBe(gatewayProvider.createGatewayRouter);
    const service = await loadGatewayAuth(modules);
    expect(service.ServiceAuthVerifyToken).toBe(serviceProvider.ServiceAuthVerifyToken);
    const session = await loadGatewayAuthHono(modules);
    expect(session.AuthHonoVerifyToken).toBe(sessionProvider.AuthHonoVerifyToken);
    const snapshot = await modules.probe();
    for (const id of ['gateway', 'gateway/auth', 'gateway/auth-hono'] as const) {
      expect(snapshot[id]).toMatchObject({ availability: 'available', state: 'loaded', installedVersion: '0.18.0' });
    }
  });
});
