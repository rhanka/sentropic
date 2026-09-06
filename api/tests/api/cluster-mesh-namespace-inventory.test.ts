import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createIdpApp } from '../../../apps/auth-idp/idp-app';
import {
  app,
  MOUNTED_NAMESPACE_REGISTRY,
  PREFIX_MOUNTED_NAMESPACE_REGISTRY,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
} from '../../src/app';

const EXPECTED_NAMESPACES = [
  '/session', '/cli', '/mcp', '/oauth', '/gw', '/chat', '/focus', '/track', '/memory',
  '/health', '/apps', '/catalog', '/resources', '/admin', '/clients', '/transfers',
  '/documents', '/config', '/auth', '/llm-mesh', '/workflows', '/comments', '/connectors',
  '/agents', '/streams', '/locks', '/business', '/analytics', '/workspaces',
] as const;

const routeKeys = (routes: ReadonlyArray<{ method: string; path: string }>): Set<string> =>
  new Set(routes.map(({ method, path }) => `${method}:${path}`));

describe('Cluster Mesh namespace inventory', () => {
  it('registers exactly 29 namespace keys with one module author each', () => {
    const namespaces = MOUNTED_NAMESPACE_REGISTRY.map(({ namespace }) => namespace);
    const modules = MOUNTED_NAMESPACE_REGISTRY.map(({ module }) => module);

    expect(namespaces).toEqual(EXPECTED_NAMESPACES);
    expect(new Set(namespaces).size).toBe(29);
    expect(new Set(modules).size).toBe(29);
    expect(PREFIX_MOUNTED_NAMESPACE_REGISTRY).toHaveLength(9);
    expect(ROOT_MOUNTED_NAMESPACE_REGISTRY).toHaveLength(20);
    for (const { namespace, module } of MOUNTED_NAMESPACE_REGISTRY) {
      expect(module.namespace).toBe(namespace);
    }
  });

  it('keeps OAuth/session projections specific to the product and IdP roots', () => {
    const product = routeKeys(app.routes);
    const idp = routeKeys(createIdpApp().routes);

    expect(product).toContain('GET:/api/v1/oauth/end_session');
    expect(product).toContain('GET:/api/v1/auth/session');
    expect(product).not.toContain('GET:/api/v1/auth/oauth/end_session');
    expect(idp).toContain('GET:/api/v1/auth/oauth/end_session');
    expect(idp).toContain('GET:/api/v1/auth/session');
    expect(idp).not.toContain('GET:/api/v1/oauth/end_session');
  });

  it('keeps the replaced legacy API index inert', () => {
    const source = readFileSync(resolve('src/routes/api/index.ts'), 'utf8');

    expect(source).toContain('export {};');
    expect(source).not.toMatch(/\b(?:route|use|get|post|put|patch|delete)\s*\(/);
    expect(source).not.toMatch(/from\s+['"].+['"]/);
  });
});
