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
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { satisfiesRange } from '../../src/modules/semver.js';
import { ARTIFACTS_PACKAGE, ARTIFACTS_RANGE, MCP_PLATFORM_RANGE, PROVIDER_CATALOG } from '../../src/modules/catalog.js';
import { enabled, fixtureDir, trainVersion } from './helpers.js';

interface Pkg {
  version: string;
  dependencies?: Record<string, string>;
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
  // Installed manifest of a package inside the web-pages consumer tree.
  const consumerManifest = (name: string): Pkg => manifest(join(
    fixtureDir('web-pages-consumer'), 'node_modules', ...name.split('/'), 'package.json',
  ));

  it('installs the artifacts candidate inside both declared ranges', () => {
    // prepare.sh always installs this consumer from the packed tarballs: the
    // dependency specs stay `file:` (never rewritten to the registry).
    const deps = manifest(join(fixtureDir('web-pages-consumer'), 'package.json')).dependencies ?? {};
    for (const name of ['@sentropic/cluster-mesh', '@sentropic/mcp-platform', ARTIFACTS_PACKAGE]) {
      expect(deps[name], name).toMatch(/^file:/u);
    }
    const mesh = consumerManifest('@sentropic/cluster-mesh');
    expect(mesh.peerDependencies?.[ARTIFACTS_PACKAGE]).toBe(ARTIFACTS_RANGE);
    const artifacts = consumerManifest(ARTIFACTS_PACKAGE);
    expect(artifacts.version).toBe(trainVersion('artifacts'));
    expect(satisfiesRange(artifacts.version, ARTIFACTS_RANGE)).toBe(true);
    expect(artifacts.peerDependencies?.['@sentropic/mcp-platform']).toBe(MCP_PLATFORM_RANGE);
    expect(artifacts.peerDependenciesMeta?.['@sentropic/mcp-platform']).toEqual({ optional: true });
    const platform = consumerManifest('@sentropic/mcp-platform');
    expect(satisfiesRange(platform.version, MCP_PLATFORM_RANGE)).toBe(true);
  });

  it('leaves artifacts uninstalled in the plain mcp consumer', () => {
    expect(() =>
      manifest(join(fixtureDir('mcp-consumer'), 'node_modules', '@sentropic', 'artifacts', 'package.json')),
    ).toThrow();
  });
});
