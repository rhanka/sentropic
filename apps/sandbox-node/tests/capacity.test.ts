import { describe, expect, it } from 'vitest';
import { ExecutionNodeAdmission } from '../src/admission.js';
import { EXECUTION_NODE_CAPACITY, EXECUTION_NODE_TENANT_SLICE_DEFAULTS } from '../src/contract.js';

const quotas = { sentropic: { maxLive: 1, maxStandby: 1 }, immo: { maxLive: 1, maxStandby: 1 } };
describe('d2-4 memory admission', () => {
  it('should admit both warm sessions and one build within 3200 MiB including gVisor', async () => {
    const admission = new ExecutionNodeAdmission(quotas);
    admission.admit('sentropic', 'live', 'a');
    admission.admit('immo', 'standby', 'b');
    await admission.admitBuild('sentropic');
    expect(admission.reservedMiB('sentropic') + admission.reservedMiB('immo')).toBe(3200);
    expect(EXECUTION_NODE_CAPACITY.parentMemoryMaxMiB).toBe(3456);
    expect(EXECUTION_NODE_TENANT_SLICE_DEFAULTS.immo).toMatchObject({ memoryMaxMiB: 2560, cpuWeight: 100 });
    admission.claim('immo');
    expect(admission.reservedMiB('immo')).toBe(768);
  });

  it('should reject on full memory.current including cache and sentry before OOM', async () => {
    const admission = new ExecutionNodeAdmission(quotas, { memoryCurrentMiB: () => 1800 });
    expect(() => admission.admit('sentropic', 'live', 'a')).toThrowError(/memory reservation/);
    await expect(admission.admitBuild('sentropic')).rejects.toMatchObject({ status: 429 });
    expect(admission.builds.snapshot().holderTenantId).toBeUndefined();
  });
});
