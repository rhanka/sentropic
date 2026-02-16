// Service Worker for Top AI Ideas Extension
import {
    loadExtensionConfig,
    saveExtensionConfig,
    type ExtensionProfile,
} from './extension-config';

// Tool executor registry placeholder
const toolExecutors: Record<string, (args: any) => Promise<unknown>> = {
    // 'tab_read_dom': executeTabReadDom,
    // ...
};

const ALLOWED_PROXY_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    'top-ai-ideas-api.sent-tech.ca',
]);

type ProxyFetchPayload = {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
};

type ExtensionConfigPayload = {
    profile?: ExtensionProfile;
    apiBaseUrl?: string;
    appBaseUrl?: string;
    wsBaseUrl?: string;
};

const isAllowedProxyUrl = (rawUrl: string): boolean => {
    try {
        const parsed = new URL(rawUrl);
        return ALLOWED_PROXY_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
};

const sanitizeHeaders = (
    headers: Record<string, string> | undefined,
): Record<string, string> => {
    const safe: Record<string, string> = {};
    if (!headers) return safe;
    for (const [key, value] of Object.entries(headers)) {
        if (!key) continue;
        const lower = key.toLowerCase();
        if (lower === 'host' || lower === 'origin' || lower === 'referer') continue;
        safe[key] = value;
    }
    return safe;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'extension_config_get') {
        void (async () => {
            try {
                const config = await loadExtensionConfig();
                sendResponse({
                    ok: true,
                    config,
                });
            } catch (error) {
                sendResponse({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();
        return true;
    }

    if (message?.type === 'extension_config_set') {
        const payload = message?.payload as ExtensionConfigPayload | undefined;
        void (async () => {
            try {
                const profile: ExtensionProfile = payload?.profile === 'prod' ? 'prod' : 'uat';
                const config = await saveExtensionConfig({
                    profile,
                    apiBaseUrl: payload?.apiBaseUrl ?? '',
                    appBaseUrl: payload?.appBaseUrl ?? '',
                    wsBaseUrl: payload?.wsBaseUrl ?? '',
                });
                sendResponse({
                    ok: true,
                    config,
                });
            } catch (error) {
                sendResponse({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();
        return true;
    }

    if (message?.type === 'extension_config_test') {
        const payload = message?.payload as ExtensionConfigPayload | undefined;
        const apiBaseUrl = (payload?.apiBaseUrl ?? '').trim();
        const healthUrl = `${apiBaseUrl.replace(/\/$/, '')}/health`;
        if (!isAllowedProxyUrl(healthUrl)) {
            sendResponse({
                ok: false,
                error: `Blocked proxy URL: ${healthUrl}`,
            });
            return true;
        }

        void (async () => {
            try {
                const response = await fetch(healthUrl, {
                    method: 'GET',
                    credentials: 'include',
                });
                sendResponse({
                    ok: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
                });
            } catch (error) {
                sendResponse({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();

        return true;
    }

    if (message?.type === 'open_side_panel') {
        const tabId = sender.tab?.id;
        const windowId = sender.tab?.windowId;

        if (typeof tabId !== 'number' && typeof windowId !== 'number') {
            sendResponse({ error: 'Missing sender tab context for side panel opening.' });
            return true;
        }

        // Keep the API call in the direct message handler path to preserve user gesture.
        const openRequest =
            typeof tabId === 'number'
                ? chrome.sidePanel.open({ tabId })
                : chrome.sidePanel.open({ windowId: windowId as number });

        void openRequest
            .then(() => {
                sendResponse({ ok: true });
            })
            .catch((error) => {
                sendResponse({
                    error: error instanceof Error ? error.message : String(error),
                });
            });

        return true;
    }

    if (message?.type === 'proxy_api_fetch') {
        const payload = message?.payload as ProxyFetchPayload | undefined;
        const rawUrl = payload?.url ?? '';
        if (!isAllowedProxyUrl(rawUrl)) {
            sendResponse({
                ok: false,
                error: `Blocked proxy URL: ${rawUrl}`,
            });
            return true;
        }

        void (async () => {
            try {
                const response = await fetch(rawUrl, {
                    method: payload?.method ?? 'GET',
                    headers: sanitizeHeaders(payload?.headers),
                    body: payload?.bodyText,
                    credentials: 'include',
                });
                const bodyText = await response.text();
                const responseHeaders: Record<string, string> = {};
                response.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });
                sendResponse({
                    ok: true,
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                    bodyText,
                });
            } catch (error) {
                sendResponse({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();

        return true;
    }

    if (message.type === 'tool_execute') {
        console.log('Received tool execution request:', message);
        const executor = toolExecutors[message.name];
        if (!executor) {
            sendResponse({ error: `Unknown local tool: ${message.name}` });
            return true;
        }
        executor(message.args)
            .then(result => sendResponse({ result }))
            .catch(err => sendResponse({ error: err.message }));
        return true; // async response
    }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
