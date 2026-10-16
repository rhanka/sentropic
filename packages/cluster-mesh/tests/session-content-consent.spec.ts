import { describe, expect, it } from 'vitest';
import {
  ContentConsentError,
  computePolicyDigest,
  validateRetentionByChannel,
  verifyPolicyDigest,
} from '../src/sessions/content-consent.js';

describe('content consent retention validation', () => {
  it('should accept explicit no-expiry defaults for both retained channels', () => {
    const map = validateRetentionByChannel({
      'terminal.cache': { mode: 'none' },
      'native.mirror': { mode: 'none' },
    });
    expect(map['terminal.cache']).toEqual({ mode: 'none' });
    expect(map['native.mirror']).toEqual({ mode: 'none' });
  });

  it('should accept a positive safe-integer duration for one channel only', () => {
    const map = validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: 3600 },
      'native.mirror': { mode: 'none' },
    });
    expect(map['terminal.cache']).toEqual({ mode: 'duration', durationSeconds: 3600 });
  });

  it('should refuse a zero duration', () => {
    expect(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: 0 },
      'native.mirror': { mode: 'none' },
    })).toMatchObject({ code: 'invalid_retention' });
  });

  it('should refuse a negative duration', () => {
    expect(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: -60 },
      'native.mirror': { mode: 'none' },
    })).toMatchObject({ code: 'invalid_retention' });
  });

  it('should refuse a fractional duration', () => {
    expect(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: 1.5 },
      'native.mirror': { mode: 'none' },
    })).toMatchObject({ code: 'invalid_retention' });
  });

  it('should refuse an overflowing duration beyond the safe integer range', () => {
    expect(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: Number.MAX_SAFE_INTEGER + 1 },
      'native.mirror': { mode: 'none' },
    })).toMatchObject({ code: 'invalid_retention' });
  });

  it('should refuse an omitted channel as unsigned retention', () => {
    expect(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'none' },
    })).toMatchObject({ code: 'unsigned_retention' });
  });

  it('should refuse an unsigned finite duration without an explicit tag', () => {
    expect(() => validateRetentionByChannel({
      'terminal.cache': { durationSeconds: 3600 },
      'native.mirror': { mode: 'none' },
    })).toMatchObject({ code: 'unsigned_retention' });
  });

  it('should refuse a malformed retention tag', () => {
    expect(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'forever' },
      'native.mirror': { mode: 'none' },
    })).toMatchObject({ code: 'invalid_retention' });
  });

  it('should refuse a non-object retention map', () => {
    expect(() => validateRetentionByChannel(null)).toMatchObject({ code: 'invalid_retention' });
  });

  it('should throw ContentConsentError instances', () => {
    try {
      validateRetentionByChannel(null);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ContentConsentError);
    }
  });
});

describe('content consent policy digest', () => {
  const policy = {
    projectId: 'project-1',
    projectRevision: 1,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-1',
    ownerId: 'user-1',
    channels: { 'terminal.live': true, 'terminal.cache': true, 'native.mirror': false, 'keyboard.control': false },
    retentionByChannel: {
      'terminal.cache': { mode: 'none' },
      'native.mirror': { mode: 'none' },
    },
  };

  it('should recompute the same digest for the same canonical policy', () => {
    expect(computePolicyDigest(policy)).toBe(computePolicyDigest(structuredClone(policy)));
  });

  it('should change the digest when a duration is altered after preparation', () => {
    const altered = structuredClone(policy);
    altered.retentionByChannel['terminal.cache'] = { mode: 'duration', durationSeconds: 60 };
    expect(computePolicyDigest(altered)).not.toBe(computePolicyDigest(policy));
  });

  it('should verify a matching digest and reject a tampered policy', () => {
    const digest = computePolicyDigest(policy);
    expect(verifyPolicyDigest(policy, digest)).toBe(true);
    const tampered = structuredClone(policy);
    tampered.channels['native.mirror'] = true;
    expect(verifyPolicyDigest(tampered, digest)).toBe(false);
  });
});
