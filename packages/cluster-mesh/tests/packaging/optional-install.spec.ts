import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneFixture, enabled, fixtureDir, nodeJson, read, runNode } from './helpers.js';

const LOADERS = [
  ['llm-mesh', 'loadLlmMesh'], ['llm-mesh/facade', 'loadLlmMeshFacade'], ['llm-mesh/enrollment', 'loadLlmMeshEnrollment'],
  ['llm-mesh/node', 'loadLlmMeshNode'], ['llm-mesh/transport/cloud-code', 'loadCloudCodeTransport'],
  ['gateway', 'loadGateway'], ['gateway/auth', 'loadGatewayAuth'], ['gateway/auth-hono', 'loadGatewayAuthHono'],
] as const;

describe.skipIf(!enabled)('packed optional install', () => {
  it('should import the bare root and every loader without any optional peer', () => {
    const result = nodeJson<{ loaders: string[]; refusal: Record<string, unknown>; probe: Record<string, unknown> }>(
      fixtureDir('bare'), `
      import { createClusterMeshModules, isClusterMeshModuleUnavailableError } from '@sentropic/cluster-mesh';
      const loaders = [];
      for (const [path, name] of ${JSON.stringify(LOADERS)}) {
        const entry = await import('@sentropic/cluster-mesh/loaders/' + path);
        if (typeof entry[name] === 'function') loaders.push(name);
      }
      const { loadLlmMesh } = await import('@sentropic/cluster-mesh/loaders/llm-mesh');
      const modules = createClusterMeshModules();
      const error = await loadLlmMesh(modules).catch((caught) => caught);
      const probe = await modules.probe();
      console.log(JSON.stringify({
        loaders,
        refusal: { recognized: isClusterMeshModuleUnavailableError(error), code: error.code, reason: error.reason, message: error.message },
        probe: { gateway: probe.gateway, mcpTrack: probe['mcp/track'] },
      }));`);
    expect(result.loaders).toHaveLength(LOADERS.length);
    expect(result.refusal).toEqual({
      recognized: true, code: 'cluster_mesh_module_unavailable', reason: 'not_installed',
      message: 'Cluster Mesh module "llm-mesh" is unavailable (not_installed). Install @sentropic/llm-mesh@">=0.22.0 <0.23.0" and restart.',
    });
    expect(result.probe).toEqual({
      gateway: { availability: 'gated', state: 'unavailable', reason: 'not_installed', packageName: '@sentropic/llm-gateway', requiredRange: '>=0.19.0 <0.20.0' },
      mcpTrack: { availability: 'gated', state: 'unavailable', reason: 'source_unavailable' },
    });
  });

  it('should fail native linking of a selected static leaf whose provider is absent', () => {
    const run = runNode(fixtureDir('bare'), `import '@sentropic/cluster-mesh/llm-mesh';`);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('ERR_MODULE_NOT_FOUND');
    expect(run.stderr).toContain('@sentropic/llm-mesh');
  });

  it('should probe metadata without evaluating an untouched installed peer', () => {
    const dir = cloneFixture('bare', 'bare-poisoned');
    for (const [name, version] of [['llm-gateway', '0.19.0'], ['llm-mesh', '0.22.0']] as const) {
      const packageDir = join(dir, 'node_modules/@sentropic', name);
      mkdirSync(join(packageDir, 'dist'), { recursive: true });
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
        name: `@sentropic/${name}`, version, type: 'module', exports: { '.': { import: './dist/index.js' } },
      }));
      writeFileSync(join(packageDir, 'dist/index.js'), `throw new Error("${name} evaluated");`);
    }
    const result = nodeJson(dir, `
      import { createClusterMeshModules } from '@sentropic/cluster-mesh';
      await import('@sentropic/cluster-mesh/loaders/gateway');
      const probe = await createClusterMeshModules().probe();
      console.log(JSON.stringify({ gateway: probe.gateway, mesh: probe['llm-mesh'] }));`);
    expect(result).toMatchObject({
      gateway: { availability: 'available', state: 'installed', installedVersion: '0.19.0' },
      mesh: { availability: 'available', state: 'installed', installedVersion: '0.22.0' },
    });
  });

  it('should run the selected public tuple through static leaves and service-mode preflight', () => {
    const result = nodeJson(fixtureDir('selected'), `
      import { createClusterMeshModules, verifyClusterMeshTopology } from '@sentropic/cluster-mesh';
      import * as leaf from '@sentropic/cluster-mesh/llm-mesh';
      import * as provider from '@sentropic/llm-mesh';
      import { createGatewayRouter, stubGatewayConfig } from '@sentropic/cluster-mesh/gateway';
      import { loadGatewayAuth } from '@sentropic/cluster-mesh/loaders/gateway/auth';
      import { loadGatewayAuthHono } from '@sentropic/cluster-mesh/loaders/gateway/auth-hono';
      const modules = createClusterMeshModules();
      const service = await loadGatewayAuth(modules);
      const session = await loadGatewayAuthHono(modules).catch((caught) => caught);
      const router = createGatewayRouter({ config: stubGatewayConfig });
      const report = verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] });
      console.log(JSON.stringify({
        identical: leaf.createLlmMesh === provider.createLlmMesh,
        service: typeof service.ServiceAuthVerifyToken,
        session: { code: session.code, reason: session.reason, packageName: session.packageName },
        health: (await router.request('/healthz')).status,
        sharedMesh: report.gateway.llmMesh.path === report.llmMesh.path,
      }));`);
    expect(result).toEqual({
      identical: true, service: 'function',
      session: { code: 'cluster_mesh_module_unavailable', reason: 'not_installed', packageName: '@sentropic/auth-hono' },
      health: 200, sharedMesh: true,
    });
    expect(read(join(fixtureDir('selected'), 'tuple.txt'))).toContain('@sentropic/llm-gateway@0.19.0');
  });

  it('should refuse a broken transitive service-auth graph as load_failed', () => {
    const dir = cloneFixture('selected', 'selected-broken');
    rmSync(join(dir, 'node_modules/@sentropic/oauth-verify'), { recursive: true, force: true });
    const result = nodeJson(dir, `
      import { createClusterMeshModules } from '@sentropic/cluster-mesh';
      import { loadGatewayAuth } from '@sentropic/cluster-mesh/loaders/gateway/auth';
      const error = await loadGatewayAuth(createClusterMeshModules()).catch((caught) => caught);
      console.log(JSON.stringify({ reason: error.reason, packageName: error.packageName }));`);
    expect(result).toEqual({ reason: 'load_failed', packageName: '@sentropic/mcp-auth' });
  });

  it('should refuse a service-mode startup whose jose peer is missing from the packed tree', () => {
    const dir = cloneFixture('selected', 'selected-no-jose');
    rmSync(join(dir, 'node_modules/jose'), { recursive: true, force: true });
    const result = nodeJson(dir, `
      import { createClusterMeshModules } from '@sentropic/cluster-mesh';
      import { loadGatewayAuth } from '@sentropic/cluster-mesh/loaders/gateway/auth';
      const error = await loadGatewayAuth(createClusterMeshModules()).catch((caught) => caught);
      console.log(JSON.stringify({ code: error.code, moduleId: error.moduleId, reason: error.reason, packageName: error.packageName }));`);
    expect(result).toEqual({
      code: 'cluster_mesh_module_unavailable', moduleId: 'gateway/auth', reason: 'not_installed', packageName: 'jose',
    });
  });
});
