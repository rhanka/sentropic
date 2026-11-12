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
    expect(admission.pendingLength('sentropic')).toBe(1);
    admission.release('sentropic', 'live');
    expect(admission.drainPending().map(request => request.requestId)).toEqual(['r2']);
  });

  it('keeps reserved standby slots independent per tenant', () => {
    const admission = new ExecutionNodeAdmission(quotas);
    admission.admit('sentropic', 'standby', 's1');
    admission.admit('immo', 'standby', 's2');
    expect(admission.snapshot('sentropic').standby).toBe(1);
    expect(admission.snapshot('immo').standby).toBe(1);
    expect(() => admission.admit('sentropic', 'standby', 's3')).toThrowError(/tenant_quota_exceeded/);
  });

  it('drains queued tenants WFQ 1:1 in rotation', () => {
    const admission = new ExecutionNodeAdmission(quotas, { globalMaxLive: 1 });
    admission.admit('sentropic', 'live', 'a1');
    for (const requestId of ['a2', 'a3']) {
      expect(() => admission.admit('sentropic', 'live', requestId)).toThrowError(/tenant_quota_exceeded/);
    }
    for (const requestId of ['b1', 'b2']) {
      expect(() => admission.admit('immo', 'live', requestId)).toThrowError(/tenant_quota_exceeded/);
    }
    const served: string[] = [];
    const holders: Array<'sentropic' | 'immo'> = ['sentropic', 'sentropic', 'immo', 'sentropic'];
    for (const holder of holders) {
      admission.release(holder, 'live');
      served.push(...admission.drainPending().map(request => request.requestId));
    }
    expect(served).toEqual(['a2', 'b1', 'a3', 'b2']);
  });
});
