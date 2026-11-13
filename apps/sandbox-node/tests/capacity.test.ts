import { describe, expect, it } from 'vitest';
import { ExecutionNodeAdmission } from '../src/admission.js';
import { EXECUTION_NODE_CAPACITY, EXECUTION_NODE_TENANT_SLICE_DEFAULTS } from '../src/contract.js';

const quotas = { sentropic: { maxLive: 1, maxStandby: 1 }, immo: { maxLive: 1, maxStandby: 1 } };
describe('d2-4 memory admission', () => {
  it('should keep two warm sessions, build and agent below the measured safe ceiling', async () => {
    const admission = new ExecutionNodeAdmission(quotas);
    admission.admit('sentropic', 'live', 'a');
    admission.admit('immo', 'standby', 'b');
    await admission.admitBuild('sentropic');
    const reserved = admission.reservedMiB('sentropic') + admission.reservedMiB('immo');
    expect(reserved).toBe(2944);
    expect(reserved + 192).toBeLessThanOrEqual(3174);
    expect(EXECUTION_NODE_CAPACITY.parentMemoryMaxMiB).toBe(2944);
    expect(EXECUTION_NODE_TENANT_SLICE_DEFAULTS.immo).toMatchObject({ memoryMaxMiB: 2304, cpuWeight: 100 });
    admission.claim('immo');
    expect(admission.reservedMiB('immo')).toBe(704);
  });

  it('should admit on reservations despite cache left by destroyed scopes', async () => {
    const admission = new ExecutionNodeAdmission(quotas, { memoryCurrentMiB: () => 1800 });
    admission.admit('sentropic', 'live', 'a');
    await admission.admitBuild('sentropic');
    expect(admission.reservedMiB('sentropic')).toBe(2240);
    expect(admission.quotaSnapshot('sentropic', '/test').usage.memoryCurrentBytes).toBe(1800 * 1048576);
  });
});
