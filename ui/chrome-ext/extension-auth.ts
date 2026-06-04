import type { ExtensionRuntimeConfig } from './extension-config';
import { createChromeStorageAdapter } from './chrome-storage-adapter';
import {
    SessionAuthClient,
    type AuthConnectResult,
    type AuthStatus,
    type AuthUser,
} from '@sentropic/cowork-bridge/auth';

// Re-export the portable auth types under their historical extension names so
// existing consumers (background.ts, tool-permissions.ts) keep working unchanged.
export type ExtensionAuthUser = AuthUser;
export type ExtensionAuthStatus = AuthStatus;
export type ExtensionAuthConnectResult = AuthConnectResult;

const EXTENSION_DEVICE_NAME = 'Sentropic Extension';

const sharedStorageAdapter = createChromeStorageAdapter();

const createClient = (config: ExtensionRuntimeConfig): SessionAuthClient =>
    new SessionAuthClient({
        storage: sharedStorageAdapter,
        fetch: (input, init) => fetch(input, init),
        config: {
            apiBaseUrl: config.apiBaseUrl,
            appBaseUrl: config.appBaseUrl,
            deviceName: EXTENSION_DEVICE_NAME,
        },
    });

export const getValidAccessToken = async (
    config: ExtensionRuntimeConfig,
    options?: { allowRefresh?: boolean },
): Promise<string | null> => createClient(config).getValidAccessToken(options);

export const getExtensionAuthStatus = async (
    config: ExtensionRuntimeConfig,
    options?: { allowRefresh?: boolean },
): Promise<ExtensionAuthStatus> => createClient(config).getStatus(options);

export const connectExtensionAuth = async (
    config: ExtensionRuntimeConfig,
): Promise<ExtensionAuthConnectResult> => createClient(config).connect();

export const logoutExtensionAuth = async (
    config: ExtensionRuntimeConfig,
): Promise<void> => createClient(config).logout();
