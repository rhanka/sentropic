import { describe, expect, it, vi } from 'vitest';
import { createLocalDeviceDomain } from '../src/index.js';

describe('local device attachment', () => {
  it('should delegate the existing issue, poll and approve lifecycle without translation', () => {
    const issued = {
      deviceCode: 'device-code',
      userCode: 'PAIR-TEST',
      intervalSec: 5,
      expiresAt: new Date('2026-08-15T00:00:00Z'),
    };
    const approved = {
      status: 'approved' as const,
      userId: 'user-1',
      role: 'editor',
      deviceName: 'Laptop',
    };
    const issueDeviceCode = vi.fn(() => issued);
    const pollDeviceCode = vi.fn(() => approved);
    const approveDeviceCode = vi.fn(() => ({ ok: true as const }));
    const devices = createLocalDeviceDomain({ issueDeviceCode, pollDeviceCode, approveDeviceCode });

    expect(devices.issueDeviceCode('Laptop')).toBe(issued);
    expect(devices.pollDeviceCode('device-code')).toBe(approved);
    expect(devices.approveDeviceCode('PAIR-TEST', 'user-1', 'editor', 'Laptop')).toEqual({ ok: true });
    expect(issueDeviceCode).toHaveBeenCalledWith('Laptop');
    expect(pollDeviceCode).toHaveBeenCalledWith('device-code');
    expect(approveDeviceCode).toHaveBeenCalledWith('PAIR-TEST', 'user-1', 'editor', 'Laptop');
  });

  it('should preserve fail-closed device approval outcomes', () => {
    const devices = createLocalDeviceDomain({
      issueDeviceCode() {
        return {
          deviceCode: 'device-code',
          userCode: 'PAIR-TEST',
          intervalSec: 5,
          expiresAt: new Date(0),
        };
      },
      pollDeviceCode() { return { status: 'expired' }; },
      approveDeviceCode() { return { ok: false, reason: 'not_found' }; },
    });

    expect(devices.pollDeviceCode('missing')).toEqual({ status: 'expired' });
    expect(devices.approveDeviceCode('missing', 'user-1', 'editor')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});
