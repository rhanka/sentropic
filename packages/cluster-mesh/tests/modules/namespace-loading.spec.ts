import { Hono } from 'hono';
import * as meshProvider from '@sentropic/llm-mesh';
import * as serviceProvider from '@sentropic/llm-gateway/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGatewayNamespaceModule } from '../../src/compose/gateway.js';
import { createLlmMeshNamespaceModule } from '../../src/compose/llm-mesh.js';
import { createClusterMeshPlugin } from '../../src/hono/plugin.js';
import { createClusterMeshModules } from '../../src/index.js';
import { createModuleRegistry } from '../../src/modules/registry.js';
import { createClusterMeshRuntime } from '../../src/runtime/generation.js';
import { evaluations, PackageTree } from '../fixtures/package-tree.js';

const context = { async verify() { throw new Error('not invoked'); } };
const receipts = { append: vi.fn(async () => undefined) };
const runtime = () => createClusterMeshRuntime({
  generationId: 'generation-1',
  config: { capacity: { poolSize: 1 } },
  context,
  registration: { async authorize() { return { ok: false, reason: 'missing_registration' } as const; } },
  receipts,
});

let tree: PackageTree | undefined;
afterEach(() => tree?.cleanup());

function emptyRegistry() {
  tree = new PackageTree();
  evaluations().length = 0;
  return createModuleRegistry({}, { anchorDir: tree.dir('app/node_modules/@sentropic/cluster-mesh/dist') });
}

describe('lazy namespace preparation', () => {
  it('should prepare /llm-mesh with the injected router and mount it through the existing plugin', async () => {
    const createRouter = vi.fn((input: { llmMesh: typeof meshProvider }) => {
      expect(input.llmMesh.createLlmMesh).toBe(meshProvider.createLlmMesh);
      return new Hono().get('/', (c) => c.json({ ok: true }));
    });
    const module = await createLlmMeshNamespaceModule(createClusterMeshModules(), { enabled: true, createRouter });
    expect(createRouter).not.toHaveBeenCalled();
    const plugin = createClusterMeshPlugin({ runtime: runtime(), namespaces: [module] });
    expect((await plugin.request('/llm-mesh')).status).toBe(200);
    expect(createRouter).toHaveBeenCalledWith(expect.objectContaining({ context, receipts }));
  });

  it('should leave disabled namespaces unmounted without resolving their providers', async () => {
    const modules = emptyRegistry();
    const createRouter = vi.fn(() => new Hono());
    const mesh = await createLlmMeshNamespaceModule(modules, { enabled: false, createRouter });
    const gateway = await createGatewayNamespaceModule(modules, { enabled: false, authMode: 'service', createRouter });
    const plugin = createClusterMeshPlugin({ runtime: runtime(), namespaces: [mesh, gateway] });
    expect((await plugin.request('/llm-mesh')).status).toBe(404);
    expect((await plugin.request('/gw/healthz')).status).toBe(404);
    expect(createRouter).not.toHaveBeenCalled();
    expect(Object.values(modules.snapshot()).every((record) => record.state === 'unprobed')).toBe(true);
  });

  it('should fail an enabled namespace before any listener binds when its provider is missing', async () => {
    const modules = emptyRegistry();
    const bind = vi.fn();
    const createRouter = vi.fn(() => new Hono());
    await expect(createLlmMeshNamespaceModule(modules, { enabled: true, createRouter })
      .then((module) => bind(createClusterMeshPlugin({ runtime: runtime(), namespaces: [module] }))))
      .rejects.toMatchObject({ code: 'cluster_mesh_module_unavailable', moduleId: 'llm-mesh', reason: 'not_installed' });
    await expect(createGatewayNamespaceModule(modules, { enabled: true, authMode: 'host', createRouter }))
      .rejects.toMatchObject({ moduleId: 'gateway', reason: 'not_installed' });
    expect(bind).not.toHaveBeenCalled();
    expect(createRouter).not.toHaveBeenCalled();
  });

  it('should prepare /gw around the gateway router with a remapped product mount', async () => {
    const module = await createGatewayNamespaceModule(createClusterMeshModules(), {
      enabled: true,
      authMode: 'host',
      createRouter: ({ gateway, serviceAuth, sessionAuth }) => {
        expect(serviceAuth).toBeUndefined();
        expect(sessionAuth).toBeUndefined();
        return gateway.createGatewayRouter({ config: gateway.stubGatewayConfig });
      },
    });
    const plugin = createClusterMeshPlugin({ runtime: runtime(), namespaces: [module], mounts: { '/gw': '/api/v1/gw' } });
    expect((await plugin.request('/api/v1/gw/healthz')).status).toBe(200);
    expect((await plugin.request('/api/v1/gw/v1/models')).status).toBe(401);
    expect((await plugin.request('/gw/healthz')).status).toBe(404);
  });

  it('should project /gw at the root for a standalone host with exactly the five gateway paths', async () => {
    let routers = 0;
    const module = await createGatewayNamespaceModule(createClusterMeshModules(), {
      enabled: true,
      authMode: 'host',
      createRouter: ({ gateway }) => {
        routers += 1;
        return gateway.createGatewayRouter({ config: gateway.stubGatewayConfig });
      },
    });
    const plugin = createClusterMeshPlugin({ runtime: runtime(), namespaces: [module], mounts: { '/gw': '/' } });
    expect(routers).toBe(1);
    const statuses = Object.fromEntries(await Promise.all([
      ['GET', '/healthz'], ['GET', '/readyz'], ['POST', '/v1/messages'], ['POST', '/v1/chat/completions'], ['GET', '/v1/models'],
    ].map(async ([method, path]) => [path, (await plugin.request(path!, { method })).status] as const)));
    expect(statuses['/healthz']).toBe(200);
    for (const path of ['/readyz', '/v1/messages', '/v1/chat/completions', '/v1/models']) expect(statuses[path], path).not.toBe(404);
    expect(statuses['/v1/models']).toBe(401);
    expect((await plugin.request('/gw/healthz')).status).toBe(404);
    expect((await plugin.request('/gw/v1/models')).status).toBe(404);
  });

  it('should hand the preflighted service-auth namespace to the host router', async () => {
    const modules = createClusterMeshModules();
    const module = await createGatewayNamespaceModule(modules, {
      enabled: true,
      authMode: 'service',
      createRouter: ({ serviceAuth }) => {
        expect(serviceAuth?.ServiceAuthVerifyToken).toBe(serviceProvider.ServiceAuthVerifyToken);
        return new Hono().get('/healthz', (c) => c.text('ok'));
      },
    });
    expect(modules.snapshot()['gateway/auth']).toMatchObject({ state: 'loaded' });
    expect(modules.snapshot()['gateway/auth-hono']).toEqual({ availability: 'gated', state: 'unprobed' });
    const plugin = createClusterMeshPlugin({ runtime: runtime(), namespaces: [module] });
    expect((await plugin.request('/gw/healthz')).status).toBe(200);
  });
});
