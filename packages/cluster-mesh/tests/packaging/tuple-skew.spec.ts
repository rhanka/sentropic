import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, nodeJson, read } from './helpers.js';
import { npmSkewViolations, runtimeRefusalViolations, type Detail, type Probe, type SkewTuple } from './skew-invariants.js';

// Skewed trees: the old tuple and a partial bump (the candidate with the consumer's own llm-mesh ^0.21.2 and
// llm-gateway ^0.18.0). npm's exact outcome depends on npm and on the registry state (before and after the train
// publication it differs), so it is recorded and printed, and only the invariants are asserted: the plain install
// never accepts the skewed tuple, a skewed tree is still obtainable, and the runtime refuses every guarded entry,
// the preflight and the gateway acquisition before any route is mounted.
const detail = (fixture: string): Detail => {
  const record = Object.fromEntries(read(join(fixtureDir(fixture), 'npm-install-detail')).trim().split('\n').map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  console.log(`[${fixture}] recorded npm outcome ${JSON.stringify(record)}`);
  return record;
};

const CANDIDATE = `@sentropic/cluster-mesh@${(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version}`;
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

function expectSkewRefused(fixture: string, tuple: SkewTuple, builders: readonly string[]): void {
  expect(npmSkewViolations(detail(fixture), tuple, builders)).toEqual([]);
  expect(runtimeRefusalViolations(nodeJson<Probe>(fixtureDir(fixture), PROBE), ENTRIES, tuple)).toEqual([]);
}

describe.skipIf(!enabled)('packed skewed tuples', () => {
  it('should never accept the old tuple with a plain install and refuse the skewed tree at runtime', () => {
    expect(read(join(fixtureDir('old-tuple'), 'npm-install-outcome')).trim()).toBe('refused');
    expectSkewRefused('old-tuple', { candidate: CANDIDATE, mesh: /^0\.21\.2$/u, gateway: /^0\.18\.0$/u },
      ['force', 'legacy-peer-deps']);
  });

  it('should never accept a partial bump with a plain install and refuse the skewed tree at every entry', () => {
    expectSkewRefused('partial-bump', { candidate: CANDIDATE, mesh: /^0\.21\.\d+$/u, gateway: /^0\.18\.\d+$/u },
      ['legacy-peer-deps']);
  });
});
