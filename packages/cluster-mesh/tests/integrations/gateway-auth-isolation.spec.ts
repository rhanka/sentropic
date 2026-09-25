import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGatewayNamespaceModule, type GatewayAuthMode } from '../../src/compose/gateway.js';
import { createClusterMeshPlugin } from '../../src/hono/plugin.js';
import { isClusterMeshModuleUnavailableError } from '../../src/modules/errors.js';
import { createModuleRegistry } from '../../src/modules/registry.js';
import { createClusterMeshRuntime } from '../../src/runtime/generation.js';
import { loadGatewayAuth } from '../../src/loaders/gateway/auth.js';
import {
  evaluations, fakeAuthHono, fakeGateway, fakeJose, fakeMcpAuth, fakeMesh, PackageTree,
} from '../fixtures/package-tree.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const PEERS = /['"](@sentropic\/(llm-mesh|llm-gateway|mcp-auth|auth-hono|oauth-verify)|jose)(\/[^'"]*)?['"]/u;

function rootGraph(): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    const source = readFileSync(file, 'utf8');
    seen.set(file, source);
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/gu)) {
      visit(resolve(dirname(file), match[1]!.replace(/\.js$/u, '.ts')));
    }
  };
  visit(join(SRC, 'index.ts'));
  return seen;
}

describe('root and gateway auth isolation (source)', () => {
  it('should keep the root graph free of static or type references to optional peers', () => {
    for (const [file, source] of rootGraph()) {
      for (const line of source.split('\n')) {
        if (!PEERS.test(line)) continue;
        const where = `${file}: ${line}`;
        expect(/\bfrom\s+['"]|^\s*import\s+['"]|typeof import\(/u.test(line), where).toBe(false);
        // Only the catalog's literal lazy thunks may import a peer, and only dynamically.
        if (/import\(/u.test(line)) expect(file.endsWith(join('modules', 'catalog.ts')), where).toBe(true);
      }
    }
  });

  it('should map /gateway only to the gateway root and each auth leaf to its own subpath', () => {
    const read = (file: string) => readFileSync(join(SRC, 'integrations/gateway', file), 'utf8');
    expect(read('index.ts')).toContain("export * from '@sentropic/llm-gateway';");
    expect(read('index.ts')).not.toMatch(/auth/u);
    expect(read('auth.ts')).toContain("export * from '@sentropic/llm-gateway/auth';");
    expect(read('auth-hono.ts')).toContain("export * from '@sentropic/llm-gateway/auth-hono';");
  });
});

let tree: PackageTree;
let anchorDir: string;
let gatewayDir: string;

beforeEach(() => {
  tree = new PackageTree();
  evaluations().length = 0;
  anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
  tree.install('app', fakeMesh('mesh'));
  gatewayDir = tree.install('app', fakeGateway('gw'));
});
afterEach(() => tree.cleanup());

function runtime() {
  return createClusterMeshRuntime({
    generationId: 'generation-1',
    config: { capacity: { poolSize: 1 } },
    context: { async verify() { throw new Error('not invoked'); } },
    registration: { async authorize() { return { ok: false, reason: 'missing_registration' } as const; } },
    receipts: { append: vi.fn(async () => undefined) },
  });
}

async function startup(authMode: GatewayAuthMode, bind = vi.fn()) {
  const modules = createModuleRegistry({}, { anchorDir });
  const namespace = await createGatewayNamespaceModule(modules, {
    enabled: true, authMode, createRouter: () => new Hono().get('/healthz', (c) => c.text('ok')),
  });
  bind(createClusterMeshPlugin({ runtime: runtime(), namespaces: [namespace] }));
  return bind;
}

async function refusedStartup(authMode: GatewayAuthMode) {
  const bind = vi.fn();
  const error = await startup(authMode, bind).then(() => undefined, (caught: unknown) => caught);
  expect(bind).not.toHaveBeenCalled();
  expect(isClusterMeshModuleUnavailableError(error)).toBe(true);
  return error as Record<string, unknown>;
}

describe('gateway auth startup matrix', () => {
  it('should import the service auth leaf alone yet fail startup before bind without mcp-auth', async () => {
    tree.install('app', fakeJose('jose'));
    const leaf = await import(pathToFileURL(join(gatewayDir, 'dist/entry-1.js')).href) as { ServiceAuthVerifyToken: unknown };
    expect(leaf.ServiceAuthVerifyToken).toBeTypeOf('function');
    expect(await refusedStartup('service')).toMatchObject({
      moduleId: 'gateway/auth', reason: 'not_installed', packageName: '@sentropic/mcp-auth', requiredRange: '>=0.2.1 <0.3.0',
    });
  });

  it('should fail service startup without jose', async () => {
    tree.install('app', fakeMcpAuth('mcp-auth'));
    expect(await refusedStartup('service')).toMatchObject({ reason: 'not_installed', packageName: 'jose' });
  });

  it('should fail session startup without auth-hono and keep service mode independent of it', async () => {
    expect(await refusedStartup('session')).toMatchObject({
      moduleId: 'gateway/auth-hono', reason: 'not_installed', packageName: '@sentropic/auth-hono',
    });
    tree.install('app', fakeMcpAuth('mcp-auth'));
    tree.install('app', fakeJose('jose'));
    evaluations().length = 0;
    expect(await startup('service')).toHaveBeenCalledOnce();
    // `gw` was already evaluated by the refused session startup (native module cache).
    expect(evaluations()).toEqual(['gw/auth', 'mcp-auth/hono', 'jose']);
  });

  it('should start session mode without mcp-auth or jose and evaluate only its peer', async () => {
    tree.install('app', fakeAuthHono('auth-hono'));
    expect(await startup('session')).toHaveBeenCalledOnce();
    expect(evaluations()).toEqual(['gw', 'gw/auth-hono', 'auth-hono/middleware']);
  });

  it('should select no gateway auth peer for a host-injected caller port', async () => {
    expect(await startup('host')).toHaveBeenCalledOnce();
    expect(evaluations()).toEqual(['gw']);
  });

  it('should ignore a compatible peer visible only from cluster-mesh', async () => {
    tree.install('app/node_modules/@sentropic/cluster-mesh', fakeMcpAuth('cluster-private'));
    tree.install('app/node_modules/@sentropic/cluster-mesh', fakeJose('cluster-jose'));
    expect(await refusedStartup('service')).toMatchObject({ reason: 'not_installed', packageName: '@sentropic/mcp-auth' });
  });

  it('should use the gateway-relative version when cluster-mesh sees a different one', async () => {
    tree.install('app', fakeMcpAuth('outer'));
    tree.install('app', fakeJose('jose'));
    tree.install('app/node_modules/@sentropic/llm-gateway', fakeMcpAuth('nested', '0.2.0'));
    expect(await refusedStartup('service')).toMatchObject({
      reason: 'incompatible_version', packageName: '@sentropic/mcp-auth', installedVersion: '0.2.0',
    });
    expect(evaluations()).toEqual(['gw']);
  });

  it('should report a broken transitive peer graph as load_failed', async () => {
    tree.install('app', fakeMcpAuth('mcp-auth', '0.2.1', 'import "@sentropic/oauth-verify";\nexport const createRequireServiceAuth = 1;'));
    tree.install('app', fakeJose('jose'));
    expect(await refusedStartup('service')).toMatchObject({ reason: 'load_failed', packageName: '@sentropic/mcp-auth' });
  });

  it('should reject the documented static preflight with a code recognized across copies', async () => {
    const modules = createModuleRegistry({}, { anchorDir });
    const error = await loadGatewayAuth(modules).catch((caught: unknown) => caught);
    const foreignCopy: unknown = JSON.parse(JSON.stringify(error));
    expect(isClusterMeshModuleUnavailableError(foreignCopy)).toBe(true);
    expect(foreignCopy).toMatchObject({ code: 'cluster_mesh_module_unavailable', reason: 'not_installed' });
  });
});
