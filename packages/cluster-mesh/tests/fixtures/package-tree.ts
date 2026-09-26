import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Evaluation log shared by fixture provider modules. */
export function evaluations(): string[] {
  const store = globalThis as { __clusterMeshFixtureEvaluations?: string[] };
  store.__clusterMeshFixtureEvaluations ??= [];
  return store.__clusterMeshFixtureEvaluations;
}

export interface FakeExport {
  readonly source: string;
}

export interface FakePackage {
  readonly name: string;
  readonly version?: string;
  readonly exports?: Readonly<Record<string, FakeExport>>;
  /** Raw manifest override (e.g. malformed JSON). */
  readonly rawManifest?: string;
}

/** Module source that records its evaluation and exports the given members. */
export function moduleSource(label: string, members: readonly string[], extra = ''): string {
  const exported = members.map((member) => `export const ${member} = () => ${JSON.stringify(`${label}:${member}`)};`);
  return [
    `(globalThis.__clusterMeshFixtureEvaluations ??= []).push(${JSON.stringify(label)});`,
    extra,
    ...exported,
  ].join('\n');
}

export class PackageTree {
  readonly root = mkdtempSync(join(tmpdir(), 'cluster-mesh-tree-'));

  /** Install a fake package in `<root>/<at>/node_modules/<name>`; returns its directory. */
  install(at: string, pkg: FakePackage): string {
    const dir = join(this.root, at, 'node_modules', ...pkg.name.split('/'));
    mkdirSync(dir, { recursive: true });
    const exportsMap: Record<string, { import: string }> = {};
    let index = 0;
    for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
      const file = `./dist/entry-${index}.js`;
      index += 1;
      exportsMap[subpath] = { import: file };
      this.write(join(dir, file), entry.source);
    }
    const manifest = pkg.rawManifest
      ?? JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', exports: exportsMap });
    this.write(join(dir, 'package.json'), manifest);
    return dir;
  }

  /** Symlink `<root>/<at>/node_modules/<name>` to an existing directory (pnpm/npm link style). */
  link(at: string, name: string, target: string): void {
    const path = join(this.root, at, 'node_modules', ...name.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path, 'dir');
  }

  dir(at: string): string {
    const path = join(this.root, at);
    mkdirSync(path, { recursive: true });
    return path;
  }

  write(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

export const MESH_MEMBERS = ['createLlmMesh', 'createProviderRegistry'] as const;

export function fakeMesh(label: string, version = '0.22.0'): FakePackage {
  return {
    name: '@sentropic/llm-mesh',
    version,
    exports: {
      '.': { source: moduleSource(label, MESH_MEMBERS) },
      './facade': { source: moduleSource(`${label}/facade`, ['createLlmMeshFacade']) },
      './enrollment': { source: moduleSource(`${label}/enrollment`, []) },
      './node': { source: moduleSource(`${label}/node`, ['InMemoryKeyring']) },
      './transport/cloud-code': { source: moduleSource(`${label}/cloud-code`, ['CloudCodeProviderAdapter']) },
    },
  };
}

export function fakeGateway(label: string, version = '0.19.0', authSource?: { service?: string; session?: string }): FakePackage {
  return {
    name: '@sentropic/llm-gateway',
    version,
    exports: {
      '.': { source: moduleSource(label, ['createGatewayRouter', 'stubGatewayConfig']) },
      './auth': {
        source: authSource?.service ?? moduleSource(`${label}/auth`, ['ServiceAuthVerifyToken'],
          'export const deferred = () => import("@sentropic/mcp-auth/hono");'),
      },
      './auth-hono': {
        source: authSource?.session ?? moduleSource(`${label}/auth-hono`, ['AuthHonoVerifyToken'],
          'export const deferred = () => import("@sentropic/auth-hono/middleware");'),
      },
    },
  };
}

export function fakeMcpAuth(label: string, version = '0.2.1', honoSource?: string): FakePackage {
  return {
    name: '@sentropic/mcp-auth',
    version,
    exports: {
      '.': { source: moduleSource(label, ['createMcpAuth']) },
      './hono': { source: honoSource ?? moduleSource(`${label}/hono`, ['createRequireServiceAuth']) },
    },
  };
}

export function fakeJose(label: string, version = '5.10.0'): FakePackage {
  return { name: 'jose', version, exports: { '.': { source: moduleSource(label, ['jwtVerify']) } } };
}

export function fakeAuthHono(label: string, version = '0.15.2'): FakePackage {
  return {
    name: '@sentropic/auth-hono',
    version,
    exports: {
      '.': { source: moduleSource(label, ['createAuthRouter']) },
      './middleware': { source: moduleSource(`${label}/middleware`, ['createRequireAuth']) },
    },
  };
}
