/**
 * L-5e — installed web-pages tuple (spec-v8 §9 5e): in the packaging
 * fixture the candidate plus the candidate mcp-platform and artifacts
 * tarballs form a coherent tuple — mesh declares the artifacts peer
 * (optional, single 0.1.0 range), the installed artifacts candidate
 * satisfies both declared ranges (mesh peer, artifacts→platform peer),
 * and the leaf loads the provider definition through the real module
 * registry only when selected. Source-manifest coherence runs in every
 * lane; the installed proof needs the prepared fixture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { satisfies } from '../../src/modules/resolution.js';
import { ARTIFACTS_PACKAGE, ARTIFACTS_RANGE, MCP_PLATFORM_RANGE, PROVIDER_CATALOG } from '../../src/modules/catalog.js';
import { enabled, fixture, trainVersion, tuple } from './helpers.js';

interface Pkg {
  version: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  exports?: Record<string, unknown>;
}

const manifest = (path: string): Pkg => JSON.parse(readFileSync(path, 'utf8')) as Pkg;
const sourceManifest = manifest(new URL('../../package.json', import.meta.url).pathname);

describe('web-pages source tuple coherence', () => {
  it('declares the optional artifacts peer once, in the candidate range', () => {
    expect(sourceManifest.peerDependencies?.[ARTIFACTS_PACKAGE]).toBe(ARTIFACTS_RANGE);
    expect(ARTIFACTS_RANGE).toBe('>=0.1.0 <0.2.0');
    expect(sourceManifest.peerDependenciesMeta?.[ARTIFACTS_PACKAGE]).toEqual({ optional: true });
    expect(sourceManifest.peerDependencies?.['@sentropic/mcp-platform']).toBe(MCP_PLATFORM_RANGE);
    expect(sourceManifest.exports?.['./mcp/web-pages']).toBeDefined();
  });

  it('keeps the module catalog descriptor identical to the declared peer', () => {
    const descriptor = PROVIDER_CATALOG['mcp/web-pages'];
    expect(descriptor.packageName).toBe(ARTIFACTS_PACKAGE);
    expect(descriptor.range).toBe(sourceManifest.peerDependencies?.[ARTIFACTS_PACKAGE]);
    expect(descriptor.subpath).toBe('./mcp');
    expect(descriptor.requiredMembers).toContain('createWebPagesRegistryDefinition');
    expect(descriptor.meshCoherence).toBe(false);
  });
});

describe.skipIf(!enabled)('installed web-pages tuple', () => {
  it('installs the artifacts candidate inside both declared ranges', () => {
    const fixtureManifest = manifest(
      fixture('web-pages-consumer', 'node_modules/@sentropic/cluster-mesh/package.json'),
    );
    expect(fixtureManifest.peerDependencies?.[ARTIFACTS_PACKAGE]).toBe(ARTIFACTS_RANGE);
    const artifacts = manifest(
      fixture('web-pages-consumer', 'node_modules/@sentropic/artifacts/package.json'),
    );
    expect(artifacts.version).toBe(trainVersion('artifacts'));
    expect(satisfies(artifacts.version, ARTIFACTS_RANGE)).toBe(true);
    expect(artifacts.peerDependencies?.['@sentropic/mcp-platform']).toBe(MCP_PLATFORM_RANGE);
    expect(artifacts.peerDependenciesMeta?.['@sentropic/mcp-platform']).toEqual({ optional: true });
    const platform = manifest(
      fixture('web-pages-consumer', 'node_modules/@sentropic/mcp-platform/package.json'),
    );
    expect(satisfies(platform.version, MCP_PLATFORM_RANGE)).toBe(true);
    const sources = tuple('web-pages-consumer');
    expect(sources['@sentropic/cluster-mesh']).toBe('file');
    expect(sources['@sentropic/mcp-platform']).toBe('file');
    expect(sources['@sentropic/artifacts']).toBe('file');
  });

  it('leaves artifacts uninstalled in the plain mcp consumer', () => {
    expect(() =>
      manifest(fixture('mcp-consumer', 'node_modules/@sentropic/artifacts/package.json')),
    ).toThrow();
  });
});
