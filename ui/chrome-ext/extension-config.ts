export type ExtensionProfile = 'uat' | 'prod';

export interface ExtensionRuntimeConfig {
    profile: ExtensionProfile;
    apiBaseUrl: string;
    appBaseUrl: string;
    wsBaseUrl: string;
    updatedAt: number;
}

export const EXTENSION_CONFIG_STORAGE_KEY = 'topAiIdeas:extensionConfig:v1';

const DEFAULT_CONFIGS: Record<
    ExtensionProfile,
    Omit<ExtensionRuntimeConfig, 'profile' | 'updatedAt'>
> = {
    uat: {
        apiBaseUrl: 'http://localhost:8787/api/v1',
        appBaseUrl: 'http://localhost:5173',
        wsBaseUrl: '',
    },
    prod: {
        apiBaseUrl: 'https://top-ai-ideas-api.sent-tech.ca/api/v1',
        appBaseUrl: 'https://top-ai-ideas.sent-tech.ca',
        wsBaseUrl: '',
    },
};

const trimSlash = (value: string): string => {
    if (!value) return '';
    return value.endsWith('/') ? value.slice(0, -1) : value;
};

const normalizeHttpUrl = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        return trimSlash(url.toString());
    } catch {
        return null;
    }
};

const normalizeConfig = (
    profile: ExtensionProfile,
    raw?: Partial<ExtensionRuntimeConfig> | null,
): ExtensionRuntimeConfig => {
    const defaults = DEFAULT_CONFIGS[profile];
    const apiBaseUrl =
        normalizeHttpUrl(raw?.apiBaseUrl ?? '') ??
        normalizeHttpUrl(defaults.apiBaseUrl) ??
        DEFAULT_CONFIGS.uat.apiBaseUrl;
    const appBaseUrl =
        normalizeHttpUrl(raw?.appBaseUrl ?? '') ??
        normalizeHttpUrl(defaults.appBaseUrl) ??
        DEFAULT_CONFIGS.uat.appBaseUrl;
    const wsBaseUrl = raw?.wsBaseUrl?.trim() ?? defaults.wsBaseUrl;

    return {
        profile,
        apiBaseUrl,
        appBaseUrl,
        wsBaseUrl,
        updatedAt: Date.now(),
    };
};

const parseStoredConfig = (payload: unknown): ExtensionRuntimeConfig | null => {
    if (!payload || typeof payload !== 'object') return null;
    const raw = payload as Partial<ExtensionRuntimeConfig>;
    const profile = raw.profile === 'prod' ? 'prod' : raw.profile === 'uat' ? 'uat' : null;
    if (!profile) return null;
    return normalizeConfig(profile, raw);
};

export async function loadExtensionConfig(): Promise<ExtensionRuntimeConfig> {
    try {
        const payload = await chrome.storage.local.get(EXTENSION_CONFIG_STORAGE_KEY);
        const stored = parseStoredConfig(payload?.[EXTENSION_CONFIG_STORAGE_KEY]);
        if (stored) return stored;
    } catch (error) {
        console.warn('Unable to read extension runtime config from storage.', error);
    }

    const fallback = normalizeConfig('uat');
    try {
        await chrome.storage.local.set({
            [EXTENSION_CONFIG_STORAGE_KEY]: fallback,
        });
    } catch (error) {
        console.warn('Unable to persist fallback extension runtime config.', error);
    }
    return fallback;
}

export async function saveExtensionConfig(
    input: Pick<ExtensionRuntimeConfig, 'profile' | 'apiBaseUrl' | 'appBaseUrl' | 'wsBaseUrl'>,
): Promise<ExtensionRuntimeConfig> {
    const normalized = normalizeConfig(input.profile, input);
    await chrome.storage.local.set({
        [EXTENSION_CONFIG_STORAGE_KEY]: normalized,
    });
    return normalized;
}

export function getDefaultConfig(profile: ExtensionProfile): ExtensionRuntimeConfig {
    return normalizeConfig(profile);
}

