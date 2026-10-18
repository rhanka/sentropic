import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMcpAuth } from '../../src/loaders/mcp/auth.js';
import { loadMcpAuthHono } from '../../src/loaders/mcp/auth/hono.js';
import { createModuleRegistry } from '../../src/modules/registry.js';
import { evaluations, moduleSource, PackageTree } from '../fixtures/package-tree.js';

let tree: PackageTree;
beforeEach(() => { tree = new PackageTree(); evaluations().length = 0; });
afterEach(() => tree.cleanup());
const registry = (disabled: readonly ('mcp/auth' | 'mcp/auth/hono')[] = []) =>
  createModuleRegistry({ disabled }, { anchorDir: tree.dir('app/node_modules/@sentropic/cluster-mesh/dist') });

function install(version = '0.2.2', members = ['createMcpAuth', 'McpAuthError', 'buildWwwAuthenticate',
  'protectedResourceMetadataPath', 'legacyProtectedResourceMetadataPath', 'PROTECTED_RESOURCE_METADATA_PATH']) {
  tree.install('app', {
    name: '@sentropic/mcp-auth', version,
    exports: {
      '.': { source: moduleSource('auth', members) },
      './hono': { source: moduleSource('hono', ['mcpAuthRoutes', 'requireMcpAuth', 'getMcpAuthContext']) },
    },
  });
  tree.install('app', { name: '@sentropic/oauth-verify', version: '0.1.0',
    exports: { '.': { source: moduleSource('verify', ['verifyAccessToken']) } } });
  tree.install('app', { name: 'jose', version: '5.10.0',
    exports: { '.': { source: moduleSource('jose', ['jwtVerify']) } } });
  tree.install('app', { name: 'hono', version: '4.10.7',
    exports: { '.': { source: moduleSource('framework', ['Hono']) } } });
}

describe('selected MCP auth loaders', () => {
  it('should resolve nothing until selected and share the provider namespace', async () => {
    install();
    const modules = registry();
    expect(modules.snapshot()['mcp/auth']).toEqual({ availability: 'gated', state: 'unprobed' });
    expect((await modules.probe())['mcp/auth']).toMatchObject({ state: 'installed' });
    expect(evaluations()).toEqual([]);
    const [first, second] = await Promise.all([loadMcpAuth(modules), loadMcpAuth(modules)]);
    expect(second).toBe(first);
    expect(modules.snapshot()['mcp/auth']).toMatchObject({ state: 'loaded', installedVersion: '0.2.2' });
    expect(evaluations()).not.toContain('hono');
    await expect(loadMcpAuthHono(modules)).resolves.toHaveProperty('requireMcpAuth');
  });

  it('should refuse missing and disabled auth without evaluating providers', async () => {
    await expect(loadMcpAuth(registry())).rejects.toMatchObject({ reason: 'not_installed' });
    install();
    await expect(loadMcpAuth(registry(['mcp/auth']))).rejects.toMatchObject({ reason: 'disabled' });
    expect(evaluations()).toEqual([]);
  });

  it('should reject the old service-auth floor only for OAuth selection', async () => {
    install('0.2.1');
    await expect(loadMcpAuth(registry())).rejects.toMatchObject({ reason: 'incompatible_version', installedVersion: '0.2.1' });
    expect(evaluations()).toEqual([]);
  });

  it('should refuse missing runtime exports and incompatible owner-resolved verifier peers', async () => {
    install('0.2.2', ['createMcpAuth']);
    await expect(loadMcpAuth(registry())).rejects.toMatchObject({ reason: 'export_unavailable' });
    tree.install('app/node_modules/@sentropic/mcp-auth', { name: '@sentropic/oauth-verify', version: '0.2.0' });
    await expect(loadMcpAuth(registry())).rejects.toMatchObject({ reason: 'incompatible_version', packageName: '@sentropic/oauth-verify' });
  });
});
