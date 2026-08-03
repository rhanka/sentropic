import { describe, expect, it, vi } from 'vitest';
import { resolveCoworkAccessToken } from '../src/cli/auth-bootstrap.js';

describe('resolveCoworkAccessToken', () => {
    it('should use a refreshed native token before attempting device-code enrollment', async () => {
        const getValidAccessToken = vi.fn().mockResolvedValue('refreshed-native-token');
        const enroll = vi.fn();

        const result = await resolveCoworkAccessToken({
            auth: { getValidAccessToken },
            deviceCode: { enroll },
            onDeviceCode: vi.fn(),
        });

        expect(result).toEqual({ token: 'refreshed-native-token', source: 'refresh' });
        expect(enroll).not.toHaveBeenCalled();
    });

    it('should enroll only after refresh state is absent or invalid, then read the stored session token', async () => {
        const getValidAccessToken = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce('enrolled-native-token');
        const start = { deviceCode: 'device-1', userCode: 'PAIR-1234', verificationUri: '/pair', intervalSec: 5, expiresInSec: 600 };
        const onDeviceCode = vi.fn();
        const enroll = vi.fn().mockImplementation(async (callback) => {
            callback(start);
            return { status: 'approved', user: { id: 'u1', role: 'editor', email: null, displayName: null }, expiresAt: '2026-08-04T00:00:00.000Z' };
        });

        const result = await resolveCoworkAccessToken({
            auth: { getValidAccessToken },
            deviceCode: { enroll },
            onDeviceCode,
        });

        expect(result).toEqual({ token: 'enrolled-native-token', source: 'device-code' });
        expect(onDeviceCode).toHaveBeenCalledWith(start);
        expect(getValidAccessToken).toHaveBeenNthCalledWith(1);
        expect(getValidAccessToken).toHaveBeenNthCalledWith(2, { allowRefresh: false });
    });
});
