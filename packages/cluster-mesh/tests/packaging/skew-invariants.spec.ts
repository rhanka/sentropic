import { describe, expect, it } from 'vitest';
import { npmSkewViolations, runtimeRefusalViolations, type Probe } from './skew-invariants.js';

// The packed tuple-skew invariants must go red on a skew that npm accepted or the runtime did not refuse; both
// npm-valid outcomes (ERESOLVE exit 1, or exit 0 with the old pair dropped) must stay green.
const TUPLE = { candidate: '@sentropic/cluster-mesh@0.13.0', mesh: /^0\.21\.2$/u, gateway: /^0\.18\.0$/u };
const SKEWED = '@sentropic/cluster-mesh@0.13.0 @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0';
const ABSENT = '@sentropic/cluster-mesh@absent @sentropic/llm-mesh@absent @sentropic/llm-gateway@absent';
const DROPPED = '@sentropic/cluster-mesh@0.13.0 @sentropic/llm-mesh@absent @sentropic/llm-gateway@absent';
const BUILDERS = ['force', 'legacy-peer-deps'];

// Registry state after the train publication (CI run 36225265271).
const PUBLISHED = {
  'plain-exit': '1', 'plain-eresolve': 'yes', 'plain-installed': ABSENT,
  'force-exit': '0', 'force-eresolve': 'yes', 'force-installed': SKEWED, 'skew-build': 'force',
};
// Registry state before the train publication.
const UNPUBLISHED = {
  'plain-exit': '0', 'plain-eresolve': 'yes', 'plain-installed': DROPPED,
  'force-exit': '0', 'force-eresolve': 'yes', 'force-installed': DROPPED,
  'legacy-peer-deps-exit': '0', 'legacy-peer-deps-eresolve': 'no', 'legacy-peer-deps-installed': SKEWED,
  'skew-build': 'legacy-peer-deps',
};

const ENTRIES = ['llm-mesh', 'gateway'];
const topology = {
  code: 'cluster_mesh_topology_invalid', reason: 'incompatible_version',
  message: 'installed @sentropic/llm-mesh@0.21.2 at /x/node_modules/@sentropic/llm-mesh does not satisfy the required range ">=0.22.0 <0.23.0"',
};
const REFUSED: Probe = {
  preflight: topology,
  load: { code: 'cluster_mesh_module_unavailable', reason: 'incompatible_version', message: 'm',
    packageName: '@sentropic/llm-gateway', installedVersion: '0.18.0', requiredRange: '>=0.19.0 <0.20.0' },
  entries: { 'llm-mesh': topology, gateway: topology },
};

describe('packed tuple-skew invariants', () => {
  it('should accept both npm-valid outcomes of the old tuple', () => {
    expect(npmSkewViolations(PUBLISHED, TUPLE, BUILDERS)).toEqual([]);
    expect(npmSkewViolations(UNPUBLISHED, TUPLE, BUILDERS)).toEqual([]);
  });

  it('should go red when the plain install ends with the old tuple installed', () => {
    const accepted = { ...PUBLISHED, 'plain-exit': '0', 'plain-installed': SKEWED };
    expect(npmSkewViolations(accepted, TUPLE, BUILDERS)).toEqual([
      `plain install accepted an out-of-range train package: ${SKEWED}`,
      `plain install built the skewed tuple: ${SKEWED}`,
    ]);
    const halfAccepted = { ...PUBLISHED, 'plain-exit': '0', 'plain-installed': DROPPED.replace('llm-gateway@absent', 'llm-gateway@0.18.0') };
    expect(npmSkewViolations(halfAccepted, TUPLE, BUILDERS)).toHaveLength(1);
  });

  it('should go red when the plain install fails without ERESOLVE or no skewed tree was built', () => {
    expect(npmSkewViolations({ ...PUBLISHED, 'plain-eresolve': 'no' }, TUPLE, BUILDERS)).toEqual(['plain install exited 1 without ERESOLVE']);
    expect(npmSkewViolations({ ...PUBLISHED, 'force-installed': DROPPED }, TUPLE, BUILDERS))
      .toEqual([`force install did not build the skewed tuple: ${DROPPED}`]);
    expect(npmSkewViolations({ ...PUBLISHED, 'skew-build': 'none' }, TUPLE, BUILDERS)).toEqual(['skew-build none is not one of force, legacy-peer-deps']);
    expect(npmSkewViolations({ 'skew-build': 'force' }, TUPLE, BUILDERS)).toEqual(['missing plain-exit', 'missing plain-eresolve', 'missing plain-installed']);
  });

  it('should accept a skewed tree refused at every entry, the preflight and the gateway load', () => {
    expect(runtimeRefusalViolations(REFUSED, ENTRIES, TUPLE)).toEqual([]);
  });

  it('should go red when the skewed tree is not refused at runtime', () => {
    expect(runtimeRefusalViolations({ ...REFUSED, preflight: 'passed' }, ENTRIES, TUPLE)).toEqual(['preflight not refused with incompatible_version: "passed"']);
    expect(runtimeRefusalViolations({ ...REFUSED, entries: { ...REFUSED.entries, gateway: 'imported' } }, ENTRIES, TUPLE))
      .toEqual(['gateway not refused with incompatible_version: "imported"']);
    expect(runtimeRefusalViolations({ ...REFUSED, load: 'loaded' }, ENTRIES, TUPLE)).toEqual(['load(\'gateway\') not refused with incompatible_version: "loaded"']);
    const otherReason = { ...topology, reason: 'not_installed' };
    expect(runtimeRefusalViolations({ ...REFUSED, entries: { ...REFUSED.entries, 'llm-mesh': otherReason } }, ENTRIES, TUPLE)).toHaveLength(1);
  });
});
