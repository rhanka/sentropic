import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, nodeJson, read } from './helpers.js';

// Skewed trees: the old tuple and a partial bump (cluster-mesh 0.13.0 with the consumer's own llm-mesh ^0.21.2 and
// llm-gateway ^0.18.0). npm's recorded behavior is asserted explicitly so a change of npm is visible; the runtime must
// refuse every guarded entry, the preflight and the gateway acquisition before any route is mounted.
const detail = (fixture: string): Record<string, string> => Object.fromEntries(
  read(join(fixtureDir(fixture), 'npm-install-detail')).trim().split('\n').map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));

const ENTRIES = ['llm-mesh', 'llm-mesh/facade', 'gateway', 'loaders/llm-mesh', 'loaders/gateway', 'compose/llm-mesh', 'compose/gateway'];
const PROBE = `
  import { createClusterMeshModules, verifyClusterMeshTopology } from '@sentropic/cluster-mesh';
  const pick = (error) => ({ code: error.code, reason: error.reason, message: error.message });
  const out = { entries: {} };
  try { verifyClusterMeshTopology(); out.preflight = 'passed'; } catch (error) { out.preflight = pick(error); }
  out.load = await createClusterMeshModules().load('gateway').then(() => 'loaded', (error) => ({ ...pick(error),
    packageName: error.packageName, installedVersion: error.installedVersion, requiredRange: error.requiredRange }));
  for (const entry of ${JSON.stringify(ENTRIES)}) {
    out.entries[entry] = await import('@sentropic/cluster-mesh/' + entry).then(() => 'imported', pick);
  }
  console.log(JSON.stringify(out));`;

type Refusal = { code: string; reason: string; message: string };
type Probe = { preflight: Refusal; load: Refusal & Record<string, string>; entries: Record<string, Refusal> };

function expectRefused(fixture: string, mesh: RegExp, gateway: RegExp): void {
  const result = nodeJson<Probe>(fixtureDir(fixture), PROBE);
  const topology = { code: 'cluster_mesh_topology_invalid', reason: 'incompatible_version' };
  const named = new RegExp(`installed @sentropic/llm-mesh@${mesh.source} at \\S+ does not satisfy the required range ">=0\\.22\\.0 <0\\.23\\.0"`, 'u');
  expect(result.preflight).toMatchObject(topology);
  expect(result.preflight.message).toMatch(named);
  for (const entry of ENTRIES) {
    expect(result.entries[entry], entry).toMatchObject(topology);
    expect(result.entries[entry]!.message, entry).toMatch(named);
  }
  expect(result.load).toMatchObject({
    code: 'cluster_mesh_module_unavailable', reason: 'incompatible_version', packageName: '@sentropic/llm-gateway',
    requiredRange: '>=0.19.0 <0.20.0',
  });
  expect(result.load.installedVersion).toMatch(gateway);
}

describe.skipIf(!enabled)('packed skewed tuples', () => {
  it('should record npm dropping the old tuple and refuse the skewed tree at runtime', () => {
    expect(read(join(fixtureDir('old-tuple'), 'npm-install-outcome')).trim()).toBe('refused');
    // npm 11.19: exit 0 with "ERESOLVE overriding peer dependency", the candidate installed and the old tuple dropped.
    const dropped = '@sentropic/cluster-mesh@0.13.0 @sentropic/llm-mesh@absent @sentropic/llm-gateway@absent';
    expect(detail('old-tuple')).toEqual({
      'plain-exit': '0', 'plain-eresolve': 'yes', 'plain-installed': dropped,
      'force-exit': '0', 'force-eresolve': 'yes', 'force-installed': dropped,
      'legacy-peer-deps-exit': '0', 'legacy-peer-deps-eresolve': 'no',
      'legacy-peer-deps-installed': '@sentropic/cluster-mesh@0.13.0 @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0',
      'skew-build': 'legacy-peer-deps',
    });
    expectRefused('old-tuple', /0\.21\.2/u, /^0\.18\.0$/u);
  });

  it('should record npm refusing a partial bump with ERESOLVE and refuse the forced tree at every entry', () => {
    // npm 11.19: the consumer's own ^0.21.2/^0.18.0 pins conflict with the candidate's optional peers -> exit 1.
    expect(detail('partial-bump')).toEqual({
      'plain-exit': '1', 'plain-eresolve': 'yes',
      'plain-installed': '@sentropic/cluster-mesh@absent @sentropic/llm-mesh@absent @sentropic/llm-gateway@absent',
      'legacy-peer-deps-exit': '0', 'legacy-peer-deps-eresolve': 'no',
      'legacy-peer-deps-installed': '@sentropic/cluster-mesh@0.13.0 @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0',
      'skew-build': 'legacy-peer-deps',
    });
    expectRefused('partial-bump', /0\.21\.2/u, /^0\.18\.0$/u);
  });
});
