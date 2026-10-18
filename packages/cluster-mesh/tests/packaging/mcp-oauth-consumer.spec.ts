import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneFixture, enabled, fixtureDir, nodeJson, read, runNode, tsc } from './helpers.js';

describe.skipIf(!enabled)('installed MCP OAuth consumer', () => {
  it.each(['NodeNext', 'Bundler'] as const)('should compile the real typed host and public call site with full library checks (%s)', (module) => {
    const result = tsc(fixtureDir('mcp-oauth'), 'oauth', read(new URL('./fixtures/mcp-oauth/consumer.ts', import.meta.url).pathname),
      { module, skipLibCheck: false });
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('should run real HTTP exchange and existing-client continuity natively on the Radar tuple', () => {
    expect(nodeJson(fixtureDir('mcp-oauth'), `
      import { runHttpScenario } from './scenario.js';
      import { createImmoMcp } from './consumer.js';
      console.log(JSON.stringify(await runHttpScenario(createImmoMcp)));
    `)).toEqual({ mints: 2, apiCalls: 2, tools: 12, assurance: 'enforced' });
  });

  it('should retain provider identity through both static leaves and typed loaders', () => {
    const result = nodeJson(fixtureDir('mcp-oauth'), `
      import * as auth from '@sentropic/cluster-mesh/mcp/auth';
      import * as hono from '@sentropic/cluster-mesh/mcp/auth/hono';
      import * as provider from '@sentropic/mcp-auth';
      import * as adapter from '@sentropic/mcp-auth/hono';
      import { loadMcpAuth, loadMcpAuthHono } from '@sentropic/cluster-mesh/loaders/mcp';
      import { createClusterMeshModules } from '@sentropic/cluster-mesh';
      const modules = createClusterMeshModules();
      console.log(JSON.stringify({ core: auth.createMcpAuth === provider.createMcpAuth,
        error: auth.McpAuthError === provider.McpAuthError, hono: hono.mcpAuthRoutes === adapter.mcpAuthRoutes,
        load: (await loadMcpAuth(modules)).createMcpAuth === provider.createMcpAuth,
        adapter: (await loadMcpAuthHono(modules)).mcpAuthRoutes === adapter.mcpAuthRoutes }));
    `);
    expect(result).toEqual({ core: true, error: true, hono: true, load: true, adapter: true });
  });

  it('should import an unused loader without peers and refuse missing or disabled auth on selection', () => {
    for (const [fixture, reason, disabled] of [['bare', 'not_installed', []], ['mcp-oauth', 'disabled', ['mcp/auth']]] as const) {
      expect(nodeJson(fixtureDir(fixture), `
        import { createClusterMeshModules } from '@sentropic/cluster-mesh';
        import { loadMcpAuth } from '@sentropic/cluster-mesh/loaders/mcp/auth';
        const error = await loadMcpAuth(createClusterMeshModules({ disabled: ${JSON.stringify(disabled)} })).catch(e => e);
        console.log(JSON.stringify({ code: error.code, reason: error.reason }));
      `)).toEqual({ code: 'cluster_mesh_module_unavailable', reason });
    }
  });

  it('should refuse static OAuth at the old auth floor before provider evaluation', () => {
    const dir = cloneFixture('mcp-oauth', 'mcp-oauth-old-auth');
    const path = join(dir, 'node_modules/@sentropic/mcp-auth');
    const manifest = JSON.parse(read(join(path, 'package.json'))); manifest.version = '0.2.1';
    writeFileSync(join(path, 'package.json'), JSON.stringify(manifest));
    appendFileSync(join(path, 'dist/index.js'), '\nthrow new Error("provider-evaluated");\n');
    const run = runNode(dir, `try { await import('@sentropic/cluster-mesh/mcp/auth'); }
      catch (error) { console.log(JSON.stringify({ code: error.code, reason: error.reason })); }`);
    expect(run.status).toBe(0); expect(run.stderr).not.toContain('provider-evaluated');
    expect(JSON.parse(run.stdout)).toEqual({ code: 'cluster_mesh_topology_invalid', reason: 'incompatible_version' });
  });

  it('should refuse a broken installed provider export rather than exposing an incomplete namespace', () => {
    const dir = cloneFixture('mcp-oauth', 'mcp-oauth-broken-auth');
    writeFileSync(join(dir, 'node_modules/@sentropic/mcp-auth/dist/index.js'), 'export const createMcpAuth = () => {};');
    expect(nodeJson(dir, `
      import { createClusterMeshModules } from '@sentropic/cluster-mesh';
      import { loadMcpAuth } from '@sentropic/cluster-mesh/loaders/mcp/auth';
      const error = await loadMcpAuth(createClusterMeshModules()).catch(e => e);
      console.log(JSON.stringify({ code: error.code, reason: error.reason }));
    `)).toEqual({ code: 'cluster_mesh_module_unavailable', reason: 'export_unavailable' });
  });
});
