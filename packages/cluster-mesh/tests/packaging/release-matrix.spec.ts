import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, nodeJson, read } from './helpers.js';

const tupleOf = (name: string): Record<string, string> => Object.fromEntries(
  read(join(fixtureDir(name), 'tuple.txt')).trim().split('\n').map((line) => {
    const at = line.lastIndexOf('@');
    return [line.slice(0, at), line.slice(at + 1)];
  }));

const PREFLIGHT = (mode: 'service' | 'session' | 'both') => `
  import { createClusterMeshModules, verifyClusterMeshTopology } from '@sentropic/cluster-mesh';
  import { createGatewayNamespaceModule } from '@sentropic/cluster-mesh/compose/gateway';
  import { loadGatewayAuth } from '@sentropic/cluster-mesh/loaders/gateway/auth';
  import { loadGatewayAuthHono } from '@sentropic/cluster-mesh/loaders/gateway/auth-hono';
  import { createGatewayRouter, stubGatewayConfig } from '@sentropic/cluster-mesh/gateway';
  const modules = createClusterMeshModules();
  const out = { topology: verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] }).instances.length };
  if (${JSON.stringify(mode)} !== 'session') out.service = typeof (await loadGatewayAuth(modules)).ServiceAuthVerifyToken;
  if (${JSON.stringify(mode)} !== 'service') {
    out.session = typeof (await loadGatewayAuthHono(modules)).AuthHonoVerifyToken;
    const namespace = await createGatewayNamespaceModule(modules, {
      enabled: true, authMode: 'session', createRouter: () => createGatewayRouter({ config: stubGatewayConfig }),
    });
    out.namespace = { namespace: namespace.namespace, enabled: namespace.enabled };
  }
  console.log(JSON.stringify(out));`;

describe.skipIf(!enabled)('packed release matrix', () => {
  it('should install the selected tuple from the committed lockfile', () => {
    const lock = JSON.parse(readFileSync(join(fixtureDir('selected'), 'committed-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    const tuple = tupleOf('selected');
    for (const [name, version] of Object.entries(tuple)) {
      if (version === 'absent') continue;
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(version);
    }
    expect(tuple).toMatchObject({
      '@sentropic/llm-mesh': '0.22.0', '@sentropic/llm-gateway': '0.19.0', '@sentropic/mcp-auth': '0.2.1',
      '@sentropic/oauth-verify': '0.1.0', jose: '5.10.0', hono: '4.10.7', '@sentropic/auth-hono': 'absent',
    });
  });

  it('should source the train packages from verified sibling archives only in a train run', () => {
    const expected = process.env.CLUSTER_MESH_SIBLING_RECEIPTS ? 'sibling' : 'registry';
    const pinned: Record<string, string> = { '@sentropic/llm-mesh': '0.22.0', '@sentropic/llm-gateway': '0.19.0' };
    for (const fixture of ['selected', 'selected-session', 'latest', 'src/separate-runtime']) {
      const lines = read(join(fixtureDir(fixture), 'sources.txt')).trim().split('\n').map((line) => line.split(' '));
      expect(lines.map(([name]) => name).sort(), fixture).toEqual(['@sentropic/llm-gateway', '@sentropic/llm-mesh']);
      for (const [name, kind, spec] of lines) {
        expect(kind, `${fixture} ${name}`).toBe(expected);
        if (kind === 'sibling') expect(spec, name).toMatch(new RegExp(`/sentropic-${name!.split('/')[1]}-${pinned[name!]}\\.tgz$`, 'u'));
        else if (fixture !== 'latest') expect(spec, name).toBe(pinned[name!]);
      }
    }
  });

  it('should pass session-mode preflight with the public auth-hono tarball', () => {
    expect(tupleOf('selected-session')).toMatchObject({ '@sentropic/auth-hono': '0.15.0', '@sentropic/mcp-auth': 'absent' });
    expect(nodeJson(fixtureDir('selected-session'), PREFLIGHT('session'))).toEqual({
      topology: 1, session: 'function', namespace: { namespace: '/gw', enabled: true },
    });
  });

  it('should qualify the latest versions inside every declared peer range', () => {
    const tuple = tupleOf('latest');
    for (const name of ['@sentropic/llm-mesh', '@sentropic/llm-gateway', '@sentropic/mcp-auth', '@sentropic/auth-hono', 'jose']) {
      expect(tuple[name], name).not.toBe('absent');
    }
    expect(nodeJson(fixtureDir('latest'), PREFLIGHT('both'))).toEqual({
      topology: 1, service: 'function', session: 'function', namespace: { namespace: '/gw', enabled: true },
    });
  });
});
