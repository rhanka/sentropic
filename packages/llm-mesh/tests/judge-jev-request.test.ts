import { describe, expect, it } from 'vitest';
import { jevDescriptor } from '../src/judge/jev-descriptor.js';
import { qualifiedDescriptor } from './judge-fixtures.js';

describe('JEV descriptor qualification boundary', () => {
  it('keeps production identity and the candidate billing bound unqualified', () => {
    expect(jevDescriptor.acceptedServedModelIds).toEqual([]);
    expect(jevDescriptor.qualification).toEqual({ servedIdentity: 'unqualified', billingBound: 'unqualified', evidenceRefs: [] });
    expect(jevDescriptor.maxBillableInputTokens).toBe(65_536);
    expect(jevDescriptor.nativeDecision).toBe(false);
    expect(jevDescriptor.retention).toMatchObject({ status: 'unknown', retentionDays: null });
  });
  it('keeps synthetic qualification detached from production configuration', () => {
    const fixture = qualifiedDescriptor();
    fixture.acceptedServedModelIds.push('another-fixture');
    expect(jevDescriptor.acceptedServedModelIds).toEqual([]);
  });
});
