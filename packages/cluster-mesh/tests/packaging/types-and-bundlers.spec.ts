import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enabled, esbuild, fixtureDir, read, runNode, TSC_CASES, tsc } from './helpers.js';

const ROOT_CONSUMER = `
import { createClusterMeshModules, verifyClusterMeshTopology, type ClusterMeshModules, type ModuleCapabilityMap } from '@sentropic/cluster-mesh';
const modules: ClusterMeshModules = createClusterMeshModules();
const map: ModuleCapabilityMap = modules.snapshot();
export const values = [map, verifyClusterMeshTopology];
`;

const LEAF_CONSUMER = `
import { createLlmMesh, type RoutePolicy } from '@sentropic/cluster-mesh/llm-mesh';
import { createLlmMeshFacade } from '@sentropic/cluster-mesh/llm-mesh/facade';
import type { AccountPublic } from '@sentropic/cluster-mesh/llm-mesh/enrollment';
import { createGatewayRouter, type CallerAuthPort } from '@sentropic/cluster-mesh/gateway';
import { ServiceAuthVerifyToken } from '@sentropic/cluster-mesh/gateway/auth';
import { loadLlmMesh } from '@sentropic/cluster-mesh/loaders/llm-mesh';
type IsAny<T> = 0 extends 1 & T ? true : false;
type NotAny<T> = IsAny<T> extends true ? never : T;
export const checks: [NotAny<typeof createLlmMesh>, NotAny<typeof createLlmMeshFacade>, NotAny<typeof createGatewayRouter>,
  NotAny<typeof ServiceAuthVerifyToken>, NotAny<typeof loadLlmMesh>] =
  [createLlmMesh, createLlmMeshFacade, createGatewayRouter, ServiceAuthVerifyToken, loadLlmMesh];
export type Types = [NotAny<RoutePolicy>, NotAny<AccountPublic>, NotAny<CallerAuthPort>];
`;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const packageDir = (fixture: string) => join(fixtureDir(fixture), 'node_modules/@sentropic/cluster-mesh');

describe.skipIf(!enabled)('packed declarations and bundlers', () => {
  it.each(TSC_CASES)('should compile a root-only consumer without peers (%o)', (options) => {
    const run = tsc(fixtureDir('bare'), 'root', ROOT_CONSUMER, options);
    expect(run.stdout + run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it.each(TSC_CASES)('should reject absent-peer leaf imports in the consumer (%o)', (options) => {
    const run = tsc(fixtureDir('bare'), 'leaf-absent', LEAF_CONSUMER, options);
    expect(run.status).not.toBe(0);
    if (options.skipLibCheck) expect(run.stdout).toMatch(/TS2305: Module '"@sentropic\/cluster-mesh\/llm-mesh"' has no exported member 'createLlmMesh'/u);
    else expect(run.stdout).toMatch(/TS2307: Cannot find module '@sentropic\/llm-mesh'/u);
  });

  it.each(TSC_CASES)('should compile selected leaves and typed loaders without any (%o)', (options) => {
    const run = tsc(fixtureDir('selected'), 'leaf', LEAF_CONSUMER, options);
    expect(run.stdout + run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('should emit provider leaves as the guard import plus export-star only', () => {
    const leaves = files(join(packageDir('bare'), 'dist/integrations'));
    // 12 re-export leaves, including local comments and the three decision leaves, plus the mcp/artifacts builtin-factory leaf
    // (asserted separately below: it carries mesh code, so it is no export-star), plus the five mcp/memory
    // builtin leaves (asserted in the memory leaf test below: factories and manifests carry mesh code).
    expect(leaves.filter((file) => file.endsWith('.d.ts'))).toHaveLength(18);
    for (const file of leaves.filter((path) => /\.(d\.ts|js)$/u.test(path))) {
      if (file.includes('integrations/mcp/artifacts.')) continue;
      if (file.includes('integrations/mcp/memory')) continue;
      const lines = read(file).split('\n').map((line) => line.trim())
        .filter((line) => line && !line.startsWith('//') && !line.startsWith('/*'));
      const exports = lines.filter((line) => line.startsWith('export'));
      expect(exports, file).toHaveLength(1);
      if (file.includes('/comments/')) expect(exports[0], file).toMatch(/^export \* from ['"]\.\.\/\.\.\/comments\/index\.js['"];$/u);
      else expect(exports[0], file).toMatch(/^export \* from "(@sentropic\/llm-(mesh|gateway)[^"]*)";$|^export \* from '(@sentropic\/llm-(mesh|gateway)[^']*)';$/u);
    }
  });

  it('should keep the artifacts builtin leaf free of embedded provider code', () => {
    // The mcp/artifacts leaf carries mesh code (the sentropic.artifacts builtin
    // factory), so it is not an export-star leaf — but like every leaf it must
    // not embed provider code: artifacts remains an external optional peer;
    // the runtime also uses the declared platform dependency for its digest.
    for (const leaf of ['dist/integrations/mcp/artifacts.js', 'dist/integrations/mcp/artifacts.d.ts']) {
      const source = read(join(packageDir('bare'), leaf));
      const externals = [...source.matchAll(/from\s+["'](@sentropic\/[^"']+)["']/gu)].map((match) => match[1]);
      const expected = leaf.endsWith('.js')
        ? ['@sentropic/artifacts/mcp', '@sentropic/mcp-platform/tool-configuration']
        : ['@sentropic/artifacts/mcp'];
      expect([...new Set(externals)].sort(), leaf).toEqual(expected.sort());
    }
    expect(read(join(packageDir('bare'), 'dist/integrations/mcp/artifacts.js'))).toMatch(/export function createArtifactsBuiltin/u);
  });

  it('should keep the memory builtin leaves free of embedded provider code', () => {
    // The mcp/memory leaves carry mesh code (the sentropic.engram.memory builtin
    // factory, composer, transport, wire manifest and definition), so they are not
    // export-star leaves — but like every leaf they must not embed provider code:
    // engram remains an external optional peer acquired through the qualified loader.
    const stems = ['memory', 'memory-compose', 'memory-definition', 'memory-manifest', 'memory-transport'];
    for (const stem of stems) {
      for (const leaf of [`dist/integrations/mcp/${stem}.js`, `dist/integrations/mcp/${stem}.d.ts`]) {
        const source = read(join(packageDir('bare'), leaf));
        expect(source, `${leaf} inlines provider code`).not.toContain('node_modules/@sentropic/engram/');
      }
    }
    const externalsOf = (stem: string): string[] => {
      const source = read(join(packageDir('bare'), `dist/integrations/mcp/${stem}.js`));
      return [...new Set([...source.matchAll(/from\s+["'](@sentropic\/[^"']+)["']/gu)].map((match) => match[1]))].sort();
    };
    expect(externalsOf('memory'), 'memory leaf externals').toEqual(['@sentropic/mcp-platform/memory']);
    expect(externalsOf('memory-transport'), 'memory-transport leaf externals').toEqual(['@sentropic/mcp-platform/memory']);
    expect(externalsOf('memory-compose'), 'memory-compose leaf externals').toEqual(
      ['@sentropic/mcp-platform/memory', '@sentropic/mcp-platform/tool-configuration']);
    expect(externalsOf('memory-manifest'), 'memory-manifest leaf is pure').toEqual([]);
    expect(read(join(packageDir('bare'), 'dist/integrations/mcp/memory.js')), 'memory leaf exports')
      .toMatch(/export (function createEngramMemoryBuiltin|\{[^}]*createEngramMemoryWireManifest[^}]*\})/u);
    expect(read(join(packageDir('bare'), 'dist/integrations/mcp/memory-manifest.js')), 'wire manifest export')
      .toMatch(/export function createEngramMemoryWireManifest/u);
  });

  it('should keep the emitted root declaration graph free of optional peers', () => {
    const peer = /["'](@sentropic\/(comments|llm-mesh|llm-gateway|mcp-auth|auth-hono|oauth-verify)|jose)(\/[^"']*)?["']/u;
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      expect(peer.test(source.replace(/\/\*\*[\s\S]*?\*\//gu, '')), file).toBe(false);
      for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/gu)) {
        visit(resolve(dirname(file), match[1]!.replace(/\.js$/u, '.d.ts')));
      }
    };
    visit(join(packageDir('bare'), 'dist/index.d.ts'));
    expect(seen.size).toBeGreaterThan(10);
  });

  it('should keep externalized cluster-mesh imports in an esbuild bundle and run it natively', () => {
    const dir = fixtureDir('selected');
    const entry = join(dir, "bundle-entry.mjs");
    writeFileSync(entry, [
        "import { createLlmMesh } from '@sentropic/cluster-mesh/llm-mesh';",
        "import { verifyClusterMeshTopology } from '@sentropic/cluster-mesh';",
        "verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] });",
        "console.log(typeof createLlmMesh);",
    ].join("\n"));
    const build = esbuild(dir, entry, join(dir, 'bundle.mjs'), ['@sentropic/cluster-mesh', '@sentropic/cluster-mesh/*']);
    expect(build.status, build.stderr).toBe(0);
    const output = read(join(dir, 'bundle.mjs'));
    expect(output).toMatch(/from "@sentropic\/cluster-mesh\/llm-mesh"/u);
    expect(output).toMatch(/from "@sentropic\/cluster-mesh"/u);
    const run = runNode(dir, output, 'bundle-run.mjs');
    expect(run.stderr).toBe('');
    expect(run.stdout.trim()).toBe('function');
  });

  it('should bundle the root like the API build without embedding provider, auth or jose code', () => {
    // Same bundling flags as api/package.json `build`; every peer is installed, so any
    // literal provider edge in the root graph would be followed and inlined.
    const dir = fixtureDir('latest');
    const entry = join(dir, 'api-like-entry.mjs');
    writeFileSync(entry, [
      "import { createClusterMeshModules, createClusterMeshPlugin } from '@sentropic/cluster-mesh';",
      'const modules = createClusterMeshModules();',
      "const mesh = await modules.load('llm-mesh');",
      'console.log(typeof createClusterMeshPlugin, typeof mesh.createLlmMesh);',
    ].join('\n'));
    const build = esbuild(dir, entry, join(dir, 'api-like.mjs'), [], ['--target=node20', '--sourcemap']);
    expect(build.status, build.stderr).toBe(0);
    const output = read(join(dir, 'api-like.mjs'));
    expect(output).toContain('node_modules/@sentropic/cluster-mesh/dist/modules/registry.js');
    for (const peer of ['@sentropic/llm-mesh', '@sentropic/llm-gateway', '@sentropic/mcp-auth', '@sentropic/oauth-verify',
      '@sentropic/auth-hono', 'jose']) {
      expect(output, peer).not.toContain(`node_modules/${peer}/`);
    }
    const run = runNode(dir, output, 'api-like-run.mjs');
    expect(run.stderr).toBe('');
    expect(run.stdout.trim()).toBe('function function');
  });
});
