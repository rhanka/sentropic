import { describe, expect, it } from 'vitest';
import { ExecutionNodeAdmission, ExecutionNodeError } from '../src/index.js';

const quotas = {
  sentropic: { maxLive: 1, maxStandby: 1 },
  immo: { maxLive: 1, maxStandby: 1 },
};

describe('admission fairness', () => {
  it('should refuse new reservations during drain without blocking release', async () => {
    const admission = new ExecutionNodeAdmission(quotas);
    admission.admit('immo', 'live', 'existing'); admission.draining = true;
    expect(() => admission.admit('sentropic', 'live', 'new')).toThrow();
    await expect(admission.admitBuild('sentropic')).rejects.toThrow();
    admission.release('immo', 'live'); expect(admission.reservedMiB('immo')).toBe(0);
    admission.draining = false; admission.admit('sentropic', 'live', 'new');
  });
  it('should reserve the build atomically without charging destroyed-scope cache', async () => {
    const admission = new ExecutionNodeAdmission(quotas, { memoryCurrentMiB: id => id === 'sentropic' ? 800 : 0 });
    admission.admit('sentropic', 'live', 'a'); admission.admit('immo', 'live', 'b');
    await admission.admitBuild('sentropic');
    expect(admission.builds.snapshot().holderTenantId).toBe('sentropic');
  });
  it('returns 429 with retryAfterMs when a tenant quota is exhausted', () => {
    const admission = new ExecutionNodeAdmission(quotas, { retryAfterMs: 250 });
    admission.admit('sentropic', 'live', 'r1');
    try {
      admission.admit('sentropic', 'live', 'r2');
      expect.unreachable();
    } catch (error) {
      expect((error as ExecutionNodeError).code).toBe('tenant_quota_exceeded');
      expect((error as ExecutionNodeError).status).toBe(429);
      expect((error as ExecutionNodeError).retryAfterMs).toBe(250);
    }
    expect(admission.snapshot('sentropic').pending).toBe(0);
    admission.release('sentropic', 'live');
    admission.admit('sentropic', 'live', 'r2');
  });

  it('keeps reserved standby slots independent per tenant', () => {
    const admission = new ExecutionNodeAdmission(quotas);
    admission.admit('sentropic', 'standby', 's1');
    admission.admit('immo', 'standby', 's2');
    expect(admission.snapshot('sentropic').standby).toBe(1);
    expect(admission.snapshot('immo').standby).toBe(1);
    expect(() => admission.admit('sentropic', 'standby', 's3')).toThrowError(/tenant_quota_exceeded/);
  });

  it('should transfer standby without a second warm reservation', () => {
    const admission = new ExecutionNodeAdmission(quotas);
    admission.admit('sentropic', 'standby', 's1');
    expect(() => admission.admit('sentropic', 'live', 'l1')).toThrowError(/tenant_quota_exceeded/);
    admission.claim('sentropic');
    expect(admission.snapshot('sentropic')).toMatchObject({ live: 1, standby: 0 });
  });
});
