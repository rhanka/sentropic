import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ClusterMeshModuleUnavailableError,
  createClusterMeshModules,
  type ClusterMeshModules,
} from '@sentropic/cluster-mesh';
import { describe, expect, it, vi } from 'vitest';

import { createHostApp } from '../src/app';
import { chatRequest, fixtureDependencies, testConfig } from './fixtures';

type Gateway = typeof import('@sentropic/llm-gateway');

/** Wraps one real registry so every `createGatewayRouter` call is counted. */
const countingRegistry = () => {
  const real = createClusterMeshModules();
  const createGatewayRouter = vi.fn();
  const modules: ClusterMeshModules = {
    ...real,
    async load(id) {
      const loaded = await real.load(id);
      if (id !== 'gateway') return loaded;
      const gateway = loaded as Gateway;
      createGatewayRouter.mockImplementation(gateway.createGatewayRouter);
      return { ...gateway, createGatewayRouter };
    },
  };
  return { modules, real, createGatewayRouter };
};

const here = dirname(fileURLToPath(import.meta.url));
const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] ?? m[2]!);

describe('standalone composition without the product app or a remote control plane', () => {
  it('builds the gateway router exactly once through one registry and serves the D2 paths at /', async () => {
    const { modules, real, createGatewayRouter } = countingRegistry();
    const host = await createHostApp({ config: testConfig(), dependencies: fixtureDependencies().dependencies, modules });
    expect(createGatewayRouter).toHaveBeenCalledOnce();

    const health = await host.app.request('/healthz');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', mode: 'personal-passthrough' });
    expect((await host.app.request('/readyz')).status).toBe(200);
    expect((await host.app.request('/v1/models')).status).toBe(401);
    expect((await host.app.request('/v1/messages', { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await host.app.request('/v1/chat/completions', { method: 'POST', body: '{}' })).status).toBe(400);
    for (const path of ['/gw/healthz', '/api/v1/gw/healthz', '/llm-mesh', '/session']) {
      expect((await host.app.request(path)).status).toBe(404);
    }
    expect(createGatewayRouter).toHaveBeenCalledOnce();

    const snapshot = real.snapshot();
    expect(snapshot.gateway).toMatchObject({ state: 'loaded', packageName: '@sentropic/llm-gateway' });
    expect(snapshot['gateway/auth']).toEqual({ availability: 'gated', state: 'unprobed' });
    expect(snapshot['gateway/auth-hono']).toEqual({ availability: 'gated', state: 'unprobed' });
  });

  it('runs a real request through the injected ports with one aggregate settlement', async () => {
    const { dependencies, settlements, generate } = fixtureDependencies();
    const host = await createHostApp({ config: testConfig(), dependencies });
    const response = await host.app.request('/v1/chat/completions', chatRequest(false));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'fixture answer' } }] });
    expect(generate).toHaveBeenCalledOnce();
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      outcome: 'success', cost: { tenantId: 'tenant-1', principalId: 'user-1' },
    });
  });

  it('refuses a disabled or missing gateway peer before any listener binds', async () => {
    const bind = vi.fn();
    await expect(createHostApp({
      config: testConfig(), dependencies: {}, modules: createClusterMeshModules({ disabled: ['gateway'] }),
    }).then(bind)).rejects.toMatchObject({
      code: 'cluster_mesh_module_unavailable', moduleId: 'gateway', reason: 'disabled',
    });
    const missing: ClusterMeshModules = {
      ...createClusterMeshModules(),
      load: async (id) => {
        throw new ClusterMeshModuleUnavailableError({
          moduleId: id, reason: 'not_installed', packageName: '@sentropic/llm-gateway', requiredRange: '>=0.18.0 <0.19.0',
        });
      },
    };
    await expect(createHostApp({ config: testConfig(), dependencies: {}, modules: missing }).then(bind))
      .rejects.toMatchObject({ code: 'cluster_mesh_module_unavailable', reason: 'not_installed' });
    expect(bind).not.toHaveBeenCalled();
  });

  it('keeps the host import graph free of the product app, cutover globals and control plane', () => {
    const sources = readdirSync(join(here, '../src')).map((name) => join(here, '../src', name));
    const standalonePorts = join(here, '../../../api/src/services/llm-runtime/standalone-ports.ts');
    const specifiers = [...sources, standalonePorts].flatMap(importsOf);
    const product = specifiers.filter((specifier) => specifier.includes('api/src/')
      && !specifier.endsWith('api/src/services/llm-runtime/standalone-ports'));
    expect(product).toEqual([]);
    expect(importsOf(standalonePorts)).toEqual(['@sentropic/llm-mesh']);
    for (const forbidden of ['api/src/app', 'routes/namespaces', 'cluster-mesh-adapter', 'queue', 'db/', 'drizzle']) {
      expect(specifiers.filter((specifier) => specifier.includes(forbidden))).toEqual([]);
    }
    // Runtime gateway values come only from the cluster-mesh loader.
    const runtimeGatewayImports = sources.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/^import\s+(?!type)[^;]*from\s+'@sentropic\/llm-gateway'/gm)]);
    expect(runtimeGatewayImports).toEqual([]);
  });
});
