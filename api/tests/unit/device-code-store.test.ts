import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  issueDeviceCode,
  pollDeviceCode,
  approveDeviceCode,
  findByUserCode,
  clearAll,
} from '../../src/services/device-code-store';

describe('device-code store (unit)', () => {
  beforeEach(() => {
    clearAll();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAll();
  });

  it('issues a code with a PAIR-XXXX user code and default interval', () => {
    const issued = issueDeviceCode('Box');
    expect(issued.userCode).toMatch(/^PAIR-[A-Z2-9]{4}$/);
    expect(issued.intervalSec).toBeGreaterThan(0);
    expect(issued.deviceCode.length).toBeGreaterThan(10);
  });

  it('returns authorization_pending until approved', () => {
    const { deviceCode } = issueDeviceCode();
    expect(pollDeviceCode(deviceCode)).toEqual({ status: 'authorization_pending' });
  });

  it('throttles a too-fast second poll with slow_down', () => {
    const { deviceCode } = issueDeviceCode();
    expect(pollDeviceCode(deviceCode)).toEqual({ status: 'authorization_pending' });
    expect(pollDeviceCode(deviceCode)).toEqual({ status: 'slow_down' });
  });

  it('allows polling again after the interval elapses', () => {
    vi.useFakeTimers();
    const { deviceCode, intervalSec } = issueDeviceCode();
    expect(pollDeviceCode(deviceCode)).toEqual({ status: 'authorization_pending' });
    vi.advanceTimersByTime((intervalSec + 1) * 1000);
    expect(pollDeviceCode(deviceCode)).toEqual({ status: 'authorization_pending' });
  });

  it('expires entries after the TTL', () => {
    vi.useFakeTimers();
    const { deviceCode, userCode } = issueDeviceCode();
    // TTL is 10 minutes; advance just past it.
    vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
    expect(pollDeviceCode(deviceCode)).toEqual({ status: 'expired' });
    expect(findByUserCode(userCode)).toBeUndefined();
  });

  it('approve links user + role and a subsequent poll consumes the code (single-use)', () => {
    vi.useFakeTimers();
    const { deviceCode, userCode } = issueDeviceCode('Original');
    const result = approveDeviceCode(userCode, 'user-123', 'admin', 'Renamed');
    expect(result).toEqual({ ok: true });

    const outcome = pollDeviceCode(deviceCode);
    expect(outcome).toEqual({
      status: 'approved',
      userId: 'user-123',
      role: 'admin',
      deviceName: 'Renamed',
    });

    // Single-use: second poll finds nothing.
    expect(pollDeviceCode(deviceCode)).toEqual({ status: 'expired' });
  });

  it('falls back to the requested device name when approver omits one', () => {
    vi.useFakeTimers();
    const { deviceCode, userCode } = issueDeviceCode('Requested Name');
    approveDeviceCode(userCode, 'user-9', 'editor');
    const outcome = pollDeviceCode(deviceCode);
    expect(outcome).toMatchObject({ status: 'approved', deviceName: 'Requested Name' });
  });

  it('rejects approve of an unknown or already-approved code', () => {
    expect(approveDeviceCode('PAIR-ZZZZ', 'u', 'editor')).toEqual({
      ok: false,
      reason: 'not_found',
    });

    const { userCode } = issueDeviceCode();
    expect(approveDeviceCode(userCode, 'u', 'editor')).toEqual({ ok: true });
    expect(approveDeviceCode(userCode, 'u', 'editor')).toEqual({
      ok: false,
      reason: 'already_resolved',
    });
  });

  it('matches user codes case-insensitively', () => {
    const { userCode } = issueDeviceCode();
    expect(findByUserCode(userCode.toLowerCase())).toBeDefined();
  });
});
