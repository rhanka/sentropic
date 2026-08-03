import type { SessionAuthClient } from '@sentropic/cowork-bridge/auth';
import type { DeviceCodeClient, DeviceCodePollResult, DeviceCodeStart } from '../enroll/index.js';

export type CoworkAuthBootstrap = {
    token: string;
    source: 'refresh' | 'device-code';
};

/**
 * Resolve a native bearer before opening Cowork. Device-code enrollment is a
 * recovery path only: a durable refresh token is tried first after every restart.
 */
export const resolveCoworkAccessToken = async (input: {
    auth: Pick<SessionAuthClient, 'getValidAccessToken'>;
    deviceCode: Pick<DeviceCodeClient, 'enroll'>;
    onDeviceCode(start: DeviceCodeStart): void;
}): Promise<CoworkAuthBootstrap> => {
    const refreshed = await input.auth.getValidAccessToken();
    if (refreshed) return { token: refreshed, source: 'refresh' };

    const outcome: DeviceCodePollResult = await input.deviceCode.enroll(input.onDeviceCode);
    if (outcome.status !== 'approved') {
        throw new Error(`enrollment failed: ${outcome.status}`);
    }
    const token = await input.auth.getValidAccessToken({ allowRefresh: false });
    if (!token) throw new Error('enrollment completed without a valid access token');
    return { token, source: 'device-code' };
};
