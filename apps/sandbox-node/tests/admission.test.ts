import { describe, expect, it } from 'vitest';
import { ExecutionNodeAdmission, ExecutionNodeError } from '../src/index.js';

const quotas = {
  sentropic: { maxLive: 1, maxStandby: 1 },
  immo: { maxLive: 1, maxStandby: 1 },
};

describe('admission fairness', () => {
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
